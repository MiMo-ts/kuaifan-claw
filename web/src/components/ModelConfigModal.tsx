import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconCheckCircle,
  CxIconClose,
  CxIconEye,
  CxIconEyeOff,
  CxIconKey,
  CxIconLoader,
  CxIconRefresh,
  CxIconShield,
  CxIconXCircle,
} from "./icons";
import { getStoredApiKey, saveApiKey, clearApiKey, getProxyBaseUrl } from '../services/proxyApi';

interface ModelEntry {
  id: string;
  name: string;
  context_window: number | null;
  is_free: boolean;
  badge: string | null;
}

interface Props {
  onClose: () => void;
}

export default function ModelConfigModal({ onClose }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const abortRef = useRef(false);
  const proxyUrl = getProxyBaseUrl();

  useEffect(() => {
    const stored = getStoredApiKey('kuaifan');
    if (stored) setApiKey(stored);
    // 快泛API 模型列表从 https://kuaifanio.cn/pricing 实时拉取，无需 API Key
    fetchModels(stored || undefined);
    return () => { abortRef.current = true; };
  }, []);

  const fetchModels = async (key?: string) => {
    if (key) saveApiKey(key, 'kuaifan');
    abortRef.current = false;
    setModelsLoading(true); setModelsError(null);
    try {
      const list = await invoke<ModelEntry[]>('list_models', { providerId: 'kuaifan', apiKey: key || null });
      if (abortRef.current) return;
      setModels(list);
    } catch (e) {
      if (abortRef.current) return;
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
      setModelsError(msg);
      setModels([]);
    } finally {
      setModelsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!apiKey || models.length === 0) return;
    abortRef.current = false;
    setTesting(true); setTestResult(null);
    try {
      saveApiKey(apiKey, 'kuaifan');
      const result = await invoke<{ success: boolean; message: string }>('test_model_connection', {
        provider: 'kuaifan',
        modelName: models[0]?.id || 'gpt-3.5-turbo',
        apiKey: apiKey,
        proxyUrl: null,
        proxyUsername: null,
        proxyPassword: null,
      });
      if (abortRef.current) return;
      setTestResult({ ok: result.success, message: result.message });
    } catch (e) {
      if (abortRef.current) return;
      const msg = typeof e === 'string' ? e : (e instanceof Error ? e.message : String(e));
      setTestResult({ ok: false, message: msg });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = () => {
    if (!apiKey) return;
    saveApiKey(apiKey, 'kuaifan');
    toast.success('API Key ???');
    onClose();
  };

  const handleClear = () => {
    setApiKey(''); setModels([]); setTestResult(null); setModelsError(null);
    clearApiKey('kuaifan');
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl overflow-hidden animate-fadeIn"
        style={{
          background: 'var(--cx-bg-elev)',
          border: '1px solid var(--cx-border)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
        }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid var(--cx-border-soft)' }}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ background: 'var(--cx-accent-glow)', border: '1px solid var(--cx-border-accent)' }}>
              <CxIconShield className="w-4 h-4" style={{ color: 'var(--cx-accent)' }} />
            </div>
            <div>
              <div className="text-[14px] font-semibold" style={{ color: 'var(--cx-text)' }}>????</div>
              <div className="text-[11px] font-mono" style={{ color: 'var(--cx-text-mute)' }}>{proxyUrl}</div>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="p-1.5 rounded-lg transition-colors"
            style={{ color: 'var(--cx-text-mute)' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--cx-text)'; e.currentTarget.style.background = 'var(--cx-bg-hover)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--cx-text-mute)'; e.currentTarget.style.background = 'transparent'; }}>
            <CxIconClose className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 space-y-4">
          {/* API Key */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold block mb-2" style={{ color: 'var(--cx-text-soft)' }}>
              快泛API Key
            </label>
            <div className="flex gap-1.5">
              <div className="flex-1 relative">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxx"
                  className="w-full h-10 pl-3.5 pr-9 rounded-lg text-[13px] font-mono outline-none transition-all"
                  style={{
                    background: 'var(--cx-bg)',
                    border: '1px solid var(--cx-border)',
                    color: 'var(--cx-text)',
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--cx-accent)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--cx-border)'; }}
                />
                <button type="button" onClick={() => setShowKey(!showKey)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--cx-text-mute)' }}>
                  {showKey ? <CxIconEyeOff className="w-4 h-4" /> : <CxIconEye className="w-4 h-4" />}
                </button>
              </div>
              <button type="button" onClick={() => fetchModels()} disabled={!apiKey || modelsLoading}
                className="px-3.5 h-10 rounded-lg text-[13px] flex items-center gap-1.5 transition-all shrink-0 font-medium"
                style={{ background: 'var(--cx-accent-soft)', border: '1px solid var(--cx-border-accent)', color: 'var(--cx-accent)', opacity: !apiKey ? 0.4 : 1 }}>
                {modelsLoading ? <CxIconLoader className="w-4 h-4 animate-spin" /> : <CxIconRefresh className="w-4 h-4" />}??
              </button>
            </div>
          </div>

          {/* Model list */}
          <div>
            <label className="text-[11px] uppercase tracking-wider font-semibold block mb-2" style={{ color: 'var(--cx-text-soft)' }}>
              ????(?????) {models.length > 0 && `(${models.length})`}
              {models.filter(m => m.is_free).length > 0 && ` ? ${models.filter(m => m.is_free).length}???`}
            </label>
            <div className="max-h-56 overflow-y-auto rounded-lg" style={{ background: 'var(--cx-bg)', border: '1px solid var(--cx-border-soft)' }}>
              {modelsLoading ? (
                <div className="flex items-center gap-2 px-4 py-10 justify-center">
                  <CxIconLoader className="w-4.5 h-4.5 animate-spin" style={{ color: 'var(--cx-accent)' }} />
                  <span className="text-[13px]" style={{ color: 'var(--cx-text-mute)' }}>???????</span>
                </div>
              ) : modelsError ? (
                <div className="px-4 py-8 text-center">
                  <span className="text-[13px]" style={{ color: 'var(--cx-error)' }}>{modelsError}</span>
                </div>
              ) : models.length === 0 && apiKey ? (
                <div className="px-4 py-8 text-center">
                  <span className="text-[13px]" style={{ color: 'var(--cx-text-mute)' }}>??"??"??????</span>
                </div>
              ) : models.length === 0 ? (
                <div className="px-4 py-8 text-center">
                  <span className="text-[13px]" style={{ color: 'var(--cx-text-mute)' }}>?? Key ?????</span>
                </div>
              ) : (
                <div className="py-1.5">
                  {models.map((m) => (
                    <div key={m.id} className="px-4 py-2 text-[13px] flex items-center gap-2.5" style={{ color: 'var(--cx-text-soft)' }}>
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: m.is_free ? 'var(--cx-success)' : 'var(--cx-accent)' }} />
                      <span className="truncate font-mono">{m.id}</span>
                      {m.badge && <span className="text-[11px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'var(--cx-accent-soft)', color: 'var(--cx-accent)' }}>{m.badge}</span>}
                      {m.is_free && <span className="text-[11px] px-1.5 py-0.5 rounded font-medium" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--cx-success)' }}>??</span>}
                      {m.context_window && <span className="text-[12px] ml-auto" style={{ color: 'var(--cx-text-dim)' }}>{m.context_window >= 1000 ? `${(m.context_window / 1000).toFixed(0)}K` : m.context_window}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Test result */}
          {testResult && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl text-[13px] font-medium"
              style={{
                background: testResult.ok ? 'var(--cx-accent-soft)' : 'rgba(239,68,68,0.08)',
                border: `1px solid ${testResult.ok ? 'var(--cx-border-accent)' : 'rgba(239,68,68,0.25)'}`,
                color: testResult.ok ? 'var(--cx-accent)' : 'var(--cx-error)',
              }}>
              {testResult.ok ? <CxIconCheckCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" /> : <CxIconXCircle className="w-4.5 h-4.5 shrink-0 mt-0.5" />}
              {testResult.message}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderTop: '1px solid var(--cx-border-soft)' }}>
          <button type="button" onClick={handleClear}
            className="text-[13px] transition-colors font-medium"
            style={{ color: 'var(--cx-text-mute)' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--cx-error)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--cx-text-mute)'; }}>
            ????
          </button>
          <div className="flex gap-2.5">
            <button type="button" onClick={handleTestConnection}
              disabled={!apiKey || models.length === 0 || testing}
              className="cx-btn text-[13px] flex items-center gap-1.5 font-medium">
              {testing ? <CxIconLoader className="w-4 h-4 animate-spin" /> : <CxIconKey className="w-4 h-4" />}????
            </button>
            <button type="button" onClick={handleSave} disabled={!apiKey}
              className="cx-btn-primary text-[13px] flex items-center gap-1.5 font-medium">
              <CxIconCheckCircle className="w-4 h-4" />????
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
