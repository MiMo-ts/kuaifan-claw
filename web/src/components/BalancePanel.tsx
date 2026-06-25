import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { useAppStore } from "../stores/appStore";
import {
  CxIconRefresh,
  CxIconTrendingUp,
  CxIconWallet,
  CxIconZap,
} from "./icons";
﻿export default function BalancePanel() {
  const { isLoggedIn, quota, usedQuota, setQuota, newApiBaseUrl } = useAppStore();
  const [refreshing, setRefreshing] = useState(false);

  const refreshQuota = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const dataDir = await invoke<string>('get_data_dir');
      const data: any = await invoke('get_quota_info', { apiUrl: newApiBaseUrl, dataDir });
      setQuota(data.quota || 0, data.used_quota || 0);
    } catch (e) {
      console.error('[BalancePanel]', e);
    }
  }, [isLoggedIn, newApiBaseUrl, setQuota]);

  useEffect(() => {
    if (isLoggedIn) {
      refreshQuota();
      const id = setInterval(refreshQuota, 60000);
      return () => clearInterval(id);
    }
  }, [isLoggedIn, refreshQuota]);

  const handleCheckin = async () => {
    try {
      const dataDir = await invoke<string>('get_data_dir');
      const result: any = await invoke('daily_checkin', { apiUrl: newApiBaseUrl, dataDir });
      const msg = result?.message || '签到成功';
      alert(msg);
      refreshQuota();
    } catch (e: any) { alert(e); }
  };

  const QUOTA_PER_YUAN = 500000; // new-api: 1 元 = 500,000 quota

  const toYuan = (q: number) => (q / QUOTA_PER_YUAN).toFixed(2);

  // Percentage bar based on a reasonable "max" — or track used/total
  const pct = quota > 0 ? Math.min(100, (usedQuota / Math.max(quota, 1)) * 100) : 0;

  if (!isLoggedIn) return null;

  return (
    <div className="px-3 py-3 border-b" style={{ borderColor: 'var(--cx-border-soft)' }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <CxIconWallet className="w-3.5 h-3.5" style={{ color: 'var(--cx-accent)' }} />
          <span className="text-[12px] font-medium" style={{ color: 'var(--cx-text-soft)' }}>钱包余额</span>
        </div>
        <button
          onClick={async () => {
            setRefreshing(true);
            try { await refreshQuota(); toast.success('余额已刷新'); } catch { toast.error('刷新失败'); }
            setRefreshing(false);
          }}
          className="p-0.5 rounded hover:opacity-70"
          style={{ color: 'var(--cx-text-mute)' }}
          title="刷新余额"
        >
          <CxIconRefresh className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="flex items-baseline gap-1 mb-1">
        <span className="text-[11px]" style={{ color: 'var(--cx-text-mute)' }}>¥</span>
        <span className="text-[20px] font-bold" style={{ color: 'var(--cx-text)' }}>
          {toYuan(quota)}
        </span>
        {usedQuota > 0 && (
          <span className="text-[11px] ml-1" style={{ color: 'var(--cx-text-mute)' }}>
            已用 ¥{toYuan(usedQuota)}
          </span>
        )}
      </div>

      {/* Progress bar */}
      <div className="w-full h-1.5 rounded-full mb-2" style={{ background: 'var(--cx-bg-soft)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 50 ? '#f59e0b' : 'var(--cx-accent)' }}
        />
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleCheckin}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-opacity hover:opacity-80"
          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <CxIconZap className="w-3 h-3" /> 每日签到
        </button>
        <button
          onClick={() => invoke('open_url', { url: newApiBaseUrl || 'https://kuaifanio.cn' }).catch(() => window.open(newApiBaseUrl || 'https://kuaifanio.cn', '_blank'))}
          className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium transition-opacity hover:opacity-80"
          style={{ background: 'rgba(59,130,246,0.1)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.2)' }}
        >
          <CxIconTrendingUp className="w-3 h-3" /> 充值
        </button>
      </div>
    </div>
  );
}
