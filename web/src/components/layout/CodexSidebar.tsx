import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  CxIconBackup,
  CxIconChevronsLeft,
  CxIconHome,
  CxIconInstances,
  CxIconLogout,
  CxIconMessageSquare,
  CxIconModels,
  CxIconModules,
  CxIconMonitor,
  CxIconPin,
  CxIconPlus,
  CxIconSearch,
  CxIconRobots,
  CxIconSettings,
  CxIconSparkles,
  CxIconTrash,
  CxIconUsage,
  CxIconWifi,
} from "../icons";
import LanDevicePanel from "../LanDevicePanel";
import { useAppStore } from "../../stores/appStore";
import { useRuntimeStore } from "../../stores/runtimeStore";
import { useModuleSessionStore } from "../../stores/moduleSessionStore";
import {
  createModuleSession,
  deleteModuleSession,
  listModuleSessions,
  renameModuleSession,
} from "../../services/moduleSessions";
import type { ModuleSession } from "../../services/moduleSessionProtocol";

export interface SidebarNavItem {
  key: string;
  label: string;
  icon: any;
  path: string;
  accent?: string;
}

const PRIMARY_ITEMS: SidebarNavItem[] = [
  { key: "new-chat", label: "新对话", icon: CxIconHome, path: "/home", accent: "var(--cx-accent)" },
];

const WORKSPACE_ITEMS: SidebarNavItem[] = [
  { key: "instances", label: "实例管理", icon: CxIconInstances, path: "/instances" },
  { key: "models", label: "模型配置", icon: CxIconModels, path: "/models" },
  { key: "robots", label: "机器人商店", icon: CxIconRobots, path: "/robots" },
  { key: "console", label: "网关控制台", icon: CxIconMonitor, path: "/console" },
];

const INSIGHT_ITEMS: SidebarNavItem[] = [
  { key: "usage", label: "Token 用量", icon: CxIconUsage, path: "/usage" },
  { key: "backup", label: "备份恢复", icon: CxIconBackup, path: "/backup" },
];

function SidebarUserInfo({ onLogout }: { onLogout: () => void }) {
  const username = useAppStore((s) => s.username);
  if (!username) return null;
  const initial = (username || "?").trim().charAt(0).toUpperCase();
  return (
    <div className="flex items-center gap-2 px-1 py-1.5 rounded-lg hover:bg-[var(--cx-bg-hover)] transition-colors duration-150 group">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 select-none"
        style={{
          background: "linear-gradient(135deg, #5b7fbd 0%, #7a9bd1 100%)",
          color: "#fff",
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25), 0 1px 2px rgba(91,127,189,0.25)",
        }}
        aria-hidden
      >
        {initial}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12px] font-medium truncate" style={{ color: "var(--cx-text)" }}>
          {username}
        </div>
        <div className="text-[10px] truncate" style={{ color: "var(--cx-text-dim)" }}>
          个人工作区
        </div>
      </div>
      <button
        onClick={onLogout}
        className="opacity-0 group-hover:opacity-100 w-6 h-6 rounded-md flex items-center justify-center transition-opacity duration-150"
        style={{ color: "var(--cx-text-mute)" }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "var(--cx-error)";
          e.currentTarget.style.background = "var(--cx-error-soft)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--cx-text-mute)";
          e.currentTarget.style.background = "transparent";
        }}
        title="退出登录"
      >
        <CxIconLogout size={14} />
      </button>
    </div>
  );
}

interface NavGroupProps {
  title: string;
  items: SidebarNavItem[];
  currentKey: string | null | undefined;
  onClick: (key: string, path: string) => void;
}

