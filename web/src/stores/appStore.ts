import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface AppState {
  initialized: boolean;
  setInitialized: (value: boolean) => void;
  currentStep: number;
  setCurrentStep: (step: number) => void;
  wizardCompleted: boolean;
  setWizardCompleted: (value: boolean) => void;
  gatewayRunning: boolean;
  setGatewayRunning: (value: boolean) => void;
  theme: 'light' | 'dark' | 'system';
  setTheme: (theme: 'light' | 'dark' | 'system') => void;
  robots: { id: string; name: string }[];
  setRobots: (robots: { id: string; name: string }[]) => void;
}

/** 勿持久化 currentStep：否则重开应用会停留在上次步骤（如第 2 步），用户看不到环境检测 */
const STORE_VERSION = 2;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      initialized: false,
      setInitialized: (value) => set({ initialized: value }),
      currentStep: 1,
      setCurrentStep: (step) => set({ currentStep: step }),
      wizardCompleted: false,
      setWizardCompleted: (value) => set({ wizardCompleted: value }),
      gatewayRunning: false,
      setGatewayRunning: (value) => set({ gatewayRunning: value }),
      theme: 'system',
      setTheme: (theme) => set({ theme }),
      robots: [],
      setRobots: (robots) => set({ robots }),
    }),
    {
      name: 'openclaw-app-storage',
      version: STORE_VERSION,
      migrate: (persisted: unknown, fromVersion: number) => {
        if (fromVersion >= STORE_VERSION) return persisted;
        const s = persisted as Record<string, unknown> | null;
        if (!s || typeof s !== 'object') return persisted;
        // 旧版把 currentStep 写进了 localStorage，升级后丢弃，避免仍停在第 2 步
        const { currentStep: _drop, ...rest } = s;
        void _drop;
        return rest;
      },
      partialize: (state) => ({
        wizardCompleted: state.wizardCompleted,
        theme: state.theme,
        robots: state.robots,
      }),
    }
  )
);
