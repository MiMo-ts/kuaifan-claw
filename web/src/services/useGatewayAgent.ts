/**
 * React hook: 通过 OpenClawGateway 直连网关 Agent，提供完整的会话能力
 * （sessions, tools, skills, memory），与 OpenClaw 控制台 UI 对话体验一致。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { OpenClawGateway } from './openclawGateway';

export interface AgentStatus {
  connected: boolean;
  connecting: boolean;
  error: string | null;
}

interface UseGatewayAgentOptions {
  onDelta?: (delta: string) => void;
  onFinal?: (fullText: string) => void;
  onError?: (error: string) => void;
  onStatusChange?: (status: AgentStatus) => void;
}

export function useGatewayAgent(opts: UseGatewayAgentOptions = {}) {
  const gwRef = useRef<OpenClawGateway | null>(null);
  const [status, setStatus] = useState<AgentStatus>({
    connected: false,
    connecting: false,
    error: null,
  });
  const statusRef = useRef(status);
  statusRef.current = status;

  const updateStatus = useCallback((patch: Partial<AgentStatus>) => {
    setStatus((prev) => {
      const next = { ...prev, ...patch };
      opts.onStatusChange?.(next);
      return next;
    });
  }, [opts]);

  const connect = useCallback(async () => {
    if (gwRef.current) {
      gwRef.current.stop();
      gwRef.current = null;
    }

    updateStatus({ connecting: true, error: null });

    try {
      const { url, token } = await OpenClawGateway.resolveConnection();
      const gw = new OpenClawGateway({
        url,
        token,
        onConnected: () => {
          updateStatus({ connected: true, connecting: false, error: null });
        },
        onDisconnected: (reason) => {
          updateStatus({ connected: false, connecting: false, error: reason ?? null });
        },
        onError: (err) => {
          console.error('[gw-agent] error:', err.message);
          updateStatus({ error: err.message });
        },
        onEvent: (event, payload) => {
          if (event === 'chat') {
            const state = payload?.state;
            // Content is in `message` field per ChatEventSchema
            let content = '';
            if (typeof payload?.message === 'string') {
              content = payload.message;
            } else if (payload?.message?.content) {
              content = typeof payload.message.content === 'string'
                ? payload.message.content
                : JSON.stringify(payload.message.content);
            } else if (payload?.message) {
              content = JSON.stringify(payload.message);
            }

            if (state === 'final' || state === 'finished') {
              opts.onFinal?.(content);
            } else if (state === 'error') {
              opts.onError?.(payload?.errorMessage ?? payload?.error ?? 'chat error');
            } else if (content) {
              opts.onDelta?.(content);
            }
          }
        },
      });

      gwRef.current = gw;
      await gw.start();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      updateStatus({ connecting: false, connected: false, error: msg });
    }
  }, [opts, updateStatus]);

  const disconnect = useCallback(() => {
    gwRef.current?.stop();
    gwRef.current = null;
    updateStatus({ connected: false, connecting: false, error: null });
  }, [updateStatus]);

  const sendMessage = useCallback(async (message: string, sessionKey = 'main') => {
    const gw = gwRef.current;
    if (!gw) {
      throw new Error('Gateway agent not initialized');
    }
    if (!statusRef.current.connected) {
      throw new Error('Gateway not connected');
    }
    return gw.sendChat({ sessionKey, message, deliver: false });
  }, []);

  const abortChat = useCallback(async (sessionKey = 'main', runId?: string) => {
    const gw = gwRef.current;
    if (!gw || !runId) return;
    try {
      await gw.abortChat(sessionKey, runId);
    } catch { /* ignore */ }
  }, []);

  const loadHistory = useCallback(async (sessionKey = 'main', limit = 100) => {
    const gw = gwRef.current;
    if (!gw) throw new Error('Gateway agent not initialized');
    return gw.loadHistory(sessionKey, limit);
  }, []);

  const getStatus = useCallback(async () => {
    const gw = gwRef.current;
    if (!gw) throw new Error('Gateway agent not initialized');
    return gw.getStatus();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      gwRef.current?.stop();
      gwRef.current = null;
    };
  }, []);

  return {
    status,
    connect,
    disconnect,
    sendMessage,
    abortChat,
    loadHistory,
    getStatus,
  };
}
