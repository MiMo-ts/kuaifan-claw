/**
 * useGatewayChat — React hook，为 CodexChatArea 提供流式对话能力。
 * 通过 GatewayClient WebSocket 直连本地 OpenClaw 网关 agent。
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { GatewayClient, ChatDelta } from './gatewayClient';

export interface UseGatewayChatOptions {
  gatewayPort: number;
  gatewayOnline: boolean;
  onDelta: (fullText: string) => void;
  onFinal: (fullText: string) => void;
  onError: (error: string) => void;
  onAborted: () => void;
}

export interface UseGatewayChatReturn {
  sendMessage: (message: string, sessionKey: string) => Promise<{ runId: string }>;
  abortChat: (sessionKey: string, runId?: string) => void;
  isReady: boolean;
}

export function useGatewayChat(opts: UseGatewayChatOptions): UseGatewayChatReturn {
  const { gatewayPort, gatewayOnline } = opts;
  const gwRef = useRef<GatewayClient | null>(null);
  const [isReady, setIsReady] = useState(false);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    console.log('[gw-chat] effect: online=' + gatewayOnline + ' port=' + gatewayPort);
    if (!gatewayOnline || gatewayPort <= 0) {
      console.log('[gw-chat] cleanup: gateway offline or port=0');
      if (gwRef.current) { gwRef.current.close(); gwRef.current = null; }
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      setIsReady(false);
      return;
    }

    let cancelled = false;
    let attempt = 0;

    const doConnect = async () => {
      if (cancelled) return;
      attempt += 1;
      console.log('[gw-chat] connect attempt #' + attempt + ' port=' + gatewayPort);

      let token = localStorage.getItem('gw-token') || '';
      console.log('[gw-chat] token from localStorage: ' + (token ? token.substring(0,8)+'...' : '(none)'));
      if (!token) {
        try {
          const info = await invoke<{ port: number; token: string }>('get_gateway_ws_info');
          console.log('[gw-chat] get_gateway_ws_info returned port=' + info?.port + ' token=' + (info?.token ? info.token.substring(0,8)+'...' : '(none)'));
          if (info?.token && info.token.length >= 8) {
            token = info.token;
            localStorage.setItem('gw-token', token);
          }
        } catch (e) {
          console.log('[gw-chat] get_gateway_ws_info failed:', e);
        }
      }

      if (cancelled) return;

      console.log('[gw-chat] creating GatewayClient port=' + gatewayPort + ' token=' + (token ? token.substring(0,8)+'...' : '(none)'));
      const gw = GatewayClient.createDirect(gatewayPort, token);
      gwRef.current = gw;

      gw.onChatDelta = (delta: ChatDelta) => {
        const cur = optsRef.current;
        console.log('[gw-chat] delta state=' + delta.state + ' msg=' + (delta.message?.substring(0,40) || ''));
        switch (delta.state) {
          case 'delta':
            if (delta.message !== undefined) cur.onDelta(delta.message);
            break;
          case 'final':
            if (delta.message !== undefined) cur.onFinal(delta.message);
            else cur.onFinal('');
            break;
          case 'error':
            cur.onError(delta.errorMessage || delta.message || '网关返回错误');
            break;
          case 'aborted':
            cur.onAborted();
            break;
        }
      };

      gw.onClose = (code, reason) => {
        console.log('[gw-chat] ws closed code=' + code + ' reason=' + reason + ' attempt=' + attempt);
        if (cancelled) return;
        setIsReady(false);
        // 保底重试（Rust 已验证 WS 就绪，前端重试仅应对极端情况）
        if (attempt < 5) {
          const delay = 1000 * attempt;
          console.log('[gw-chat] retry in ' + delay + 'ms');
          retryTimerRef.current = setTimeout(() => {
            retryTimerRef.current = null;
            if (!cancelled) doConnect();
          }, delay);
        }
      };

      gw.onConnected = () => {
        if (!cancelled) {
          console.log('[gw-chat] CONNECTED! isReady=true');
          setIsReady(true);
        }
      };

      console.log('[gw-chat] calling gw.connect()');
      gw.connect();
    };

    doConnect();

    return () => {
      console.log('[gw-chat] effect cleanup');
      cancelled = true;
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
      gwRef.current?.close();
      gwRef.current = null;
      setIsReady(false);
    };
  }, [gatewayOnline, gatewayPort]);

  const sendMessage = useCallback(async (message: string, sessionKey: string): Promise<{ runId: string }> => {
    const gw = gwRef.current;
    console.log('[gw-chat] sendMessage isConnected=' + (gw?.isConnected || false));
    if (!gw || !gw.isConnected) throw new Error('网关未连接');
    return gw.sendChatStream({ sessionKey, message, deliver: false });
  }, []);

  const abortChat = useCallback((sessionKey: string, runId?: string) => {
    gwRef.current?.abortChat(sessionKey, runId);
  }, []);

  return { sendMessage, abortChat, isReady };
}
