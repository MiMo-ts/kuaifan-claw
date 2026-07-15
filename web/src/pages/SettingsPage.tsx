import toast from 'react-hot-toast';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  CxIconArrowLeft,
  CxIconBoxes,
  CxIconCheckCircle,
  CxIconClose,
  CxIconDownload,
  CxIconExternalLink,
  CxIconFileText,
  CxIconInfo,
  CxIconLoader,
  CxIconMessageCircle,
  CxIconMonitor,
  CxIconMoon,
  CxIconPackages,
  CxIconPalette,
  CxIconPlugins,
  CxIconRefresh,
  CxIconRotateCcw,
  CxIconSettings,
  CxIconSun,
  CxIconTerminal,
  CxIconTrash2,
} from "../components/icons";
import { useAppStore } from '../stores/appStore';
import { moduleDefinition } from '../modules/registry';
import AnsiUp from 'ansi-to-html';
import { updateService, ReleaseInfo } from '../services/updateService';

interface RuntimeLogsTail { gateway: string; manager: string; }

const ansiUp = new AnsiUp();

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ansiToHtml(text: string): string { return ansiUp.toHtml(escapeHtml(text)); }

const GATEWAY_ERROR_LINE_RE =
  /(exec failed|ParserError|InvalidEndOfLine|ParentContainsErrorRecordException|FullyQualifiedErrorId|CategoryInfo\s*:|Command exited with code [1-9]|exited with code [1-9]\b|\bERR!\b|\bERROR\b|\[error\]|\bFATAL\b|UnhandledPromiseRejection|uncaught exception|ECONNREFUSED|EADDRINUSE|失败\b|错误\b)/i;

function isGatewayErrorLine(line: string): boolean {
  if (GATEWAY_ERROR_LINE_RE.test(line)) return true;
  const t = line.trimStart();
  if (t.startsWith('+ ') && (t.includes('CategoryInfo') || t.includes('FullyQualifiedErrorId') || /^\+\s+\.\.\./.test(t))) return true;
  return false;
}

function ansiToHtmlGatewayLog(text: string): string {
  if (!text) return '';
  return text.split('\n').map(line =>
    isGatewayErrorLine(line)
      ? '<span class="text-red-400 font-medium">' + ansiToHtml(line) + '</span>'
      : ansiToHtml(line)
  ).join('\n');
}

const C = {
  bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
  bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
  text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
  textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
  accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)', accentHover: 'var(--cx-accent-hover)',
};

