import { create } from "zustand";
import type { ModuleId } from "../modules/registry";
import {
  resolveActiveModuleSession,
  sortModuleSessions,
  type ModuleSession,
} from "../services/moduleSessionProtocol";

type SessionMap = Record<ModuleId, ModuleSession[]>;
type ActiveSessionMap = Record<ModuleId, string | null>;

const emptySessions = (): SessionMap => ({ openclaw: [], hermes: [], codex: [], claude: [] });
const emptyActiveSessions = (): ActiveSessionMap => ({ openclaw: null, hermes: null, codex: null, claude: null });

interface ModuleSessionState {
  sessionsByModule: SessionMap;
  activeSessionIdByModule: ActiveSessionMap;
  setSessions: (moduleId: ModuleId, sessions: ModuleSession[]) => void;
  setActiveSession: (moduleId: ModuleId, sessionId: string | null) => void;
  removeSession: (moduleId: ModuleId, sessionId: string) => void;
}

export const useModuleSessionStore = create<ModuleSessionState>()((set) => ({
  sessionsByModule: emptySessions(),
  activeSessionIdByModule: emptyActiveSessions(),

  setSessions: (moduleId, sessions) => set((state) => {
    const sorted = sortModuleSessions(sessions);
    if (sorted.length === 0) {
      // 首次刷新前会得到空列表；保留 store 中已有会话，避免覆盖
      // 当前 main 页面看到的历史消息丢失。
      const current = state.sessionsByModule[moduleId];
      const active = state.activeSessionIdByModule[moduleId];
      if (current && current.length > 0) {
        return {
          sessionsByModule: { ...state.sessionsByModule, [moduleId]: current },
          activeSessionIdByModule: {
            ...state.activeSessionIdByModule,
            [moduleId]: active,
          },
        };
      }
    }
    const activeSessionId = state.activeSessionIdByModule[moduleId];
    return {
      sessionsByModule: { ...state.sessionsByModule, [moduleId]: sorted },
      activeSessionIdByModule: {
        ...state.activeSessionIdByModule,
        [moduleId]: resolveActiveModuleSession(moduleId, activeSessionId, sorted),
      },
    };
  }),

  setActiveSession: (moduleId, sessionId) => set((state) => ({
    activeSessionIdByModule: { ...state.activeSessionIdByModule, [moduleId]: sessionId },
  })),

  removeSession: (moduleId, sessionId) => set((state) => {
    const sessions = state.sessionsByModule[moduleId].filter((session) => session.id !== sessionId);
    return {
      sessionsByModule: { ...state.sessionsByModule, [moduleId]: sessions },
      activeSessionIdByModule: {
        ...state.activeSessionIdByModule,
        [moduleId]: state.activeSessionIdByModule[moduleId] === sessionId ? (sessions[0]?.id ?? null) : state.activeSessionIdByModule[moduleId],
      },
    };
  }),
}));
