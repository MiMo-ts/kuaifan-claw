import React from "react";
import {
  CxIconAlertCircle,
  CxIconCheckCircle,
  CxIconCpu,
  CxIconLoader,
  CxIconUser,
} from "../icons";
import type { HermesMessage as HermesMessageType, HermesToolCall } from "../../types/hermes";
import { HermesAttachmentPreview } from "./HermesAttachmentPreview";

function formatTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

const ToolState: React.FC<{ toolCall: HermesToolCall }> = ({ toolCall }) => {
  const Icon = toolCall.status === "running"
    ? CxIconLoader
    : toolCall.status === "error"
      ? CxIconAlertCircle
      : CxIconCheckCircle;
  const color = toolCall.status === "error"
    ? "var(--cx-error)"
    : toolCall.status === "done"
      ? "var(--cx-success)"
      : "var(--cx-text-mute)";

  return (
    <span
      className="inline-flex h-6 items-center gap-1.5 rounded border px-2 text-[10.5px]"
      style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)", color }}
    >
      <Icon className={`h-3 w-3 ${toolCall.status === "running" ? "animate-spin" : ""}`} />
      {toolCall.name}
    </span>
  );
};

export interface HermesMessageProps {
  message: HermesMessageType;
  showHeader?: boolean;
  dateLabel?: string;
}

export const HermesMessageView: React.FC<HermesMessageProps> = ({
  message,
  showHeader = true,
}) => {
  const isUser = message.role === "user";
  const Avatar = isUser ? CxIconUser : CxIconCpu;

  if (message.role === "system") {
    return (
      <div className="my-3 text-center text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
        {message.content}
      </div>
    );
  }

  return (
    <div className={`flex gap-2.5 py-2.5 ${isUser ? "flex-row-reverse" : ""}`}>
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border"
        style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)" }}
      >
        <Avatar className="h-3.5 w-3.5" style={{ color: isUser ? "var(--cx-accent)" : "var(--cx-text-soft)" }} />
      </div>
      <div className={`flex max-w-[82%] min-w-0 flex-col ${isUser ? "items-end" : "items-start"}`}>
        {showHeader ? (
          <div className={`mb-1 flex items-center gap-2 text-[10.5px] ${isUser ? "flex-row-reverse" : ""}`} style={{ color: "var(--cx-text-mute)" }}>
            <span className="font-medium" style={{ color: "var(--cx-text-soft)" }}>
              {isUser ? "你" : "Hermes"}
            </span>
            {!isUser && message.model ? <span>{message.model}</span> : null}
            <span className="tabular-nums">{formatTime(message.ts)}</span>
          </div>
        ) : null}
        <div
          className="max-w-full rounded-lg border px-3.5 py-2.5"
          style={{
            background: isUser ? "var(--cx-accent)" : "var(--cx-bg-elev)",
            borderColor: isUser ? "transparent" : "var(--cx-border-soft)",
            color: isUser ? "#fff" : "var(--cx-text)",
          }}
        >
          {message.toolCalls?.length ? (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {message.toolCalls.map((toolCall) => (
                <ToolState key={toolCall.id} toolCall={toolCall} />
              ))}
            </div>
          ) : null}

          {message.content ? (
            <div className="whitespace-pre-wrap break-words text-[13px] leading-relaxed">
              {message.content}
            </div>
          ) : message.status === "streaming" ? (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cx-text-mute)" }}>
              <CxIconLoader className="h-3.5 w-3.5 animate-spin" />正在思考
            </div>
          ) : null}

          {message.attachments?.length ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {message.attachments.map((attachment) => <HermesAttachmentPreview key={attachment.id} attachment={attachment} compact />)}
            </div>
          ) : null}

          {message.reasoning ? (
            <details className="mt-2 border-t pt-2" style={{ borderColor: "var(--cx-border-soft)" }}>
              <summary className="cursor-pointer text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
                查看推理过程
              </summary>
              <div className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed" style={{ color: "var(--cx-text-soft)" }}>
                {message.reasoning}
              </div>
            </details>
          ) : null}

          {message.status === "error" ? (
            <div className="mt-2 flex items-start gap-1.5 text-[11.5px]" style={{ color: "var(--cx-error)" }}>
              <CxIconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {message.errorMessage || "回复失败"}
            </div>
          ) : null}
          {message.status === "cancelled" ? (
            <div className="mt-2 text-[11px]" style={{ color: "var(--cx-text-mute)" }}>已停止</div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

export default HermesMessageView;
