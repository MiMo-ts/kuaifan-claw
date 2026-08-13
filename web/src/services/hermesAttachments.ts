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
  localPath?: string;
  exportDir?: string;
  kind: HermesAttachmentKind;
  state: "uploaded";
}

const ASSISTANT_MEDIA_DIRECTIVE = /(?:^|\s)MEDIA:(https?:\/\/[^\s]+|(?:[A-Za-z]:[\\/]|\/|~\/)[^\s]+)/g;

function mediaFileName(source: string): string {
  const withoutQuery = source.split(/[?#]/, 1)[0];
  return decodeURIComponent(withoutQuery.split(/[\\/]/).pop() || "attachment");
}

function mediaMime(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase() || "";
  if (extension === "mp4" || extension === "webm") return `video/${extension}`;
  if (extension === "mov") return "video/quicktime";
  if (extension === "mp3" || extension === "wav" || extension === "ogg") return `audio/${extension}`;
  if (extension === "png") return "image/png";
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  return "application/octet-stream";
}

export function attachmentExportName(attachment: {
  name?: string;
  localPath?: string;
}): string {
  const candidate = String(attachment.name || attachment.localPath || "image").trim();
  const name = mediaFileName(candidate);
  return name && name !== "." ? name : "image";
}

export function extractKuaifanExportDirectories(
  toolResults: Array<{ result?: unknown }>,
): Map<string, string> {
  const directories = new Map<string, string>();
  for (const tool of toolResults) {
    if (typeof tool?.result !== "string") continue;
    try {
      const jsonLine = tool.result.split(/\r?\n/).map((line) => line.trim()).find((line) => line.startsWith("{") && line.endsWith("}"));
      if (!jsonLine) continue;
      const value = JSON.parse(jsonLine) as Record<string, unknown>;
      const mediaPath = value.artifact === "kuaifan-image/v1"
        ? value.image_path
        : value.artifact === "kuaifan-video/v1"
          ? value.video_path
          : undefined;
      if (typeof mediaPath !== "string" || typeof value.export_dir !== "string") continue;
      const exportDir = value.export_dir.trim();
      if (exportDir) directories.set(mediaPath, exportDir);
    } catch {
      // Tool results are often mixed human-readable output; ignore non-JSON.
    }
  }
  return directories;
}

function parseKuaifanArtifactLine(line: string): HermesAssistantAttachment | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  try {
    const value = JSON.parse(trimmed) as Record<string, unknown>;
    if (value.artifact === "kuaifan-image/v1" && typeof value.image_path === "string" && value.image_path.trim()) {
      const localPath = value.image_path.trim();
      const name = attachmentExportName({ name: mediaFileName(localPath), localPath });
      const mime = mediaMime(name);
      return {
        id: `kuaifan-image-${localPath}`,
        name,
        mime,
        size: 0,
        url: "",
        localPath,
        exportDir: typeof value.export_dir === "string" ? value.export_dir.trim() || undefined : undefined,
        kind: classifyAttachment(mime, name),
        state: "uploaded",
      };
    }
    if (value.artifact === "kuaifan-video/v1") {
      const rawPath = typeof value.video_path === "string" && value.video_path.trim()
        ? value.video_path.trim()
        : typeof value.absolute_path === "string" && value.absolute_path.trim()
          ? value.absolute_path.trim()
          : "";
      if (!rawPath) return null;
      const name = attachmentExportName({ name: mediaFileName(rawPath), localPath: rawPath });
      const mime = mediaMime(name) === "application/octet-stream" ? "video/mp4" : mediaMime(name);
      return {
        id: `kuaifan-video-${rawPath}`,
        name: name.endsWith(".mp4") || name.includes(".") ? name : `${name}.mp4`,
        mime: mime.startsWith("video/") ? mime : "video/mp4",
        size: 0,
        url: "",
        localPath: rawPath,
        exportDir: typeof value.export_dir === "string" ? value.export_dir.trim() || undefined : undefined,
        kind: "video",
        state: "uploaded",
      };
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Hermes kuaifan skills print a JSON artifact (and for Hermes runtime do not
 * emit MEDIA:). Pull image/video attachments from tool results so the chat
 * preview can materialize local managed media without relying on the model.
 */
export function extractKuaifanToolAttachments(
  toolResults: Array<{ result?: unknown; name?: string }>,
): HermesAssistantAttachment[] {
  const attachments: HermesAssistantAttachment[] = [];
  const seen = new Set<string>();
  const push = (attachment: HermesAssistantAttachment | null) => {
    if (!attachment?.localPath || seen.has(attachment.localPath)) return;
    seen.add(attachment.localPath);
    attachments.push(attachment);
  };
  for (const tool of toolResults) {
    if (typeof tool?.result !== "string") continue;
    const result = tool.result;
    // Prefer whole-result JSON first (pretty-printed multi-line payloads).
    push(parseKuaifanArtifactLine(result.trim()));
    for (const line of result.split(/\r?\n/)) {
      push(parseKuaifanArtifactLine(line));
    }
    // Fallback: first balanced JSON object embedded in mixed terminal output.
    const start = result.indexOf("{");
    const end = result.lastIndexOf("}");
    if (start >= 0 && end > start) {
      push(parseKuaifanArtifactLine(result.slice(start, end + 1)));
    }
  }
  return attachments;
}

export function mergeAssistantAttachments(
  ...groups: HermesAssistantAttachment[][]
): HermesAssistantAttachment[] {
  const merged: HermesAssistantAttachment[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const attachment of group) {
      const key = attachment.localPath || attachment.url || attachment.id;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(attachment);
    }
  }
  return merged;
}

const LOCAL_VIDEO_PATH_IN_TEXT = /(?:^|[\s`"'=])((?:[A-Za-z]:[\\/]|\/|~\/)[^\s`"'<>]+\.(?:mp4|webm|mov))(?=$|[\s`"'<])/gi;

export function extractAssistantAttachments(content: string): {
  text: string;
  attachments: HermesAssistantAttachment[];
} {
  const attachments: HermesAssistantAttachment[] = [];
  const seen = new Set<string>();

  const pushLocalOrRemote = (source: string, stripFromText: boolean): string => {
    try {
      const isRemote = /^https?:\/\//i.test(source);
      const url = isRemote ? new URL(source).href : "";
      const key = isRemote ? url : source;
      if (seen.has(key)) return stripFromText ? "" : source;
      seen.add(key);
      const name = attachmentExportName({
        name: mediaFileName(isRemote ? url : source),
        localPath: isRemote ? undefined : source,
      });
      const mime = mediaMime(name);
      attachments.push({
        id: `media-${attachments.length}-${key}`,
        name,
        mime,
        size: 0,
        url,
        localPath: isRemote ? undefined : source,
        kind: classifyAttachment(mime, name),
        state: "uploaded",
      });
      return stripFromText ? "" : source;
    } catch {
      return source;
    }
  };

  let text = String(content || "").replace(ASSISTANT_MEDIA_DIRECTIVE, (match, source: string) => {
    const kept = pushLocalOrRemote(source, true);
    if (kept === "") return match.startsWith("\n") ? "\n" : "";
    return match;
  });

  // Hermes runtime skills often only print JSON; models then quote the local
  // video path in prose. Surface those as playable video attachments too.
  text = text.replace(LOCAL_VIDEO_PATH_IN_TEXT, (match, source: string) => {
    pushLocalOrRemote(source, false);
    return match;
  });

  return { text: text.trim(), attachments };
}
