import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CxIconArrowUpRight,
  CxIconClose,
  CxIconDatabase,
  CxIconRobots,
  CxIconServer,
  CxIconTerminal,
} from "./icons";
﻿export interface ModuleCard {
  key: string;
  title: string;
  desc: string;
  icon: any;
  path?: string | null;
  accent?: string;
  badge?: string;
}

const MODULES: ModuleCard[] = [
  {
    key: "openclaw",
    title: "OpenClaw",
    desc: "网关环境检测与安装",
    icon: CxIconServer,
    path: "/wizard",
    accent: "#5b7fbd",
  },
  {
    key: "hermes",
    title: "爱马仕",
    desc: "多平台消息路由调度",
    icon: CxIconRobots,
    path: null,
    accent: "#c4883c",
    badge: "即将推出",
  },
  {
    key: "codex",
    title: "Codex",
    desc: "Codex CLI 智能编码助手",
    icon: CxIconTerminal,
    path: null,
    accent: "#4a9e5c",
    badge: "即将推出",
  },
  {
    key: "claude",
    title: "Claude",
    desc: "Anthropic Claude AI 编程助手",
    icon: CxIconDatabase,
    path: null,
    accent: "#d97757",
    badge: "即将推出",
  },
];

interface Props {
  onClose: () => void;
}

export default function ModuleCardsModal({ onClose }: Props) {
  const navigate = useNavigate();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleClick = (card: ModuleCard) => {
    if (card.path) {
      navigate(card.path);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 cx-animate-fade-in"
      style={{ background: "rgba(44, 36, 22, 0.42)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[85vh] overflow-y-auto cx-scroll-slim cx-animate-scale-in"
        style={{
          background: "var(--cx-bg-elev)",
          border: "1px solid var(--cx-border)",
          borderRadius: 14,
          boxShadow: "var(--cx-shadow-xl)",
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span
                className="text-[10px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
                style={{ background: "var(--cx-bg-soft)", color: "var(--cx-text-mute)" }}
              >
                module center
              </span>
            </div>
            <h2 className="text-[17px] font-semibold leading-tight" style={{ color: "var(--cx-text)" }}>
              模块中心
            </h2>
            <p className="text-[12.5px] mt-1" style={{ color: "var(--cx-text-mute)" }}>
              选择一个模块开始配置 · 已启用{" "}
              <span style={{ color: "var(--cx-accent)", fontWeight: 500 }}>
                {MODULES.filter((m) => m.path).length}
              </span>{" "}
              / {MODULES.length}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-150"
            style={{ color: "var(--cx-text-mute)" }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--cx-bg-hover)";
              e.currentTarget.style.color = "var(--cx-text)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--cx-text-mute)";
            }}
            aria-label="关闭"
          >
            <CxIconClose className="w-4 h-4" />
          </button>
        </div>

        {/* Cards grid */}
        <div className="grid grid-cols-2 gap-2.5">
          {MODULES.map((card, idx) => {
            const Icon = card.icon;
            const isDisabled = !card.path;
            const isHover = hoverIdx === idx;

            return (
              <button
                key={card.key}
                type="button"
                disabled={isDisabled}
                onClick={() => handleClick(card)}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="relative flex items-start gap-3 p-3.5 rounded-xl text-left transition-all duration-200"
                style={{
                  background: isHover && !isDisabled ? "var(--cx-bg-elev)" : "var(--cx-bg-soft)",
                  border: `1px solid ${isHover && !isDisabled ? "var(--cx-border)" : "var(--cx-border-soft)"}`,
                  opacity: isDisabled ? 0.55 : 1,
                  cursor: isDisabled ? "not-allowed" : "pointer",
                  boxShadow:
                    isHover && !isDisabled
                      ? "0 4px 14px rgba(44,36,22,0.08), 0 1px 3px rgba(44,36,22,0.05)"
                      : "none",
                  transform: isHover && !isDisabled ? "translateY(-1px)" : "translateY(0)",
                }}
              >
                {/* Icon */}
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 transition-transform duration-200"
                  style={{
                    background: `${card.accent}1a`,
                    boxShadow: `inset 0 0 0 1px ${card.accent}26`,
                    transform: isHover && !isDisabled ? "scale(1.05)" : "scale(1)",
                  }}
                >
                  <Icon className="w-[18px] h-[18px]" style={{ color: card.accent }} strokeWidth={1.75} />
                </div>

                {/* Text */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[13px] font-semibold truncate"
                      style={{ color: "var(--cx-text)" }}
                    >
                      {card.title}
                    </span>
                    {card.badge && (
                      <span
                        className="text-[9.5px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider shrink-0"
                        style={{
                          background: "var(--cx-warn-soft)",
                          color: "var(--cx-warn)",
                        }}
                      >
                        {card.badge}
                      </span>
                    )}
                  </div>
                  <p
                    className="text-[11.5px] mt-0.5 leading-snug"
                    style={{ color: "var(--cx-text-mute)" }}
                  >
                    {card.desc}
                  </p>
                </div>

                {/* Arrow indicator on hover */}
                {!isDisabled && (
                  <CxIconArrowUpRight
                    className="w-3.5 h-3.5 shrink-0 self-center transition-all duration-200"
                    style={{
                      color: isHover ? card.accent : "transparent",
                      transform: isHover ? "translate(0,0)" : "translate(-2px, 2px)",
                      opacity: isHover ? 1 : 0,
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="mt-5 pt-3 flex items-center justify-between cx-hairline" style={{ marginTop: 20, paddingTop: 12 }}>
          <span className="text-[11px]" style={{ color: "var(--cx-text-dim)" }}>
            按 <kbd
              className="font-mono px-1 py-0.5 rounded text-[10px]"
              style={{ background: "var(--cx-bg-soft)", border: "1px solid var(--cx-border-soft)" }}
            >Esc</kbd> 关闭
          </span>
          <span className="text-[11px]" style={{ color: "var(--cx-text-dim)" }}>
            kuaifan-claw · 模块中心
          </span>
        </div>
      </div>
    </div>
  );
}
