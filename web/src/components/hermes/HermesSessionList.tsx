import React, { useMemo, useState } from "react";
import { CxIconMessageSquare, CxIconPlus, CxIconSearch, CxIconTrash } from "../icons";
import type { HermesSession } from "../../types/hermes";

const fontFamily: React.CSSProperties = {
  fontFamily:
    'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
};

export interface HermesSessionListProps {
  sessions: HermesSession[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete?: (id: string) => void;
}

function formatRelative(ts: number): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "刚刚";
  if (m < 60) return m + " 分钟前";
  const h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  const d = Math.floor(h / 24);
  if (d < 7) return d + " 天前";
  return new Date(ts).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" });
}

export const HermesSessionList: React.FC<HermesSessionListProps> = ({
  sessions,
  activeId,
  loading,
  onSelect,
  onNew,
  onDelete,
}) => {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.lastMessage || "").toLowerCase().includes(q)
    );
  }, [sessions, query]);

  return (
    <aside
      className="w-[280px] shrink-0 flex flex-col border-r h-full"
      style={{
        background: "var(--cx-bg-soft)",
        borderColor: "var(--cx-border-soft)",
      }}
    >
      <div
        className="px-3 h-12 flex items-center justify-between border-b shrink-0"
        style={{ borderColor: "var(--cx-border-soft)" }}
      >
        <span
          className="text-[12px] font-semibold tracking-wide uppercase"
          style={{
            color: "var(--cx-text-soft)",
            letterSpacing: 0.4,
            ...fontFamily,
          }}
        >
          会话
        </span>
        <button
          type="button"
          onClick={onNew}
          aria-label="新建会话"
          className="h-7 px-2.5 inline-flex items-center gap-1 rounded-md text-[12px] font-semibold transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2"
          style={{
            background: "var(--cx-accent)",
            color: "#ffffff",
            ...fontFamily,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background =
              "var(--cx-accent-hover, var(--cx-accent))";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--cx-accent)";
          }}
        >
          <CxIconPlus className="w-3.5 h-3.5" style={{ color: "#ffffff" }} />
          新建
        </button>
      </div>

      <div className="px-3 py-2 border-b shrink-0" style={{ borderColor: "var(--cx-border-soft)" }}>
        <div
          className="h-8 px-2.5 flex items-center gap-2 rounded-md"
          style={{ background: "var(--cx-bg-elev)", border: "1px solid var(--cx-border-soft)" }}
        >
          <CxIconSearch className="w-3.5 h-3.5 shrink-0" style={{ color: "var(--cx-text-mute)" }} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话"
            className="flex-1 bg-transparent text-[12px] outline-none"
            style={{ color: "var(--cx-text)", ...fontFamily }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto cx-scroll-slim">
        {loading ? (
          <ul className="py-2 px-2 space-y-1.5">
            {[0, 1, 2, 3, 4].map((i) => (
              <li
                key={i}
                className="px-2.5 py-2.5 rounded-md border"
                style={{
                  background: "var(--cx-bg-elev)",
                  borderColor: "var(--cx-border-soft)",
                }}
              >
                <div
                  className="h-3 w-3/4 rounded mb-1.5 cx-shimmer"
                  style={{ background: "var(--cx-bg-soft)" }}
                />
                <div
                  className="h-2.5 w-1/2 rounded cx-shimmer"
                  style={{ background: "var(--cx-bg-soft)" }}
                />
              </li>
            ))}
          </ul>
        ) : filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center px-6 py-12 gap-2"
            style={fontFamily}
          >
            <CxIconMessageSquare
              className="w-6 h-6"
              style={{ color: "var(--cx-text-dim)" }}
            />
            <div className="text-[12px] font-medium" style={{ color: "var(--cx-text-soft)" }}>
              {query ? "未找到结果" : "还没有会话"}
            </div>
            <div className="text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
              {query ? "试试其他关键字" : "点击右上新建开始聊天"}
            </div>
          </div>
        ) : (
          <ul className="py-1.5 px-1.5 space-y-0.5">
            {filtered.map((s) => {
              const active = s.id === activeId;
              return (
                <li key={s.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(s.id)}
                    className={
                      "group w-full text-left px-2.5 py-2 rounded-md transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 " +
                      (active ? "" : "")
                    }
                    style={{
                      background: active ? "var(--cx-bg-elev)" : "transparent",
                      border: active ? "1px solid var(--cx-border-soft)" : "1px solid transparent",
                      boxShadow: active ? "var(--cx-shadow-xs)" : "none",
                    }}
                    onMouseEnter={(e) => {
                      if (active) return;
                      (e.currentTarget as HTMLElement).style.background = "var(--cx-bg-elev)";
                    }}
                    onMouseLeave={(e) => {
                      if (active) return;
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                    }}
                  >
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[12.5px] font-semibold truncate"
                          style={{ color: "var(--cx-text)", ...fontFamily }}
                        >
                          {s.title || "新对话"}
                        </div>
                        <div
                          className="mt-0.5 text-[11px] truncate"
                          style={{ color: "var(--cx-text-mute)", ...fontFamily }}
                        >
                          {s.lastMessage || (s.messageCount ? `${s.messageCount} 条消息` : "暂无消息")}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-0.5">
                        <span
                          className="text-[10px] tabular-nums"
                          style={{ color: "var(--cx-text-dim)" }}
                        >
                          {formatRelative(s.updatedAt)}
                        </span>
                        {s.running ? (
                          <span
                            className="w-1.5 h-1.5 rounded-full animate-pulse"
                            style={{ background: "var(--cx-success)" }}
                            aria-label="正在运行"
                          />
                        ) : null}
                      </div>
                    </div>
                    {onDelete ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDelete(s.id);
                        }}
                        aria-label="删除会话"
                        className="mt-1 opacity-0 group-hover:opacity-100 transition-opacity duration-150 inline-flex items-center gap-1 text-[10px] px-1.5 h-[18px] rounded focus-visible:outline-none focus-visible:ring-1"
                        style={{
                          color: "var(--cx-text-mute)",
                          background: "var(--cx-bg-soft)",
                          ...fontFamily,
                        }}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.color = "var(--cx-error)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.color = "var(--cx-text-mute)";
                        }}
                      >
                        <CxIconTrash className="w-2.5 h-2.5" />
                        删除
                      </button>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
};

export default HermesSessionList;