function NavGroup({ title, items, currentKey, onClick }: NavGroupProps) {
  return (
    <div className="mb-3">
      <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: "var(--cx-text-dim)" }}>
        {title}
      </div>
      <div className="space-y-0.5">
        {items.map((it) => {
          const Icon = it.icon;
          const active = currentKey === it.key;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onClick(it.key, it.path)}
              className="cx-nav-item w-full"
              data-active={active}
              title={it.label}
            >
              <Icon
                className="w-[15px] h-[15px] shrink-0"
                style={{ color: active ? (it.accent || "var(--cx-accent)") : "var(--cx-text-mute)" }}
              />
              <span className="flex-1 truncate text-left">{it.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

interface CodexSidebarProps {
  activeKey?: string;
  onNavigate?: (key: string, path: string) => void;
  gatewayRunning?: boolean;
}

export default function CodexSidebar({ activeKey, onNavigate, gatewayRunning }: CodexSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const activeModule = useAppStore((s) => s.activeModule);
  const openclawGatewayRunning = useAppStore((s) => s.gatewayRunning);
  const runtimes = useRuntimeStore((s) => s.runtimes);
  const sessions = useModuleSessionStore((s) => s.sessionsByModule[activeModule]);
  const activeSessionId = useModuleSessionStore((s) => s.activeSessionIdByModule[activeModule]);
  const setSessions = useModuleSessionStore((s) => s.setSessions);
  const setActiveSession = useModuleSessionStore((s) => s.setActiveSession);
  const removeSession = useModuleSessionStore((s) => s.removeSession);
  const upsertSession = useModuleSessionStore((s) => s.upsertSession);
  const hydrated = useModuleSessionStore((s) => s.hydrated);
  const [search, setSearch] = useState("");
  const [nameEditing, setNameEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const [showLan, setShowLan] = useState(false);
  const hermesRuntime = runtimes.find((runtime) => runtime.id === "hermes");
  const moduleGuiUrl = activeModule === "hermes" ? hermesRuntime?.guiUrl ?? null : null;
  const moduleRunning = activeModule === "hermes"
    ? Boolean(hermesRuntime?.running)
    : Boolean(gatewayRunning ?? openclawGatewayRunning);

  const current =
    activeKey ??
    (() => {
      const path = location.pathname;
      if (path === "/home") return "new-chat";
      const all = [...WORKSPACE_ITEMS, ...INSIGHT_ITEMS];
      const match = all.find((it) => path.startsWith(it.path));
      return match?.key ?? null;
    })();

  const handleClick = (key: string, path: string) => {
    if (onNavigate) {
      onNavigate(key, path);
      return;
    }
    navigate(path);
  };

  // 鈹€鈹€ Gateway session sync 鈹€鈹€
  const syncSessions = useCallback(async () => {
    if (!hydrated) return;
    try {
      const next = await listModuleSessions(activeModule, moduleGuiUrl);
      if (next.length === 0) return; // remote empty: keep local persisted list
      setSessions(activeModule, next);
    } catch {
      // Gateway may still be starting. Keep the last module-owned session snapshot.
    }
  }, [activeModule, hydrated, moduleGuiUrl, setSessions]);

  useEffect(() => {
    if (!moduleRunning || !hydrated) return;
    void syncSessions();
    const timer = window.setInterval(() => void syncSessions(), 5_000);
    return () => window.clearInterval(timer);
  }, [moduleRunning, hydrated, syncSessions]);

  // 鈹€鈹€ Actions 鈹€鈹€
  const handleNewThread = async () => {
    navigate("/home");
    if (!moduleRunning) {
      window.alert("请先启动当前模块网关");
      return;
    }
    try {
      const session = await createModuleSession(activeModule, moduleGuiUrl);
      upsertSession(activeModule, session);
      setActiveSession(activeModule, session.id);
      // Trigger an immediate sync so the gateway-side title / lastMessage
      // are folded back into the local snapshot without waiting 5s.
      void syncSessions();
    } catch (error) {
      window.alert(`创建会话失败：${String(error)}`);
    }
  };

  const handleThreadClick = (sessionId: string) => {
    setActiveSession(activeModule, sessionId);
    navigate("/home");
  };

  const handleDeleteThread = async (e: React.MouseEvent, t: ModuleSession) => {
    e.stopPropagation();
    const ok = window.confirm(`删除会话 “${t.title}” ？`);
    if (!ok) return;
    try {
      await deleteModuleSession(activeModule, t.id, moduleGuiUrl);
      removeSession(activeModule, t.id);
    } catch (error) {
      window.alert(`删除会话失败：${String(error)}`);
    }
  };

  const handleRenameStart = (t: ModuleSession) => {
    setNameEditing(t.id);
    setEditValue(t.title);
  };

  const handleRenameSubmit = async (t: ModuleSession) => {
    const v = editValue.trim();
    if (v && v !== t.title) {
      try {
        await renameModuleSession(activeModule, t.id, v, moduleGuiUrl);
        upsertSession(activeModule, { ...t, title: v });
      } catch (error) {
        window.alert(`重命名会话失败：${String(error)}`);
      }
    }
    setNameEditing(null);
  };

  const handleLogout = async () => {
    try {
      const dataDir = await invoke<string>("get_data_dir");
      const newApiBaseUrl = useAppStore.getState().newApiBaseUrl;
      await invoke("logout", { apiUrl: newApiBaseUrl, dataDir });
    } catch {
      /* ignore */
    }
    useAppStore.getState().clearAuth();
    window.location.reload();
  };

  const filteredThreads = sessions.filter((t) =>
    !search.trim() ? true : t.title.toLowerCase().includes(search.trim().toLowerCase())
  );

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    const min = 60 * 1000;
    const hr = 60 * min;
    const day = 24 * hr;
    if (diff < min) return "刚刚";
    if (diff < hr) return `${Math.floor(diff / min)} 分钟前`;
    if (diff < day) return `${Math.floor(diff / hr)} 小时前`;
    if (diff < 7 * day) return `${Math.floor(diff / day)} 天前`;
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  return (
    <>
    {showLan && <LanDevicePanel onClose={() => setShowLan(false)} />}
    <aside
      className="cx-sidebar-surface shrink-0 flex flex-col h-full cx-animate-slide-right"
      style={{ width: "var(--cx-sidebar-width)" }}
    >
      {/* Brand / Top */}
      <div className="px-3 pt-3 pb-2 flex items-center justify-between">
        <button
          type="button"
          onClick={() => handleClick("new-chat", "/home")}
          className="flex items-center gap-2 px-1.5 py-1 rounded-md transition-colors duration-150 hover:bg-[var(--cx-bg-hover)]"
          title="返回主页"
        >
          <div
            className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
            style={{
              background: "linear-gradient(135deg, #5b7fbd 0%, #7a9bd1 50%, #9bb8de 100%)",
              boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), 0 1px 2px rgba(91,127,189,0.3)",
            }}
          >
            <CxIconSparkles className="w-3.5 h-3.5 text-white" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col leading-tight text-left">
            <span className="text-[13px] font-semibold" style={{ color: "var(--cx-text)" }}>
              快泛 Claw
            </span>
            <span className="text-[9.5px] font-mono" style={{ color: "var(--cx-text-dim)", letterSpacing: "0.04em" }}>
              v1.0.24
            </span>
          </div>
        </button>
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className="w-6 h-6 rounded-md flex items-center justify-center transition-colors duration-150"
          style={{ color: "var(--cx-text-mute)" }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--cx-bg-hover)";
            e.currentTarget.style.color = "var(--cx-text)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "var(--cx-text-mute)";
          }}
          title="收起侧栏"
          aria-label="toggle sidebar"
        >
          <CxIconChevronsLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Primary CTA */}
      <div className="px-3 pt-1 pb-3">
        <button
          type="button"
          onClick={handleNewThread}
          className="w-full flex items-center gap-2 h-9 px-3 rounded-lg text-[13px] font-medium transition-all duration-150"
          style={{
            background: "linear-gradient(180deg, var(--cx-accent) 0%, var(--cx-accent-hover) 100%)",
            color: "#fff",
            boxShadow: "0 1px 2px rgba(91,127,189,0.25), inset 0 1px 0 rgba(255,255,255,0.18)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow =
              "0 2px 6px rgba(91,127,189,0.32), inset 0 1px 0 rgba(255,255,255,0.22)";
            e.currentTarget.style.transform = "translateY(-1px)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow =
              "0 1px 2px rgba(91,127,189,0.25), inset 0 1px 0 rgba(255,255,255,0.18)";
            e.currentTarget.style.transform = "translateY(0)";
          }}
        >
          <CxIconPlus className="w-4 h-4 shrink-0" strokeWidth={2.5} />
          <span>新建会话</span>
          <span
            className="ml-auto text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: "rgba(255,255,255,0.18)",
              color: "rgba(255,255,255,0.92)",
              letterSpacing: "0.04em",
            }}
          >
            N
          </span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto cx-scroll-slim px-3">
        {/* Nav groups */}
        <NavGroup title="工作区" items={WORKSPACE_ITEMS} currentKey={current} onClick={handleClick} />
        <NavGroup title="洞察" items={INSIGHT_ITEMS} currentKey={current} onClick={handleClick} />

        {/* Search */}
        <div className="mt-4 mb-2 flex items-center gap-1.5 px-3">
          <span
            className="text-[10px] font-semibold uppercase tracking-[0.08em] flex-1"
            style={{ color: "var(--cx-text-dim)" }}
          >
            最近会话
          </span>
          <span
            className="text-[10px] font-mono px-1.5 py-0.5 rounded"
            style={{
              background: "var(--cx-bg-soft)",
              color: "var(--cx-text-mute)",
            }}
          >
            {sessions.length}
          </span>
        </div>
        <div
          className="relative mx-3 mb-2 flex items-center rounded-md transition-colors duration-150"
          style={{
            background: "var(--cx-bg-soft)",
            border: "1px solid var(--cx-border-soft)",
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = "var(--cx-accent)";
            e.currentTarget.style.boxShadow = "0 0 0 3px var(--cx-accent-ring)";
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = "var(--cx-border-soft)";
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <CxIconSearch className="w-3.5 h-3.5 ml-2.5 shrink-0" style={{ color: "var(--cx-text-dim)" }} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索会话"
            className="flex-1 bg-transparent outline-none px-2 py-1.5 text-[12px]"
            style={{ color: "var(--cx-text)" }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="px-1.5 text-[11px]"
              style={{ color: "var(--cx-text-mute)" }}
              aria-label="清除"
            >
              鈳?
            </button>
          )}
        </div>

        {/* Thread list */}
        <div className="space-y-0.5 px-3 pb-3">
          {filteredThreads.map((t) => {
            const isActive = t.id === activeSessionId;
            return (
              <div key={t.id} className="relative group">
                <button
                  type="button"
                  onClick={() => handleThreadClick(t.id)}
                  className="cx-nav-item w-full"
                  data-active={isActive}
                  style={{ height: "auto", padding: "7px 10px 7px 12px" }}
                >
                  <CxIconMessageSquare
                    className="w-[14px] h-[14px] shrink-0"
                    style={{
                      color: isActive ? "var(--cx-accent)" : "var(--cx-text-mute)",
                    }}
                  />
                  {nameEditing === t.id ? (
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => handleRenameSubmit(t)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRenameSubmit(t);
                        if (e.key === "Escape") setNameEditing(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent outline-none text-[12.5px] font-medium px-1"
                      style={{
                        color: "var(--cx-text)",
                        borderBottom: "1px solid var(--cx-accent)",
                      }}
                    />
                  ) : (
                    <div className="flex-1 min-w-0 text-left">
                      <div
                        className="text-[12.5px] truncate font-medium"
                        style={{
                          color: isActive ? "var(--cx-text)" : "var(--cx-text-soft)",
                        }}
                        onDoubleClick={() => handleRenameStart(t)}
                      >
                        {t.title || "新会话"}
                      </div>
                      {t.lastMessage && (
                        <div className="flex items-center justify-between mt-0.5 gap-1">
                          <span
                            className="text-[10.5px] truncate"
                            style={{ color: "var(--cx-text-dim)" }}
                          >
                            {t.lastMessage}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </button>

                {/* Pin + Delete overlay */}
                <div className="absolute right-1.5 top-1.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRenameStart(t);
                    }}
                    className="w-5 h-5 rounded flex items-center justify-center"
                    style={{ color: "var(--cx-text-mute)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--cx-accent)";
                      e.currentTarget.style.background = "var(--cx-accent-soft)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--cx-text-mute)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    title="重命名"
                    aria-label="重命名"
                  >
                    <CxIconPin size={12} style={{ transform: "rotate(-45deg)" }} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => handleDeleteThread(e, t)}
                    className="w-5 h-5 rounded flex items-center justify-center"
                    style={{ color: "var(--cx-text-mute)" }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.color = "var(--cx-error)";
                      e.currentTarget.style.background = "var(--cx-error-soft)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.color = "var(--cx-text-mute)";
                      e.currentTarget.style.background = "transparent";
                    }}
                    title="删除"
                    aria-label="删除"
                  >
                    <CxIconTrash size={12} />
                  </button>
                </div>
              </div>
            );
          })}

          {sessions.length === 0 && (
            <div
              className="flex flex-col items-center justify-center text-center py-6 px-2 rounded-lg"
              style={{
                background: "var(--cx-bg-soft)",
                border: "1px dashed var(--cx-border-soft)",
              }}
            >
              <CxIconMessageSquare
                className="w-5 h-5 mb-2"
                style={{ color: "var(--cx-text-dim)" }}
              />
              <div className="text-[12px] font-medium" style={{ color: "var(--cx-text-soft)" }}>
                暂无会话
              </div>
              <div className="text-[10.5px] mt-0.5" style={{ color: "var(--cx-text-dim)" }}>
                点击上方按钮开始第一次对话
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div
        className="border-t px-3 pt-2 pb-3"
        style={{ borderColor: "var(--cx-border-soft)" }}
      >
        <SidebarUserInfo onLogout={handleLogout} />
        <div className="grid grid-cols-3 gap-1 mt-2">
          <button
            type="button"
            onClick={() => handleClick("settings", "/settings")}
            className="cx-nav-item justify-center"
            style={{ height: "30px" }}
            title="设置"
          >
            <CxIconSettings size={14} style={{ color: "var(--cx-text-mute)" }} />
            <span className="text-[12px]">设置</span>
          </button>
          <button
            type="button"
            onClick={() => setShowLan(true)}
            className="cx-nav-item justify-center"
            style={{ height: "30px" }}
            title="多设备互联"
          >
            <CxIconWifi size={14} style={{ color: "var(--cx-text-mute)" }} />
            <span className="text-[12px]">互联</span>
          </button>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent("openModuleCards"))}
            className="cx-nav-item justify-center"
            style={{ height: "30px" }}
            title="模块中心"
          >
            <CxIconModules size={14} style={{ color: "var(--cx-text-mute)" }} />
            <span className="text-[12px]">模块</span>
          </button>
        </div>
      </div>
    </aside>
    </>
  );
}


