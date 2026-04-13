import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle, XCircle, Loader2, RefreshCw, AlertTriangle } from 'lucide-react';
import { INSTALL_PROGRESS_DOM_EVENT, InstallProgressPayload } from '../../utils/installProgressBridge';

/// 常见 npm 错误关键词 → 中文说明 + registry 配置提示
const NPM_ERROR_HINTS: Array<[string[], string]> = [
  [['ETARGET', 'No matching version', 'notarget'], 'npm registry 上找不到匹配的版本。可能原因：npm 镜像未同步最新版。请检查「设置 → registry 配置」是否设为国内镜像（如 https://registry.npmmirror.com）或 npmjs.org。'],
  [['ETIMEDOUT', 'ECONNREFUSED', 'network', 'timeout'], '网络连接超时。请检查网络代理/VPN 设置，或更换为可访问的 npm registry（设置 → registry）。'],
  [['EACCES', 'EPERM', 'access is denied', 'operation not permitted', '拒绝访问'], '权限错误。请确认本程序有写入数据目录的权限；部分杀毒软件可能拦截 node_modules 操作。'],
  [['ENOTFOUND', 'getaddrinfo'], 'DNS 解析失败，无法连接 registry。请检查网络或设置 registry（如 https://registry.npmmirror.com）。'],
  [['ENOENT', 'not find', '找不到'], '找不到文件或目录。可能原因：npm 缓存损坏。请尝试关闭程序后手动删除「数据目录\\openclaw-cn\\node_modules」再重试。'],
  [['ECONNRESET'], '连接被重置。请检查网络代理或更换 registry。'],
];

