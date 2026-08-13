import React, { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CxIconCpu } from "../components/icons";

interface InfiniteCanvasStatus {
  installed: boolean;
  running: boolean;
  version: string;
  port: number;
  guiUrl: string;
  runtimeDir: string;
  dataDir: string;
  pythonSharedFrom: string;
}

export interface InfiniteCanvasPageProps {
  guiUrl?: string | null;
  version?: string;
  running?: boolean;
  port?: number;
  busy?: boolean;
  onToggle?: () => void;
  onRefresh?: () => void;
}

const fontFamily = {
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
} as const;

export default function InfiniteCanvasPage({
  guiUrl,
  running = false,
  port = 0,
  busy = false,
  onToggle,
}: InfiniteCanvasPageProps) {
  const [status, setStatus] = useState<InfiniteCanvasStatus | null>(null);

  const effectiveUrl = useMemo(() => {
    const normalizeCanvasGuiUrl = (raw?: string | null, fallbackPort = 0) => {
      const text = String(raw || "").trim();
      if (!text) {
        return fallbackPort
          ? `http://127.0.0.1:${fallbackPort}/static/index.html?page=canvas`
          : null;
      }
      try {
        const url = new URL(text);
        // 宿主内始终进入完整 Studio 壳，避免只看到项目板而丢失菜单/素材库
        if (url.pathname.includes("canvas-list.html") || !url.pathname.includes("index.html")) {
          url.pathname = "/static/index.html";
          url.searchParams.set("page", "canvas");
        } else if (!url.searchParams.get("page")) {
          url.searchParams.set("page", "canvas");
        }
        return url.toString();
      } catch {
        if (text.includes("canvas-list.html")) {
          return text.replace("canvas-list.html", "index.html?page=canvas");
        }
        return text;
      }
    };
    return (
      normalizeCanvasGuiUrl(guiUrl, port) ||
      normalizeCanvasGuiUrl(status?.guiUrl, port) ||
      (port ? `http://127.0.0.1:${port}/static/index.html?page=canvas` : null)
    );
  }, [guiUrl, status?.guiUrl, port]);

  const loadStatus = useCallback(async () => {
    try {
      const next = await invoke<InfiniteCanvasStatus>("get_infinite_canvas_status");
      setStatus(next);
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus, running, guiUrl]);

  const installed = status?.installed ?? true;
  // 壳层 runtime store 是展示真源：未启动时绝不能因端口残留探测而继续挂载 iframe
  const isOnline = Boolean(running);

  // 与 Hermes / OpenClaw 一致：会话区只保留启动态卡片，不展示路径/版本等技术信息。
  if (!isOnline || !effectiveUrl) {
    return (
      <div className="flex h-full flex-col" style={{ background: "var(--cx-bg)" }}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6" style={fontFamily}>
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--cx-accent-soft)", border: "1px solid var(--cx-border-soft)" }}
          >
            <CxIconCpu className="h-8 w-8" style={{ color: "var(--cx-accent)" }} />
          </div>
          <div className="max-w-[420px] text-center">
            <div className="mb-1 text-[16px] font-semibold" style={{ color: "var(--cx-text)" }}>
              {installed ? "画布与视频运行时已停止" : "画布与视频尚未安装"}
            </div>
            <div className="text-[13px] leading-relaxed" style={{ color: "var(--cx-text-mute)" }}>
              {installed
                ? "启动后可进入画布与视频，进行 LLM / 生图 / 生视频创作。"
                : "请先通过模块中心完成安装，再启动画布与视频服务。"}
            </div>
          </div>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={busy || !installed}
              className="h-9 rounded-md px-5 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: "var(--cx-success)", color: "#fff" }}
            >
              {busy ? "启动中..." : installed ? "启动画布与视频" : "请先安装"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--cx-bg)" }}>
      <div className="min-h-0 flex-1">
        <iframe
          key={`canvas-online-${effectiveUrl}`}
          title="画布与视频"
          src={effectiveUrl}
          className="h-full w-full border-0"
          allow="clipboard-read; clipboard-write; fullscreen"
        />
      </div>
    </div>
  );
}
