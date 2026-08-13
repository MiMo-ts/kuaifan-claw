import React, { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import {
  CxIconAlertCircle,
  CxIconClose,
  CxIconDownload,
  CxIconExternal,
  CxIconTrash2,
} from "../icons";
import type { HermesAttachment } from "../../types/hermes";
import { attachmentExportName } from "../../services/hermesAttachments";

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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const url = attachment.url || attachment.previewUrl || "";
  const fallback = typeof attachment.fallback === "string" ? attachment.fallback : undefined;
  const label = `${attachment.name} ${formatSize(attachment.size)}`;
  const isLocalMedia = Boolean(attachment.localPath);
  const isImage = attachment.kind === "image" && Boolean(url);
  const isVideo = attachment.kind === "video";
  const canLightbox = (isImage || (isVideo && Boolean(url))) && Boolean(url);

  useEffect(() => {
    if (!lightboxOpen) return undefined;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setLightboxOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [lightboxOpen]);

  const exportMedia = async () => {
    if (!attachment.localPath) return;
    try {
      const savedPath = await invoke<string>("export_hermes_media", {
        sourcePath: attachment.localPath,
        suggestedDir: attachment.exportDir,
      }).catch(async () =>
        invoke<string>("export_hermes_image", {
          sourcePath: attachment.localPath,
          suggestedDir: attachment.exportDir,
        }),
      );
      toast.success(`已保存：${savedPath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/cancel/i.test(message)) toast.error(`保存失败：${message}`);
    }
  };

  const revealMedia = async () => {
    if (!attachment.localPath) return;
    try {
      await invoke("open_hermes_media_folder", { sourcePath: attachment.localPath }).catch(() =>
        invoke("open_hermes_image_folder", { sourcePath: attachment.localPath }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`打开目录失败：${message}`);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded border ${compact ? "w-28" : "w-full max-w-sm"}`}
      style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)" }}
    >
      {isImage ? (
        <button
          type="button"
          className="block w-full cursor-zoom-in text-left"
          onClick={() => setLightboxOpen(true)}
          title={`查看 ${attachment.name}`}
          aria-label={`放大查看 ${attachment.name}`}
        >
          <img src={url} alt={attachment.name} className="block aspect-video w-full object-cover" />
        </button>
      ) : isVideo ? (
        url ? (
          <button
            type="button"
            className="relative block w-full cursor-zoom-in text-left"
            onClick={() => setLightboxOpen(true)}
            title={`预览播放 ${attachment.name}`}
            aria-label={`放大预览播放 ${attachment.name}`}
          >
            <video
              src={url}
              className="pointer-events-none block aspect-video w-full bg-black object-contain"
              muted
              playsInline
              preload="metadata"
            />
            <span
              className="absolute inset-0 flex items-center justify-center bg-black/25 text-xs font-medium text-white"
              aria-hidden
            >
              点击放大播放
            </span>
          </button>
        ) : (
          <div
            className="flex aspect-video w-full items-center justify-center px-2 text-center text-[11px]"
            style={{ color: "var(--cx-text-mute)", background: "#111" }}
          >
            视频已生成，正在加载预览…
          </div>
        )
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
        {isLocalMedia && !onRemove ? (
          <>
            <button
              type="button"
              onClick={exportMedia}
              className="flex h-5 w-5 shrink-0 items-center justify-center hover:text-[var(--cx-text)]"
              title="保存到..."
              aria-label="保存到..."
            >
              <CxIconDownload className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={revealMedia}
              className="flex h-5 w-5 shrink-0 items-center justify-center hover:text-[var(--cx-text)]"
              title="打开所在目录"
              aria-label="打开所在目录"
            >
              <CxIconExternal className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}
        {attachment.state === "uploading" ? <span className="shrink-0">上传中</span> : null}
        {attachment.state === "error" ? <CxIconAlertCircle className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cx-error)" }} /> : null}
        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="flex h-5 w-5 shrink-0 items-center justify-center hover:text-[var(--cx-error)]"
            title="移除附件"
            aria-label="移除附件"
          >
            <CxIconTrash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {fallback ? (
        <div className="border-t px-2 py-1 text-[10px]" style={{ borderColor: "var(--cx-border-soft)", color: "var(--cx-text-mute)" }}>
          {fallback}
        </div>
      ) : null}

      {lightboxOpen && canLightbox ? (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/80 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={isVideo ? "视频预览" : "图片预览"}
          onClick={(event) => {
            if (event.target === event.currentTarget) setLightboxOpen(false);
          }}
        >
          <div className="relative max-h-[92vh] max-w-[92vw] overflow-hidden rounded-lg bg-black shadow-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
              <div className="max-w-full truncate text-xs text-white/75" title={attachmentExportName(attachment)}>
                {attachmentExportName(attachment)}
              </div>
              <div className="flex items-center gap-1.5">
                {isLocalMedia ? (
                  <>
                    <button
                      type="button"
                      onClick={exportMedia}
                      className="rounded border border-white/30 px-2 py-1 text-[11px] text-white hover:bg-white/10"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={revealMedia}
                      className="rounded border border-white/30 px-2 py-1 text-[11px] text-white hover:bg-white/10"
                    >
                      打开目录
                    </button>
                  </>
                ) : null}
                <button
                  type="button"
                  onClick={() => setLightboxOpen(false)}
                  className="flex h-7 w-7 items-center justify-center rounded border border-white/30 text-white hover:bg-white/10"
                  aria-label="关闭预览"
                >
                  <CxIconClose className="h-4 w-4" />
                </button>
              </div>
            </div>
            {isVideo ? (
              <video
                src={url}
                controls
                autoPlay
                className="block max-h-[calc(92vh-48px)] max-w-[92vw] bg-black object-contain"
              />
            ) : (
              <img
                src={url}
                alt={attachment.name}
                className="block max-h-[calc(92vh-48px)] max-w-[92vw] object-contain"
              />
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HermesAttachmentPreview;
