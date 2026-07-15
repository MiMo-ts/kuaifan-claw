import React, { useEffect, useRef } from "react";
import type { HermesMessage as HermesMessageType } from "../../types/hermes";
import { HermesMessageView } from "./HermesMessage";

export interface HermesMessageListProps {
  messages: HermesMessageType[];
  emptyState?: React.ReactNode;
  loading?: boolean;
}

export const HermesMessageList: React.FC<HermesMessageListProps> = ({
  messages,
  emptyState,
  loading = false,
}) => {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
    if (nearBottom) element.scrollTop = element.scrollHeight;
  }, [messages]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center" style={{ color: "var(--cx-text-mute)" }}>
        <span className="text-[12px]">正在加载会话...</span>
      </div>
    );
  }

  if (messages.length === 0) {
    return <div className="flex min-h-0 flex-1">{emptyState}</div>;
  }

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto cx-scroll-slim">
      <div className="mx-auto max-w-[780px] px-4 py-4">
        {messages.map((message, index) => (
          <HermesMessageView
            key={message.id}
            message={message}
            showHeader={index === 0 || messages[index - 1].role !== message.role}
          />
        ))}
      </div>
    </div>
  );
};

export default HermesMessageList;
