import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from "../stores/appStore";
import {
  CxIconLoader,
  CxIconLogIn,
  CxIconUserPlus,
} from "../components/icons";
﻿import { saveApiKey } from '../services/proxyApi';

interface AuthResponse {
  id: number;
  username: string;
  display_name: string;
  role: number;
  status: number;
  group: string;
  quota: number;
  used_quota: number;
  request_count: number;
  email: string | null;
  aff_code: string | null;
}

export default function LoginPage() {
  const { setAuth, newApiBaseUrl } = useAppStore();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [serverUrl, setServerUrl] = useState(newApiBaseUrl || 'https://kuaifanio.cn');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('请输入用户名和密码');
      return;
    }
    if (mode === 'register') {
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
      if (password.length < 8) {
        setError('密码至少 8 位');
        return;
      }
    }

    setLoading(true);
    try {
      const dataDir = await invoke<string>('get_data_dir');
      let user: AuthResponse;
      if (mode === 'login') {
        user = await invoke<AuthResponse>('login', { apiUrl: serverUrl, username, password, dataDir });
      } else {
        user = await invoke<AuthResponse>('register', { apiUrl: serverUrl, username, password, displayName: displayName || username, dataDir });
      }

      // Update store
      useAppStore.getState().setNewApiBaseUrl(serverUrl);
      setAuth({
        isLoggedIn: true,
        userId: user.id,
        username: user.username,
        displayName: user.display_name,
        role: user.role,
        group: user.group,
        quota: user.quota,
        usedQuota: user.used_quota,
        requestCount: user.request_count,
        email: user.email,
        affCode: user.aff_code,
      });

      navigate('/home', { replace: true });

      // Auto-configure API key for gateway + model config page (non-blocking)
      try {
        const key = await invoke<string>('auto_configure_api_key', { apiUrl: serverUrl, dataDir });
        useAppStore.getState().setApiKey(key);
        saveApiKey(key, 'kuaifan');
        await invoke('save_api_key', { dataDir, apiKey: key });
      } catch { /* non-fatal */ }
    } catch (e) {
      const msg = typeof e === 'string' ? e : (e as Error).message || String(e);
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fontFamily = { fontFamily: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif' };

  return (
    <div className="flex items-center justify-center min-h-screen" style={{ background: 'var(--cx-bg)' }}>
      <div className="w-full max-w-md mx-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🦞</div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--cx-text)', ...fontFamily }}>快泛 Claw</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--cx-text-mute)' }}>一站式 AI 管理与代理平台</p>
        </div>

        {/* Server config */}
        <div className="mb-4 px-4 py-3 rounded-lg" style={{ background: 'var(--cx-bg-soft)', border: '1px solid var(--cx-border-soft)' }}>
          <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--cx-text-mute)' }}>new-api 服务器地址</label>
          <input
            type="text"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder="https://kuaifanio.cn"
            className="w-full bg-transparent outline-none text-[13px]"
            style={{ color: 'var(--cx-text)' }}
          />
        </div>

        {/* Card */}
        <div className="rounded-xl p-6" style={{ background: 'var(--cx-bg-elev)', border: '1px solid var(--cx-border-soft)' }}>
          {/* Mode tabs */}
          <div className="flex mb-6 rounded-lg p-0.5" style={{ background: 'var(--cx-bg-soft)' }}>
            <button
              type="button"
              onClick={() => { setMode('login'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium transition-colors"
              style={{
                background: mode === 'login' ? 'var(--cx-bg-elev)' : 'transparent',
                color: mode === 'login' ? 'var(--cx-text)' : 'var(--cx-text-mute)',
              }}
            >
              <CxIconLogIn className="w-4 h-4" /> 登录
            </button>
            <button
              type="button"
              onClick={() => { setMode('register'); setError(''); }}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-[13px] font-medium transition-colors"
              style={{
                background: mode === 'register' ? 'var(--cx-bg-elev)' : 'transparent',
                color: mode === 'register' ? 'var(--cx-text)' : 'var(--cx-text-mute)',
              }}
            >
              <CxIconUserPlus className="w-4 h-4" /> 注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--cx-text-soft)' }}>用户名</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-[14px] outline-none"
                style={{
                  background: 'var(--cx-bg-soft)',
                  border: '1px solid var(--cx-border)',
                  color: 'var(--cx-text)',
                  ...fontFamily,
                }}
                autoFocus
              />
            </div>

            <div>
              <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--cx-text-soft)' }}>密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-[14px] outline-none"
                style={{
                  background: 'var(--cx-bg-soft)',
                  border: '1px solid var(--cx-border)',
                  color: 'var(--cx-text)',
                  ...fontFamily,
                }}
              />
            </div>

            {mode === 'register' && (
              <>
                <div>
                  <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--cx-text-soft)' }}>确认密码</label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={e => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-[14px] outline-none"
                    style={{
                      background: 'var(--cx-bg-soft)',
                      border: '1px solid var(--cx-border)',
                      color: 'var(--cx-text)',
                      ...fontFamily,
                    }}
                  />
                </div>
                <div>
                  <label className="text-[12px] font-medium mb-1 block" style={{ color: 'var(--cx-text-soft)' }}>
                    显示名称 <span className="opacity-50">(可选)</span>
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={e => setDisplayName(e.target.value)}
                    placeholder={username || '你的昵称'}
                    className="w-full px-3 py-2.5 rounded-lg text-[14px] outline-none"
                    style={{
                      background: 'var(--cx-bg-soft)',
                      border: '1px solid var(--cx-border)',
                      color: 'var(--cx-text)',
                      ...fontFamily,
                    }}
                  />
                </div>
              </>
            )}

            {error && (
              <div className="text-[13px] px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.15)' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg text-[14px] font-semibold transition-opacity disabled:opacity-60"
              style={{ background: 'var(--cx-accent)', color: '#fff', ...fontFamily }}
            >
              {loading ? (
                <><CxIconLoader className="w-4 h-4 animate-spin" /> {mode === 'login' ? '登录中…' : '注册中…'}</>
              ) : mode === 'login' ? (
                '登录'
              ) : (
                '注册新账户'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] mt-4" style={{ color: 'var(--cx-text-dim)' }}>
          快泛 Claw · new-api 统一账户
        </p>
      </div>
    </div>
  );
}
