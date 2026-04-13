import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { INSTALL_PROGRESS_DOM_EVENT, InstallProgressPayload } from '../../utils/installProgressBridge';
import { CheckCircle, XCircle, AlertCircle, RefreshCw, Download, Loader2, GitBranch } from 'lucide-react';

interface EnvItem {
  name: string;
  version?: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  required: boolean;
}

interface ProgressEvent {
  stage: string;
  status: 'started' | 'progress' | 'finished' | 'failed' | 'mirror-fallback' | 'detail';
  percent?: number;
  message: string;
}

interface Props {
  onNext: () => void;
}

// 阶段中文映射
const STAGE_LABELS: Record<string, string> = {
  'homebrew': 'Homebrew',
  'node': 'Node.js',
  'git': 'Git',
  'pnpm': 'pnpm',
  'openclaw-install': 'OpenClaw-CN',
  'openclaw-deps': 'OpenClaw-CN 依赖',
  'default': '安装',
};

function stageLabel(stage: string): string {
  for (const [key, label] of Object.entries(STAGE_LABELS)) {
    if (stage.includes(key)) return label;
  }
  return STAGE_LABELS['default'];
}

function statusColor(status: string): string {
  switch (status) {
    case 'finished': return 'text-green-600';
    case 'failed': return 'text-red-600';
    case 'mirror-fallback': return 'text-yellow-600';
    default: return 'text-blue-600';
  }
}

function statusBg(status: string): string {
  switch (status) {
    case 'finished': return 'bg-green-50 border-green-200';
    case 'failed': return 'bg-red-50 border-red-200';
    case 'mirror-fallback': return 'bg-yellow-50 border-yellow-200';
    default: return 'bg-blue-50 border-blue-200';
  }
}

