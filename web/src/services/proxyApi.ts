const PROXY_BASE = 'https://kuaifanio.cn/v1';
const KEY_STORAGE_PREFIX = 'openclaw-api-key-';

export function getProxyBaseUrl(): string {
  return PROXY_BASE;
}

function getKeyStorageName(providerId: string): string {
  return `${KEY_STORAGE_PREFIX}${providerId}`;
}

export function getStoredApiKey(providerId: string = 'kuaifan'): string | null {
  return localStorage.getItem(getKeyStorageName(providerId));
}

export function saveApiKey(key: string, providerId: string = 'kuaifan'): void {
  localStorage.setItem(getKeyStorageName(providerId), key);
}

export function clearApiKey(providerId: string = 'kuaifan'): void {
  localStorage.removeItem(getKeyStorageName(providerId));
}

export function hasApiKey(providerId: string = 'kuaifan'): boolean {
  const key = getStoredApiKey(providerId);
  return !!key && key.length > 0;
}

export function clearAllApiKeys(): void {
  const keys = Object.keys(localStorage).filter(k => k.startsWith(KEY_STORAGE_PREFIX));
  keys.forEach(k => localStorage.removeItem(k));
}

export interface ProxyModel {
  id: string;
  object?: string;
  owned_by?: string;
}

/** Fetch available models from the proxy */
export async function fetchProxyModels(signal?: AbortSignal): Promise<ProxyModel[]> {
  const key = getStoredApiKey();
  if (!key) throw new Error('未配置 API Key');

  const res = await fetch(`${PROXY_BASE}/models`, {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return data.data || data.models || data || [];
}

/** Test connection to the proxy */
export async function testProxyConnection(modelId?: string, signal?: AbortSignal): Promise<{ ok: boolean; message: string }> {
  const key = getStoredApiKey();
  if (!key) return { ok: false, message: '未配置 API Key' };

  try {
    const res = await fetch(`${PROXY_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelId || 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
      }),
      signal,
    });
    if (res.ok) return { ok: true, message: '连接成功' };
    const text = await res.text();
    return { ok: false, message: `${res.status}: ${text.slice(0, 200)}` };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) };
  }
}

/** Message content — plain text or multimodal array */
export type MessageContent = string | ({ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } })[];

export interface ChatMessage {
  role: string;
  content: MessageContent;
}

/** Read a local file and return base64 data URL (for Tauri fs) */
export async function fileToBase64(path: string): Promise<string> {
  const { readFile } = await import('@tauri-apps/plugin-fs');
  const contents = await readFile(path);
  const ext = path.split('.').pop()?.toLowerCase() || 'png';
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', pdf: 'application/pdf', txt: 'text/plain', json: 'application/json', md: 'text/markdown' };
  const mime = mimeMap[ext] || 'application/octet-stream';
  const base64 = btoa(String.fromCharCode(...new Uint8Array(contents)));
  return `data:${mime};base64,${base64}`;
}

/** Streaming chat completion — calls callback with each delta chunk */
export async function streamChatCompletion(
  model: string,
  messages: ChatMessage[],
  onDelta: (content: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const key = getStoredApiKey();
  if (!key) throw new Error('未配置 API Key');

  const res = await fetch(`${PROXY_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error('Response body is not readable');

  const decoder = new TextDecoder();
  let buffer = '';
  let fullContent = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullContent += delta;
          onDelta(delta);
        }
      } catch {
        // Skip unparseable lines
      }
    }
  }

  return fullContent;
}

/** Non-streaming chat completion */
export async function chatCompletion(
  model: string,
  messages: ChatMessage[],
  signal?: AbortSignal,
): Promise<string> {
  const key = getStoredApiKey();
  if (!key) throw new Error('未配置 API Key');

  const res = await fetch(`${PROXY_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model, messages }),
    signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || JSON.stringify(data);
}
