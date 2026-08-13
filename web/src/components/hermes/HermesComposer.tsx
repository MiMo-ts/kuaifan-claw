import React, { useCallback, useEffect, useRef, useState } from "react";
import { CxIconSend, CxIconStop, CxIconUpload } from "../icons";
import type { HermesAttachment, HermesLocalAttachment } from "../../types/hermes";
import { attachmentSendState, classifyAttachment } from "../../services/hermesAttachments";
import { HermesAttachmentPreview } from "./HermesAttachmentPreview";

export interface HermesComposerProps {
  onSend: (text: string, attachments: HermesLocalAttachment[]) => void | Promise<void>;
  onUpload: (files: File[], onProgress: (file: File, progress: number) => void) => Promise<HermesAttachment[]>;
  onCancel?: () => void;
  busy?: boolean;
  /** When true, composer stays usable while busy (native Hermes interrupt/clarify). */
  allowSendWhileBusy?: boolean;
  disabled?: boolean;
  placeholder?: string;
  initialText?: string;
  onTextConsumed?: () => void;
  modelLabel?: string;
}

export const HermesComposer: React.FC<HermesComposerProps> = ({
  onSend,
  onUpload,
  onCancel,
  busy = false,
  allowSendWhileBusy = false,
  disabled = false,
  placeholder = "输入消息，Enter 发送，Shift + Enter 换行",
  initialText = "",
  onTextConsumed,
  modelLabel,
}) => {
  const [text, setText] = useState(initialText);
  const [attachments, setAttachments] = useState<HermesLocalAttachment[]>([]);
  const [dragging, setDragging] = useState(false);
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const objectUrlsRef = useRef(new Set<string>());

  useEffect(() => () => objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url)), []);

  useEffect(() => {
    if (!initialText) return;
    setText(initialText);
    onTextConsumed?.();
    requestAnimationFrame(() => textAreaRef.current?.focus());
  }, [initialText, onTextConsumed]);

  useEffect(() => {
    const element = textAreaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [text]);

  const addFiles = useCallback((files: FileList | File[]) => {
    const items = Array.from(files).filter((file) => file.size > 0).map((file) => {
      const previewUrl = URL.createObjectURL(file);
      objectUrlsRef.current.add(previewUrl);
      return {
        id: `attachment-${Date.now()}-${crypto.randomUUID()}`,
        file,
        previewUrl,
        kind: classifyAttachment(file.type, file.name),
        state: "uploading" as const,
      };
    });
    if (!items.length) return;
    setAttachments((current) => [...current, ...items]);
    void (async () => {
      for (const item of items) {
        try {
          const [uploaded] = await onUpload([item.file], (file, progress) => {
            if (file !== item.file) return;
            setAttachments((current) => current.map((attachment) => attachment.id === item.id
              ? { ...attachment, progress }
              : attachment));
          });
          if (!uploaded) throw new Error("Hermes did not return the uploaded attachment");
          setAttachments((current) => current.map((attachment) => attachment.id === item.id
            ? { ...attachment, state: "uploaded", progress: 1, uploaded }
            : attachment));
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          setAttachments((current) => current.map((attachment) => attachment.id === item.id
            ? { ...attachment, state: "error", errorMessage }
            : attachment));
        }
      }
    })();
  }, [onUpload]);

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => {
      const target = current[index];
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrlsRef.current.delete(target.previewUrl);
      }
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  }, []);

  const send = useCallback(async () => {
    const value = text.trim();
    const blockedByBusy = busy && !allowSendWhileBusy;
    if ((!value && attachments.length === 0) || blockedByBusy || disabled || attachmentSendState(attachments) !== "ready") return;
    await onSend(value, attachments);
    setText("");
    attachments.forEach((attachment) => {
      URL.revokeObjectURL(attachment.previewUrl);
      objectUrlsRef.current.delete(attachment.previewUrl);
    });
    setAttachments([]);
  }, [allowSendWhileBusy, attachments, busy, disabled, onSend, text]);

  const sendState = attachmentSendState(attachments);
  const canSend = (Boolean(text.trim()) || attachments.length > 0)
    && !disabled
    && (!busy || allowSendWhileBusy)
    && sendState === "ready";

  return (
    <div
      className="shrink-0 border-t px-4 py-3"
      style={{ background: "var(--cx-bg)", borderColor: "var(--cx-border-soft)" }}
    >
      <div className="mx-auto max-w-[780px]">
        <div
          className="relative overflow-hidden rounded-lg border"
          style={{
            background: "var(--cx-bg-elev)",
            borderColor: "var(--cx-border)",
            boxShadow: "var(--cx-shadow-sm)",
          }}
        >
          <input ref={fileInputRef} type="file" multiple className="sr-only" onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.currentTarget.value = "";
          }} />
          {attachments.length ? (
            <div className="flex flex-wrap gap-2 border-b p-2" style={{ borderColor: "var(--cx-border-soft)" }}>
              {attachments.map((attachment, index) => {
                const preview: HermesAttachment = {
                  ...(attachment.uploaded || {}),
                  id: attachment.id,
                  name: attachment.file.name,
                  mime: attachment.file.type,
                  size: attachment.file.size,
                  url: attachment.previewUrl,
                  previewUrl: attachment.previewUrl,
                  kind: attachment.kind,
                  state: attachment.state,
                  fallback: attachment.state === "uploading" && attachment.progress != null
                    ? `${Math.round(attachment.progress * 100)}%`
                    : undefined,
                  errorMessage: attachment.errorMessage,
                };
                return <HermesAttachmentPreview key={preview.id} attachment={preview} compact onRemove={() => removeAttachment(index)} />;
              })}
            </div>
          ) : null}
          <textarea
            ref={textAreaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send();
              }
            }}
            onPaste={(event) => {
              if (event.clipboardData.files.length) {
                event.preventDefault();
                addFiles(event.clipboardData.files);
              }
            }}
            onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
            onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); } }}
            rows={1}
            disabled={disabled}
            placeholder={disabled ? "Hermes 网关连接后即可发送消息" : placeholder}
            className="block max-h-[180px] min-h-[48px] w-full resize-none bg-transparent px-3.5 py-3 text-[13px] leading-relaxed outline-none disabled:opacity-60"
            style={{ color: "var(--cx-text)" }}
          />
          <div
            className="flex h-9 items-center justify-between border-t px-2"
            style={{ borderColor: "var(--cx-border-soft)" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium disabled:opacity-50"
                style={{ borderColor: "var(--cx-border)", color: "var(--cx-text-soft)", background: "var(--cx-bg-soft)" }}
                title="上传文件"
                disabled={disabled || busy}
              >
                <CxIconUpload className="h-4 w-4" strokeWidth={2} />
                <span>上传文件</span>
              </button>
              {modelLabel ? (
                <span className="truncate text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
                  {modelLabel}
                </span>
              ) : null}
              <span className="text-[10px] tabular-nums" style={{ color: "var(--cx-text-dim)" }}>
                {text.length} 字
              </span>
              {sendState === "uploading" ? <span className="text-[10px]" style={{ color: "var(--cx-warn)" }}>正在上传附件</span> : null}
              {sendState === "error" ? <span className="text-[10px]" style={{ color: "var(--cx-error)" }}>移除失败附件后可发送</span> : null}
            </div>
            <div className="flex items-center gap-1.5">
              {busy && onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium"
                  style={{ background: "var(--cx-error-soft)", color: "var(--cx-error)" }}
                >
                  <CxIconStop className="h-3 w-3" />停止
                </button>
              ) : null}
              {(!busy || allowSendWhileBusy) ? (
                <button
                  type="button"
                  onClick={() => void send()}
                  disabled={!canSend}
                  className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background: canSend ? "var(--cx-accent)" : "var(--cx-bg-soft)",
                    color: canSend ? "#fff" : "var(--cx-text-dim)",
                  }}
                >
                  <CxIconSend className="h-3 w-3" />发送
                </button>
              ) : null}
            </div>
          </div>
          {dragging ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-2 border-dashed text-[12px]" style={{ borderColor: "var(--cx-accent)", color: "var(--cx-accent)", background: "var(--cx-bg-elev)" }}>松开以添加附件</div> : null}
        </div>
        <p className="mt-1.5 px-1 text-[10px]" style={{ color: "var(--cx-text-dim)" }}>
          重要结果请结合工具输出和原始数据核对。
        </p>
      </div>
    </div>
  );
};

export default HermesComposer;
