import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { INSTALL_PROGRESS_DOM_EVENT, InstallProgressPayload } from '../../utils/installProgressBridge';
import { CheckCircle, Download, Loader2, AlertTriangle, RefreshCw, XCircle } from 'lucide-react';

interface Plugin {
  id: string;
  name: string;
  icon: string;
  description: string;
  installed: boolean;
  version?: string;
  enabled: boolean;
  /** npm 运行时依赖是否就绪；就绪时网关才能正常加载 */
  deps_ready: boolean;
}

interface ProgressEvent {
  stage: string;
  status: 'started' | 'progress' | 'finished' | 'failed' | 'mirror-fallback' | 'detail';
  percent?: number;
  message: string;
}

interface Props {
  onNext: () => void;
  onPrev: () => void;
}

const NPM_ERROR_HINTS: Array<[string[], string]> = [
  [['ETARGET', 'No matching version', 'notarget'], 'npm registry 找不到匹配版本。请检查「设置 → registry 配置」是否设为国内镜像（如 https://registry.npmmirror.com）。'],
  [['ETIMEDOUT', 'ECONNREFUSED', 'timeout'], '网络超时。请检查网络代理/VPN，或更换 registry。'],
  [['EACCES', 'EPERM', 'access is denied', '拒绝访问'], '权限错误。请确认程序有写入数据目录的权限；杀毒软件可能拦截 node_modules 操作。'],
  [['ENOTFOUND', 'getaddrinfo'], 'DNS 解析失败，无法连接 registry。请检查网络或设置 registry。'],
];

function getPluginErrorHint(message: string): string | null {
  const msg = message.toLowerCase();
  for (const [keywords, hint] of NPM_ERROR_HINTS) {
    if (keywords.some(k => msg.includes(k.toLowerCase()))) return hint;
  }
  return null;
}

function formatInvokeError(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}

