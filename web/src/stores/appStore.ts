import { create } from "zustand";
import { persist } from "zustand/middleware";

interface AppState {
  // Initialization
  initialized: boolean;
  setInitialized: (value: boolean) => void;

  // Wizard
  currentStep: number;
  setCurrentStep: (step: number) => void;
  wizardCompleted: boolean;
  setWizardCompleted: (value: boolean) => void;

  // Auth
  isLoggedIn: boolean;
  userId: number;
  username: string;
  displayName: string;
  role: number;
  group: string;
  quota: number;
  usedQuota: number;
  requestCount: number;
  email: string | null;
  affCode: string | null;
  apiKey: string;
  accessToken: string;
  newApiBaseUrl: string;
  setAuth: (auth: Partial<AppState>) => void;
  clearAuth: () => void;
  setNewApiBaseUrl: (url: string) => void;
  setApiKey: (key: string) => void;
  setQuota: (quota: number, usedQuota: number) => void;

  // Gateway
  gatewayRunning: boolean;
  setGatewayRunning: (value: boolean) => void;

  // UI
  theme: "light" | "dark" | "system";
  setTheme: (theme: "light" | "dark" | "system") => void;
  conversationKey: number;
  newConversation: () => void;

  // Robots
  robots: { id: string; name: string }[];
  setRobots: (robots: { id: string; name: string }[]) => void;

  // OpenClaw setup
  openclawSetupDone: boolean;
  setOpenclawSetupDone: (v: boolean) => void;

  // Module switching
  activeModule: "openclaw" | "hermes" | "codex" | "claude" | "infinite_canvas";
  setActiveModule: (m: "openclaw" | "hermes" | "codex" | "claude" | "infinite_canvas") => void;
  codexInstalled: boolean;
  setCodexInstalled: (v: boolean) => void;
}

const STORE_VERSION = 5;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Init
      initialized: false,
      setInitialized: (value) => set({ initialized: value }),

      // Wizard
      currentStep: 1,
      setCurrentStep: (step) => set({ currentStep: step }),
      wizardCompleted: false,
      setWizardCompleted: (value) => set({ wizardCompleted: value }),

      // Auth
      isLoggedIn: false,
      userId: 0,
      username: "",
      displayName: "",
      role: 0,
      group: "",
      quota: 0,
      usedQuota: 0,
      requestCount: 0,
      email: null,
      affCode: null,
      apiKey: "",
      accessToken: "",
      newApiBaseUrl: "",
      setAuth: (auth) =>
        set((s) => ({
          ...s,
          isLoggedIn: auth.isLoggedIn ?? s.isLoggedIn,
          userId: auth.userId ?? s.userId,
          username: auth.username ?? s.username,
          displayName: auth.displayName ?? s.displayName,
          role: auth.role ?? s.role,
          group: auth.group ?? s.group,
          quota: auth.quota ?? s.quota,
          usedQuota: auth.usedQuota ?? s.usedQuota,
          requestCount: auth.requestCount ?? s.requestCount,
          email: auth.email ?? s.email,
          affCode: auth.affCode ?? s.affCode,
        })),
      clearAuth: () =>
        set({
          isLoggedIn: false,
          userId: 0,
          username: "",
          displayName: "",
          role: 0,
          group: "",
          quota: 0,
          usedQuota: 0,
          requestCount: 0,
          email: null,
          affCode: null,
          apiKey: "",
          accessToken: "",
        }),
      setNewApiBaseUrl: (url) => set({ newApiBaseUrl: url }),
      setApiKey: (key) => set({ apiKey: key }),
      setQuota: (quota, usedQuota) => set({ quota, usedQuota }),

      // Gateway
      gatewayRunning: false,
      setGatewayRunning: (value) => set({ gatewayRunning: value }),

      // UI
      theme: "system",
      setTheme: (theme) => set({ theme }),
      conversationKey: 0,
      newConversation: () => set((s) => ({ conversationKey: s.conversationKey + 1 })),

      // Robots
      robots: [],
      setRobots: (robots) => set({ robots }),

      // OpenClaw
      openclawSetupDone: false,
      setOpenclawSetupDone: (v) => set({ openclawSetupDone: v }),

      // Module switching
      activeModule: "openclaw" as "openclaw" | "hermes" | "codex" | "claude" | "infinite_canvas",
      setActiveModule: (m) => set({ activeModule: m }),
      codexInstalled: false,
      setCodexInstalled: (v) => set({ codexInstalled: v }),
    }),
    {
      name: "openclaw-app-storage",
      version: STORE_VERSION,
      migrate: (persisted: unknown, fromVersion: number) => {
        if (fromVersion >= STORE_VERSION) return persisted;
        const s = persisted as Record<string, unknown> | null;
        if (!s || typeof s !== "object") return persisted;
        const { currentStep: _cs, ...rest } = s;
        void _cs;
        return rest;
      },
      partialize: (state) => ({
        wizardCompleted: state.wizardCompleted,
        theme: state.theme,
        robots: state.robots,
        isLoggedIn: state.isLoggedIn,
        userId: state.userId,
        username: state.username,
        displayName: state.displayName,
        role: state.role,
        group: state.group,
        quota: state.quota,
        usedQuota: state.usedQuota,
        email: state.email,
        affCode: state.affCode,
        apiKey: state.apiKey,
        newApiBaseUrl: state.newApiBaseUrl,
        openclawSetupDone: state.openclawSetupDone,
        activeModule: state.activeModule,
        codexInstalled: state.codexInstalled,
      }),
    }
  )
);
