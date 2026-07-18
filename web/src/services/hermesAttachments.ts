export type HermesAttachmentKind = "image" | "video" | "audio" | "document" | "file";

export interface HermesPromptAttachment {
  id: string;
  state?: "pending" | "uploading" | "uploaded" | "error";
}

const TEXTUAL_DOCUMENT_MIMES = new Set([
  "application/ecmascript",
  "application/javascript",
  "application/json",
  "application/ld+json",
  "application/toml",
  "application/typescript",
  "application/x-javascript",
  "application/x-toml",
  "application/x-typescript",
  "application/x-yaml",
  "application/x-yml",
  "application/xml",
  "application/yaml",
]);
const TEXTUAL_DOCUMENT_EXTENSIONS = new Set([
  "asm", "bash", "bat", "c", "cc", "clj", "cmd", "coffee", "cpp", "cs", "css", "cxx",
  "dart", "env", "ex", "exs", "fs", "fsx", "go", "gradle", "groovy", "h", "hpp", "htm",
  "html", "ini", "java", "js", "json", "json5", "jsonc", "jsx", "kt", "kts", "less", "lua",
  "m", "markdown", "md", "mjs", "php", "pl", "pm", "properties", "ps1", "py", "pyi", "r",
  "rb", "rs", "sass", "scala", "scss", "sh", "sql", "svelte", "swift", "toml", "ts", "tsx",
  "vue", "xml", "yaml", "yml",
]);

export function normalizeAttachmentFallback(value: unknown): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text || undefined;
  }
  if (!value || typeof value !== "object") return undefined;

  const fallback = value as Record<string, unknown>;
  for (const key of ["reason", "message", "detail"]) {
    const candidate = fallback[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export interface AttachmentUrlInput {
  baseUrl: string;
  attachmentId: string;
  runtimeSessionId: string;
  rawUrl?: string;
}

export function resolveAttachmentUrl({
  baseUrl,
  attachmentId,
  runtimeSessionId,
  rawUrl,
}: AttachmentUrlInput): string {
  try {
    if (rawUrl) return new URL(rawUrl, `${baseUrl}/`).toString();
    if (!attachmentId || !runtimeSessionId) return "";
    const url = new URL(`/api/chat/attachments/${encodeURIComponent(attachmentId)}`, `${baseUrl}/`);
    url.searchParams.set("session_id", runtimeSessionId);
    return url.toString();
  } catch {
    return "";
  }
}

export function attachmentSendState(
  attachments: Array<Pick<HermesPromptAttachment, "state">>,
): "ready" | "uploading" | "error" {
  if (attachments.some((attachment) => attachment.state === "pending" || attachment.state === "uploading")) {
    return "uploading";
  }
  if (attachments.some((attachment) => attachment.state === "error")) {
    return "error";
  }
  return "ready";
}

export function classifyAttachment(mime: string, name = ""): HermesAttachmentKind {
  const normalized = String(mime || "").toLowerCase();
  const extension = String(name || "").split(".").pop()?.toLowerCase() || "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  if (
    normalized.startsWith("text/")
    || normalized === "application/pdf"
    || normalized.includes("document")
    || normalized.includes("spreadsheet")
    || TEXTUAL_DOCUMENT_MIMES.has(normalized)
    || TEXTUAL_DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return "document";
  }
  return "file";
}

export function toPromptAttachmentIds(attachments: HermesPromptAttachment[]): string[] {
  return attachments
    .filter((attachment) => attachment.state === "uploaded")
    .map((attachment) => attachment.id)
    .filter(Boolean);
}

export interface HermesAssistantAttachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  url: string;
  kind: HermesAttachmentKind;
  state: "uploaded";
}

export function extractAssistantAttachments(content: string): {
  text: string;
  attachments: HermesAssistantAttachment[];
} {
  const attachments: HermesAssistantAttachment[] = [];
  const text = String(content || "").replace(/(?:^|\s)MEDIA:(https?:\/\/[^\s]+)/g, (match, url: string) => {
    try {
      const parsed = new URL(url);
      const name = decodeURIComponent(parsed.pathname.split("/").pop() || "attachment");
      const extension = name.split(".").pop()?.toLowerCase() || "";
      const mime = extension === "mp4" || extension === "webm" || extension === "mov"
        ? `video/${extension === "mov" ? "quicktime" : extension}`
        : extension === "mp3" || extension === "wav" || extension === "ogg"
          ? `audio/${extension}`
          : extension === "png" ? "image/png"
            : extension === "jpg" || extension === "jpeg" ? "image/jpeg"
              : extension === "webp" ? "image/webp"
                : "application/octet-stream";
      attachments.push({ id: `media-${attachments.length}-${parsed.href}`, name, mime, size: 0, url: parsed.href, kind: classifyAttachment(mime), state: "uploaded" });
      return match.startsWith("\n") ? "\n" : "";
    } catch {
      return match;
    }
  }).trim();
  return { text, attachments };
}
