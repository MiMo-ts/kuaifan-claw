import { useMemo } from "react";
import type { ModuleId } from "../../modules/registry";
import { buildNativeGuiUrl } from "../../services/moduleSessionProtocol";
import { CxIconLoader, CxIconPlay } from "../icons";

interface ModuleGuiFrameProps {
  moduleId: ModuleId;
  guiUrl: string | null;
  running: boolean;
  busy?: boolean;
  sessionId?: string | null;
  onStart: () => void;
}

export default function ModuleGuiFrame({
  moduleId,
  guiUrl,
  running,
  busy = false,
  sessionId,
  onStart,
}: ModuleGuiFrameProps) {
  const source = useMemo(
    () => guiUrl ? buildNativeGuiUrl(moduleId, guiUrl, sessionId) : null,
    [guiUrl, moduleId, sessionId],
  );

  if (!running) {
    return (
      <div className="flex h-full items-center justify-center p-6" style={{ background: "var(--cx-bg)" }}>
        <button type="button" onClick={onStart} disabled={busy} className="cx-btn cx-btn-primary disabled:opacity-50">
          {busy ? <CxIconLoader className="h-4 w-4 animate-spin" /> : <CxIconPlay className="h-4 w-4" />}
          启动 {moduleId === "hermes" ? "Hermes" : "OpenClaw"} 网关
        </button>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="flex h-full items-center justify-center" style={{ background: "var(--cx-bg)" }}>
        <CxIconLoader className="h-5 w-5 animate-spin" style={{ color: "var(--cx-accent)" }} />
      </div>
    );
  }

  return (
    <iframe
      key={source}
      title={`${moduleId} 原生对话界面`}
      src={source}
      className="h-full w-full border-0"
      allow="clipboard-read; clipboard-write"
    />
  );
}