function getNpmErrorHint(message: string): string | null {
  const msg = message.toLowerCase();
  for (const [keywords, hint] of NPM_ERROR_HINTS) {
    if (keywords.some(k => msg.includes(k.toLowerCase()))) {
      return hint;
    }
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

interface Props {
  onNext: () => void;
  onPrev: () => void;
}

interface Progress {
  step: string;
  progress: number;
  message: string;
  status: string;
}

interface ProgressEvent {
  stage: string;
  status: 'started' | 'progress' | 'finished' | 'failed' | 'mirror-fallback' | 'detail';
  percent?: number;
  message: string;
}

/** 与后端 `OpenClawCnStatus`（camelCase）对齐 */
interface OpenClawCnStatus {
  coreReady: boolean;
  depsReady: boolean;
  fullyReady: boolean;
  version: string | null;
  openclawDir: string;
}

/** 与后端 `OpenClawInstallStatus`（camelCase）对齐 */
interface OpenClawInstallStatus {
  npmInstallRunning: boolean;
  npmInstallDone: boolean;
  npmInstallFailed: boolean;
  npmInstallError: string | null;
  markerPath: string | null;
}

const STAGE_LABELS: Record<string, string> = {
  'openclaw-install': '安装',
  'openclaw-pkg': '① 获取程序包',
  'openclaw-deps': '② 安装依赖（node_modules）',
  'openclaw-init': '③ 初始化',
  // 旧版后端曾统一用 install
  install: '安装',
  init: '初始化',
};

function logTime(): string {
  const d = new Date();
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function statusColor(status: string): string {
  switch (status) {
    case 'finished': return 'text-green-600';
    case 'failed': return 'text-red-600';
    case 'mirror-fallback': return 'text-yellow-600';
    case 'detail': return 'text-slate-600';
    default: return 'text-blue-600';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'finished': return 'bg-green-50 border-green-200';
    case 'failed': return 'bg-red-50 border-red-200';
    case 'mirror-fallback': return 'bg-yellow-50 border-yellow-200';
    case 'detail': return 'bg-slate-50 border-slate-200';
    default: return 'bg-blue-50 border-blue-200';
  }
}

export default function OpenClawInstall({ onNext, onPrev }: Props) {
  const [installing, setInstalling] = useState(false);
  const [backgroundMode, setBackgroundMode] = useState(false);
  const [bgPollInterval, setBgPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [liveProgress, setLiveProgress] = useState<ProgressEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [dataDir, setDataDir] = useState<string | null>(null);
  const [cnStatus, setCnStatus] = useState<OpenClawCnStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const logEndRef = useRef<HTMLDivElement>(null);

  const refreshCnStatus = useCallback(() => {
    setStatusLoading(true);
    invoke<OpenClawCnStatus>('get_openclaw_cn_status')
      .then((s) => {
        setCnStatus(s);
        setInstalled(s.fullyReady);
      })
      .catch(() => {
        setCnStatus(null);
      })
      .finally(() => setStatusLoading(false));
  }, []);

  // 轮询后台安装状态
  const startBgPoll = useCallback(() => {
    const interval = setInterval(async () => {
      try {
        const status = await invoke<OpenClawInstallStatus>('get_openclaw_install_status');
        if (status.npmInstallDone && !status.npmInstallFailed) {
          // 安装完成
          clearInterval(interval);
          setBgPollInterval(null);
          setBackgroundMode(false);
          setInstalling(false);
          refreshCnStatus();
          setLogs(prev => [...prev, `[${logTime()}] [local] 后台安装完成，检测到 node_modules 就绪`]);
        } else if (status.npmInstallFailed) {
          // 安装失败
          clearInterval(interval);
          setBgPollInterval(null);
          setBackgroundMode(false);
          setInstalling(false);
          setError(status.npmInstallError || '后台 npm install 失败');
        }
      } catch {
        // 忽略轮询错误，继续轮询
      }
    }, 5000); // 每 5 秒轮询一次
    setBgPollInterval(interval);
  }, [refreshCnStatus]);

  useEffect(() => {
    return () => {
      if (bgPollInterval) clearInterval(bgPollInterval);
    };
  }, [bgPollInterval]);

  useEffect(() => {
    let cancelled = false;
    invoke<string>('get_data_dir')
      .then((dir) => {
        if (!cancelled) setDataDir(dir);
      })
      .catch(() => {
        if (!cancelled) setDataDir(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    refreshCnStatus();
  }, [refreshCnStatus]);

  useEffect(() => {
    const onBridge = (e: Event) => {
      const ev = (e as CustomEvent<InstallProgressPayload>).detail;
      if (!ev.stage.startsWith('openclaw-')) return;
      setLiveProgress(ev as ProgressEvent);
      const t = logTime();
      if (ev.status === 'detail') {
        setLogs((prev) => [...prev, `[${t}] ${ev.message}`]);
      } else {
        setLogs((prev) => [...prev, `[${t}] [${ev.status}] ${ev.message}`]);
      }
    };
    window.addEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);
    return () => {
      window.removeEventListener(INSTALL_PROGRESS_DOM_EVENT, onBridge as EventListener);
    };
  }, []);

  // 自动滚动日志
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  /** 安装耗时较长时，即使 Tauri 事件偶发延迟，也定时提示用户并非死机 */
  useEffect(() => {
    if (!installing) return;
    const id = window.setInterval(() => {
      setLogs((prev) => [
        ...prev,
        `[${logTime()}] [local] 仍在等待后端…（拉包/删目录/npm 可能静默数分钟，详见数据目录 logs/app.log）`,
      ]);
    }, 45_000);
    return () => window.clearInterval(id);
  }, [installing]);

  const startInstall = async (forceReinstall = false, background = false) => {
    setInstalled(false);
    setInstalling(true);
    setError(null);
    setProgress([]);
    setLiveProgress({
      stage: 'openclaw-install',
      status: 'started',
      message: '正在请求后端执行安装…',
    });
    setLogs([
      `[${logTime()}] [local] 已发起安装（进度由向导页统一转发，无需再注册监听）`,
      `[${logTime()}] [local] 正在调用 install_openclaw…${forceReinstall ? '（强制重装）' : ''}${background ? '（后台模式）' : ''}`,
    ]);

    try {
      if (background) {
        // 后台模式：启动后台安装，立即返回
        const result = await invoke<string>('start_openclaw_background_install', {
          version: null,
          forceReinstall,
        });
        setLogs(prev => [...prev, `[${logTime()}] [local] 后台安装已启动: ${result}`]);
        setBackgroundMode(true);
        // 立即开始轮询
        startBgPoll();
        setInstalling(false); // 安装中但不在 waiting 状态
        setProgress([{
          step: 'openclaw-pkg',
          progress: 100,
          message: '程序包解压/下载完成',
          status: 'success',
        }, {
          step: 'openclaw-deps',
          progress: 0,
          message: 'npm install 正在后台运行（node_modules 安装中，可继续其他配置步骤）',
          status: 'running',
        }]);
      } else {
        // 同步模式：等待安装完成
        const result = await invoke<Progress[]>('install_openclaw', {
          version: null,
          forceReinstall,
        });
        setProgress(result);
        const allSuccess = result.every((p) => p.status === 'success' || p.status === 'skipped');
        if (allSuccess) {
          setInstalled(true);
        } else {
          const failed = result.find((p) => p.status === 'error');
          if (failed) setError(failed.message);
        }
        setInstalling(false);
        refreshCnStatus();
      }
    } catch (e) {
      console.error('Install error:', e);
      setError(String(e));
      setInstalling(false);
    }
  };

  const getIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'running': return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      default: return null;
    }
  };

  const getBgClass = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-50 border-green-200';
      case 'error': return 'bg-red-50 border-red-200';
      case 'running': return 'bg-blue-50 border-blue-200';
      case 'skipped': return 'bg-gray-50 border-gray-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  const stepLabel = (step: string) => {
    return STAGE_LABELS[step] ?? step;
  };

  // 计算总体进度（用于初始进入时）
  const currentProgress = progress.length > 0
    ? Math.round(progress.reduce((sum, p) => sum + p.progress, 0) / progress.length)
    : liveProgress?.percent ?? 0;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">安装 OpenClaw-CN</h2>
        <p className="text-gray-600">
          {installing
            ? '正在执行：拉取包 → 安装依赖，请稍候…'
            : '分两步：先把 openclaw-cn 包放到数据目录，再在该目录执行 npm/pnpm install 生成 node_modules'}
        </p>
        {dataDir && (
          <p className="text-xs text-slate-500 mt-2 max-w-2xl mx-auto break-all space-y-0.5">
            <span>本应用托管数据目录（与系统自带 Node/Git 路径无关）：</span>
            <span className="font-mono text-slate-600">{dataDir.replace(/\\/g, '/')}</span>
            <br />
            <span>OpenClaw-CN 仓库：</span>
            <span className="font-mono text-blue-600">{`${dataDir.replace(/\\/g, '/')}/openclaw-cn`}</span>
            <span>，Node/Git（如需安装）：</span>
            <span className="font-mono text-blue-600">{`${dataDir.replace(/\\/g, '/')}/env/`}</span>
          </p>
        )}
      </div>

      {statusLoading && (
        <div className="flex justify-center py-4 text-sm text-slate-500">
          <Loader2 className="w-4 h-4 animate-spin mr-2 mt-0.5" />
          正在检测本机 OpenClaw-CN 安装状态…
        </div>
      )}

      {!statusLoading && cnStatus?.fullyReady && !installing && progress.length === 0 && (
        <div className="rounded-xl border border-green-200 bg-green-50 p-4 text-left max-w-2xl mx-auto">
          <div className="flex items-start gap-3">
            <CheckCircle className="w-6 h-6 text-green-600 shrink-0 mt-0.5" />
            <div className="text-sm text-green-900 space-y-1">
              <p className="font-medium">检测到 OpenClaw-CN 已完整安装，可直接进入下一步。</p>
              <p className="text-green-800/90">
                版本 {cnStatus.version ?? '未知'}；入口与 node_modules 已就绪。
              </p>
              <p className="text-xs text-green-800/80 break-all font-mono">{cnStatus.openclawDir}</p>
              <p className="text-xs text-green-800/70 pt-1">
                若你刚替换过程序包或依赖损坏，可点击「重新安装」强制拉包并执行 npm/pnpm install。
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 后台安装模式指示器 */}
      {backgroundMode && !installed && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-left max-w-2xl mx-auto">
          <div className="flex items-start gap-3">
            <Loader2 className="w-6 h-6 text-blue-500 shrink-0 mt-0.5 animate-spin" />
            <div className="text-sm text-blue-900 space-y-1">
              <p className="font-medium">OpenClaw-CN 正在后台安装（npm install 运行中）</p>
              <p className="text-blue-800/90">
                node_modules 正在后台补全，无需等待安装完成即可继续其他配置步骤。
              </p>
              <p className="text-blue-800/80 text-xs">
                系统每 5 秒自动检测安装状态，完成后自动刷新状态。
                {cnStatus && !cnStatus.fullyReady && ' 你也可以先配置模型等步骤，安装完成后再回来。'}
              </p>
            </div>
          </div>
        </div>
      )}

      {!statusLoading && cnStatus && !cnStatus.fullyReady && !installing && progress.length === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-left max-w-2xl mx-auto text-sm text-amber-950">
          <p className="font-medium mb-1">未检测到完整安装</p>
          <ul className="list-disc pl-5 space-y-0.5 text-amber-900/90">
            <li>程序入口 dist/entry.js：{cnStatus.coreReady ? '已存在' : '缺失或损坏'}</li>
            <li>依赖 node_modules：{cnStatus.depsReady ? '已就绪' : '缺失或不完整'}</li>
          </ul>
          <p className="mt-2 text-xs text-amber-900/80">请点击下方「开始安装」完成拉包与依赖安装。</p>
        </div>
      )}

      {/* 初始状态 */}
      {!installing && progress.length === 0 && !error && !backgroundMode && (
        <div className="text-center py-8">
          <div className="mb-6">
            {!cnStatus?.fullyReady && (
              <div className="w-20 h-20 mx-auto bg-blue-100 rounded-full flex items-center justify-center mb-4">
                <span className="text-4xl">🚀</span>
              </div>
            )}
            <p className="text-gray-600 mb-2">
              {cnStatus?.fullyReady
                ? '无需重复安装时可直接点「下一步」；需要修复时再执行安装。'
                : '点击下方按钮开始安装 OpenClaw-CN（已安装完整时会自动跳过拉包与重复 npm install）'}
            </p>
            {!cnStatus?.fullyReady && (
              <p className="text-amber-600 text-sm">
                提示：推荐使用「后台安装」，npm install 会在后台运行，可同时配置其他步骤
              </p>
            )}
          </div>
          <div className="flex flex-col items-center gap-3">
            {!cnStatus?.fullyReady && (
              <>
                <button
                  type="button"
                  onClick={() => startInstall(Boolean(cnStatus?.fullyReady), true)}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-2 px-8 py-3 bg-green-500 text-white rounded-lg font-medium hover:bg-green-600 transition-colors disabled:opacity-50"
                >
                  <Loader2 className="w-4 h-4 animate-spin hidden" />
                  <span>后台安装（推荐）</span>
                </button>
                <div className="text-gray-400 text-sm">— 或 —</div>
                <button
                  type="button"
                  onClick={() => startInstall(Boolean(cnStatus?.fullyReady), false)}
                  disabled={statusLoading}
                  className="inline-flex items-center gap-2 px-8 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
                >
                  同步安装（等待完成）
                </button>
              </>
            )}
            {cnStatus?.fullyReady && (
              <button
                type="button"
                onClick={() => startInstall(true, false)}
                disabled={statusLoading}
                className="inline-flex items-center gap-2 px-8 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                <RefreshCw className="w-4 h-4" />
                重新安装 / 修复
              </button>
            )}
            {!statusLoading && (
              <button
                type="button"
                onClick={() => refreshCnStatus()}
                className="px-4 py-3 border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-sm"
              >
                刷新检测
              </button>
            )}
          </div>
        </div>
      )}

      {/* 安装中状态 */}
      {installing && (
        <div className="py-6 space-y-4">
          {/* 顶部实时进度条 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {liveProgress ? (
                  <>
                    <Loader2 className={`w-4 h-4 animate-spin ${statusColor(liveProgress.status)}`} />
                    <span className="text-sm font-medium text-gray-700">
                      {stepLabel(liveProgress.stage) ?? liveProgress.stage}
                    </span>
                  </>
                ) : (
                  <>
                    <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />
                    <span className="text-sm text-gray-700">准备中…</span>
                  </>
                )}
              </div>
              <span className={`text-xs font-medium ${statusColor(liveProgress?.status ?? 'started')}`}>
                {liveProgress?.status === 'progress'
                  ? `${Math.round(liveProgress.percent ?? 0)}%`
                  : liveProgress?.status === 'mirror-fallback'
                  ? '切换镜像…'
                  : liveProgress?.status === 'finished'
                  ? '完成'
                  : liveProgress?.status === 'failed'
                  ? '失败'
                  : liveProgress?.status === 'detail'
                  ? '实时输出'
                  : '进行中'}
              </span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              {liveProgress?.status === 'progress' && liveProgress.percent !== undefined ? (
                <div
                  className="h-2 rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${liveProgress.percent}%` }}
                />
              ) : (
                <div className="h-2 rounded-full bg-blue-400 animate-pulse w-2/3" />
              )}
            </div>
            {liveProgress && liveProgress.status !== 'detail' && (
              <div className={`text-xs ${statusColor(liveProgress.status)}`}>{liveProgress.message}</div>
            )}
            {liveProgress?.status === 'detail' && (
              <div className="text-xs text-slate-600 font-mono break-all">{liveProgress.message}</div>
            )}
          </div>

          {/* 当前阶段卡片（安装过程中 progress 通常为空，完成后才有条目） */}
          {progress.map((item, idx) => (
            <div
              key={`${item.step}-${idx}-${item.message.slice(0, 20)}`}
              className={`flex items-center p-4 rounded-lg border ${getBgClass(item.status)}`}
            >
              {getIcon(item.status)}
              <div className="ml-3 flex-1">
                <div className="font-medium text-gray-900">{stepLabel(item.step)}</div>
                <div className="text-sm text-gray-500">{item.message}</div>
              </div>
              {item.status === 'running' && (
                <div className="text-sm text-blue-500">{Math.round(item.progress)}%</div>
              )}
            </div>
          ))}

          {/* 实时日志：安装开始即展示，避免长时间无反馈 */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs font-mono text-slate-800 max-h-48 overflow-y-auto min-h-[6rem]">
            <div className="text-slate-500 mb-2 font-sans text-[11px]">安装日志（含 npm / 包管理器阶段输出与心跳）</div>
            {logs.map((line, i) => (
              <div key={i} className="break-all">{line}</div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {/* 安装完成（已有历史进度） */}
      {!installing && progress.length > 0 && (
        <div className="space-y-3">
          {progress.map((item, idx) => (
            <div
              key={`${item.step}-${idx}-${item.message.slice(0, 20)}`}
              className={`flex items-center p-4 rounded-lg border ${getBgClass(item.status)}`}
            >
              {getIcon(item.status)}
              <div className="ml-3 flex-1">
                <div className="font-medium text-gray-900">{stepLabel(item.step)}</div>
                <div className="text-sm text-gray-500">{item.message}</div>
              </div>
              {item.status === 'running' && (
                <div className="text-sm text-blue-500">{Math.round(item.progress)}%</div>
              )}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 space-y-3">
          <div className="text-red-700 font-medium mb-1">安装失败</div>
          <div className="text-red-600 text-sm whitespace-pre-wrap break-words font-mono">{error}</div>
          {getNpmErrorHint(error) && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded p-3 text-sm text-amber-800">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{getNpmErrorHint(error)}</span>
            </div>
          )}
          <div className="text-xs text-gray-500 border-t border-gray-200 pt-2">
            若问题持续，请打开「数据目录\logs\app.log」查看详细后端日志，或截图发给开发者。
          </div>
          {!installing && (
            <button
              type="button"
              onClick={() => startInstall(true)}
              className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
            >
              强制重装
            </button>
          )}
        </div>
      )}

      <div className="flex justify-between items-center pt-4 border-t">
        <button
          onClick={onPrev}
          disabled={installing && !backgroundMode}
          className="px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50"
        >
          上一步
        </button>

        {/* 后台模式时，显示「跳过，先配置其他」按钮 */}
        {backgroundMode && !installed && (
          <div className="flex gap-2">
            <button
              onClick={() => {
                if (bgPollInterval) clearInterval(bgPollInterval);
                setBackgroundMode(false);
                onNext();
              }}
              className="px-4 py-2 rounded-lg font-medium transition-colors bg-amber-100 text-amber-700 hover:bg-amber-200"
            >
              跳过，先配置其他步骤
            </button>
          </div>
        )}

        <button
          onClick={onNext}
          disabled={!installed}
          className={`
            px-6 py-2 rounded-lg font-medium transition-colors
            ${!installed
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-500 text-white hover:bg-blue-600'
            }
          `}
        >
          {installed ? '下一步' : (backgroundMode ? '等待后台安装完成…' : '请先完成安装')}
        </button>
      </div>
    </div>
  );
}
