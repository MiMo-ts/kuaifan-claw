import React from "react";
import { CxIconAlertCircle, CxIconTrash2 } from "../icons";
import type { HermesAttachment } from "../../types/hermes";

function formatSize(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export interface HermesAttachmentPreviewProps {
  attachment: HermesAttachment;
  onRemove?: () => void;
  compact?: boolean;
}

export const HermesAttachmentPreview: React.FC<HermesAttachmentPreviewProps> = ({
  attachment,
  onRemove,
  compact = false,
}) => {
  const url = attachment.url || attachment.previewUrl || "";
  const fallback = typeof attachment.fallback === "string" ? attachment.fallback : undefined;
  const label = `${attachment.name} ${formatSize(attachment.size)}`;

  return (
    <div
      className={`relative overflow-hidden rounded border ${compact ? "w-28" : "w-full max-w-sm"}`}
      style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)" }}
    >
      {attachment.kind === "image" && url ? (
        <a href={url} target="_blank" rel="noreferrer" title={`查看 ${attachment.name}`}>
          <img src={url} alt={attachment.name} className="block aspect-video w-full object-cover" />
        </a>
      ) : attachment.kind === "video" && url ? (
        <video src={url} controls className="block aspect-video w-full bg-black object-contain" />
      ) : attachment.kind === "audio" && url ? (
        <div className="px-2 py-2"><audio src={url} controls className="h-7 w-full" /></div>
      ) : (
        <a
          href={url || undefined}
          target="_blank"
          rel="noreferrer"
          className="block truncate px-2.5 py-2 text-[11px]"
          style={{ color: "var(--cx-text-soft)" }}
          title={attachment.name}
        >
          {attachment.name}
        </a>
      )}
      <div className="flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-[10px]" style={{ color: "var(--cx-text-mute)" }}>
        <span className="min-w-0 flex-1 truncate" title={label}>{label}</span>
        {attachment.state === "uploading" ? <span className="shrink-0">上传中</span> : null}
        {attachment.state === "error" ? <CxIconAlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cx-error)" }} /> : null}
        {onRemove ? (
          <button type="button" onClick={onRemove} className="flex h-5 w-5 shrink-0 items-center justify-center" title="移除附件">
            <CxIconTrash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {attachment.errorMessage ? <div className="px-2 pb-1.5 text-[10px]" style={{ color: "var(--cx-error)" }}>{attachment.errorMessage}</div> : null}
      {fallback ? <div className="px-2 pb-1.5 text-[10px]" style={{ color: "var(--cx-text-mute)" }}>{fallback}</div> : null}
    </div>
  );
};

export default HermesAttachmentPreview;
