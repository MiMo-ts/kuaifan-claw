import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../stores/appStore";
import {
  CxIconClose,
  CxIconDatabase,
  CxIconLoader,
  CxIconRobots,
  CxIconServer,
  CxIconTerminal,
} from "./icons";

const MODULES = [
  {
    key: "openclaw" as const,
    title: "OpenClaw",
    description: "网关与本地智能体对话",
    icon: CxIconServer,
    accent: "#3978b8",
    available: true,
  },
  {
    key: "hermes" as const,
    title: "Hermes",
    description: "工具调用、多平台消息与历史会话",
    icon: CxIconRobots,
    accent: "#b36b32",
    available: true,
  },
  {
    key: "codex" as const,
    title: "Codex",
    description: "Codex CLI 智能编码助手",
    icon: CxIconTerminal,
    accent: "#3f8a55",
    available: false,
  },
  {
    key: "claude" as const,
    title: "Claude",
    description: "Anthropic Claude 编程助手",
    icon: CxIconDatabase,
    accent: "#a45f4a",
    available: false,
  },
];

type ModuleKey = (typeof MODULES)[number]["key"];

export default function ModuleCardsModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const activeModule = useAppStore((state) => state.activeModule);
  const setActiveModule = useAppStore((state) => state.setActiveModule);
  const [installedMap, setInstalledMap] = useState<Record<string, boolean>>({});
  const [checking, setChecking] = useState<Record<string, boolean>>({});
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const checkInstallStatus = useCallback(async () => {
    const installed: Record<string, boolean> = {};
    // OpenClaw: check via gateway status
    try {
      const ocStatus = await invoke<{ coreReady: boolean }>("get_openclaw_cn_status");
      installed.openclaw = ocStatus?.coreReady ?? false;
    } catch { installed.openclaw = false; }
    // Hermes: check via bundled check
    try {
      const r = await invoke<{ installed: boolean }>("check_hermes_bundled");
      installed.hermes = r?.installed ?? false;
    } catch { installed.hermes = false; }
    setInstalledMap(installed);
  }, []);

  useEffect(() => { checkInstallStatus(); }, [checkInstallStatus]);

  const handleClick = async (module: (typeof MODULES)[number]) => {
    if (!module.available) return;

    // 实时检查安装状态
    setChecking((prev) => ({ ...prev, [module.key]: true }));
    let freshInstalled = false;
    try {
      if (module.key === "openclaw") {
        const s = await invoke<{ coreReady: boolean }>("get_openclaw_cn_status");
        freshInstalled = s?.coreReady ?? false;
      } else if (module.key === "hermes") {
        const r = await invoke<{ installed: boolean }>("check_hermes_bundled");
        freshInstalled = r?.installed ?? false;
      }
    } catch { /* noop */ }
    setChecking((prev) => ({ ...prev, [module.key]: false }));

    // 更新安装状态缓存
    setInstalledMap((prev) => ({ ...prev, [module.key]: freshInstalled }));

    // 切换模块
    setActiveModule(module.key);

    // 未安装 → 跳转安装向导；已安装 → 回到首页
    if (freshInstalled) {
      navigate("/home");
    } else {
      navigate(`/wizard?module=${module.key}`);
    }
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: "rgba(0,0,0,0.48)", backdropFilter: "blur(5px)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-[620px] rounded-lg p-5"
        style={{
          background: "var(--cx-bg-elev)",
          border: "1px solid var(--cx-border)",
          boxShadow: "var(--cx-shadow-xl)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-[16px] font-semibold" style={{ color: "var(--cx-text)" }}>
              模块中心
            </h2>
            <p className="mt-1 text-[12px]" style={{ color: "var(--cx-text-mute)" }}>
              选择首页使用的智能体模块 · 未安装需先安装
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded"
            style={{ color: "var(--cx-text-mute)" }}
            aria-label="关闭"
            title="关闭"
          >
            <CxIconClose className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {MODULES.map((module, idx) => {
            const Icon = module.icon;
            const selected = module.key === activeModule;
            const installed = installedMap[module.key] ?? false;
            const isChecking = checking[module.key] ?? false;
            const isHover = hoverIdx === idx;

            return (
              <button
                key={module.key}
                type="button"
                disabled={!module.available}
                onClick={() => handleClick(module)}
                onMouseEnter={() => setHoverIdx(idx)}
                onMouseLeave={() => setHoverIdx(null)}
                className="flex min-h-[82px] items-start gap-3 rounded-md border p-3 text-left transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  background: selected ? "var(--cx-accent-soft)" : isHover && module.available ? "var(--cx-bg-elev)" : "var(--cx-bg-soft)",
                  borderColor: selected ? "var(--cx-accent)" : isHover && module.available ? "var(--cx-border)" : "var(--cx-border-soft)",
                  transform: isHover && module.available ? "translateY(-1px)" : "none",
                }}
              >
                <span
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
                  style={{ background: `${module.accent}18`, color: module.accent }}
                >
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-[13px] font-semibold" style={{ color: "var(--cx-text)" }}>
                      {module.title}
                    </span>
                    {selected ? (
                      <span className="text-[10px] rounded px-1 py-0.5" style={{ background: "var(--cx-accent)", color: "#fff" }}>当前</span>
                    ) : null}
                    {installed && !selected ? (
                      <span className="inline-block w-2 h-2 rounded-full" style={{ background: "var(--cx-success)" }} title="已安装" />
                    ) : null}
                    {!module.available ? (
                      <span className="text-[10px]" style={{ color: "var(--cx-text-dim)" }}>即将推出</span>
                    ) : null}
                  </span>
                  <span className="mt-1 block text-[11.5px] leading-relaxed" style={{ color: "var(--cx-text-mute)" }}>
                    {module.description}
                  </span>
                  {module.available && (
                    <span className="mt-1.5 block text-[10px] font-medium" style={{ color: installed ? "var(--cx-success)" : "var(--cx-warn)" }}>
                      {isChecking ? (
                        <span className="inline-flex items-center gap-1"><CxIconLoader className="w-2.5 h-2.5 animate-spin" />检测中...</span>
                      ) : installed ? (
                        "已安装 · 点击切换"
                      ) : (
                        "未安装 · 点击安装"
                      )}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
