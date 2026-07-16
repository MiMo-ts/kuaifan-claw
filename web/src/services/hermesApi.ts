import {
  normalizeCreatedSession,
  normalizeRuntimeProvider,
  terminalEventStatus,
  type HermesSessionIdentity,
} from "./hermesProtocol";
import type {
  HermesAttachment,
  HermesMessage,
  HermesSession,
  HermesSettings,
  HermesSlashCommandResult,
  HermesStartChatPayload,
  HermesStartChatResponse,
  HermesStreamEvent,
  HermesToolCall,
} from "../types/hermes";
import {
  classifyAttachment,
  normalizeAttachmentFallback,
  resolveAttachmentUrl,
  toPromptAttachmentIds,
} from "./hermesAttachments";

const RPC_TIMEOUT_MS = 30_000;

const HERMES_DASHBOARD_SESSION_TOKEN = "kfc-desk-3463b6e3f34d0f12fc416939e9a81fc395f40f4730cfc145";

type RpcResult = Record<string, any>;
type StreamListener = (event: HermesStreamEvent) => void;

interface PendingRequest {
  resolve: (value: RpcResult) => void;
  reject: (error: Error) => void;
  timer: number;
}

function normalizeBaseUrl(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

function toTimestamp(value: unknown): number {
  const numeric = Number(value || 0);
  if (!numeric) return Date.now();
  return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
}

function resultText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export class HermesApiError extends Error {
  code?: number;

  constructor(message: string, code?: number) {
    super(message);
    this.name = "HermesApiError";
    this.code = code;
  }
}

export interface HermesApiClientOptions {
  baseUrl: string;
}

export interface HermesStreamHandle {
  close: () => void;
}

export class HermesApiClient {
  private readonly baseUrl: string;
  private socket: WebSocket | null = null;
  private socketPromise: Promise<WebSocket> | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private listeners = new Map<string, Set<StreamListener>>();
  private backlog = new Map<string, HermesStreamEvent[]>();
  private storedToRuntime = new Map<string, string>();
  private runtimeToStored = new Map<string, string>();
  private sessionToken: string | null = null;

  constructor(options: HermesApiClientOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
  }

  isConfigured(): boolean {
    return Boolean(this.baseUrl);
  }

  async health(): Promise<boolean> {
    if (!this.baseUrl) return false;
    try {
      const response = await fetch(`${this.baseUrl}/api/status`, {
        cache: "no-store",
        credentials: "include",
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<HermesSession[]> {
    const result = await this.request("session.list", { limit: 200 });
    const rows = Array.isArray(result.sessions) ? result.sessions : [];
    return rows.map((row: any) => this.normalizeSession(row));
  }

  async listDashboardSessions(): Promise<HermesSession[]> {
    const response = await this.dashboardRequest("/api/sessions?limit=200&order=recent");
    const payload = await response.json();
    const rows = Array.isArray(payload?.sessions) ? payload.sessions : [];
    return rows.map((row: any) => this.normalizeSession(row));
  }

  async createSession(): Promise<HermesSession> {
    const result = await this.request("session.create", {
      source: "desktop",
      close_on_disconnect: false,
    });
    const identity = normalizeCreatedSession(result);
    this.rememberIdentity(identity);
    return this.normalizeSession({
      id: identity.storedSessionId,
      session_id: identity.storedSessionId,
      started_at: Date.now(),
      last_active: Date.now(),
    });
  }

  async deleteStoredSession(storedSessionId: string): Promise<void> {
    await this.dashboardRequest(`/api/sessions/${encodeURIComponent(storedSessionId)}`, {
      method: "DELETE",
    });
    const runtimeSessionId = this.storedToRuntime.get(storedSessionId);
    if (runtimeSessionId) this.forgetIdentity(storedSessionId, runtimeSessionId);
  }

  async renameStoredSession(storedSessionId: string, title: string): Promise<void> {
    await this.dashboardRequest(`/api/sessions/${encodeURIComponent(storedSessionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  async getSession(
    storedSessionId: string,
  ): Promise<{ session: HermesSession; messages: HermesMessage[] }> {
    let runtimeSessionId = this.storedToRuntime.get(storedSessionId);
    let rawMessages: any[] = [];

    if (runtimeSessionId) {
      try {
        const history = await this.request("session.history", {
          session_id: runtimeSessionId,
        });
        rawMessages = Array.isArray(history.messages) ? history.messages : [];
      } catch {
        this.forgetIdentity(storedSessionId, runtimeSessionId);
        runtimeSessionId = undefined;
      }
    }

    if (!runtimeSessionId) {
      const resumed = await this.request("session.resume", {
        session_id: storedSessionId,
        source: "desktop",
        close_on_disconnect: false,
      });
      const identity = normalizeCreatedSession(resumed, storedSessionId);
      this.rememberIdentity(identity);
      runtimeSessionId = identity.runtimeSessionId;
      rawMessages = Array.isArray(resumed.messages) ? resumed.messages : [];

      if (rawMessages.length === 0) {
        const history = await this.request("session.history", {
          session_id: runtimeSessionId,
        });
        rawMessages = Array.isArray(history.messages) ? history.messages : [];
      }
    }

    return {
      session: this.normalizeSession({
        id: storedSessionId,
        session_id: storedSessionId,
        message_count: rawMessages.length,
      }),
      messages: await Promise.all(rawMessages.map((message, index) =>
        this.normalizeMessage(message, storedSessionId, runtimeSessionId!, index),
      )),
    };
  }

  async getSettings(): Promise<HermesSettings> {
    try {
      const result = await this.request("setup.runtime_check", {});
      return {
        model: typeof result.model === "string" ? result.model : undefined,
        modelProvider: normalizeRuntimeProvider(result.provider, result.source),
      };
    } catch {
      return {};
    }
  }

  async startChat(payload: HermesStartChatPayload): Promise<HermesStartChatResponse> {
    const identity = await this.ensureChatSession(payload);
    const attachments: HermesAttachment[] = payload.uploadedAttachments?.slice() || [];
    if (!payload.uploadedAttachments) {
      for (const file of payload.attachments || []) {
        attachments.push(await this.uploadAttachment(
          identity.runtimeSessionId,
          file,
          payload.onAttachmentProgress,
        ));
      }
    }

    await this.request("prompt.submit", {
      session_id: identity.runtimeSessionId,
      text: payload.message,
      attachment_ids: toPromptAttachmentIds(attachments),
    });

    return {
      streamId: identity.runtimeSessionId,
      runtimeSessionId: identity.runtimeSessionId,
      sessionId: identity.storedSessionId,
      attachments,
    };
  }

  async executeSlashCommand(payload: HermesStartChatPayload): Promise<{
    sessionId: string;
    runtimeSessionId: string;
    result: HermesSlashCommandResult;
  }> {
    const identity = await this.ensureChatSession(payload);
    const command = payload.message.trim();
    let result: HermesSlashCommandResult;
    try {
      result = await this.request("slash.exec", {
        session_id: identity.runtimeSessionId,
        command,
      }) as HermesSlashCommandResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!(error instanceof HermesApiError) || error.code !== 4018 || !message.includes("command.dispatch")) {
        throw error;
      }
      const [name = "", ...parts] = command.replace(/^\//, "").split(/\s+/);
      result = await this.request("command.dispatch", {
        session_id: identity.runtimeSessionId,
        name,
        arg: parts.join(" "),
      }) as HermesSlashCommandResult;
    }
    return {
      sessionId: identity.storedSessionId,
      runtimeSessionId: identity.runtimeSessionId,
      result,
    };
  }

  async prepareAttachments(payload: HermesStartChatPayload): Promise<{
    sessionId: string;
    runtimeSessionId: string;
    attachments: HermesAttachment[];
  }> {
    const identity = await this.ensureChatSession(payload);
    const attachments: HermesAttachment[] = [];
    for (const file of payload.attachments || []) {
      attachments.push(await this.uploadAttachment(
        identity.runtimeSessionId,
        file,
        payload.onAttachmentProgress,
      ));
    }
    return {
      sessionId: identity.storedSessionId,
      runtimeSessionId: identity.runtimeSessionId,
      attachments,
    };
  }

  async cancelChat(runtimeSessionId: string): Promise<void> {
    if (!runtimeSessionId) return;
    try {
      await this.request("session.interrupt", { session_id: runtimeSessionId });
    } catch {
      // Best effort. The local message is still marked cancelled by the caller.
    }
  }

  openStream(runtimeSessionId: string, listener: StreamListener): HermesStreamHandle {
    const listeners = this.listeners.get(runtimeSessionId) ?? new Set<StreamListener>();
    listeners.add(listener);
    this.listeners.set(runtimeSessionId, listeners);

    const queued = this.backlog.get(runtimeSessionId);
    if (queued?.length) {
      this.backlog.delete(runtimeSessionId);
      queueMicrotask(() => queued.forEach((event) => listener(event)));
    }

    return {
      close: () => {
        const current = this.listeners.get(runtimeSessionId);
        current?.delete(listener);
        if (current?.size === 0) this.listeners.delete(runtimeSessionId);
      },
    };
  }

  dispose(): void {
    this.socket?.close(1000, "Hermes client disposed");
    this.socket = null;
    this.socketPromise = null;
    this.rejectPending(new HermesApiError("Hermes connection closed"));
    this.listeners.clear();
    this.backlog.clear();
  }

  private async ensureRuntimeSession(storedSessionId: string): Promise<HermesSessionIdentity> {
    const existing = this.storedToRuntime.get(storedSessionId);
    if (existing) {
      return { storedSessionId, runtimeSessionId: existing };
    }

    const resumed = await this.request("session.resume", {
      session_id: storedSessionId,
      source: "desktop",
      close_on_disconnect: false,
    });
    const identity = normalizeCreatedSession(resumed, storedSessionId);
    this.rememberIdentity(identity);
    return identity;
  }

  private async ensureChatSession(payload: HermesStartChatPayload): Promise<HermesSessionIdentity> {
    if (payload.sessionId) {
      return this.ensureRuntimeSession(payload.sessionId);
    }
    const created = await this.request("session.create", {
      source: "desktop",
      close_on_disconnect: false,
      ...(payload.model ? { model: payload.model } : {}),
      ...(payload.modelProvider ? { provider: payload.modelProvider } : {}),
      ...(payload.workspace ? { cwd: payload.workspace } : {}),
      ...(payload.profile ? { profile: payload.profile } : {}),
    });
    const identity = normalizeCreatedSession(created);
    this.rememberIdentity(identity);
    return identity;
  }

  private rememberIdentity(identity: HermesSessionIdentity): void {
    this.storedToRuntime.set(identity.storedSessionId, identity.runtimeSessionId);
    this.runtimeToStored.set(identity.runtimeSessionId, identity.storedSessionId);
  }

  private forgetIdentity(storedSessionId: string, runtimeSessionId: string): void {
    this.storedToRuntime.delete(storedSessionId);
    this.runtimeToStored.delete(runtimeSessionId);
  }

  private async request(method: string, params: Record<string, unknown>): Promise<RpcResult> {
    const socket = await this.connect();
    const id = ++this.requestId;

    return new Promise<RpcResult>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesApiError(`Hermes RPC timed out: ${method}`));
      }, RPC_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private async connect(): Promise<WebSocket> {
    if (!this.baseUrl) throw new HermesApiError("Hermes runtime URL is missing");
    if (this.socket?.readyState === WebSocket.OPEN) return this.socket;
    if (this.socketPromise) return this.socketPromise;

    this.socketPromise = (async () => {
      const token = await this.getSessionToken();
      const url = new URL(this.baseUrl);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = `${url.pathname.replace(/\/+$/, "")}/api/ws`;
      url.search = "";
      if (token) url.searchParams.set("token", token);

      return new Promise<WebSocket>((resolve, reject) => {
        const socket = new WebSocket(url.toString());
        const fail = () => reject(new HermesApiError("Hermes WebSocket connection failed"));

        socket.addEventListener("open", () => {
          socket.removeEventListener("error", fail);
          this.socket = socket;
          resolve(socket);
        }, { once: true });
        socket.addEventListener("error", fail, { once: true });
        socket.addEventListener("message", (event) => this.handleSocketMessage(event));
        socket.addEventListener("close", () => {
          if (this.socket === socket) this.socket = null;
          this.socketPromise = null;
          this.rejectPending(new HermesApiError("Hermes WebSocket disconnected"));
          this.listeners.forEach((listeners) => {
            listeners.forEach((listener) =>
              listener({ type: "error", message: "Hermes 长连接已断开" }),
            );
          });
        });
      });
    })();

    try {
      return await this.socketPromise;
    } catch (error) {
      this.socketPromise = null;
      throw error;
    }
  }

  private async getSessionToken(): Promise<string> {
    if (this.sessionToken !== null) return this.sessionToken;

    // 1. The desktop shell mints `HERMES_DASHBOARD_SESSION_TOKEN` via
    //    `runtime.json` and passes it to the Hermes process. The Hermes
    //    dashboard reads it as `_SESSION_TOKEN` and expects every HTTP
    //    request to carry it as `X-Hermes-Session-Token` (REST) or
    //    `?token=` (WebSocket). Use the same value here so the embedded
    //    Tauri WebView can talk to the loopback dashboard without loading
    //    the dashboard's HTML.
    this.sessionToken = HERMES_DASHBOARD_SESSION_TOKEN;
    return this.sessionToken;
  }

  private async dashboardRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getSessionToken();
    const headers = new Headers(init.headers);
    if (token) headers.set("X-Hermes-Session-Token", token);
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      cache: "no-store",
      credentials: "include",
    });
    if (!response.ok) {
      throw new HermesApiError(`Hermes dashboard request failed: ${response.status}`);
    }
    return response;
  }

  private async uploadAttachment(
    runtimeSessionId: string,
    file: File,
    onProgress?: (file: File, progress: number) => void,
  ): Promise<NonNullable<HermesMessage["attachments"]>[number]> {
    const token = await this.getSessionToken();
    const form = new FormData();
    form.append("session_id", runtimeSessionId);
    form.append("file", file, file.name);

    const response = await new Promise<any>((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open("POST", `${this.baseUrl}/api/chat/attachments`);
      request.withCredentials = true;
      if (token) request.setRequestHeader("X-Hermes-Session-Token", token);
      request.upload.onprogress = (event) => {
        if (event.lengthComputable) onProgress?.(file, event.total ? event.loaded / event.total : 0);
      };
      request.onerror = () => reject(new HermesApiError(
        "Hermes attachment upload failed: the gateway did not accept the network request",
      ));
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) {
          let detail = "";
          try {
            detail = String(JSON.parse(request.responseText)?.detail || "").trim();
          } catch {
            detail = request.statusText.trim();
          }
          reject(new HermesApiError(`Hermes attachment upload failed: ${request.status}${detail ? ` (${detail})` : ""}`));
          return;
        }
        try {
          resolve(JSON.parse(request.responseText));
        } catch {
          reject(new HermesApiError("Hermes attachment upload returned invalid JSON"));
        }
      };
      request.send(form);
    });

    const raw = response?.attachment || {};
    const rawUrl = typeof response?.url === "string" ? response.url : "";
    return {
      id: String(raw.id || ""),
      name: String(raw.name || file.name),
      mime: String(raw.mime || file.type || "application/octet-stream"),
      size: Number(raw.size || file.size || 0),
      kind: classifyAttachment(String(raw.mime || file.type || "")),
      state: "uploaded",
      url: await this.materializeAttachmentUrl(resolveAttachmentUrl({
        baseUrl: this.baseUrl,
        attachmentId: String(raw.id || ""),
        runtimeSessionId,
        rawUrl,
      })),
      fallback: typeof raw.fallback === "string" ? raw.fallback : undefined,
    };
  }

  private handleSocketMessage(event: MessageEvent): void {
    let message: any;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      window.clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(new HermesApiError(
          message.error.message || "Hermes RPC failed",
          message.error.code,
        ));
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }

    if (message.method !== "event" || !message.params) return;
    const runtimeSessionId = String(message.params.session_id || "");
    if (!runtimeSessionId) return;
    const normalized = this.normalizeStreamEvent(
      String(message.params.type || ""),
      message.params.payload ?? {},
    );
    if (!normalized) return;

    const listeners = this.listeners.get(runtimeSessionId);
    if (listeners?.size) {
      listeners.forEach((listener) => listener(normalized));
      return;
    }

    const queued = this.backlog.get(runtimeSessionId) ?? [];
    queued.push(normalized);
    this.backlog.set(runtimeSessionId, queued.slice(-200));
  }

  private normalizeStreamEvent(type: string, payload: any): HermesStreamEvent | null {
    const terminalStatus = terminalEventStatus(type);
    if (terminalStatus === "done") {
      return {
        type: "final",
        text: typeof payload.text === "string" ? payload.text : "",
        status: payload.status,
      };
    }
    if (terminalStatus === "error") {
      return { type: "error", message: payload.message || "Hermes 回复失败" };
    }
    if (terminalStatus === "cancelled") return { type: "aborted" };

    switch (type) {
      case "message.delta":
        return { type: "delta", text: String(payload.text || "") };
      case "thinking.delta":
      case "reasoning.delta":
      case "reasoning.available":
        return { type: "reasoning", text: String(payload.text || "") };
      case "tool.start":
        return { type: "tool_call", toolCall: this.normalizeToolCall(payload) };
      case "tool.complete":
        return {
          type: "tool_result",
          toolCallId: String(payload.tool_id || payload.id || ""),
          result: resultText(payload.result ?? payload.result_text),
        };
      case "session.info":
      case "session.title":
      case "session.created":
        return {
          type: "meta",
          model: typeof payload.model === "string" ? payload.model : undefined,
          title: typeof payload.title === "string" ? payload.title : undefined,
        };
      default:
        return null;
    }
  }

  private normalizeSession(row: any): HermesSession {
    const createdAt = toTimestamp(row.started_at || row.created_at || row.createdAt);
    const updatedAt = toTimestamp(
      row.last_active || row.updated_at || row.updatedAt || createdAt,
    );
    return {
      id: String(row.id || row.session_id || row.sessionId || ""),
      title: String(row.title || row.preview || "新对话"),
      lastMessage: String(row.preview || row.last_message || ""),
      messageCount: Number(row.message_count || row.messageCount || 0),
      createdAt,
      updatedAt,
      model: typeof row.model === "string" ? row.model : undefined,
      running: Boolean(row.running),
    };
  }

  private async normalizeMessage(
    message: any,
    sessionId: string,
    runtimeSessionId: string,
    index: number,
  ): Promise<HermesMessage> {
    const content = message.content ?? message.text ?? message.message ?? "";
    return {
      id: String(message.id || message.message_id || `${sessionId}-${index}`),
      role: (message.role || "user") as HermesMessage["role"],
      content: resultText(content),
      status: message.status || "done",
      ts: toTimestamp(message.ts || message.timestamp || message.created_at),
      model: typeof message.model === "string" ? message.model : undefined,
      reasoning: typeof message.reasoning === "string" ? message.reasoning : undefined,
      toolCalls: Array.isArray(message.tool_calls)
        ? message.tool_calls.map((tool: any) => this.normalizeToolCall(tool))
        : undefined,
      attachments: Array.isArray(message.attachments)
        ? await Promise.all(message.attachments.map((attachment: any) =>
          this.normalizeAttachment(attachment, runtimeSessionId),
        ))
        : undefined,
      errorMessage: message.error_message || message.errorMessage,
    };
  }

  private async normalizeAttachment(
    attachment: unknown,
    runtimeSessionId: string,
  ): Promise<HermesAttachment> {
    const raw = attachment && typeof attachment === "object"
      ? attachment as Record<string, unknown>
      : {};
    const mime = typeof raw.mime === "string" ? raw.mime : "application/octet-stream";
    const rawUrl = typeof raw.url === "string" ? raw.url : "";

    return {
      id: typeof raw.id === "string" ? raw.id : "",
      name: typeof raw.name === "string" ? raw.name : "attachment",
      mime,
      size: typeof raw.size === "number" && Number.isFinite(raw.size) ? raw.size : 0,
      kind: typeof raw.kind === "string"
        && ["image", "video", "audio", "document", "file"].includes(raw.kind)
        ? raw.kind as HermesAttachment["kind"]
        : classifyAttachment(mime),
      state: "uploaded",
      url: await this.materializeAttachmentUrl(resolveAttachmentUrl({
        baseUrl: this.baseUrl,
        attachmentId: typeof raw.id === "string" ? raw.id : "",
        runtimeSessionId,
        rawUrl,
      })),
      fallback: normalizeAttachmentFallback(raw.fallback),
    };
  }

  private async materializeAttachmentUrl(sourceUrl: string): Promise<string> {
    if (!sourceUrl) return "";
    try {
      const source = new URL(sourceUrl);
      const base = new URL(this.baseUrl);
      if (source.origin !== base.origin) return source.toString();
      const token = await this.getSessionToken();
      const response = await fetch(source.toString(), {
        headers: token ? { "X-Hermes-Session-Token": token } : undefined,
        credentials: "include",
      });
      if (!response.ok) return "";
      return URL.createObjectURL(await response.blob());
    } catch {
      return "";
    }
  }

  private normalizeToolCall(payload: any): HermesToolCall {
    return {
      id: String(payload.tool_id || payload.id || `tool-${Date.now()}`),
      name: String(payload.name || "tool"),
      args: payload.args ?? payload.args_text,
      result: resultText(payload.result ?? payload.result_text) || undefined,
      status: payload.error ? "error" : payload.result != null ? "done" : "running",
      startedAt: toTimestamp(payload.started_at || Date.now()),
      finishedAt: payload.result != null ? Date.now() : undefined,
    };
  }

  private rejectPending(error: Error): void {
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer);
      pending.reject(error);
    });
    this.pending.clear();
  }
}

export function clientFromGuiUrl(guiUrl: string | null | undefined): HermesApiClient {
  return new HermesApiClient({ baseUrl: guiUrl || "" });
}
