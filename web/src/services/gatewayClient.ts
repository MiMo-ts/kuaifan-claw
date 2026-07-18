/**
 * 前端直连 OpenClaw 网关 WebSocket — 与控制台 UI 完全相同的协议（含设备身份）
 * 支持流式聊天 (chat.send → chat events → delta/final/aborted/error)
 */
type EventHandler = (event: string, payload: any) => void;

export interface ChatDelta {
  runId: string;
  sessionKey: string;
  seq: number;
  state: 'delta' | 'final' | 'aborted' | 'error';
  message?: string;
  errorMessage?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  stopReason?: string;
}

export type ChatDeltaHandler = (delta: ChatDelta) => void;

export interface SessionEntry {
  key: string;
  sessionId?: string;
  label?: string;
  updatedAt?: number;
  createdAt?: number;
  model?: string;
  modelProvider?: string;
  thinkingLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  origin?: { label?: string; chatType?: string; channel?: string };
  lastMessage?: { role: string; preview: string };
  spawnedBy?: string;
}

interface PendingReq {
  resolve: (v: any) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

// ── Device Identity (ECDSA P-256, PEM format so gateway auto-detects algorithm) ──

const DEVICE_STORAGE_KEY = 'clawdbot-gateway-device-id-v2';

// Session browsing and chat only need regular operator read/write access.
// Requesting admin, approvals, or pairing scopes turns a reconnect into a
// device-permission upgrade, which OpenClaw correctly blocks until approved.
export const MANAGER_OPERATOR_SCOPES = ['operator.read', 'operator.write'] as const;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function spkiToPem(spkiDer: ArrayBuffer): string {
  const b64 = arrayBufferToBase64(spkiDer);
  const lines = b64.match(/.{1,64}/g)?.join('\n') ?? b64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadOrCreateDeviceIdentity(): Promise<{
  deviceId: string; publicKeyPem: string; privateKey: CryptoKey;
}> {
  try {
    const stored = localStorage.getItem(DEVICE_STORAGE_KEY);
    if (stored) {
      const { privateKeyJwk, publicKeySpkiB64, deviceId } = JSON.parse(stored);
      const privateKey = await crypto.subtle.importKey('jwk', privateKeyJwk,
        { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
      const publicKeyPem = spkiToPem(Uint8Array.from(atob(publicKeySpkiB64), c => c.charCodeAt(0)).buffer);
      return { deviceId, publicKeyPem, privateKey };
    }
  } catch { /* regenerate */ }

  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const spkiDer = await crypto.subtle.exportKey('spki', keyPair.publicKey);
  const deviceId = await sha256Hex(spkiDer);
  const publicKeySpkiB64 = arrayBufferToBase64(spkiDer);
  const publicKeyPem = spkiToPem(spkiDer);

  localStorage.setItem(DEVICE_STORAGE_KEY, JSON.stringify({ privateKeyJwk, publicKeySpkiB64, deviceId }));
  return { deviceId, publicKeyPem, privateKey: keyPair.privateKey };
}

function buildSignaturePayload(params: {
  deviceId: string; clientId: string; clientMode: string;
  role: string; scopes: string[]; signedAtMs: number; token: string; nonce: string;
}): string {
  return [
    'v2', params.deviceId, params.clientId, params.clientMode,
    params.role, params.scopes.join(','), String(params.signedAtMs),
    params.token, params.nonce,
  ].join('|');
}

async function signPayload(privateKey: CryptoKey, payload: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: { name: 'SHA-256' } },
    privateKey,
    new TextEncoder().encode(payload),
  );
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── Gateway Client ──

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingReq>();
  private nextId = 1;
  private _ready = false;
  private readyResolve: (() => void) | null = null;
  readonly ready: Promise<void>;
  onEvent: EventHandler | null = null;
  onChatDelta: ChatDeltaHandler | null = null;
  onClose: ((code: number, reason: string) => void) | null = null;
  onConnected: (() => void) | null = null;
  port = 18789;
  token = '';
  private connectNonce: string | null = null;
  private _closed = false;

  constructor() {
    this.ready = new Promise(r => { this.readyResolve = r; });
  }

  get isConnected(): boolean { return this._ready && this.ws?.readyState === WebSocket.OPEN; }
  get isClosed(): boolean { return this._closed; }

  /** 使用默认路径读取 openclaw.json 创建客户端 */
  static async create(): Promise<GatewayClient> {
    const gw = new GatewayClient();
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const dataDir: string = await invoke('get_data_dir');
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const { join } = await import('@tauri-apps/api/path');
      const cfgPath = await join(dataDir, 'openclaw', 'openclaw.json');
      const content = await readTextFile(cfgPath);
      const cfg = JSON.parse(content);
      gw.port = cfg?.gateway?.port ?? 18789;
      gw.token = cfg?.gateway?.auth?.token ?? '';
    } catch {
      gw.port = 18789;
    }
    if (!gw.token) gw.token = localStorage.getItem('gw-token') || '';
    if (gw.token) localStorage.setItem('gw-token', gw.token);
    return gw;
  }

  /** 直接指定端口和 token 创建客户端，无需读取文件 */
  static createDirect(port: number, token?: string): GatewayClient {
    const gw = new GatewayClient();
    gw.port = port || 18789;
    gw.token = token || localStorage.getItem('gw-token') || '';
    if (gw.token) localStorage.setItem('gw-token', gw.token);
    return gw;
  }

  connect() {
    if (this._closed) return;
    console.log('[gw] connecting to ws://127.0.0.1:' + this.port + ' token=' + (this.token ? this.token.substring(0,8)+'...' : '(none)'));
    const ws = new WebSocket(`ws://127.0.0.1:${this.port}/`);
    this.ws = ws;
    ws.onopen = () => { console.log('[gw] socket opened'); };
    ws.onmessage = (e) => {
      try { this._handle(JSON.parse(e.data as string)); }
      catch { /* ignore */ }
    };
    ws.onclose = (e) => {
      console.log('[gw] closed code='+e.code+' reason='+e.reason);
      this._ready = false;
      this.onClose?.(e.code, e.reason);
    };
    ws.onerror = (e) => { console.log('[gw] socket error', e); };
  }

  private _handle(msg: any) {
    // Handle connect.challenge event
    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      this.connectNonce = msg.payload?.nonce ?? null;
      this._sendConnect();
      return;
    }

    // Handle chat streaming events
    if (msg.type === 'event' && msg.event === 'chat') {
      if (this.onChatDelta) {
        const p = msg.payload ?? {};
        this.onChatDelta({
          runId: p.runId ?? '',
          sessionKey: p.sessionKey ?? '',
          seq: p.seq ?? 0,
          state: p.state ?? 'delta',
          message: p.message,
          errorMessage: p.errorMessage,
          usage: p.usage,
          stopReason: p.stopReason,
        });
      }
      return;
    }

    // Generic event forwarding
    if (msg.type === 'event') {
      this.onEvent?.(msg.event, msg.payload);
      return;
    }

    // RPC response
    if (msg.type === 'res') {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok !== false) p.resolve(msg.payload ?? null);
      else {
        const errMsg = msg.error?.message ?? msg.error ?? 'request failed';
        p.reject(new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)));
      }
    }
  }

  private async _sendConnect() {
    const id = String(this.nextId++);
    const clientId = 'openclaw-control-ui';
    const clientMode = 'webchat';
    const role = 'operator';
    const scopes = [...MANAGER_OPERATOR_SCOPES];

    let device: any = undefined;
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      try {
        const identity = await loadOrCreateDeviceIdentity();
        const signedAtMs = Date.now();
        const payload = buildSignaturePayload({
          deviceId: identity.deviceId, clientId, clientMode,
          role, scopes, signedAtMs, token: this.token || '',
          nonce: this.connectNonce ?? '',
        });
        const signature = await signPayload(identity.privateKey, payload);
        device = {
          id: identity.deviceId,
          publicKey: identity.publicKeyPem,
          signature,
          signedAt: signedAtMs,
          nonce: this.connectNonce ?? undefined,
        };
      } catch (e) { console.warn('[gw] device identity failed:', e); }
    }

    const body = {
      type: 'req', id, method: 'connect',
      params: {
        minProtocol: 4, maxProtocol: 4,
        client: {
          id: clientId, version: 'control-ui',
          platform: navigator.platform?.startsWith('Win') ? 'win32' :
                    navigator.platform?.startsWith('Mac') ? 'darwin' : 'linux',
          mode: clientMode,
          instanceId: 'manager-' + Math.random().toString(36).slice(2, 8),
        },
        role,
        scopes,
        device,
        caps: [],
        auth: this.token ? { token: this.token } : undefined,
        userAgent: navigator.userAgent,
        locale: navigator.language,
      },
    };

    const pending: PendingReq = {
      resolve: () => {
        this._ready = true;
        this.readyResolve?.();
        this.onConnected?.();
        console.log('[gw] connected');
      },
      reject: (e: Error) => { console.error('[gw] connect failed:', e.message); },
      timer: setTimeout(() => { this.pending.delete(id); }, 15000),
    };
    this.pending.set(id, pending);
    this.ws?.send(JSON.stringify(body));
  }

  // ── Generic JSON-RPC ──

  async request(method: string, params?: any): Promise<any> {
    if (!this._ready) await this.ready;
    const id = String(this.nextId++);
    const body: any = { type: 'req', id, method };
    if (params !== undefined) body.params = params;
    return new Promise((resolve, reject) => {
      const pending: PendingReq = {
        resolve, reject,
        timer: setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout: ${method}`)); }, 30000),
      };
      this.pending.set(id, pending);
      try { this.ws?.send(JSON.stringify(body)); }
      catch (e) { this.pending.delete(id); clearTimeout(pending.timer); reject(e); }
    });
  }

  // ── Chat API ──

  /** 发送消息并流式接收回复。返回 runId，增量通过 onChatDelta 回调推送。 */
  async sendChatStream(opts: {
    sessionKey?: string;
    message: string;
    thinking?: string | number;
    deliver?: boolean;
    timeoutMs?: number;
  }): Promise<{ runId: string }> {
    if (!this._ready) await this.ready;
    const runId = 'mgr-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const result = await this.request('chat.send', {
      sessionKey: opts.sessionKey ?? 'main',
      message: opts.message,
      thinking: opts.thinking,
      deliver: opts.deliver ?? false,
      timeoutMs: opts.timeoutMs,
      idempotencyKey: runId,
    });
    return { runId: result?.runId ?? runId };
  }

  /** 中断正在运行的对话 */
  async abortChat(sessionKey: string, runId?: string): Promise<void> {
    await this.request('chat.abort', { sessionKey, runId: runId ?? undefined });
  }

  /** 加载会话历史 */
  async loadHistory(sessionKey: string, limit = 100): Promise<{
    sessionKey: string;
    sessionId?: string;
    messages?: Array<{ role: string; content: string; ts?: number; name?: string }>;
    thinkingLevel?: string;
  }> {
    return this.request('chat.history', { sessionKey, limit });
  }

  /** 获取网关状态 */
  async getStatus(): Promise<any> {
    return this.request('status');
  }

  // ── Session API ──

  /** 列出所有会话 */
  async listSessions(opts?: {
    limit?: number; activeMinutes?: number; search?: string;
    includeDerivedTitles?: boolean; includeLastMessage?: boolean;
  }): Promise<SessionEntry[]> {
    const result = await this.request('sessions.list', {
      limit: opts?.limit ?? 100,
      activeMinutes: opts?.activeMinutes,
      search: opts?.search,
      includeDerivedTitles: opts?.includeDerivedTitles ?? true,
      includeLastMessage: opts?.includeLastMessage ?? true,
    });
    return (result?.sessions ?? result ?? []) as SessionEntry[];
  }

  /** 删除会话 */
  async deleteSession(key: string, deleteTranscript = false): Promise<void> {
    await this.request('sessions.delete', { key, deleteTranscript });
  }

  /** 更新会话元数据 */
  async patchSession(key: string, patch: {
    label?: string; model?: string; thinkingLevel?: string;
  }): Promise<void> {
    await this.request('sessions.patch', { key, ...patch });
  }

  /** 重置会话（保留模型设置，清除 token 计数，新建 transcript） */
  async resetSession(key: string): Promise<void> {
    await this.request('sessions.reset', { key });
  }

  // ── Lifecycle ──

  close() {
    this._closed = true;
    this._ready = false;
    for (const [, p] of this.pending) { clearTimeout(p.timer); p.reject(new Error('closed')); }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
  }
}