export default function PluginConfig({ onNext, onPrev }: Props) {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);
  /** 正在重装依赖的插件 id（用于显示独立进度，区别于首次安装） */
  const [reinstalling, setReinstalling] = useState<string | null>(null);
  /** 上一次安装失败（必须展示给用户，不能只在 console） */
  const [installError, setInstallError] = useState<{ pluginId: string; message: string } | null>(null);
  const [installOkHint, setInstallOkHint] = useState<string | null>(null);
  const [liveProgress, setLiveProgress] = useState<ProgressEvent | null>(null);
  /** 与 exe 同级的 data 目录（插件在 {dataDir}/plugins，随运行方式变化，勿与 bin 下路径混淆） */
  const [dataDir, setDataDir] = useState<string | null>(null);

  const loadPlugins = async () => {
    setLoading(true);
    try {
      const list = await invoke<Plugin[]>('list_plugins');
      setPlugins(list);
    } catch (e) {
      console.error('Load plugins error:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    invoke<string>('get_data_dir')
      .then(setDataDir)
      .catch(() => setDataDir(null));
  }, []);

  useEffect(() => {
    loadPlugins();

    const onBridge = (e: Event) => {
      const ev = (e as CustomEvent<InstallProgressPayload>).detail;
      if (!ev.stage.startsWith('plugin-') && !ev.stage.startsWith('skill-') && !ev.stage.startsWith('fix-deps-')) return;
      setLiveProgress(ev as ProgressEvent);
      if (ev.status === 'failed' && (ev.stage.startsWith('plugin-') || ev.stage.startsWith('fix-deps-'))) {
        const pid = ev.stage.replace(/^plugin-/, '').replace(/^fix-deps-/, '');
        setInstallError({ pluginId: pid, message: ev.message });
      }
    };
    window.addEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);

    return () => {
      window.removeEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);
    };
  }, []);

  const installedCount = plugins.filter((p) => p.installed).length;

  const handleInstall = async (pluginId: string) => {
    setInstalling(pluginId);
    setLiveProgress(null);
    setInstallError(null);
    setInstallOkHint(null);
    try {
      const msg = await invoke<string>('install_plugin', { pluginId });
      await loadPlugins();
      setInstallOkHint(msg || `插件「${pluginId}」安装成功`);
    } catch (e) {
      const text = formatInvokeError(e);
      console.error('Install plugin error:', e);
      setInstallError({ pluginId, message: text });
    }
    setInstalling(null);
  };

  /** 重装依赖：强制 npm install，跳过已安装判断；用于移植后依赖缺失一键修复 */
  const handleReinstall = async (pluginId: string) => {
    setReinstalling(pluginId);
    setLiveProgress(null);
    setInstallError(null);
    setInstallOkHint(null);
    try {
      const msg = await invoke<string>('reinstall_plugin_deps', { pluginId });
      await loadPlugins();
      setInstallOkHint(msg || `插件「${pluginId}」依赖重装完成`);
    } catch (e) {
      const text = formatInvokeError(e);
      console.error('Reinstall plugin deps error:', e);
      setInstallError({ pluginId, message: text });
    }
    setReinstalling(null);
  };

  const statusColor = (status: string) => {
    switch (status) {
      case 'finished': return 'text-green-600';
      case 'failed': return 'text-red-600';
      case 'mirror-fallback': return 'text-yellow-600';
      default: return 'text-blue-600';
    }
  };

  const statusBg = (status: string) => {
    switch (status) {
      case 'finished': return 'bg-green-50 border-green-200';
      case 'failed': return 'bg-red-50 border-red-200';
      case 'mirror-fallback': return 'bg-yellow-50 border-yellow-200';
      default: return 'bg-blue-50 border-blue-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">聊天插件配置</h2>
        <p className="text-gray-600">选择需要安装的聊天平台插件</p>
        {dataDir && (
          <p className="text-xs text-gray-500 mt-3 max-w-3xl mx-auto text-left sm:text-center break-all leading-relaxed">
            <span className="text-gray-400">数据目录（随当前运行的 exe 位置变化）：</span>
            <span className="font-mono text-gray-600 block sm:inline sm:ml-1">{dataDir}</span>
            <br className="hidden sm:block" />
            <span className="text-gray-400">插件目录：</span>
            <span className="font-mono text-gray-600">
              {dataDir.replace(/[/\\]+$/, '')}
              {dataDir.includes('\\') ? '\\' : '/'}plugins
            </span>
          </p>
        )}
      </div>

      {installOkHint && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 flex justify-between items-start gap-3">
          <span>{installOkHint}</span>
          <button type="button" className="text-green-700 hover:underline shrink-0" onClick={() => setInstallOkHint(null)}>
            关闭
          </button>
        </div>
      )}

      {installError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 space-y-2">
          <div className="font-medium flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-500 shrink-0" />
            插件「{installError.pluginId}」安装失败
          </div>
          <div className="text-red-700 whitespace-pre-wrap break-words font-mono text-xs">{installError.message}</div>
          {getPluginErrorHint(installError.message) && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-600" />
              <span>{getPluginErrorHint(installError.message)}</span>
            </div>
          )}
          <div className="text-xs text-gray-500 border-t border-gray-200 pt-1.5">
            若问题持续，请打开「数据目录\logs\app.log」查看详细后端日志。
          </div>
          <button
            type="button"
            className="text-red-600 hover:underline text-xs"
            onClick={() => setInstallError(null)}
          >
            关闭提示
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="ml-3 text-gray-600">加载中...</span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {plugins.map((plugin) => (
              <div
                key={plugin.id}
                className={`
                  p-4 rounded-lg border transition-colors
                  ${plugin.installed
                    ? 'bg-green-50 border-green-200'
                    : 'bg-white border-gray-200 hover:border-blue-300'
                  }
                `}
              >
                <div className="flex items-center mb-2">
                  <span className="text-2xl mr-2">{plugin.icon}</span>
                  <div className="flex-1">
                    <div className="font-medium text-gray-900">{plugin.name}</div>
                    {plugin.version && (
                      <div className="text-xs text-gray-500">v{plugin.version}</div>
                    )}
                  </div>
                  {plugin.installed ? (
                  <CheckCircle className="w-5 h-5 text-green-500" />
                ) : null}
                </div>
                <p className="text-sm text-gray-500 mb-3">{plugin.description}</p>
                {plugin.id === 'wechat_clawbot' && !plugin.installed && (
                  <p className="text-xs text-gray-500 mb-2">
                    与钉钉/飞书相同一键安装；安装后请在「创建实例」选择微信时按提示扫码登录。
                  </p>
                )}
                {!plugin.installed && plugin.version && (
                  <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2">
                    检测到未完成的插件目录（缺 node_modules 等）。请点击「安装」补全依赖，无需单独重装。
                  </p>
                )}
                {!plugin.installed ? (
                    <button
                      onClick={() => handleInstall(plugin.id)}
                      disabled={installing === plugin.id || reinstalling === plugin.id}
                      className="w-full py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center"
                    >
                      {installing === plugin.id ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          安装中...
                        </>
                      ) : (
                        <>
                          <Download className="w-4 h-4 mr-2" />
                          安装
                        </>
                      )}
                    </button>
                ) : (
                  <div className="space-y-2">
                    {/* 依赖状态 */}
                    {plugin.deps_ready ? (
                      <div className="flex items-center gap-1 text-xs text-green-600">
                        <CheckCircle className="w-3.5 h-3.5 shrink-0" />
                        <span>依赖就绪</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1 text-xs text-orange-600">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                        <span>依赖缺失，网关无法加载</span>
                      </div>
                    )}
                    {/* 重装依赖按钮 */}
                    <button
                      onClick={() => handleReinstall(plugin.id)}
                      disabled={installing === plugin.id || reinstalling === plugin.id}
                      className={`w-full py-1.5 text-xs rounded border flex items-center justify-center gap-1.5 transition-colors ${
                        plugin.deps_ready
                          ? 'border-gray-300 text-gray-500 hover:bg-gray-50 hover:border-gray-400'
                          : 'border-orange-300 text-orange-600 hover:bg-orange-50 hover:border-orange-400'
                      } disabled:opacity-50`}
                    >
                      {reinstalling === plugin.id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          重装中...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-3.5 h-3.5" />
                          重装依赖
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="text-center text-sm text-gray-500">
            已安装 {installedCount} / {plugins.length} 个插件
          </div>

          {/* ── 安装 / 重装进度：正在操作就显示 */}
          {(installing || reinstalling) && (
            <div
              className={`rounded-lg border p-4 ${
                liveProgress ? statusBg(liveProgress.status) : 'bg-blue-50 border-blue-200'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Loader2
                    className={`w-4 h-4 animate-spin ${
                      liveProgress ? statusColor(liveProgress.status) : 'text-blue-600'
                    }`}
                  />
                  <span className="font-medium text-sm">
                    {liveProgress
                      ? liveProgress.stage.replace('plugin-', '插件 ').replace('fix-deps-', '重装 ').replace('skill-', 'skill-')
                      : installing ?? reinstalling ?? ''}
                  </span>
                </div>
                <span
                  className={`text-xs font-medium ${
                    liveProgress ? statusColor(liveProgress.status) : 'text-blue-600'
                  }`}
                >
                  {liveProgress?.status === 'progress' && `${Math.round(liveProgress.percent ?? 0)}%`}
                  {liveProgress?.status === 'started' && '进行中…'}
                  {liveProgress?.status === 'finished' && '完成'}
                  {liveProgress?.status === 'failed' && '失败'}
                  {liveProgress?.status === 'mirror-fallback' && '切换镜像…'}
                  {liveProgress?.status === 'detail' && '详情'}
                  {!liveProgress && '已请求后端…'}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                {liveProgress?.status === 'progress' && liveProgress.percent !== undefined ? (
                  <div
                    className="h-1.5 rounded-full bg-blue-500 transition-all duration-500"
                    style={{ width: `${liveProgress.percent}%` }}
                  />
                ) : (
                  <div className="h-1.5 rounded-full bg-blue-400 animate-pulse w-1/3" />
                )}
              </div>
              <div
                className={`mt-1 text-xs ${
                  liveProgress ? statusColor(liveProgress.status) : 'text-blue-700'
                }`}
              >
                {liveProgress?.message ??
                  '正在安装，等待后端进度事件。若长时间无更新，请查看下方红色错误提示或日志。'}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex justify-between items-center pt-4 border-t">
        <button
          onClick={onPrev}
          className="px-4 py-2 text-gray-600 hover:text-gray-900"
        >
          上一步
        </button>

        <button
          onClick={onNext}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
