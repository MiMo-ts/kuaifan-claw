import type { ModuleId } from "../modules/registry";

/** The OpenClaw Control UI persists the application chat under this key. */
export const DEFAULT_OPENCLAW_MAIN_SESSION = "agent:main:main";

export interface ModuleSession {
  id: string;
  moduleId: ModuleId;
  title: string;
  lastMessage?: string;
  updatedAt: number;
  createdAt?: number;
}

export function sortModuleSessions(sessions: ModuleSession[]): ModuleSession[] {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt);
}

export function resolveActiveModuleSession(
  moduleId: ModuleId,
  activeSessionId: string | null,
  sessions: Array<Pick<ModuleSession, "id">>,
): string | null {
  if (moduleId === "hermes" && activeSessionId === null) return null;
  // OpenClaw 的首次刷新会得到空列表；只要用户已经选中持久主会话，
  // 保持它而不是被空列表重置（避免 main 历史在网关重启后被清空）。
  if (
    activeSessionId &&
    moduleId === "openclaw" &&
    activeSessionId === DEFAULT_OPENCLAW_MAIN_SESSION &&
    sessions.length === 0
  ) {
    return activeSessionId;
  }
  return activeSessionId && sessions.some((session) => session.id === activeSessionId)
    ? activeSessionId
    : (sessions[0]?.id ?? null);
}

export function buildNativeGuiUrl(
  moduleId: ModuleId,
  guiUrl: string,
  sessionId?: string | null,
): string {
  const url = new URL(guiUrl);
  url.pathname = "/chat";

  if (sessionId) {
    url.searchParams.set(moduleId === "hermes" ? "resume" : "session", sessionId);
  }

  return url.toString();
}
