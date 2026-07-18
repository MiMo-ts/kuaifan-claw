// Hermes WebUI domain types
// Mirrors the contracts exposed by the Python Hermes WebUI server.

export type HermesRole = "user" | "assistant" | "system" | "tool";

export type HermesMessageStatus =
  | "streaming"
  | "done"
  | "error"
  | "cancelled";

export interface HermesAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  kind?: "image" | "video" | "audio" | "document" | "file";
  state?: "pending" | "uploading" | "uploaded" | "error";
  previewUrl?: string;
  fallback?: string;
  errorMessage?: string;
}

export interface HermesLocalAttachment {
  id: string;
  file: File;
  previewUrl: string;
  kind: NonNullable<HermesAttachment["kind"]>;
  state: NonNullable<HermesAttachment["state"]>;
  uploaded?: HermesAttachment;
  errorMessage?: string;
  progress?: number;
}

export interface HermesToolCall {
  id: string;
  name: string;
  // Human-readable label built by Hermes from the tool name + args
  // (e.g. "Asked a question", "Opened www.douyin.com", "Ran agent-browser
  // install"). This is the same `context` field the native Hermes desktop
  // renders as the per-step heading in its activity timeline; without it
  // every tool call collapses to a bare `name` chip ("browser_navigate")
  // and the user can't see what the agent actually did.
  context?: string;
  // The tool.start payload also carries a redacted pretty-printed JSON
  // dump of the args (in verbose mode). Captured for the collapsible
  // "show details" panel.
  argsText?: string;
  args?: unknown;
  result?: string;
  status: "running" | "done" | "error";
  startedAt: number;
  finishedAt?: number;
  durationS?: number;
}

export interface HermesMessage {
  id: string;
  role: HermesRole;
  content: string;
  status?: HermesMessageStatus;
  ts: number;
  model?: string;
  reasoning?: string;
  toolCalls?: HermesToolCall[];
  attachments?: HermesAttachment[];
  errorMessage?: string;
  reasoningTokens?: number;
}

export interface HermesSession {
  id: string;
  title: string;
  lastMessage?: string;
  messageCount: number;
  updatedAt: number;
  createdAt: number;
  model?: string;
  unread?: boolean;
  running?: boolean;
}

export interface HermesSettings {
  model?: string;
  modelProvider?: string;
  profile?: string;
  workspace?: string;
  availableModels?: Array<{ id: string; label: string; provider?: string }>;
  reasoningEffort?: "off" | "low" | "medium" | "high" | "xhigh";
}

// Events normalized from the Hermes JSON-RPC WebSocket.
export type HermesStreamEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; toolCall: HermesToolCall }
  | {
    type: "tool_result";
    toolCallId: string;
    result: string;
    status?: "done" | "error";
    durationS?: number;
  }
  | { type: "final"; messageId?: string; text?: string; status?: string; reasoningTokens?: number }
  | { type: "aborted" }
  | { type: "error"; message: string }
  | { type: "meta"; model?: string; title?: string; reasoningTokens?: number; reasoningEffort?: string };

export interface HermesStartChatPayload {
  sessionId?: string;
  message: string;
  model?: string;
  modelProvider?: string;
  workspace?: string;
  profile?: string;
  attachments?: File[];
  uploadedAttachments?: HermesAttachment[];
  onAttachmentProgress?: (file: File, progress: number) => void;
}

export interface HermesStartChatResponse {
  streamId: string;
  sessionId?: string;
  runtimeSessionId?: string;
  userMessageId?: string;
  assistantMessageId?: string;
  attachments?: HermesAttachment[];
}

export interface HermesSlashCommandResult {
  type?: "exec" | "send" | "prefill" | "skill" | "plugin" | "alias";
  output?: string;
  message?: string;
  notice?: string;
  name?: string;
}
