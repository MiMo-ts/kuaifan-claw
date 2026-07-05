import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CxIconExternalLink, CxIconLoader, CxIconRefresh } from '../components/icons';

interface GatewayWsInfo { port: number; token: string; }

export default function ConsolePage() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [key, setKey] = useState(0);

  const resolve = async () => {
    setLoading(true);
    setError('');
    try {
      const info = await invoke<GatewayWsInfo>('get_gateway_ws_info');
      if (!info?.port) throw new Error('网关未启动');
      const tokenParam = info.token?.length >= 8 ? `?token=${encodeURIComponent(info.token)}` : '';
      setUrl(`http://127.0.0.1:${info.port}/control-ui${tokenParam}`);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || '无法连接到网关');
      setLoading(false);
    }
  };

  useEffect(() => { resolve(); }, []);

  const handleRefresh = () => { setKey(k => k + 1); resolve(); };

  const fontFamily = { fontFamily: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif' };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ background: 'var(--cx-bg)' }}>
        <div className="text-center">
          <CxIconLoader className="w-6 h-6 mx-auto mb-3 animate-spin" style={{ color: 'var(--cx-accent)' }} />
          <div className="text-[13px]" style={{ color: 'var(--cx-text-mute)', ...fontFamily }}>
            正在连接网关控制台…
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4" style={{ background: 'var(--cx-bg)' }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center"
          style={{ background: 'rgba(200,85,74,0.08)', border: '1px solid rgba(200,85,74,0.18)' }}
        >
          <CxIconExternalLink className="w-6 h-6" style={{ color: 'var(--cx-error)' }} />
        </div>
        <div className="text-center">
          <div className="text-[15px] font-semibold mb-1" style={{ color: 'var(--cx-text)', ...fontFamily }}>
            无法打开控制台
          </div>
          <div className="text-[12.5px] mb-4" style={{ color: 'var(--cx-text-mute)', ...fontFamily }}>
            {error}
          </div>
          <button
            onClick={handleRefresh}
            className="inline-flex items-center gap-2 px-4 h-8 rounded-lg text-[13px] font-medium transition-all duration-150"
            style={{
              background: 'var(--cx-accent)',
              color: '#fff',
            }}
          >
            <CxIconRefresh className="w-3.5 h-3.5" /> 重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--cx-bg)' }}>
      {/* top bar */}
      <div
        className="h-9 px-4 flex items-center justify-between shrink-0"
        style={{ borderBottom: '1px solid var(--cx-border-soft)', background: 'var(--cx-topbar-bg)' }}
      >
        <span className="text-[12px] font-medium" style={{ color: 'var(--cx-text-soft)', ...fontFamily }}>
          OpenClaw 控制台
        </span>
        <button
          onClick={handleRefresh}
          className="flex items-center gap-1 px-2 h-6 rounded text-[11px] transition-all duration-150"
          style={{ color: 'var(--cx-text-mute)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--cx-accent)'; e.currentTarget.style.background = 'var(--cx-bg-hover)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--cx-text-mute)'; e.currentTarget.style.background = 'transparent'; }}
          title="刷新控制台"
        >
          <CxIconRefresh className="w-3 h-3" /> 刷新
        </button>
      </div>
      <iframe
        key={key}
        ref={iframeRef}
        src={url}
        className="flex-1 w-full border-0"
        title="OpenClaw Control UI"
      />
    </div>
  );
}
