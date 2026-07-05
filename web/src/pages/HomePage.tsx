import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconDownload,
  CxIconLoader,
  CxIconMonitor,
  CxIconPlay,
  CxIconPower,
} from "../components/icons";
import { useAppStore } from "../stores/appStore";
import { checkForUpdate, downloadAndInstallUpdate, UpdateProgress } from "../utils/updater";
import ModuleCardsModal from "../components/ModuleCardsModal";
import ModelConfigModal from "../components/ModelConfigModal";
import CodexChatArea from "../components/layout/CodexChatArea";

interface GatewayStatus {
  running: boolean;
  version?: string;
  port: number;
  uptime_seconds: number;
  memory_mb: number;
  instances_running?: number;
}

export default function HomePage() {
  const { gatewayRunning, setGatewayRunning } = useAppStore();
  const [hydrated, setHydrated] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);

  // Update
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [, setUpdateNotes] = useState("");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Modals
  const [modelConfigOpen, setModelConfigOpen] = useState(false);
  const [moduleCardsOpen, setModuleCardsOpen] = useState(false);

  const gatewayRunningRef = useRef(gatewayRunning);
  useEffect(() => { gatewayRunningRef.current = gatewayRunning; }, [gatewayRunning]);

  // Hydration
  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) { setHydrated(true); return; }
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  // Load initial data
  useEffect(() => { if (!hydrated) return; loadInitial(); }, [hydrated]);

  const loadInitial = async () => {
    try {
      const [status] = await Promise.all([
        invoke<GatewayStatus>("get_gateway_status"),
        invoke<{ provider?: string; model_name?: string }>("get_default_model").catch(() => null),
      ]);
      setGatewayStatus(status);
      setGatewayRunning(status.running);
      const KEY = 'openclaw-module-center-shown';
      if (!status.running && !localStorage.getItem(KEY)) {
        localStorage.setItem(KEY, '1');
        setTimeout(() => setModuleCardsOpen(true), 500);
      }
    } catch {
      const KEY = 'openclaw-module-center-shown';
      if (!localStorage.getItem(KEY)) {
        localStorage.setItem(KEY, '1');
        setTimeout(() => setModuleCardsOpen(true), 500);
      }
    }
  };

  // Poll gateway status
  const pollGateway = useCallback(async () => {
    if (gatewayBusy || gatewayOpLockRef.current) return;
    try {
      const status = await invoke<GatewayStatus>("get_gateway_status");
      setGatewayStatus(status);
      setGatewayRunning(status.running);
    } catch { /* ignore */ }
  }, [gatewayBusy]);

  useEffect(() => {
    if (!hydrated) return;
    const id = window.setInterval(pollGateway, 5000);
    const onVis = () => { if (document.visibilityState === "visible") void pollGateway(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { window.clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, [hydrated, pollGateway]);

  // Module cards event listener
  useEffect(() => {
    const handler = () => setModuleCardsOpen(true);
    window.addEventListener("openModuleCards", handler);
    return () => window.removeEventListener("openModuleCards", handler);
  }, []);

  // Check for updates
  useEffect(() => {
    if (!hydrated) return;
    const doCheck = async () => {
      try {
        const info = await checkForUpdate();
        if (info.available) {
          setUpdateAvailable(true);
          setUpdateVersion(info.version || "");
          setUpdateNotes(info.body || "");
        }
      } catch { /* ignore */ }
    };
    const t = window.setTimeout(doCheck, 3000);
    return () => window.clearTimeout(t);
  }, [hydrated]);

  const gatewayOpLockRef = useRef(false);

  const handleToggleGateway = useCallback(async () => {
    if (gatewayBusy) return;
    const isRunning = gatewayRunningRef.current;
    setGatewayBusy(true);
    gatewayOpLockRef.current = true;
    const toastId = toast.loading(isRunning ? "正在停止网关..." : "正在启动网关...", {
      style: { background: "var(--cx-bg-overlay)", color: "var(--cx-text)", border: "1px solid var(--cx-border)" },
    });
    try {
      if (isRunning) {
        await invoke("stop_gateway");
        setGatewayRunning(false);
        setGatewayStatus({ running: false, port: 0, uptime_seconds: 0, memory_mb: 0 });
        toast.success("网关已停止", { id: toastId });
      } else {
        await invoke("start_gateway");
        const status = await invoke<GatewayStatus>("get_gateway_status");
        setGatewayRunning(status.running);
        setGatewayStatus(status);
        toast.success(status.running ? "网关已启动" : "网关启动失败", { id: toastId });
      }
    } catch (e) {
      setGatewayRunning(isRunning);
      try {
        const status = await invoke<GatewayStatus>("get_gateway_status");
        setGatewayStatus(status);
        setGatewayRunning(status.running);
      } catch { /* 查询失败则保持当前显示 */ }
      toast.error(`操作失败: ${e instanceof Error ? e.message : String(e)}`, { id: toastId });
    } finally {
      setGatewayBusy(false);
      setTimeout(() => { gatewayOpLockRef.current = false; }, 3000);
    }
  }, [gatewayBusy, setGatewayRunning]);

  const handleUpdate = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try { await downloadAndInstallUpdate((p) => setUpdateProgress(p)); }
    catch (e) { toast.error(`更新失败: ${e}`); setIsUpdating(false); setUpdateProgress(null); }
  };

  if (!hydrated) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: "var(--cx-bg)" }}>
        <CxIconLoader className="cx-animate-spin w-5 h-5" style={{ color: "var(--cx-accent)" }} />
      </div>
    );
  }

  const isOnline = gatewayStatus?.running;

  return (
    <div className="flex flex-col h-full" style={{ background: "var(--cx-bg)" }}>
      {/* Top bar */}
      <div className="h-11 px-5 flex items-center justify-between shrink-0 gap-3 backdrop-blur-md"
        style={{ borderBottom: "1px solid var(--cx-border-soft)", background: "var(--cx-topbar-bg)" }}>
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-medium" style={{ color: "var(--cx-text)" }}>快泛 Claw</span>
          <span className="cx-badge"
            style={isOnline ? { background: "var(--cx-success-soft)", color: "var(--cx-success)" } : { background: "var(--cx-error-soft)", color: "var(--cx-error)" }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{ background: isOnline ? "var(--cx-success)" : "var(--cx-error)" }} />
            {isOnline ? `运行中:${gatewayStatus?.port}` : "未启动"}
          </span>
          {updateAvailable && !isUpdating && (
            <button onClick={handleUpdate} className="cx-btn cx-btn-primary" style={{ padding: "2px 10px", fontSize: 11 }}>
              <CxIconDownload className="w-3 h-3" />更新 v{updateVersion}
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => invoke('open_openclaw_console').catch(() => {})}
            className="flex items-center gap-1 px-2 h-7 rounded text-[11px] font-medium transition-all duration-150"
            style={{
              color: 'var(--cx-text-mute)',
              border: '1px solid var(--cx-border-soft)',
            }}
            title="在浏览器中打开网关控制台"
          >
            <CxIconMonitor className="w-3 h-3" /> 控制台
          </button>
          <button
            onClick={handleToggleGateway}
            disabled={gatewayBusy}
            className="flex items-center gap-1.5 px-2.5 h-7 rounded-md text-[12px] font-medium transition-all duration-150 disabled:opacity-50"
            style={{
              background: isOnline ? 'rgba(200,85,74,0.08)' : 'rgba(74,158,92,0.10)',
              color: isOnline ? 'var(--cx-error)' : 'var(--cx-success)',
              border: `1px solid ${isOnline ? 'rgba(200,85,74,0.18)' : 'rgba(74,158,92,0.22)'}`,
            }}
          >
            {gatewayBusy ? (
              <CxIconLoader className="w-3 h-3 animate-spin" />
            ) : isOnline ? (
              <CxIconPower className="w-3 h-3" />
            ) : (
              <CxIconPlay className="w-3 h-3" style={{ fill: 'currentColor' }} />
            )}
            <span>{gatewayBusy ? (isOnline ? '停止中…' : '启动中…') : (isOnline ? '停止' : '启动')}</span>
          </button>
        </div>
      </div>

      {/* Update progress */}
      {isUpdating && updateProgress && (
        <div className="px-4 py-2" style={{ background: "var(--cx-bg-soft)", borderBottom: "1px solid var(--cx-border-soft)" }}>
          <div className="text-[12px]" style={{ color: "var(--cx-text-soft)" }}>更新中:{updateProgress.percentage?.toFixed(0)}%</div>
          <div className="mt-1 h-1 rounded-full" style={{ background: "var(--cx-border-soft)" }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${updateProgress.percentage ?? 0}%`, background: "var(--cx-accent)" }} />
          </div>
        </div>
      )}

      {/* Main content: chat area (using OpenClaw gateway agent) */}
      <div className="flex-1 min-h-0">
        <CodexChatArea
          title="新对话"
          gatewayRunning={isOnline ?? false}
          gatewayBusy={gatewayBusy}
          gatewayPort={gatewayStatus?.port ?? 0}
          onToggleGateway={handleToggleGateway}
        />
      </div>

      {/* Modals */}
      {moduleCardsOpen && <ModuleCardsModal onClose={() => setModuleCardsOpen(false)} />}
      {modelConfigOpen && <ModelConfigModal onClose={() => { setModelConfigOpen(false); loadInitial(); }} />}
    </div>
  );
}
