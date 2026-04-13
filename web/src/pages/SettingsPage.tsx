import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Moon, Sun, Monitor, RefreshCw, ArrowLeft, Loader2, Trash2, X, RotateCcw, MessageCircle, Download, CheckCircle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import AnsiUp from 'ansi-to-html';
import { updateService } from '../services/updateService';

interface RuntimeLogsTail {
  gateway: string;
  manager: string;
}

const ansiUp = new AnsiUp();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function ansiToHtml(text: string): string {
  // 先转义 HTML，再处理 ANSI
  const escaped = escapeHtml(text);
  return ansiUp.toHtml(escaped);
}

/** 网关日志中疑似报错行（含 PowerShell / exec / Node 常见形态） */
const GATEWAY_ERROR_LINE_RE =
  /(exec failed|ParserError|InvalidEndOfLine|ParentContainsErrorRecordException|FullyQualifiedErrorId|CategoryInfo\s*:|Command exited with code [1-9]|exited with code [1-9]\d*\b|\bERR!\b|\bERROR\b|\[error\]|\bFATAL\b|UnhandledPromiseRejection|uncaught exception|ECONNREFUSED|EADDRINUSE|失败\b|错误\b)/i;

function isGatewayErrorLine(line: string): boolean {
  if (GATEWAY_ERROR_LINE_RE.test(line)) return true;
  // PowerShell 错误上下文行（以 + 开头）
  const t = line.trimStart();
  if (t.startsWith('+ ') && (t.includes('CategoryInfo') || t.includes('FullyQualifiedErrorId') || /^\+\s+\.\.\./.test(t)))
    return true;
  return false;
}