type Theme = 'light' | 'dark' | 'system';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { setTheme: setStoreTheme, theme: storeTheme } = useAppStore();
  const activeModule = useAppStore((state) => state.activeModule);
  const activeModuleDefinition = moduleDefinition(activeModule);
  const [theme, setTheme] = useState<Theme>(storeTheme as Theme);
  const [saving, setSaving] = useState(false);

  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogsTail | null>(null);
  const [logLive, setLogLive] = useState(true);
  const [logRefreshing, setLogRefreshing] = useState(false);
  const logPreRef = useRef<HTMLPreElement>(null);
  const logLiveRef = useRef(logLive);
  logLiveRef.current = logLive;

  const [checkingVersion, setCheckingVersion] = useState(false);
  const [recentReleases, setRecentReleases] = useState<ReleaseInfo[]>([]);
  const [currentAppVersion, setCurrentAppVersion] = useState('1.0.22');

  const [logModal, setLogModal] = useState<{ type: 'gateway' | 'manager'; html: string } | null>(null);
  const [showContact, setShowContact] = useState(false);
  const [enlargedImage, setEnlargedImage] = useState(false);

  const fetchRuntimeLogs = useCallback(async () => {
    try {
      const data = await invoke<RuntimeLogsTail>('read_module_logs_tail', { moduleId: activeModule, lines: 500 });
      setRuntimeLogs(data);
      if (logLiveRef.current && logPreRef.current) {
        requestAnimationFrame(() => { const el = logPreRef.current; if (el) el.scrollTop = el.scrollHeight; });
      }
    } catch { /* silent */ }
  }, [activeModule]);

  const handleRefreshLogs = async () => { setLogRefreshing(true); try { await fetchRuntimeLogs(); } finally { setLogRefreshing(false); } };

  const handleClearGatewayLog = async () => {
    if (!window.confirm(`确定清空 ${activeModuleDefinition.name} 网关日志文件？（不影响管理端 app.log）`)) return;
    try { await invoke<string>('clear_module_gateway_log', { moduleId: activeModule }); toast.success('网关日志已清空'); await fetchRuntimeLogs(); }
    catch (e) { toast.error(String(e)); }
  };

  const openLogModal = (type: 'gateway' | 'manager') => {
    const raw = type === 'gateway' ? runtimeLogs?.gateway : runtimeLogs?.manager;
    if (!raw) return;
    setLogModal({ type, html: type === 'gateway' ? ansiToHtmlGatewayLog(raw) : ansiToHtml(raw) });
  };

  useEffect(() => { void fetchRuntimeLogs(); }, [fetchRuntimeLogs]);
  useEffect(() => {
    if (!logLive) return;
    const id = window.setInterval(() => void fetchRuntimeLogs(), 2000);
    return () => clearInterval(id);
  }, [logLive, fetchRuntimeLogs]);

  useEffect(() => { invoke<string>('get_app_version').then(setCurrentAppVersion).catch(() => undefined); }, []);

  const handleReturnToWizard = () => {
    if (!window.confirm('将回到「一站式安装向导」第一步。\n\n• 数据目录里的实例、机器人、YAML 配置仍会保留；仅重置本机向导进度。\n• 若已删除 openclaw 文件夹，请在向导第 2 步「安装 OpenClaw」重新安装后再启动网关。\n\n确定继续？')) return;
    navigate('/wizard');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_app_config', { config: { appearance: { theme } } });
      setStoreTheme(theme);
      toast.success('设置已保存');
    } catch (e) { toast.error(String(e)); }
    finally { setSaving(false); }
  };

  const handleCheckVersion = async () => {
    setCheckingVersion(true);
    try {
      const releases = await updateService.fetchRecentReleases(3);
      setRecentReleases(releases);
      if (releases.length > 0) toast.success('获取到 ' + releases.length + ' 个版本');
      else toast.error('获取版本失败');
    } catch { toast.error('版本检查失败'); }
    finally { setCheckingVersion(false); }
  };

  const handleDownloadVersion = async (release: ReleaseInfo) => {
    const exeAsset = updateService.getExeAsset(release);
    if (!exeAsset) { toast.error('未找到该版本的下载链接'); return; }
    try { await invoke('open_url', { url: exeAsset.url }); }
    catch { window.open(exeAsset.url, '_blank'); }
  };

  const themeOptions: { id: Theme; label: string; sub: string; icon: any }[] = [
    { id: 'light', label: '浅色', sub: '日光环境，明亮清新', icon: CxIconSun },
    { id: 'dark', label: '深色', sub: '夜间使用，护眼柔和', icon: CxIconMoon },
    { id: 'system', label: '跟随系统', sub: '与系统主题自动同步', icon: CxIconMonitor },
  ];

  return (
    <div className="min-h-full" style={{ background: C.bg }}>
      <header className="sticky top-0 z-20" style={{ background: C.bgElev, borderBottom: '1px solid ' + C.borderSoft }}>
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center gap-4">
          <button onClick={() => navigate('/home')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: C.textMute }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
            <CxIconArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: C.accentSoft, boxShadow: 'inset 0 0 0 1px ' + C.accent + '26' }}>
              <CxIconSettings className="w-3.5 h-3.5" style={{ color: C.accent }} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[14px] font-semibold leading-tight" style={{ color: C.text }}>设置</h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: C.textMute }}>主题 · 运行日志 · 版本管理 · 关于</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto px-6 py-7">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">
          <div className="space-y-5">
            <SectionCard icon={CxIconPalette} title="外观主题" desc="选择应用的整体视觉风格">
              <div className="grid grid-cols-3 gap-2.5">
                {themeOptions.map((t) => {
                  const Icon = t.icon;
                  const active = theme === t.id;
                  return (
                    <button key={t.id} type="button" onClick={() => setTheme(t.id)}
                      className="relative flex flex-col items-center gap-1.5 p-4 rounded-xl transition-all duration-200"
                      style={{ background: active ? C.accentSoft : C.bgSoft, border: '1px solid ' + (active ? C.accent : C.borderSoft), boxShadow: active ? '0 1px 2px rgba(91,127,189,0.18)' : 'none' }}
                      onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.borderColor = C.border; } }}
                      onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = C.bgSoft; e.currentTarget.style.borderColor = C.borderSoft; } }}>
                      {active && (
                        <span className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: C.accent }}>
                          <CxIconCheckCircle className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                        </span>
                      )}
                      <Icon className="w-5 h-5" style={{ color: active ? C.accent : C.textMute }} strokeWidth={1.75} />
                      <div className="text-[12.5px] font-semibold" style={{ color: active ? C.accent : C.text }}>{t.label}</div>
                      <div className="text-[10.5px]" style={{ color: C.textMute }}>{t.sub}</div>
                    </button>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              icon={CxIconTerminal} title="运行日志"
              desc={`实时显示 ${activeModuleDefinition.name} 网关与管理端尾部 · 错误行套红色`}
              right={
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer select-none px-2 h-7 rounded-md transition-colors duration-150"
                    style={{ background: logLive ? C.accentSoft : C.bgSoft, color: logLive ? C.accent : C.textMute, border: '1px solid ' + (logLive ? C.accent + '40' : C.borderSoft) }}>
                    <input type="checkbox" checked={logLive} onChange={e => setLogLive(e.target.checked)} className="w-3 h-3" style={{ accentColor: C.accent }} />
                    每 2 秒自动刷新
                  </label>
                  <button type="button" onClick={() => void handleRefreshLogs()} disabled={logRefreshing}
                    className="h-7 px-2.5 rounded-md text-[11.5px] flex items-center gap-1 transition-colors duration-150"
                    style={{ background: C.bgSoft, color: C.textSoft, border: '1px solid ' + C.borderSoft }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.bgSoft; }}>
                    {logRefreshing ? <CxIconLoader className="w-3 h-3 animate-spin" /> : <CxIconRefresh className="w-3 h-3" />}刷新
                  </button>
                  <button type="button" onClick={() => void handleClearGatewayLog()}
                    className="h-7 px-2.5 rounded-md text-[11.5px] flex items-center gap-1 transition-colors duration-150"
                    style={{ background: 'var(--cx-warn-soft)', color: 'var(--cx-warn)', border: '1px solid var(--cx-warn)30' }}>
                    <CxIconTrash2 className="w-3 h-3" />清空
                  </button>
                </div>
              }>
              <div className="space-y-3">
                <LogBlock label={`${activeModuleDefinition.name} 网关`} filePath={activeModule === 'hermes' ? '%LOCALAPPDATA%/hermes/logs/gateway-stdio.log' : 'logs/openclaw-gateway.log'}
                  html={runtimeLogs?.gateway?.trim() ? ansiToHtmlGatewayLog(runtimeLogs.gateway) : escapeHtml('（暂无网关日志；启动网关后 stdout/stderr 将写入此文件）')}
                  empty={!runtimeLogs?.gateway?.trim()} onExpand={() => openLogModal('gateway')} preRef={logPreRef} />
                <LogBlock label="管理端（Tauri）" filePath="logs/app.log"
                  html={runtimeLogs?.manager?.trim() ? ansiToHtml(runtimeLogs.manager) : escapeHtml('（暂无管理端日志）')}
                  empty={!runtimeLogs?.manager?.trim()} onExpand={() => openLogModal('manager')} />
              </div>
            </SectionCard>

            <SectionCard icon={CxIconPackages} title="版本管理" desc="从快泛 Claw 官网获取最新 3 个版本并下载"
              right={
                <button type="button" onClick={() => void handleCheckVersion()} disabled={checkingVersion}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors duration-150"
                  style={{ background: C.accent, color: '#fff' }}
                  onMouseEnter={(e) => { if (!checkingVersion) e.currentTarget.style.background = C.accentHover; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = C.accent; }}>
                  {checkingVersion ? <CxIconLoader className="w-3.5 h-3.5 animate-spin" /> : <CxIconRefresh className="w-3.5 h-3.5" />}
                  {checkingVersion ? '检查中…' : '检查新版本'}
                </button>
              }>
              {recentReleases.length === 0 ? (
                <div className="text-center py-10">
                  <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: C.bgSoft, color: C.textDim }}>
                    <CxIconPlugins size={20} className="w-5 h-5" />
                  </div>
                  <div className="text-[12.5px]" style={{ color: C.textMute }}>点击「检查新版本」获取版本列表</div>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {recentReleases.map((release) => {
                    const exeAsset = updateService.getExeAsset(release);
                    const isCurrentVersion = release.version === currentAppVersion;
                    return (
                      <div key={release.tag_name}
                        className="flex items-center gap-3 p-3 rounded-xl transition-colors duration-150"
                        style={{ background: C.bgSoft, border: '1px solid ' + C.borderSoft }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.border; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSoft; }}>
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                          style={{ background: isCurrentVersion ? C.accentSoft : C.bgElev, color: isCurrentVersion ? C.accent : C.textSoft, border: '1px solid ' + (isCurrentVersion ? C.accent + '40' : C.borderSoft) }}>
                          <CxIconPackages className="w-4 h-4" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12.5px] font-semibold" style={{ color: C.text }}>v{release.version}</span>
                            {release.is_latest && (
                              <span className="text-[10px] px-1.5 h-4 rounded-full inline-flex items-center font-medium"
                                style={{ background: 'var(--cx-success-soft)', color: 'var(--cx-success)' }}>最新</span>
                            )}
                            {isCurrentVersion && (
                              <span className="text-[10px] px-1.5 h-4 rounded-full inline-flex items-center font-medium"
                                style={{ background: C.accentSoft, color: C.accent }}>已安装</span>
                            )}
                          </div>
                          <div className="text-[11px] truncate" style={{ color: C.textMute }}>{release.name || release.tag_name}</div>
                          <div className="text-[10.5px] mt-0.5 font-mono" style={{ color: C.textDim }}>
                            {new Date(release.published_at).toLocaleDateString('zh-CN')}
                          </div>
                        </div>
                        {exeAsset ? (
                          <button type="button" onClick={() => void handleDownloadVersion(release)} disabled={isCurrentVersion}
                            className="h-7 px-3 rounded-md text-[11.5px] font-medium flex items-center gap-1.5 transition-colors duration-150"
                            style={{ background: isCurrentVersion ? C.bgSoft : 'var(--cx-success)', color: isCurrentVersion ? C.textMute : '#fff', border: '1px solid ' + (isCurrentVersion ? C.borderSoft : 'transparent') }}>
                            {isCurrentVersion ? <><CxIconCheckCircle className="w-3 h-3" />当前版本</> : <><CxIconDownload className="w-3 h-3" />浏览器下载</>}
                          </button>
                        ) : <div className="text-[11px]" style={{ color: C.textDim }}>无安装包</div>}
                      </div>
                    );
                  })}
                </div>
              )}
            </SectionCard>

            <SectionCard icon={CxIconInfo} title="关于" desc="应用版本与客服联系方式">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: 'linear-gradient(135deg, #5b7fbd 0%, #7a9bd1 100%)', boxShadow: '0 2px 8px rgba(91,127,189,0.25)' }}>
                  <CxIconBoxes className="w-6 h-6 text-white" strokeWidth={1.75} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold" style={{ color: C.text }}>快泛 Claw</div>
                  <div className="text-[11.5px] mt-0.5" style={{ color: C.textMute }}>一站式本地 Agent 平台 · 跨平台桌面应用</div>
                  <div className="flex items-center gap-3 mt-2.5 text-[11px] font-mono" style={{ color: C.textDim }}>
                    <span>版本 v{currentAppVersion}</span>
                    <span style={{ color: C.border }}>·</span>
                    <span>Tauri · React · TypeScript</span>
                  </div>
                </div>
              </div>
            </SectionCard>

            <div className="rounded-xl overflow-hidden"
              style={{ background: 'linear-gradient(135deg, #fdf6ec 0%, #f5f2ed 100%)', border: '1px solid #d6c39e', boxShadow: 'var(--cx-shadow-xs)' }}>
              <div className="flex items-center gap-3 px-5 py-4" style={{ borderBottom: '1px solid #e8d8b6' }}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--cx-warn-soft)', color: 'var(--cx-warn)' }}>
                  <CxIconRotateCcw className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-[13px] font-semibold" style={{ color: C.text }}>重新走安装向导</h3>
                  <p className="text-[11px] mt-0.5" style={{ color: C.textSoft }}>重置本机向导进度（实例、机器人、YAML 配置仍会保留）</p>
                </div>
              </div>
              <div className="px-5 py-3.5">
                <button type="button" onClick={handleReturnToWizard}
                  className="w-full h-9 rounded-lg text-[12.5px] font-medium flex items-center justify-center gap-1.5 transition-colors duration-150"
                  style={{ background: 'var(--cx-warn-soft)', color: 'var(--cx-warn)', border: '1px solid var(--cx-warn)40' }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#fae6c440'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--cx-warn-soft)'; }}>
                  <CxIconRotateCcw className="w-3.5 h-3.5" />返回安装向导（从第 1 步开始）
                </button>
              </div>
            </div>

            <button type="button" onClick={handleSave} disabled={saving}
              className="w-full h-11 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 transition-all duration-150"
              style={{ background: saving ? C.accentHover : C.accent, color: '#fff', boxShadow: '0 1px 3px rgba(91,127,189,0.25)' }}
              onMouseEnter={(e) => { if (!saving) e.currentTarget.style.background = C.accentHover; }}
              onMouseLeave={(e) => { if (!saving) e.currentTarget.style.background = C.accent; }}>
              {saving && <CxIconRefresh className="w-4 h-4 animate-spin" />}
              {saving ? '保存中…' : '保存设置'}
            </button>
          </div>

          <aside className="space-y-3">
            <SideCard icon={CxIconMessageCircle} title="联系客服" desc="扫码添加快泛客服微信" cta="扫码联系" onClick={() => setShowContact(true)} />
            <SideCard icon={CxIconFileText} title="使用文档" desc="查看快泛 Claw 的使用说明与 API 文档" cta="打开文档" onClick={() => toast('文档功能开发中…')} />
            <SideCard icon={CxIconExternalLink} title="官网" desc="访问快泛 Claw 官网获取最新动态" cta="访问官网"
              onClick={async () => {
                try { await invoke('open_url', { url: 'http://kuaifanclaw.cn' }); }
                catch { window.open('http://kuaifanclaw.cn', '_blank'); }
              }} />

            <div className="rounded-xl p-4 text-[10.5px] font-mono leading-relaxed"
              style={{ background: C.bgSoft, border: '1px solid ' + C.borderSoft, color: C.textDim }}>
              <div className="flex items-center gap-1.5 mb-1.5" style={{ color: C.textMute }}>
                <CxIconSettings size={20} className="w-3 h-3" />
                <span className="font-semibold not-italic">快捷键</span>
              </div>
              <div className="space-y-0.5">
                <div>Esc · 关闭弹窗</div>
                <div>Ctrl/⌘ + K · 命令面板</div>
                <div>Ctrl/⌘ + , · 打开设置</div>
              </div>
            </div>
          </aside>
        </div>
      </main>

      {logModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 cx-animate-fade-in"
          style={{ background: 'rgba(44, 36, 22, 0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setLogModal(null)}>
          <div className="w-full max-w-5xl rounded-xl flex flex-col overflow-hidden cx-animate-scale-in"
            style={{ background: C.bgElev, border: '1px solid ' + C.border, boxShadow: 'var(--cx-shadow-xl)', maxHeight: '90vh' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 h-14 shrink-0" style={{ borderBottom: '1px solid ' + C.borderSoft }}>
              <div>
                <h3 className="text-[14px] font-semibold" style={{ color: C.text }}>
                  {logModal.type === 'gateway' ? `${activeModuleDefinition.name} 网关日志` : '管理端日志'}
                </h3>
                <p className="text-[11px] mt-0.5" style={{ color: C.textMute }}>
                  {logModal.type === 'gateway' ? `${activeModule === 'hermes' ? '%LOCALAPPDATA%/hermes/logs/gateway-stdio.log' : 'logs/openclaw-gateway.log'} · 实时输出` : 'logs/app.log · 实时输出'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void handleRefreshLogs()}
                  className="h-7 px-2.5 rounded-md text-[11.5px] flex items-center gap-1.5 transition-colors duration-150"
                  style={{ background: C.bgSoft, color: C.textSoft, border: '1px solid ' + C.borderSoft }}>
                  <CxIconRefresh className="w-3 h-3" />刷新
                </button>
                <button type="button" onClick={() => setLogModal(null)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
                  style={{ color: C.textMute }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
                  <CxIconClose className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 cx-scroll-slim">
              <pre className="text-[11.5px] font-mono leading-relaxed whitespace-pre-wrap break-all p-4 rounded-lg"
                style={{ background: '#1a1814', color: '#e8e3d8' }}
                dangerouslySetInnerHTML={{ __html: logModal.html }} />
            </div>
          </div>
        </div>
      )}

      {showContact && !enlargedImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-6 cx-animate-fade-in"
          style={{ background: 'rgba(44, 36, 22, 0.55)', backdropFilter: 'blur(6px)' }}
          onClick={() => setShowContact(false)}>
          <div className="rounded-2xl p-6 flex flex-col items-center cx-animate-scale-in"
            style={{ background: C.bgElev, border: '1px solid ' + C.border, boxShadow: 'var(--cx-shadow-xl)', maxWidth: 560, width: '100%' }}
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-2 self-start">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: C.accentSoft, color: C.accent }}>
                <CxIconMessageCircle className="w-4 h-4" />
              </div>
              <h3 className="text-[15px] font-semibold" style={{ color: C.text }}>联系客服</h3>
            </div>
            <p className="text-[12.5px] self-start mb-5" style={{ color: C.textMute }}>扫码添加快泛客服微信 · 工作日 9:00 – 18:00</p>
            <img src="/images/二维码.jpg" alt="客服二维码"
              className="w-72 h-72 object-contain rounded-xl cursor-pointer transition-transform duration-200"
              style={{ border: '1px solid ' + C.borderSoft }}
              onClick={() => setEnlargedImage(true)} title="点击放大" />
            <button type="button" onClick={() => setShowContact(false)}
              className="mt-5 h-9 px-5 rounded-lg text-[12.5px] font-medium transition-colors duration-150"
              style={{ background: C.bgSoft, color: C.textSoft, border: '1px solid ' + C.borderSoft }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.bgSoft; }}>关闭</button>
          </div>
        </div>
      )}

      {showContact && enlargedImage && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6 cursor-zoom-out"
          style={{ background: 'rgba(0,0,0,0.92)' }} onClick={() => setEnlargedImage(false)}>
          <img src="/images/二维码.jpg" alt="客服二维码" className="max-w-full max-h-full object-contain rounded-xl" />
        </div>
      )}
    </div>
  );
}

function SectionCard({
  icon: Icon, title, desc, right, children,
}: {
  icon?: any; title: string; desc?: string; right?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl overflow-hidden"
      style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}>
      <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid ' + C.borderSoft }}>
        <div className="flex items-center gap-2.5 min-w-0">
          {Icon && (
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: C.accentSoft, color: C.accent }}>
              <Icon className="w-3.5 h-3.5" strokeWidth={2} />
            </div>
          )}
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold leading-tight" style={{ color: C.text }}>{title}</h2>
            {desc && <p className="text-[11px] mt-0.5 leading-tight" style={{ color: C.textMute }}>{desc}</p>}
          </div>
        </div>
        {right}
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function LogBlock({
  label, filePath, html, empty, onExpand, preRef,
}: {
  label: string; filePath: string; html: string; empty: boolean;
  onExpand: () => void; preRef?: React.RefObject<HTMLPreElement>;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-[11.5px] font-semibold" style={{ color: C.textSoft }}>{label}</span>
          <code className="text-[10px] px-1.5 py-0.5 rounded font-mono"
            style={{ background: C.bgSoft, color: C.textMute, border: '1px solid ' + C.borderSoft }}>{filePath}</code>
        </div>
        <button type="button" onClick={onExpand} disabled={empty}
          className="text-[11px] flex items-center gap-1 transition-colors duration-150"
          style={{ color: empty ? C.textDim : C.accent }}>
          <CxIconExternalLink className="w-3 h-3" />点击放大
        </button>
      </div>
      <pre ref={preRef} onClick={empty ? undefined : onExpand}
        className="text-[11.5px] font-mono leading-relaxed rounded-lg p-3 overflow-auto cx-scroll-slim whitespace-pre-wrap break-all"
        style={{ background: '#1a1814', color: '#e8e3d8', maxHeight: 220, cursor: empty ? 'default' : 'pointer', border: '1px solid ' + C.borderSoft }}
        dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

function SideCard({
  icon: Icon, title, desc, cta, onClick,
}: {
  icon: any; title: string; desc: string; cta: string; onClick: () => void;
}) {
  return (
    <button type="button" onClick={onClick}
      className="w-full text-left flex items-center gap-3 p-3.5 rounded-xl transition-all duration-200"
      style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = C.border;
        e.currentTarget.style.transform = 'translateY(-1px)';
        e.currentTarget.style.boxShadow = '0 4px 12px rgba(44,36,22,0.06)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = C.borderSoft;
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--cx-shadow-xs)';
      }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: C.accentSoft, color: C.accent }}>
        <Icon className="w-4 h-4" strokeWidth={1.75} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[12.5px] font-semibold" style={{ color: C.text }}>{title}</div>
        <div className="text-[10.5px] mt-0.5 truncate" style={{ color: C.textMute }}>{desc}</div>
      </div>
      <span className="text-[10.5px] font-medium px-2 h-6 rounded-md inline-flex items-center shrink-0"
        style={{ background: C.accentSoft, color: C.accent }}>{cta}</span>
    </button>
  );
}
