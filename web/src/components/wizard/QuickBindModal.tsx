import { useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  CxIconAlertCircle,
  CxIconCheckCircle,
  CxIconClock,
  CxIconClose,
  CxIconLoader,
  CxIconRefresh,
} from "../icons";
interface QuickBindStartResult {
  success: boolean;
  qr_image_base64?: string;
  device_code?: string;
  expires_in?: number;
  interval_ms?: number;
  error?: string;
}

interface QuickBindPollResult {
  status: string;
  access_token?: string;
  client_secret?: string;
  bot_token?: string;
  message?: string;
  error?: string;
}

export interface QuickBindCompleteData {
  appId?: string;
  appSecret?: string;
  authCode?: string;
}

export type QuickBindPlatform = 'feishu' | 'wechat';

interface Props {
  platform: QuickBindPlatform;
  onComplete: (data: QuickBindCompleteData) => void;
  onCancel: () => void;
}

const PLATFORM_CONFIG: Record<QuickBindPlatform, {
  title: string;
  label: string;
  instruction: string;
  scanningMsg: string;
  manualHint: string;
  startCommand: string;
  pollCommand: string;
  startArgs: Record<string, unknown>;
  pollArgsFn: (deviceCode: string) => Record<string, unknown>;
}> = {
  feishu: {
    title: '飞书快捷绑定',
    label: '飞书',
    instruction: '请使用飞书 App 扫描二维码',
    scanningMsg: '等待扫码中，扫码后自动获取凭证…',
    manualHint: '也可在飞书开放平台手动创建应用获取凭证',
    startCommand: 'start_feishu_quick_bind',
    pollCommand: 'poll_feishu_quick_bind',
    startArgs: {},
    pollArgsFn: (dc) => ({ deviceCode: dc }),
  },
  wechat: {
    title: '微信快捷绑定',
    label: '微信',
    instruction: '请使用微信 App 扫描二维码',
    scanningMsg: '等待扫码中，扫码后自动获取 bot_token…',
    manualHint: '也可通过命令行手动登录',
    startCommand: 'start_wechat_cli_bind',
    pollCommand: 'poll_wechat_cli_bind',
    startArgs: {},
    pollArgsFn: () => ({}),
  },
};

