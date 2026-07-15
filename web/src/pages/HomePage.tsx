import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import toast from "react-hot-toast";
import ModuleCardsModal from "../components/ModuleCardsModal";
import {
  CxIconDownload,
  CxIconLoader,
  CxIconMonitor,
  CxIconPlay,
  CxIconPower,
  CxIconRobots,
} from "../components/icons";
import HermesPage from "./HermesPage";
import ModuleGuiFrame from "../components/layout/ModuleGuiFrame";
import { useAppStore } from "../stores/appStore";
import { useRuntimeStore } from "../stores/runtimeStore";
import { checkForUpdate, downloadAndInstallUpdate, type UpdateProgress } from "../utils/updater";

interface GatewayStatus {
  running: boolean;
  version?: string;
  port: number;
  uptime_seconds: number;
  memory_mb: number;
}

export default function HomePage() {
  const setGatewayRunning = useAppStore((state) => state.setGatewayRunning);
  const activeModule = useAppStore((state) => state.activeModule);
  const runtimes = useRuntimeStore((state) => state.runtimes);
  const scanRuntimes = useRuntimeStore((state) => state.scanRuntimes);
  const startRuntime = useRuntimeStore((state) => state.startRuntime);
  const stopRuntime = useRuntimeStore((state) => state.stopRuntime);
  const checkRuntimeHealth = useRuntimeStore((state) => state.checkRuntimeHealth);

  const [hydrated, setHydrated] = useState(false);
  const [gatewayBusy, setGatewayBusy] = useState(false);
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [openclawGuiUrl, setOpenclawGuiUrl] = useState<string | null>(null);
  const [moduleCardsOpen, setModuleCardsOpen] = useState(false);
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState("");
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const operationLockRef = useRef(false);

  const hermesRuntime = runtimes.find((runtime) => runtime.id === "hermes") ?? null;
  const isHermes = activeModule === "hermes";
  const isOnline = isHermes ? Boolean(hermesRuntime?.running) : Boolean(gatewayStatus?.running);
  const activePort = isHermes ? hermesRuntime?.guiPort || 0 : gatewayStatus?.port || 0;

  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    return useAppStore.persist.onFinishHydration(() => setHydrated(true));
  }, []);

  const loadOpenClawStatus = useCallback(async () => {
    try {
      const status = await invoke<GatewayStatus>("get_gateway_status");
      setGatewayStatus(status);
      setGatewayRunning(status.running);
    } catch {
      setGatewayStatus((current) => current ?? {
        running: false,
        port: 0,
        uptime_seconds: 0,
        memory_mb: 0,
      });
    }
  }, [setGatewayRunning]);

  useEffect(() => {
    if (!hydrated) return;
    void loadOpenClawStatus();
    void scanRuntimes();
  }, [hydrated, loadOpenClawStatus, scanRuntimes]);

  useEffect(() => {
    if (!hydrated) return;
    const poll = () => {
      if (operationLockRef.current) return;
      if (activeModule === "hermes") {
        void checkRuntimeHealth("hermes");
      } else {
        void loadOpenClawStatus();
      }
    };
    const timer = window.setInterval(poll, 5_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeModule, checkRuntimeHealth, hydrated, loadOpenClawStatus]);

  useEffect(() => {
    if (!hydrated || isHermes || !gatewayStatus?.running) {
      if (!isHermes) setOpenclawGuiUrl(null);
      return;
    }
    let cancelled = false;
    void invoke<string>("get_openclaw_embedded_gui_url")
      .then((url) => {
        if (!cancelled) setOpenclawGuiUrl(url);
      })
      .catch(() => {
        if (!cancelled) setOpenclawGuiUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayStatus?.port, gatewayStatus?.running, hydrated, isHermes]);

  useEffect(() => {
    const openModules = () => setModuleCardsOpen(true);
    window.addEventListener("openModuleCards", openModules);
    return () => window.removeEventListener("openModuleCards", openModules);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((info) => {
        if (!info.available) return;
        setUpdateAvailable(true);
        setUpdateVersion(info.version || "");
      }).catch(() => undefined);
    }, 3_000);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  const handleToggleGateway = useCallback(async () => {
    if (gatewayBusy || operationLockRef.current) return;
    operationLockRef.current = true;
    setGatewayBusy(true);
    const stopping = isOnline;
    const toastId = toast.loading(stopping ? "正在停止网关..." : "正在启动网关...");

    try {
      if (isHermes) {
        if (stopping) {
          await stopRuntime("hermes");
        } else {
          await startRuntime("hermes");
        }
        await scanRuntimes();
      } else if (stopping) {
        await invoke("stop_gateway");
        setGatewayRunning(false);
        setGatewayStatus({ running: false, port: 0, uptime_seconds: 0, memory_mb: 0 });
      } else {
        await invoke("start_gateway");
        await loadOpenClawStatus();
      }
      toast.success(stopping ? "网关已停止" : "网关已启动", { id: toastId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`操作失败：${message}`, { id: toastId });
      if (isHermes) await scanRuntimes();
      else await loadOpenClawStatus();
    } finally {
      setGatewayBusy(false);
      window.setTimeout(() => {
        operationLockRef.current = false;
      }, 800);
    }
  }, [
    gatewayBusy,
    isHermes,
    isOnline,
    loadOpenClawStatus,
    scanRuntimes,
    setGatewayRunning,
    startRuntime,
    stopRuntime,
  ]);

  const handleUpdate = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await downloadAndInstallUpdate(setUpdateProgress);
    } catch (error) {
      toast.error(`更新失败：${String(error)}`);
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  };

  if (!hydrated) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "var(--cx-bg)" }}>
        <CxIconLoader className="h-5 w-5 animate-spin" style={{ color: "var(--cx-accent)" }} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col" style={{ background: "var(--cx-bg)" }}>
      <div
        className="flex h-11 shrink-0 items-center justify-between gap-3 px-5"
        style={{ borderBottom: "1px solid var(--cx-border-soft)", background: "var(--cx-topbar-bg)" }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[13px] font-semibold" style={{ color: "var(--cx-text)" }}>
            {isHermes ? "Hermes" : "OpenClaw"}
          </span>
          <span
            className="cx-badge"
            style={isOnline
              ? { background: "var(--cx-success-soft)", color: "var(--cx-success)" }
              : { background: "var(--cx-error-soft)", color: "var(--cx-error)" }}
          >
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: "currentColor" }} />
            {isOnline ? `运行中 · ${activePort}` : "未启动"}
          </span>
          {updateAvailable && !isUpdating ? (
            <button type="button" onClick={handleUpdate} className="cx-btn cx-btn-primary" style={{ padding: "2px 9px", fontSize: 11 }}>
              <CxIconDownload className="h-3 w-3" />更新 v{updateVersion}
            </button>
          ) : null}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setModuleCardsOpen(true)}
            className="flex h-7 items-center gap-1 rounded px-2 text-[11px]"
            style={{ color: "var(--cx-text-mute)", border: "1px solid var(--cx-border-soft)" }}
          >
            <CxIconRobots className="h-3 w-3" />模块
          </button>
          {!isHermes ? (
            <button
              type="button"
              onClick={() => invoke("open_openclaw_console").catch(() => undefined)}
              className="flex h-7 items-center gap-1 rounded px-2 text-[11px]"
              style={{ color: "var(--cx-text-mute)", border: "1px solid var(--cx-border-soft)" }}
            >
              <CxIconMonitor className="h-3 w-3" />控制台
            </button>
          ) : null}
          <button
            type="button"
            onClick={handleToggleGateway}
            disabled={gatewayBusy}
            className="flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px] font-medium disabled:opacity-50"
            style={{
              background: isOnline ? "var(--cx-error-soft)" : "var(--cx-success-soft)",
              color: isOnline ? "var(--cx-error)" : "var(--cx-success)",
              border: "1px solid var(--cx-border-soft)",
            }}
          >
            {gatewayBusy ? (
              <CxIconLoader className="h-3 w-3 animate-spin" />
            ) : isOnline ? (
              <CxIconPower className="h-3 w-3" />
            ) : (
              <CxIconPlay className="h-3 w-3" />
            )}
            {gatewayBusy ? "处理中" : isOnline ? "停止" : "启动"}
          </button>
        </div>
      </div>

      {isUpdating && updateProgress ? (
        <div className="px-4 py-2" style={{ borderBottom: "1px solid var(--cx-border-soft)" }}>
          <div className="text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
            更新中 {updateProgress.percentage?.toFixed(0)}%
          </div>
        </div>
      ) : null}

      <div className="min-h-0 flex-1">
        {isHermes ? (
          <HermesPage
            guiUrl={hermesRuntime?.guiUrl}
            version={hermesRuntime?.version}
            running={isOnline}
            port={activePort}
            busy={gatewayBusy}
            onToggle={handleToggleGateway}
            onRefresh={() => void scanRuntimes()}
          />
        ) : (
          <ModuleGuiFrame
            moduleId="openclaw"
            guiUrl={openclawGuiUrl}
            running={isOnline}
            busy={gatewayBusy}
            onStart={handleToggleGateway}
          />
        )}
      </div>

      {moduleCardsOpen ? <ModuleCardsModal onClose={() => setModuleCardsOpen(false)} /> : null}
    </div>
  );
}
