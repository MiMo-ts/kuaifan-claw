import { useEffect, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconClose,
  CxIconCopy,
  CxIconInfo,
  CxIconLoader,
  CxIconRefresh,
  CxIconServer,
  CxIconSmartphone,
  CxIconWifi,
} from './icons';

interface LanInfo {
  local_ips: string[];
  gateway_host: string;
  gateway_port: number;
  gateway_running: boolean;
  connection_urls: string[];
}

interface DeviceEntry {
  ip: string;
  name: string;
  status: string;
  first_seen: string;
  last_seen: string;
}

interface Props { onClose: () => void; }

export default function LanDevicePanel({ onClose }: Props) {
  const [info, setInfo] = useState<LanInfo | null>(null);
  const [devices, setDevices] = useState<DeviceEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [dataDir, setDataDir] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const isLan = info?.gateway_host === '0.0.0.0';

  const load = useCallback(async () => {
    try {
      const dir = await invoke<string>('get_data_dir');
      setDataDir(dir);
      const [lan, devs] = await Promise.all([
        invoke<LanInfo>('get_lan_info', { dataDir: dir }),
        invoke<DeviceEntry[]>('get_device_list', { dataDir: dir }),
      ]);
      setInfo(lan);
      setDevices(devs);
    } catch { toast.error('获取网络信息失败'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleLan = async () => {
    if (!dataDir || !info) return;
    setToggling(true);
    try {
      const newHost = isLan ? '127.0.0.1' : '0.0.0.0';
      await invoke('set_gateway_host', { dataDir, host: newHost });

      if (info.gateway_running) {
        // 网关运行中，需要重启才能生效
        await invoke('stop_gateway');
        await new Promise(r => setTimeout(r, 800));
        await invoke('start_gateway');
        toast.success(newHost === '0.0.0.0'
          ? '已切换到局域网模式，网关已重启'
          : '已切换到本机模式，网关已重启');
      } else {
        toast.success(newHost === '0.0.0.0'
          ? '已开启局域网访问，启动网关后生效'
          : '已关闭局域网访问');
      }
      await load();
    } catch (e) { toast.error('操作失败: ' + String(e)); }
    finally { setToggling(false); }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('已复制'), () => toast.error('复制失败'));
  };

  const doAction = async (ip: string, action: string) => {
    setActionLoading(ip);
    try {
      const cmd = action === 'approve' ? 'approve_device' : action === 'deny' ? 'deny_device' : 'block_device';
      await invoke(cmd, { dataDir, ip });
      toast.success({ approve: '已允许', deny: '已拒绝', block: '已拉黑' }[action] || '操作成功');
      await load();
    } catch (e) { toast.error(String(e)); }
    finally { setActionLoading(null); }
  };

  const C = {
    bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
    bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
    text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
    textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
    accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)',
    success: 'var(--cx-success)', warn: 'var(--cx-warn)',
  };

  const pendingDevices = devices.filter(d => d.status === 'pending');
  const managedDevices = devices.filter(d => d.status !== 'pending');
  const statusLabel = (s: string) => ({ pending: '待处理', approved: '已允许', denied: '已拒绝', blocked: '已拉黑' }[s] || s);
  const statusColor = (s: string) => ({
    pending: '#f59e0b', approved: '#22c55e', denied: '#ef4444', blocked: '#991b1b',
  }[s] || C.textMute);
  const statusBg = (s: string) => ({
    pending: 'rgba(245,158,11,0.1)', approved: 'rgba(34,197,94,0.1)',
    denied: 'rgba(239,68,68,0.06)', blocked: 'rgba(153,27,27,0.08)',
  }[s] || C.bgSoft);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(44,36,22,0.42)', backdropFilter: 'blur(6px)' }} onClick={onClose}>
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto cx-scroll-slim"
        style={{ background: C.bgElev, border: `1px solid ${C.border}`, borderRadius: 14,
          boxShadow: 'var(--cx-shadow-xl)', padding: 24 }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <span className="text-[10px] font-mono uppercase tracking-[0.1em] px-1.5 py-0.5 rounded"
              style={{ background: C.bgSoft, color: C.textMute }}>gateway lan</span>
            <h2 className="text-[17px] font-semibold mt-1" style={{ color: C.text }}>网关互联</h2>
            <p className="text-[12.5px] mt-0.5" style={{ color: C.textMute }}>同一网关下多设备互联互通</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: C.textMute }}
            onMouseEnter={e => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
            <CxIconClose className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <CxIconLoader className="w-5 h-5 animate-spin" style={{ color: C.textMute }} />
          </div>
        ) : info ? (
          <div className="space-y-4">

            {/* ===== 1. 网关地址（始终显示） ===== */}
            <div className="p-4 rounded-xl" style={{ background: C.bgSoft, border: `1px solid ${C.borderSoft}` }}>
              <div className="flex items-center gap-2 mb-2">
                <CxIconServer className="w-4 h-4" style={{ color: C.textMute }} />
                <span className="text-[12px] font-semibold" style={{ color: C.text }}>本机网关地址</span>
                {info.gateway_running ? (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(34,197,94,0.12)', color: '#22c55e' }}>运行中</span>
                ) : (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(239,68,68,0.08)', color: '#ef4444' }}>未启动</span>
                )}
              </div>

              {info.connection_urls.length > 0 ? (
                <div className="space-y-1.5">
                  {info.connection_urls.map((url, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 rounded-lg"
                      style={{ background: C.bgElev, border: `1px solid ${C.borderSoft}` }}>
                      <code className="flex-1 text-[13px] font-mono font-semibold select-all" style={{ color: C.text }}>{url}</code>
                      <button onClick={() => copyText(url)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors"
                        style={{ color: C.textMute }}
                        onMouseEnter={e => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
                        <CxIconCopy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12px] py-2" style={{ color: C.textMute }}>
                  本机 IP: {info.local_ips.join(' / ')} · 端口: {info.gateway_port}
                </div>
              )}

              {!info.gateway_running && (
                <div className="flex items-start gap-2 mt-2 p-2.5 rounded-lg text-[11px]"
                  style={{ background: 'rgba(245,158,11,0.06)', color: '#b45309' }}>
                  <CxIconInfo className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>网关未启动，启动后将在此处显示完整连接地址。其他设备可通过该地址接入本机网关。</span>
                </div>
              )}
            </div>

            {/* ===== 2. 局域网开关 ===== */}
            <div className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: isLan ? 'rgba(34,197,94,0.04)' : C.bgSoft, border: `1px solid ${isLan ? 'rgba(34,197,94,0.15)' : C.borderSoft}` }}>
              <div className="flex items-center gap-2.5">
                <CxIconWifi className="w-4 h-4" style={{ color: isLan ? 'var(--cx-success)' : C.textMute }} />
                <div>
                  <div className="text-[12.5px] font-medium" style={{ color: C.text }}>允许局域网设备接入</div>
                  <div className="text-[10.5px]" style={{ color: C.textMute }}>
                    {isLan ? '网关绑定 0.0.0.0 · 同网络设备可连接' : '仅本机 127.0.0.1 可访问'}
                  </div>
                </div>
              </div>
              <button onClick={toggleLan} disabled={toggling}
                className="relative inline-flex items-center rounded-full transition-colors duration-200 shrink-0"
                style={{ width: 40, height: 22, background: isLan ? 'var(--cx-success)' : C.border, opacity: toggling ? 0.5 : 1 }}>
                <span className="absolute w-[16px] h-[16px] rounded-full bg-white shadow transition-transform duration-200"
                  style={{ left: 3, transform: isLan ? 'translateX(18px)' : 'translateX(0)' }} />
              </button>
            </div>

            {/* ===== 3. 待处理接入请求 ===== */}
            {isLan && pendingDevices.length > 0 && (
              <div className="p-4 rounded-xl" style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.25)' }}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-2 h-2 rounded-full animate-pulse" style={{ background: '#f59e0b' }} />
                  <span className="text-[12px] font-semibold" style={{ color: '#b45309' }}>待处理接入请求</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                    style={{ background: 'rgba(245,158,11,0.15)', color: '#b45309' }}>{pendingDevices.length}</span>
                </div>
                <div className="space-y-2">
                  {pendingDevices.map(d => (
                    <div key={d.ip} className="p-3 rounded-lg"
                      style={{ background: C.bgElev, border: '1px solid rgba(245,158,11,0.2)' }}>
                      <div className="flex items-center gap-2.5 mb-2.5">
                        <CxIconSmartphone className="w-4 h-4 shrink-0" style={{ color: '#f59e0b' }} />
                        <div className="flex-1 min-w-0">
                          <div className="text-[12.5px] font-medium" style={{ color: C.text }}>{d.name || '未知设备'}</div>
                          <div className="text-[10.5px]" style={{ color: C.textMute }}>{d.ip} · {d.last_seen}</div>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => doAction(d.ip, 'approve')} disabled={actionLoading === d.ip}
                          className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors"
                          style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
                          {actionLoading === d.ip ? '...' : '允许接入'}
                        </button>
                        <button onClick={() => doAction(d.ip, 'deny')} disabled={actionLoading === d.ip}
                          className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors"
                          style={{ background: 'rgba(239,68,68,0.06)', color: '#dc2626' }}>
                          {actionLoading === d.ip ? '...' : '拒绝'}
                        </button>
                        <button onClick={() => doAction(d.ip, 'block')} disabled={actionLoading === d.ip}
                          className="flex-1 py-1.5 rounded-md text-[11px] font-medium transition-colors"
                          style={{ background: 'rgba(153,27,27,0.06)', color: '#991b1b' }}>
                          {actionLoading === d.ip ? '...' : '拉黑'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== 4. 已管理设备列表 ===== */}
            {managedDevices.length > 0 && (
              <div>
                <div className="text-[11px] font-medium mb-2" style={{ color: C.textMute }}>
                  设备列表 ({managedDevices.length})
                </div>
                <div className="space-y-1.5">
                  {managedDevices.map(d => (
                    <div key={d.ip} className="flex items-center gap-2.5 p-2.5 rounded-lg"
                      style={{ background: C.bgSoft, border: `1px solid ${C.borderSoft}` }}>
                      <CxIconSmartphone className="w-3.5 h-3.5 shrink-0" style={{ color: C.textMute }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[11.5px] font-medium truncate" style={{ color: C.text }}>{d.name || d.ip}</div>
                        <div className="text-[10px]" style={{ color: C.textDim }}>{d.ip}</div>
                      </div>
                      <span className="text-[10px] px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: statusBg(d.status), color: statusColor(d.status) }}>
                        {statusLabel(d.status)}
                      </span>
                      {d.status === 'denied' && (
                        <button onClick={() => doAction(d.ip, 'approve')} className="text-[10px] px-2 py-1 rounded"
                          style={{ color: '#16a34a' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(34,197,94,0.08)'; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>允许</button>
                      )}
                      {d.status === 'blocked' && (
                        <button onClick={() => doAction(d.ip, 'approve')} className="text-[10px] px-2 py-1 rounded"
                          style={{ color: C.textMute }}
                          onMouseEnter={e => { e.currentTarget.style.background = C.bgHover; }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>解除</button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ===== 5. 使用说明 ===== */}
            <div className="p-3 rounded-xl" style={{ background: 'rgba(59,130,246,0.03)', border: '1px solid rgba(59,130,246,0.1)' }}>
              <div className="flex items-center gap-2 mb-1.5">
                <CxIconInfo className="w-3.5 h-3.5" style={{ color: 'var(--cx-accent)' }} />
                <span className="text-[11.5px] font-semibold" style={{ color: C.text }}>如何互联</span>
              </div>
              <ol className="text-[10.5px] space-y-1" style={{ color: C.textSoft, paddingLeft: '1.2em' }}>
                <li>主机开启<b>「允许局域网设备接入」</b>，启动网关</li>
                <li>复制<b>网关地址</b>发给另一台设备</li>
                <li>另一台设备在<b>模型配置</b>中将供应商 base_url 设为主机网关地址</li>
                <li>新设备首次连接会出现在<b>「待处理接入请求」</b>中</li>
                <li>主机选择<b>允许/拒绝/拉黑</b>管理接入权限</li>
                <li>确保防火墙允许端口 <b>{info.gateway_port}</b> 入站</li>
              </ol>
            </div>

          </div>
        ) : null}

        {/* Footer */}
        <div className="mt-5 pt-3 flex items-center justify-between" style={{ borderTop: `1px solid ${C.borderSoft}` }}>
          <button onClick={load} className="flex items-center gap-1.5 text-[11px] transition-colors"
            style={{ color: C.textMute }}
            onMouseEnter={e => { e.currentTarget.style.color = C.text; }}
            onMouseLeave={e => { e.currentTarget.style.color = C.textMute; }}>
            <CxIconRefresh className="w-3 h-3" /> 刷新
          </button>
          <span className="text-[11px]" style={{ color: C.textDim }}>快泛Claw · 网关互联</span>
        </div>
      </div>
    </div>
  );
}
