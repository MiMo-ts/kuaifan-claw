import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
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

const STORE_VERSION = 2;
const STORAGE_NAME = "openclaw-cn-manager-sessions";

export const DEFAULT_NEW_CHAT_TITLE = "\u65b0\u4f1a\u8bdd";

interface ModuleSessionState {
  hydrated: boolean;
  sessionsByModule: SessionMap;
  activeSessionIdByModule: ActiveSessionMap;
  setHydrated: (value: boolean) => void;
  setSessions: (moduleId: ModuleId, sessions: ModuleSession[]) => void;
  setActiveSession: (moduleId: ModuleId, sessionId: string | null) => void;
  removeSession: (moduleId: ModuleId, sessionId: string) => void;
  upsertSession: (moduleId: ModuleId, session: ModuleSession) => void;
}

export function mergeModuleSessions(
  current: ModuleSession[],
  incoming: ModuleSession[],
): ModuleSession[] {
  if (incoming.length === 0) return current;
  if (current.length === 0) return sortModuleSessions(incoming);

  const incomingById = new Map(incoming.map((session) => [session.id, session]));
  const localsOnly = current.filter((session) => !incomingById.has(session.id));

  const merged = incoming.map((remote) => {
    const local = current.find((session) => session.id === remote.id);
    if (!local) return remote;
    return {
      ...local,
      ...remote,
      title: remote.title && remote.title !== DEFAULT_NEW_CHAT_TITLE ? remote.title : local.title,
      lastMessage: remote.lastMessage || local.lastMessage,
      createdAt: local.createdAt ?? remote.createdAt,
    };
  });

  return sortModuleSessions([...merged, ...localsOnly]);
}

export const useModuleSessionStore = create<ModuleSessionState>()(
  persist(
    (set) => ({
      hydrated: false,
      sessionsByModule: emptySessions(),
      activeSessionIdByModule: emptyActiveSessions(),

      setHydrated: (value) => set({ hydrated: value }),

      setSessions: (moduleId, sessions) => set((state) => {
        const incoming = sortModuleSessions(sessions);
        const current = state.sessionsByModule[moduleId] ?? [];
        const active = state.activeSessionIdByModule[moduleId];

        if (incoming.length === 0) {
          if (current.length === 0) return state;
          return {
            sessionsByModule: { ...state.sessionsByModule, [moduleId]: current },
            activeSessionIdByModule: { ...state.activeSessionIdByModule, [moduleId]: active },
          };
        }

        const merged = mergeModuleSessions(current, incoming);
        return {
          sessionsByModule: { ...state.sessionsByModule, [moduleId]: merged },
          activeSessionIdByModule: {
            ...state.activeSessionIdByModule,
            [moduleId]: resolveActiveModuleSession(moduleId, active, merged),
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

      upsertSession: (moduleId, session) => set((state) => {
        const current = state.sessionsByModule[moduleId] ?? [];
        const existingIndex = current.findIndex((s) => s.id === session.id);
        let next: ModuleSession[];
        if (existingIndex >= 0) {
          next = current.slice();
          next[existingIndex] = { ...current[existingIndex], ...session };
        } else {
          next = [session, ...current];
        }
        return {
          sessionsByModule: { ...state.sessionsByModule, [moduleId]: sortModuleSessions(next) },
          activeSessionIdByModule: { ...state.activeSessionIdByModule, [moduleId]: session.id },
        };
      }),
    }),
    {
      name: STORAGE_NAME,
      version: STORE_VERSION,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        sessionsByModule: state.sessionsByModule,
        activeSessionIdByModule: state.activeSessionIdByModule,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true);
      },
      migrate: (persisted) => (persisted as Partial<ModuleSessionState>) ?? {},
      merge: (persisted, current) => {
        const p = (persisted as Partial<ModuleSessionState>) ?? {};
        const sessionsByModule = { ...current.sessionsByModule };
        if (p.sessionsByModule) {
          for (const key of Object.keys(p.sessionsByModule) as ModuleId[]) {
            const value = p.sessionsByModule[key];
            if (Array.isArray(value)) {
              sessionsByModule[key] = sortModuleSessions(value);
            }
          }
        }
        return {
          ...current,
          ...p,
          sessionsByModule,
          activeSessionIdByModule: { ...current.activeSessionIdByModule, ...(p.activeSessionIdByModule ?? {}) },
        };
      },
    },
  ),
);