function formatTime(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

type Phase = 'loading' | 'qr' | 'done' | 'error';

export default function QuickBindModal({ platform, onComplete, onCancel }: Props) {
  const cfg = PLATFORM_CONFIG[platform];
  const [phase, setPhase] = useState<Phase>('loading');
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [expiresIn, setExpiresIn] = useState(600);
  const [remainingSecs, setRemainingSecs] = useState(600);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Refs to avoid stale closure in polling
  const deviceCodeRef = useRef<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);
  const pollIntervalRef = useRef(5000);

  const stopTimers = useCallback(() => {
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
  }, []);

  // Poll loop — uses refs, safe from stale closures
  const doPoll = useCallback(async () => {
    if (!mountedRef.current) return;
    const dc = deviceCodeRef.current;
    if (!dc) return;

    try {
      const pollArgs = cfg.pollArgsFn(dc);
      const result = await invoke<QuickBindPollResult>(cfg.pollCommand, pollArgs);
      if (!mountedRef.current) return;

      switch (result.status) {
        case 'success':
        case 'confirmed':
          stopTimers();
          setPhase('done');
          setStatusMsg('授权成功！');
          setTimeout(() => {
            if (mountedRef.current) {
              const data: QuickBindCompleteData = {};
              if (result.access_token) data.appId = result.access_token;
              if (result.client_secret) data.appSecret = result.client_secret;
              if (result.bot_token) data.authCode = result.bot_token;
              onComplete(data);
            }
          }, 600);
          break;

        case 'scanned':
          setStatusMsg('已扫码，正在确认授权…');
          scheduleNext(2000); // poll faster after scan
          break;

        case 'waiting':
        case 'wait':
          setStatusMsg(cfg.scanningMsg);
          scheduleNext();
          break;

        case 'expired':
          stopTimers();
          setPhase('error');
          setErrorMsg('QR 码已过期，请重新发起绑定');
          break;

        case 'denied':
          stopTimers();
          setPhase('error');
          setErrorMsg('用户拒绝授权');
          break;

        default:
          if (result.message) setStatusMsg(result.message);
          scheduleNext();
      }
    } catch (e) {
      if (!mountedRef.current) return;
      // Network errors during poll are normal — keep trying
      pollTimerRef.current = setTimeout(doPoll, pollIntervalRef.current);
    }
  }, [cfg, onComplete, stopTimers]);

  const scheduleNext = useCallback((delayOverride?: number) => {
    if (!mountedRef.current) return;
    const delay = delayOverride ?? pollIntervalRef.current;
    pollTimerRef.current = setTimeout(doPoll, delay);
  }, [doPoll]);

  // Start: get QR code then begin auto-polling
  const startBind = useCallback(async () => {
    setPhase('loading');
    setErrorMsg(null);
    setStatusMsg(null);
    try {
      const result = await invoke<QuickBindStartResult>(cfg.startCommand, cfg.startArgs);
      if (!mountedRef.current) return;

      if (result.success && result.qr_image_base64) {
        setQrBase64(result.qr_image_base64);
        const dc = result.device_code || null;
        deviceCodeRef.current = dc;
        const exp = result.expires_in ?? 600;
        setExpiresIn(exp);
        setRemainingSecs(exp);
        pollIntervalRef.current = result.interval_ms ?? 5000;
        setPhase('qr');
        setStatusMsg(cfg.scanningMsg);
        // Auto-start polling immediately
        scheduleNext(2000);
      } else {
        setPhase('error');
        setErrorMsg(result.error || '启动快捷绑定失败，请检查网络后重试');
      }
    } catch (e) {
      setPhase('error');
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }, [cfg, scheduleNext]);

  // Countdown
  useEffect(() => {
    if (phase !== 'qr') return;
    countdownRef.current = setInterval(() => {
      setRemainingSecs(prev => {
        if (prev <= 1) {
          stopTimers();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [phase, stopTimers]);

  // Expired
  useEffect(() => {
    if (remainingSecs <= 0 && phase === 'qr') {
      stopTimers();
      setPhase('error');
      setErrorMsg('QR 码已过期，请重新发起绑定');
    }
  }, [remainingSecs, phase, stopTimers]);

  // Lifecycle
  useEffect(() => {
    mountedRef.current = true;
    startBind();
    return () => {
      mountedRef.current = false;
      stopTimers();
    };
  }, [startBind, stopTimers]);

  const handleRetry = () => {
    stopTimers();
    setQrBase64(null);
    deviceCodeRef.current = null;
    pollIntervalRef.current = 5000;
    startBind();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">{cfg.title}</h2>
          <button onClick={() => { stopTimers(); onCancel(); }} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
            <CxIconClose className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-6 flex flex-col items-center space-y-4">
          {/* Loading */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center space-y-3 py-8">
              <CxIconLoader className="w-10 h-10 text-blue-500 animate-spin" />
              <p className="text-sm text-gray-500">正在生成绑定二维码...</p>
            </div>
          )}

          {/* QR display + auto-polling status */}
          {phase === 'qr' && qrBase64 && (
            <>
              <div className="flex items-center gap-2 text-sm">
                <CxIconClock className="w-4 h-4 text-gray-400" />
                <span className={remainingSecs < 60 ? 'text-red-500 font-medium' : 'text-gray-500'}>
                  {formatTime(remainingSecs)}
                </span>
              </div>

              <div className="p-3 bg-white border-2 border-gray-200 rounded-xl relative">
                <img
                  src={`data:image/png;base64,${qrBase64}`}
                  alt={`${cfg.label}绑定二维码`}
                  className="w-56 h-56"
                />
              </div>

              {/* Auto-polling indicator */}
              <div className="flex items-center gap-2 text-sm">
                <CxIconLoader className="w-4 h-4 text-blue-500 animate-spin" />
                <span className="text-blue-600">{statusMsg || cfg.instruction}</span>
              </div>
            </>
          )}

          {/* Success */}
          {phase === 'done' && (
            <div className="flex flex-col items-center space-y-3 py-8">
              <CxIconCheckCircle className="w-12 h-12 text-green-500" />
              <p className="text-base font-medium text-green-700">授权成功！</p>
              <p className="text-sm text-gray-500">正在自动填入凭证...</p>
            </div>
          )}

          {/* Error */}
          {phase === 'error' && (
            <div className="flex flex-col items-center space-y-3 py-4">
              <CxIconAlertCircle className="w-10 h-10 text-red-500" />
              <p className="text-sm text-red-600 text-center px-4 whitespace-pre-wrap">
                {errorMsg || '绑定失败，请重试'}
              </p>
              <div className="flex gap-2">
                <button onClick={handleRetry} className="inline-flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm transition-colors">
                  <CxIconRefresh className="w-4 h-4" /> 重新发起
                </button>
                <button onClick={() => { stopTimers(); onCancel(); }} className="inline-flex items-center gap-2 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm transition-colors">
                  手动填写
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
          <p className="text-xs text-gray-400 text-center">{cfg.manualHint}</p>
        </div>
      </div>
    </div>
  );
}
