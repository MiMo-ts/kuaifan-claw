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
import { cleanThinkingText, formatHermesToolArgs, hasMeaningfulReasoning } from "../../services/hermesProtocol";

function formatTime(timestamp: number): string {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Single tool-call step. Renders a vertical timeline entry mirroring the
// native Hermes desktop: icon + readable heading ("Opened www.douyin.com",
// "Asked a question", "Ran agent-browser install") + an optional
// collapsed result panel. This is what users see in place of a bare
// browser_navigate chip when Hermes forwards `context` on tool.start.
const ToolStep: React.FC<{ toolCall: HermesToolCall }> = ({ toolCall }) => {
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
  const heading = (toolCall.context && toolCall.context.trim())
    || toolCall.name
    || "tool";
  const argsSummary = toolCall.argsText || formatHermesToolArgs(toolCall.args);
  const hasDetail = Boolean(toolCall.result);

  return (
    <div
      className="flex gap-2 border-l-2 pl-2.5 py-1.5 text-[12.5px]"
      style={{ borderColor: toolCall.status === "error" ? "var(--cx-error)" : toolCall.status === "done" ? "var(--cx-success)" : "var(--cx-border-soft)" }}
    >
      <Icon
        className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${toolCall.status === "running" ? "animate-spin" : ""}`}
        style={{ color }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-medium" style={{ color: "var(--cx-text)" }}>
            {heading}
          </span>
          {toolCall.name && toolCall.context && toolCall.context.trim() !== toolCall.name ? (
            <span className="shrink-0 text-[10.5px]" style={{ color: "var(--cx-text-mute)" }}>
              {toolCall.name}
            </span>
          ) : null}
          {typeof toolCall.durationS === "number" ? (
            <span className="shrink-0 text-[10.5px] tabular-nums" style={{ color: "var(--cx-text-dim)" }}>
              {toolCall.durationS.toFixed(1)}s
            </span>
          ) : null}
        </div>
        {argsSummary ? (
          <div className="mt-0.5 truncate text-[10.5px]" style={{ color: "var(--cx-text-mute)" }}>
            参数 · {argsSummary}
          </div>
        ) : null}
        {hasDetail ? (
          <details className="mt-1">
            <summary
              className="cursor-pointer text-[10.5px]"
              style={{ color: "var(--cx-text-mute)" }}
            >
              {toolCall.result ? "查看结果" : "查看参数"}
            </summary>
            <pre
              className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded border p-1.5 text-[10.5px] leading-snug"
              style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)", color: "var(--cx-text-soft)" }}
            >
{toolCall.result}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
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
            <div
              className="mb-2 flex flex-col gap-1 rounded-md border p-2"
              style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)" }}
            >
              {message.toolCalls.map((toolCall) => (
                <ToolStep key={toolCall.id} toolCall={toolCall} />
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

          {hasMeaningfulReasoning(message.reasoning) ? (
            <details className="mt-2 border-t pt-2" style={{ borderColor: "var(--cx-border-soft)" }}>
              <summary className="cursor-pointer text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
                查看推理过程
              </summary>
              <div className="mt-2 whitespace-pre-wrap text-[11.5px] leading-relaxed" style={{ color: "var(--cx-text-soft)" }}>
                {cleanThinkingText(message.reasoning || "")}
              </div>
            </details>
          ) : message.status === "done" && typeof message.reasoningTokens === "number" && message.reasoningTokens > 0 ? (
            <div className="mt-2 border-t pt-2 text-[10.5px]" style={{ borderColor: "var(--cx-border-soft)", color: "var(--cx-text-mute)" }}>
              模型内部推理了 {message.reasoningTokens} 个 token，上游未透传
            </div>
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
