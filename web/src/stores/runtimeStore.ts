import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface RuntimeInfo {
  id: string;
  name: string;
  description: string;
  version: string;
  icon: string;
  category: string;
  capabilities: string[];
  guiType: "web" | "terminal" | "external";
  guiUrl: string;
  guiPort: number;
  gatewayPort: number;
  running: boolean;
  pid: number | null;
  startedAt: number | null;
}

interface RuntimeState {
  runtimes: RuntimeInfo[];
  activeRuntimeId: string; // 当前选中模块
  loading: boolean;

  scanRuntimes: () => Promise<void>;
  startRuntime: (id: string) => Promise<void>;
  stopRuntime: (id: string) => Promise<void>;
  checkRuntimeHealth: (id: string) => Promise<boolean>;
  setActiveRuntime: (id: string) => void;
  getActiveRuntime: () => RuntimeInfo | null;
}

export const useRuntimeStore = create<RuntimeState>()((set, get) => ({
  runtimes: [],
  activeRuntimeId: "openclaw",
  loading: false,

  scanRuntimes: async () => {
    set({ loading: true });
    try {
      const list = await invoke<RuntimeInfo[]>("get_runtime_list");
      set({ runtimes: list, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  startRuntime: async (id: string) => {
    set({ loading: true });
    try {
      const inst = await invoke<RuntimeInfo>("start_runtime", {
        runtimeId: id,
      });
      set((s) => ({
        runtimes: s.runtimes.map((r) => (r.id === id ? inst : r)),
        loading: false,
      }));
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  stopRuntime: async (id: string) => {
    try {
      await invoke("stop_runtime", { runtimeId: id });
      set((s) => ({
        runtimes: s.runtimes.map((r) =>
          r.id === id ? { ...r, running: false, pid: null, startedAt: null } : r
        ),
      }));
    } catch (e) {
      throw e;
    }
  },

  checkRuntimeHealth: async (id: string) => {
    try {
      const inst = await invoke<RuntimeInfo>("get_runtime_status", { runtimeId: id });
      set((s) => ({
        runtimes: s.runtimes.map((r) => (r.id === id ? inst : r)),
      }));
      return inst.running;
    } catch {
      return false;
    }
  },

  setActiveRuntime: (id: string) => set({ activeRuntimeId: id }),

  getActiveRuntime: () => {
    const { runtimes, activeRuntimeId } = get();
    return runtimes.find((r) => r.id === activeRuntimeId) ?? null;
  },
}));
