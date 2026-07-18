export interface HermesSessionIdentity {
  runtimeSessionId: string;
  storedSessionId: string;
}

type CreatedSessionResult = {
  session_id?: unknown;
  sessionId?: unknown;
  stored_session_id?: unknown;
  storedSessionId?: unknown;
  resumed?: unknown;
  session_key?: unknown;
};

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function parseHermesSlashCommand(text: string): { name: string; arg: string } | null {
  const match = text.trim().match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), arg: (match[2] || "").trim() };
}

export function normalizeCreatedSession(
  result: CreatedSessionResult,
  existingStoredSessionId?: string,
): HermesSessionIdentity {
  const runtimeSessionId = stringValue(result.session_id) || stringValue(result.sessionId);
  if (!runtimeSessionId) {
    throw new Error("Hermes did not return a runtime session id");
  }

  const storedSessionId =
    stringValue(result.stored_session_id) ||
    stringValue(result.storedSessionId) ||
    stringValue(result.resumed) ||
    stringValue(result.session_key) ||
    stringValue(existingStoredSessionId) ||
    runtimeSessionId;

  return { runtimeSessionId, storedSessionId };
}

export function mergeAuthoritativeMessages<T>(
  current: T[],
  authoritative: T[] | null | undefined,
): T[] {
  return authoritative && authoritative.length >= current.length
    ? authoritative
    : current;
}

export function normalizePersistedToolHistoryMessage(
  value: Record<string, unknown>,
  id: string,
  timestamp: number,
): HermesMessage {
  const name = typeof value.name === "string" && value.name.trim()
    ? value.name
    : "tool";
  const context = typeof value.context === "string" && value.context.trim()
    ? value.context
    : undefined;

  return {
    id,
    role: "assistant",
    content: "",
    status: "done",
    ts: timestamp,
    toolCalls: [{
      id: `${id}-tool`,
      name,
      context,
      status: "done",
      startedAt: timestamp,
      finishedAt: timestamp,
    }],
  };
}

const SENSITIVE_TOOL_ARG_KEY = /(?:api[_-]?key|authorization|password|secret|token)/i;

function formatToolArgValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function formatHermesToolArgs(value: unknown, maxLength = 180): string {
  let text = "";
  if (typeof value === "string") {
    text = value.replace(/\s+/g, " ").trim();
  } else if (value && typeof value === "object" && !Array.isArray(value)) {
    text = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${key}: ${SENSITIVE_TOOL_ARG_KEY.test(key) ? "[redacted]" : formatToolArgValue(item)}`)
      .join(" · ");
  } else if (value != null) {
    text = formatToolArgValue(value);
  }

  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

type HermesStreamingMessage = {
  role?: unknown;
  status?: unknown;
};

export function reconcileHermesStreamingMessages<T extends HermesStreamingMessage>(
  current: T[],
  authoritative: T[] | null | undefined,
): { messages: T[]; terminal: boolean } {
  const liveAssistant = [...current].reverse().find(
    (message) => message.role === "assistant" && message.status === "streaming",
  );
  if (liveAssistant) {
    return { messages: current, terminal: false };
  }

  const messages = mergeAuthoritativeMessages(current, authoritative);
  const assistant = [...messages].reverse().find((message) => message.role === "assistant");
  const status = typeof assistant?.status === "string" ? assistant.status : "done";
  return {
    messages,
    terminal: status === "done" || status === "error" || status === "cancelled",
  };
}

export function normalizeRuntimeProvider(
  provider: unknown,
  source: unknown,
): string | undefined {
  const providerName = stringValue(provider);
  const runtimeSource = stringValue(source);
  if (providerName === "custom" && runtimeSource.startsWith("custom_provider:")) {
    const customName = runtimeSource.slice("custom_provider:".length).trim();
    if (customName) return `custom:${customName}`;
  }
  return providerName || undefined;
}

export function terminalEventStatus(
  eventType: string,
): "done" | "error" | "cancelled" | null {
  switch (eventType) {
    case "message.complete":
    case "final":
      return "done";
    case "error":
      return "error";
    case "aborted":
      return "cancelled";
    default:
      return null;
  }
}


// Coalesced strip of upstream "thinking status" placeholders so a noisy
// "Hermes is thinking..." prefix doesn't dominate the streaming bubble.
// Mirrors the native Hermes (D:\\爱马仕\\apps\\desktop\\src\\lib\\chat-runtime.ts)
// THINKING_STATUS_PREFIX_RE / EMPTY_THINKING_PLACEHOLDER_RE. Tokens stream
// as small chunks - we never trim trailing whitespace per chunk because
// the model emits sentence-spacing as data, not chrome.
const THINKING_STATUS_PREFIX_RE =
  /^\s*(?:(?:[^\s.]{1,16})\s+)?(?:processing|thinking|reasoning|analyzing|pondering|contemplating|musing|cogitating|ruminating|deliberating|mulling|reflecting|computing|synthesizing|formulating|brainstorming)\.\.\.\s*/i;

const EMPTY_THINKING_PLACEHOLDER_RE =
  /\b(?:current rewritten thinking|next thinking to process|provide the thinking content|don't see any .*thinking)\b/i;

export function cleanThinkingText(value: string): string {
  if (!value) return "";
  const stripped = value.replace(THINKING_STATUS_PREFIX_RE, "");
  return EMPTY_THINKING_PLACEHOLDER_RE.test(stripped) ? "" : stripped;
}

export function hasMeaningfulReasoning(value: string | undefined | null): boolean {
  if (!value) return false;
  return cleanThinkingText(value).trim().length > 0;
}

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh";

export const REASONING_EFFORT_VALUES: readonly ReasoningEffort[] = [
  "off",
  "low",
  "medium",
  "high",
  "xhigh",
];

export function normalizeReasoningEffort(value: unknown): ReasoningEffort {
  if (typeof value !== "string") return "off";
  const lower = value.trim().toLowerCase();
  if (lower === "" || lower === "false" || lower === "no" || lower === "none") return "off";
  if (REASONING_EFFORT_VALUES.includes(lower as ReasoningEffort)) {
    return lower as ReasoningEffort;
  }
  return "off";
}
import type { HermesMessage } from "../types/hermes";
