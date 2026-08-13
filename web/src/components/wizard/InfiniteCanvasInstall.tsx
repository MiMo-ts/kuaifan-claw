import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { INSTALL_PROGRESS_DOM_EVENT, InstallProgressPayload } from "../../utils/installProgressBridge";
import { CxIconCheckCircle, CxIconLoader } from "../icons";

interface Props {
  onNext: () => void;
  onPrev: () => void;
}

interface CanvasCheckStatus {
  installed: boolean;
  bundlePresent?: boolean;
  pythonSharedFromHermes?: boolean;
  name?: string;
}

export default function InfiniteCanvasInstall({ onNext, onPrev }: Props) {
  const [status, setStatus] = useState<CanvasCheckStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMessage, setProgressMessage] = useState<string>("");
  const [progressPercent, setProgressPercent] = useState<number>(0);

  const refresh = async () => {
    try {
      const next = await invoke<CanvasCheckStatus>("check_infinite_canvas_bundled");
      setStatus(next);
      return next;
    } catch (reason) {
      setError(String(reason));
      return null;
    }
  };

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => {
      if (!installing) void refresh();
    }, 2500);
    return () => window.clearInterval(id);
  }, [installing]);

  useEffect(() => {
    const onBridge = (event: Event) => {
      const detail = (event as CustomEvent<InstallProgressPayload>).detail;
      if (!detail || detail.stage !== "infinite_canvas") return;
      setProgressMessage(detail.message || "");
      if (typeof detail.percent === "number") {
        setProgressPercent(detail.percent);
      }
      if (detail.status === "finished") {
        setInstalling(false);
        void refresh();
      }
      if (detail.status === "failed") {
        setInstalling(false);
        setError(detail.message || "安装失败");
      }
    };
    window.addEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);
    return () => {
      window.removeEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);
    };
  }, []);

  const install = async () => {
    setError(null);
    setInstalling(true);
    setProgressMessage("开始安装画布与视频...");
    setProgressPercent(5);
    try {
      await invoke<string>("install_infinite_canvas_runtime");
      setProgressMessage("画布与视频安装完成");
      setProgressPercent(100);
      await refresh();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setInstalling(false);
    }
  };

  const installed = status?.installed ?? false;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold" style={{ color: "var(--cx-text)" }}>
          安装画布与视频
        </h2>
        <p className="mt-2 text-sm" style={{ color: "var(--cx-text-mute)" }}>
          从内置包安装应用本体，并复用 Hermes 的 python.zip。安装完成后可返回首页。
        </p>
      </div>

      {installed ? (
        <div
          className="flex items-start gap-3 rounded-md border p-4"
          style={{
            borderColor: "var(--cx-success)",
            background: "var(--cx-success-soft, #ecfdf5)",
            color: "var(--cx-success)",
          }}
        >
          <CxIconCheckCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <div className="text-[14px] font-semibold">安装成功</div>
            <div className="mt-1 text-[12px]" style={{ color: "var(--cx-text-mute)" }}>
              已检测到画布与视频运行时，可返回首页启动使用。
            </div>
          </div>
        </div>
      ) : (
        <div
          className="rounded-md border p-4 text-sm"
          style={{
            borderColor: "var(--cx-border)",
            background: "var(--cx-bg-soft)",
            color: "var(--cx-text-soft)",
          }}
        >
          <div>内置应用包：{status?.bundlePresent ? "已就绪" : "检测中 / 未找到"}</div>
          <div className="mt-1">共享 Python：{status?.pythonSharedFromHermes ? "可复用 Hermes" : "检测中 / 未找到"}</div>
          {(installing || progressMessage) && (
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between text-[12px]">
                <span>{progressMessage || "准备安装..."}</span>
                <span>{Math.round(progressPercent)}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded" style={{ background: "var(--cx-border-soft)" }}>
                <div
                  className="h-full rounded transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%`, background: "var(--cx-accent)" }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error ? (
        <div
          className="rounded-md border p-4 text-sm"
          style={{
            borderColor: "var(--cx-error)",
            background: "var(--cx-error-soft, #fef2f2)",
            color: "var(--cx-error)",
          }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex justify-between border-t pt-4" style={{ borderColor: "var(--cx-border-soft)" }}>
        <button
          type="button"
          onClick={onPrev}
          className="px-4 py-2 text-sm"
          style={{ color: "var(--cx-text-mute)" }}
        >
          上一步
        </button>
        {installed ? (
          <button
            type="button"
            onClick={onNext}
            className="rounded px-5 py-2 text-sm font-medium text-white"
            style={{ background: "var(--cx-accent, #2563eb)" }}
          >
            返回首页
          </button>
        ) : (
          <button
            type="button"
            disabled={installing || status?.bundlePresent === false}
            onClick={() => void install()}
            className="inline-flex items-center gap-2 rounded px-5 py-2 text-sm font-medium text-white disabled:opacity-50"
            style={{ background: "var(--cx-accent, #2563eb)" }}
          >
            {installing ? <CxIconLoader className="h-4 w-4 animate-spin" /> : null}
            {installing ? "安装中..." : "安装画布与视频"}
          </button>
        )}
      </div>
    </div>
  );
}
