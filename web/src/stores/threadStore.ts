import { create } from 'zustand';

export interface MediaBlock {
  media_type: string;
  mime: string;
  data: string;
  name?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  media?: MediaBlock[];
  status?: 'streaming' | 'done' | 'error';
  ts: number;
}

export interface Thread {
  id: string;
  title: string;
  lastMessage: string;
  ts: number;
  messages: ChatMessage[];
  /** Gateway session key — 持久化到 OpenClaw sessions.json + JSONL */
  sessionKey: string;
}

interface ThreadState {
  threads: Thread[];
  activeThreadId: string | null;

  createThread: (sessionKey?: string, title?: string) => string;
  updateThread: (id: string, updates: Partial<Pick<Thread, 'title' | 'lastMessage' | 'messages' | 'ts' | 'sessionKey'>>) => void;
  removeThread: (id: string) => void;
  setActiveThread: (id: string | null) => void;
  getActiveThread: () => Thread | null;

  /** Sync threads from gateway session list. Keeps local messages but updates metadata. */
  syncFromGateway: (sessions: Array<{ key: string; sessionId?: string; label?: string; updatedAt?: number }>) => void;
}

let _idCounter = Math.floor(Math.random() * 10000);

export const useThreadStore = create<ThreadState>()((set, get) => ({
  threads: [],
  activeThreadId: null,

  createThread: (sessionKey?: string, title?: string) => {
    _idCounter += 1;
    const id = `t-${Date.now().toString(36)}-${_idCounter.toString(36)}`;
    const key = sessionKey || `kuaifan-${id}`;
    const now = Date.now();
    const thread: Thread = {
      id,
      title: title || '新对话',
      lastMessage: '',
      ts: now,
      sessionKey: key,
      messages: [{
        id: `welcome-${id}`,
        role: 'system',
        content: '欢迎使用快泛 Claw。在下方输入框中输入内容即可与 AI 对话。\n\n支持拖拽文件/图片/视频到输入区发送。',
        ts: now,
      }],
    };
    set((s) => ({ threads: [thread, ...s.threads], activeThreadId: id }));
    return id;
  },

  updateThread: (id, updates) => set((s) => ({
    threads: s.threads.map((t) =>
      t.id === id ? { ...t, ...updates, ts: updates.ts ?? t.ts } : t
    ),
  })),

  removeThread: (id) => set((s) => {
    const next = s.threads.filter((t) => t.id !== id);
    return {
      threads: next,
      activeThreadId: s.activeThreadId === id ? null : s.activeThreadId,
    };
  }),

  setActiveThread: (id) => set({ activeThreadId: id }),

  getActiveThread: () => {
    const { threads, activeThreadId } = get();
    return threads.find((t) => t.id === activeThreadId) ?? null;
  },

  /** 从 Gateway sessions.list 同步会话列表，保留本地已有消息 */
  syncFromGateway: (sessions) => {
    const current = get().threads;
    const now = Date.now();
    const updated: Thread[] = [];

    for (const s of sessions) {
      const existing = current.find(t => t.sessionKey === s.key);
      if (existing) {
        updated.push({
          ...existing,
          title: s.label || existing.title,
          ts: s.updatedAt ? s.updatedAt * 1000 : existing.ts,
          sessionKey: s.key,
        });
      } else {
        _idCounter += 1;
        const id = `t-${now.toString(36)}-${_idCounter.toString(36)}`;
        updated.push({
          id,
          title: s.label || '历史会话',
          lastMessage: '',
          ts: s.updatedAt ? s.updatedAt * 1000 : now,
          sessionKey: s.key,
          messages: [],
        });
      }
    }

    // Keep local-only threads (no sessionKey yet or not in gateway list)
    for (const t of current) {
      if (!updated.some(u => u.sessionKey === t.sessionKey) && t.sessionKey && !t.sessionKey.startsWith('kuaifan-')) {
        // Gateway-owned but not in current list — might be deleted, remove from local
        continue;
      }
      if (!updated.some(u => u.id === t.id)) {
        updated.push(t);
      }
    }

    // Sort by ts descending
    updated.sort((a, b) => b.ts - a.ts);

    const activeId = get().activeThreadId;
    const activeStillExists = updated.some(t => t.id === activeId);

    set({
      threads: updated,
      activeThreadId: activeStillExists ? activeId : (updated[0]?.id ?? null),
    });
  },
}));