export default function EnvCheck({ onNext }: Props) {
  const [items, setItems] = useState<EnvItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [progress, setProgress] = useState<ProgressEvent | null>(null);
  const [logs, setLogs] = useState<{ time: string; stage: string; status: string; message: string }[]>([]);
  const [dataDir, setDataDir] = useState<string>('');
  const logEndRef = useRef<HTMLDivElement>(null);

  const checkEnv = async () => {
    setLoading(true);
    try {
      const result = await invoke<{ items: EnvItem[]; success: boolean }>('run_env_check');
      setItems(result.items);
      setHasError(!result.success);
    } catch (e) {
      console.error('Env check error:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    invoke<string>('get_data_dir')
      .then(setDataDir)
      .catch(() => setDataDir(''));
    checkEnv();

    const onBridge = (e: Event) => {
      const ev = (e as CustomEvent<InstallProgressPayload>).detail;
      setProgress(ev as ProgressEvent);
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      setLogs((prev) => [...prev, {
        time: timeStr,
        stage: stageLabel(ev.stage),
        status: ev.status,
        message: ev.message,
      }]);
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

  const runAutoFix = async () => {
    setFixing(true);
    setLogs([]);
    setProgress(null);
    try {
      const result = await invoke<{ ok: boolean; messages: string[] }>('run_env_auto_fix');
      // run_env_auto_fix 的 messages 是最终汇总，也追加到日志
      for (const msg of result.messages) {
        const now = new Date();
        const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
        setLogs((prev) => [...prev, { time: timeStr, stage: '汇总', status: result.ok ? 'finished' : 'failed', message: msg }]);
      }
      await checkEnv();
    } catch (e) {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;
      setLogs((prev) => [...prev, { time: timeStr, stage: '错误', status: 'failed', message: `执行失败: ${String(e)}` }]);
    }
    setFixing(false);
  };

  const getIcon = (status: string) => {
    switch (status) {
      case 'success': return <CheckCircle className="w-5 h-5 text-green-500" />;
      case 'error': return <XCircle className="w-5 h-5 text-red-500" />;
      case 'warning': return <AlertCircle className="w-5 h-5 text-yellow-500" />;
      default: return null;
    }
  };

  const getBgClass = (status: string) => {
    switch (status) {
      case 'success': return 'bg-green-50 border-green-200';
      case 'error': return 'bg-red-50 border-red-200';
      case 'warning': return 'bg-yellow-50 border-yellow-200';
      default: return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">环境检测</h2>
        <p className="text-gray-600">检测系统环境，确保满足运行要求</p>
        {dataDir && (
          <p className="mt-1 text-xs text-gray-400 break-all">
            数据目录（Node/Git 将安装于此）：{dataDir}
          </p>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-8 h-8 text-blue-500 animate-spin" />
          <span className="ml-3 text-gray-600">正在检测环境...</span>
        </div>
      ) : (
        <>
          <div className="space-y-3">
            {items.map((item, idx) => (
              <div
                key={idx}
                className={`flex items-center justify-between p-4 rounded-lg border ${getBgClass(item.status)}`}
              >
                <div className="flex items-center space-x-3">
                  {getIcon(item.status)}
                  <div>
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {item.version && (
                      <div className="text-sm text-gray-500">版本: {item.version}</div>
                    )}
                  </div>
                </div>
                <div className="text-sm text-right">
                  <div className={`
                    ${item.status === 'success' ? 'text-green-700' : ''}
                    ${item.status === 'error' ? 'text-red-700' : ''}
                    ${item.status === 'warning' ? 'text-yellow-700' : ''}
                  `}>
                    {item.message}
                  </div>
                  {item.required && item.status !== 'success' && (
                    <div className="text-xs text-red-500 mt-1">* 必需组件</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── 实时进度条 ─────────────────────────────── */}
          {fixing && progress && (
            <div className={`rounded-lg border p-4 ${statusBg(progress.status)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center space-x-2">
                  <Loader2 className={`w-4 h-4 animate-spin ${statusColor(progress.status)}`} />
                  <span className="font-medium text-sm">{stageLabel(progress.stage)}</span>
                </div>
                <span className={`text-xs font-medium ${statusColor(progress.status)}`}>
                  {progress.status === 'started' && '准备中…'}
                  {progress.status === 'progress' && `${Math.round(progress.percent ?? 0)}%`}
                  {progress.status === 'finished' && '完成'}
                  {progress.status === 'failed' && '失败'}
                  {progress.status === 'mirror-fallback' && '切换镜像…'}
                </span>
              </div>
              {/* 进度条：有 percent 时显示精确进度，否则 indeterminate */}
              <div className="w-full bg-gray-200 rounded-full h-1.5">
                {progress.status === 'progress' && progress.percent !== undefined ? (
                  <div
                    className={`h-1.5 rounded-full transition-all duration-500 ${
                      progress.status === 'progress' ? 'bg-blue-500' : ''
                    }`}
                    style={{ width: `${progress.percent}%` }}
                  />
                ) : (
                  <div className="h-1.5 rounded-full bg-blue-400 animate-pulse w-1/3" />
                )}
              </div>
              <div className={`mt-1 text-xs ${statusColor(progress.status)}`}>{progress.message}</div>
            </div>
          )}

          {/* ── 安装日志 ───────────────────────────────── */}
          {logs.length > 0 && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
              <div className="font-medium mb-2 flex items-center gap-1">
                <GitBranch className="w-3.5 h-3.5" />
                安装日志
              </div>
              <div className="space-y-0.5 max-h-48 overflow-y-auto">
                {logs.map((log, i) => (
                  <div key={i} className="flex gap-2 text-xs font-mono">
                    <span className="text-gray-400 shrink-0">{log.time}</span>
                    <span className={`shrink-0 font-medium ${statusColor(log.status)}`}>
                      [{log.stage}]
                    </span>
                    <span className="text-gray-700 break-all">{log.message}</span>
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 justify-between items-center pt-4 border-t">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={checkEnv}
                disabled={fixing}
                className="flex items-center px-4 py-2 text-gray-600 hover:text-gray-900 disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${fixing ? 'animate-spin' : ''}`} />
                重新检测
              </button>
              <button
                type="button"
                onClick={runAutoFix}
                disabled={fixing}
                className="flex items-center px-4 py-2 rounded-lg border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                title="下载并安装缺失的组件，支持国内镜像自动切换（可能弹出 UAC）"
              >
                <Download className="w-4 h-4 mr-2" />
                {fixing ? '正在安装…' : '一键安装缺失组件'}
              </button>
            </div>

            <button
              onClick={onNext}
              disabled={hasError}
              className={`
                px-6 py-2 rounded-lg font-medium transition-colors
                ${hasError
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-500 text-white hover:bg-blue-600'
                }
              `}
            >
              {hasError ? '请先解决环境问题' : '下一步'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