/** 网关日志：错误行套红色，便于在深色背景上扫一眼定位问题 */
function ansiToHtmlGatewayLog(text: string): string {
  if (!text) return '';
  return text
    .split('\n')
    .map(line => {
      const inner = ansiToHtml(line);
      return isGatewayErrorLine(line)
        ? `<span class="text-red-400 font-medium">${inner}</span>`
        : inner;
    })
    .join('\n');
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const { setTheme: setStoreTheme, theme: storeTheme, setWizardCompleted, setCurrentStep } = useAppStore();
  const [theme, setTheme] = useState(storeTheme);
  const [saving, setSaving] = useState(false);

  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogsTail | null>(null);
  const [logLive, setLogLive] = useState(true);
  const [logRefreshing, setLogRefreshing] = useState(false);
  const logPreRef = useRef<HTMLPreElement>(null);
  const logLiveRef = useRef(logLive);
  logLiveRef.current = logLive;

  // 版本检查相关状态
  const [checkingVersion, setCheckingVersion] = useState(false);
  const [appVersionInfo, setAppVersionInfo] = useState<any>(null);
  const [openClawVersionInfo, setOpenClawVersionInfo] = useState<any>(null);
  const [downloading, setDownloading] = useState(false);

  // 日志放大弹窗
  const [logModal, setLogModal] = useState<{ type: 'gateway' | 'manager'; html: string } | null>(null);

  // 联系客服弹窗
  const [showContact, setShowContact] = useState(false);

  const fetchRuntimeLogs = useCallback(async () => {
    try {
      const data = await invoke<RuntimeLogsTail>('read_runtime_logs_tail', { lines: 500 });
      setRuntimeLogs(data);
      if (logLiveRef.current && logPreRef.current) {
        requestAnimationFrame(() => {
          const el = logPreRef.current;
          if (el) el.scrollTop = el.scrollHeight;
        });
      }
    } catch {
      /* 轮询失败时静默，避免刷屏 */
    }
  }, []);

  const handleRefreshLogs = async () => {
    setLogRefreshing(true);
    try {
      await fetchRuntimeLogs();
    } finally {
      setLogRefreshing(false);
    }
  };

  const handleClearGatewayLog = async () => {
    if (!window.confirm('确定清空 OpenClaw 网关日志文件？（不影响管理端 app.log）')) return;
    try {
      await invoke<string>('clear_openclaw_gateway_log');
      toast.success('网关日志已清空');
      await fetchRuntimeLogs();
    } catch (e) {
      toast.error(String(e));
    }
  };

  const openLogModal = (type: 'gateway' | 'manager') => {
    const raw = type === 'gateway' ? runtimeLogs?.gateway : runtimeLogs?.manager;
    if (!raw) return;
    const html = type === 'gateway' ? ansiToHtmlGatewayLog(raw) : ansiToHtml(raw);
    setLogModal({ type, html });
  };

  useEffect(() => {
    void fetchRuntimeLogs();
  }, [fetchRuntimeLogs]);

  useEffect(() => {
    if (!logLive) return;
    const id = window.setInterval(() => void fetchRuntimeLogs(), 2000);
    return () => clearInterval(id);
  }, [logLive, fetchRuntimeLogs]);

  const handleReturnToWizard = () => {
    if (
      !window.confirm(
        '将回到「一站式安装向导」第一步。\n\n' +
          '• 数据目录里的实例、机器人、YAML 配置仍会保留；仅重置本机向导进度。\n' +
          '• 若已删除 openclaw-cn 文件夹，请在向导第 2 步「安装 OpenClaw-CN」重新安装后再启动网关。\n\n' +
          '确定继续？'
      )
    ) {
      return;
    }
    navigate('/wizard');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke('save_app_config', {
        config: { appearance: { theme } },
      });
      setStoreTheme(theme as 'light' | 'dark' | 'system');
      toast.success('设置已保存');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setSaving(false);
    }
  };

  // 检查版本更新
  const handleCheckVersion = async () => {
    setCheckingVersion(true);
    try {
      // 检查应用版本
      const appInfo = await updateService.checkAppVersion('1.0.0');
      setAppVersionInfo(appInfo);
      
      // 检查OpenClaw版本
      const openClawInfo = await updateService.checkOpenClawVersion('1.0.0');
      setOpenClawVersionInfo(openClawInfo);
      
      if (appInfo.hasUpdate || openClawInfo.hasUpdate) {
        toast.success('检测到新版本');
      } else {
        toast.success('当前已是最新版本');
      }
    } catch (error) {
      toast.error('版本检查失败');
    } finally {
      setCheckingVersion(false);
    }
  };

  // 下载并安装更新
  const handleDownloadUpdate = async (url: string) => {
    setDownloading(true);
    try {
      const success = await updateService.downloadAndInstallUpdate(url);
      if (success) {
        toast.success('更新下载完成，请重启应用');
      } else {
        toast.error('更新下载失败');
      }
    } catch (error) {
      toast.error('更新失败');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold text-gray-900">设置</h1>
        </div>

        {/* 基础设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">外观主题</h2>
          <div className="flex gap-3">
            {(
              [
                { id: 'light' as const, icon: Sun, label: '浅色' },
                { id: 'dark' as const, icon: Moon, label: '深色' },
                { id: 'system' as const, icon: Monitor, label: '跟随系统' },
              ] as const
            ).map(t => (
              <button
                type="button"
                key={t.id}
                onClick={() => setTheme(t.id)}
                className={`flex-1 py-3 rounded-lg border flex flex-col items-center transition-colors
                  ${theme === t.id ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:bg-gray-50'}`}
              >
                <t.icon className="w-6 h-6 mb-1" />
                <span className="text-sm">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 运行日志（OpenClaw 网关 stdout/stderr + 管理端） */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">运行日志</h2>
              <p className="text-sm text-gray-500 mt-0.5">
                实时显示 OpenClaw 网关进程输出（<code className="text-xs bg-gray-100 px-1 rounded">logs/openclaw-gateway.log</code>
                ）与管理端 <code className="text-xs bg-gray-100 px-1 rounded">logs/app.log</code> 尾部；网关区含
                <span className="text-red-600 font-medium"> 红色行</span>
                表示疑似报错（exec/PowerShell/进程退出等）。
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={logLive}
                  onChange={e => setLogLive(e.target.checked)}
                  className="rounded border-gray-300"
                />
                每 2 秒自动刷新
              </label>
              <button
                type="button"
                onClick={() => void handleRefreshLogs()}
                disabled={logRefreshing}
                className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50"
              >
                {logRefreshing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                立即刷新
              </button>
              <button
                type="button"
                onClick={() => void handleClearGatewayLog()}
                className="px-3 py-1.5 text-sm border border-amber-200 text-amber-800 rounded-lg hover:bg-amber-50 flex items-center gap-1.5"
              >
                <Trash2 className="w-4 h-4" />
                清空网关日志
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {/* OpenClaw 网关 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">OpenClaw 网关</span>
                <button
                  type="button"
                  onClick={() => openLogModal('gateway')}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  点击放大
                </button>
              </div>
              <pre
                ref={logPreRef}
                onClick={() => openLogModal('gateway')}
                className="text-xs font-mono bg-gray-900 text-gray-100 rounded-lg p-3 overflow-auto max-h-56 whitespace-pre-wrap break-all cursor-pointer hover:ring-2 hover:ring-blue-400"
                title="点击放大查看完整日志"
                dangerouslySetInnerHTML={{
                  __html: runtimeLogs?.gateway?.trim()
                    ? ansiToHtmlGatewayLog(runtimeLogs.gateway)
                    : escapeHtml('（暂无网关日志；启动网关后 stdout/stderr 将写入此文件）'),
                }}
              />
            </div>
            {/* 管理端 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-gray-600">管理端（Tauri）</span>
                <button
                  type="button"
                  onClick={() => openLogModal('manager')}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  点击放大
                </button>
              </div>
              <pre
                onClick={() => openLogModal('manager')}
                className="text-xs font-mono bg-slate-800 text-slate-100 rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all cursor-pointer hover:ring-2 hover:ring-blue-400"
                title="点击放大查看完整日志"
                dangerouslySetInnerHTML={{
                  __html: runtimeLogs?.manager?.trim()
                    ? ansiToHtml(runtimeLogs.manager)
                    : escapeHtml('（暂无管理端日志）'),
                }}
              />
            </div>
          </div>
        </div>

        {/* 自动更新设置 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">自动更新</h2>
          <p className="text-sm text-gray-500 mb-4">检查并更新快泛claw和OpenClaw-CN到最新版本</p>
          
          {/* 版本检查按钮 */}
          <div className="mb-4">
            <button
              type="button"
              onClick={() => void handleCheckVersion()}
              disabled={checkingVersion}
              className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {checkingVersion ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {checkingVersion ? '检查中...' : '检查新版本'}
            </button>
          </div>
          
          {/* 版本信息和更新按钮 */}
          <div className="space-y-4">
            {/* 应用版本 */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">快泛claw</div>
                <div className="text-sm">
                  当前版本: <span className="font-medium">1.0.0</span>
                  {appVersionInfo && appVersionInfo.latestVersion && (
                    <span className="ml-2">
                      最新版本: <span className={`font-medium ${appVersionInfo.hasUpdate ? 'text-green-600' : 'text-gray-600'}`}>{appVersionInfo.latestVersion}</span>
                    </span>
                  )}
                </div>
              </div>
              {appVersionInfo && appVersionInfo.hasUpdate && (
                <div className="mt-3 space-y-2">
                  <div className="text-sm text-gray-600">
                    <strong>更新内容:</strong>
                    <pre className="whitespace-pre-wrap mt-1 text-xs">{appVersionInfo.changelog}</pre>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDownloadUpdate(appVersionInfo.downloadUrl)}
                    disabled={downloading}
                    className="w-full py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {downloading ? '下载中...' : '下载更新'}
                  </button>
                </div>
              )}
              {appVersionInfo && !appVersionInfo.hasUpdate && (
                <div className="mt-3 flex items-center text-sm text-green-600">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  当前已是最新版本
                </div>
              )}
            </div>
            
            {/* OpenClaw版本 */}
            <div className="p-4 bg-gray-50 rounded-lg">
              <div className="flex items-center justify-between mb-2">
                <div className="font-medium text-gray-900">OpenClaw-CN</div>
                <div className="text-sm">
                  当前版本: <span className="font-medium">1.0.0</span>
                  {openClawVersionInfo && openClawVersionInfo.latestVersion && (
                    <span className="ml-2">
                      最新版本: <span className={`font-medium ${openClawVersionInfo.hasUpdate ? 'text-green-600' : 'text-gray-600'}`}>{openClawVersionInfo.latestVersion}</span>
                    </span>
                  )}
                </div>
              </div>
              {openClawVersionInfo && openClawVersionInfo.hasUpdate && (
                <div className="mt-3 space-y-2">
                  <div className="text-sm text-gray-600">
                    <strong>更新内容:</strong>
                    <pre className="whitespace-pre-wrap mt-1 text-xs">{openClawVersionInfo.changelog}</pre>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDownloadUpdate(openClawVersionInfo.downloadUrl)}
                    disabled={downloading}
                    className="w-full py-2 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {downloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                    {downloading ? '下载中...' : '下载更新'}
                  </button>
                </div>
              )}
              {openClawVersionInfo && !openClawVersionInfo.hasUpdate && (
                <div className="mt-3 flex items-center text-sm text-green-600">
                  <CheckCircle className="w-4 h-4 mr-1" />
                  当前已是最新版本
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 安装向导 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-amber-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">安装向导</h2>
          <p className="text-sm text-gray-600 mb-4">
            完成向导后，应用会记住进度并直接进入首页。若需重新走环境检测、安装 OpenClaw-CN、插件与模型等步骤，可点击下方按钮。
          </p>
          <button
            type="button"
            onClick={handleReturnToWizard}
            className="w-full py-3 border-2 border-amber-300 text-amber-900 rounded-lg font-medium hover:bg-amber-50 flex items-center justify-center gap-2"
          >
            <RotateCcw className="w-5 h-5" />
            返回安装向导（从第 1 步开始）
          </button>
        </div>

        {/* 关于 */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">关于</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <div>版本: 1.0.0</div>
            <div>快泛claw</div>
          </div>
          <button
            type="button"
            onClick={() => setShowContact(true)}
            className="mt-4 w-full py-3 border border-blue-200 text-blue-600 rounded-lg font-medium hover:bg-blue-50 flex items-center justify-center gap-2"
          >
            <MessageCircle className="w-5 h-5" />
            联系客服
          </button>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center"
        >
          {saving ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
          保存设置
        </button>
      </div>

      {/* 联系客服弹窗 */}
      {showContact && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm flex flex-col items-center p-8">
            <h3 className="text-xl font-semibold text-gray-900 mb-2">联系客服</h3>
            <p className="text-sm text-gray-500 mb-6 text-center">扫码添加快泛客服微信</p>
            <img
              src="/images/二维码.jpg"
              alt="客服二维码"
              className="w-64 h-64 object-contain rounded-xl border border-gray-200"
            />
            <button
              type="button"
              onClick={() => setShowContact(false)}
              className="mt-6 px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 font-medium"
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {/* 日志放大弹窗 */}
      {logModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl flex flex-col"
            style={{ maxHeight: '90vh' }}>
            {/* 弹窗标题栏 */}
            <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {logModal.type === 'gateway' ? 'OpenClaw 网关日志' : '管理端（Tauri）日志'}
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">实时输出，点击外部或右上角关闭</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleRefreshLogs()}
                  className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"
                >
                  <RefreshCw className="w-4 h-4" />
                  刷新
                </button>
                <button
                  type="button"
                  onClick={() => setLogModal(null)}
                  className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {/* 日志内容 */}
            <div className="flex-1 overflow-auto p-4">
              <pre
                className="text-xs font-mono bg-gray-900 text-gray-100 rounded-lg p-4 whitespace-pre-wrap break-all leading-relaxed"
                dangerouslySetInnerHTML={{ __html: logModal.html }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
