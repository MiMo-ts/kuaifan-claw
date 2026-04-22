import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  Settings, FolderOpen, Database, RefreshCw, Play, Square,
  ChevronRight, Plus, Bot, Plug, BarChart3, ArrowLeft, Monitor, Loader2, Download, X,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { checkForUpdate, downloadAndInstallUpdate, UpdateProgress } from '../utils/updater';

interface GatewayStatus {
  running: boolean;
  version?: string;
  port: number;
  uptime_seconds: number;
  memory_mb: number;
  instances_running?: number;
}

interface Instance {
  id: string;
  name: string;
  enabled: boolean;
  robot_id: string;
  channel_type: string;
  message_count: number;
}

export default function HomePage() {
  const navigate = useNavigate();
  const { wizardCompleted, gatewayRunning, setGatewayRunning } = useAppStore();
  const [gatewayStatus, setGatewayStatus] = useState<GatewayStatus | null>(null);
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);
  const [dataDir, setDataDir] = useState<string>('');
  const [hydrated, setHydrated] = useState(false);
  const [defaultModel, setDefaultModel] = useState<{provider?: string; model_name?: string} | null>(null);
  /** 启动/停止网关进行中，避免重复点击并配合 Toast 提示 */
  const [gatewayBusy, setGatewayBusy] = useState(false);
  /** 更新状态 */
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [updateVersion, setUpdateVersion] = useState('');
  const [updateNotes, setUpdateNotes] = useState('');
  const [updateProgress, setUpdateProgress] = useState<UpdateProgress | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    if (useAppStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    return unsub;
  }, []);

  useEffect(() => {
    invoke<string>('get_data_dir').then(d => setDataDir(d)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (!wizardCompleted) {
      navigate('/', { replace: true });
      return;
    }
    loadData();
  }, [hydrated, wizardCompleted, navigate]);

  /** 网关进程崩溃或端口被占后，状态文件可能仍显示「运行中」；定时探测 TCP 与状态文件，避免界面长期不同步 */
  useEffect(() => {
    if (!hydrated || !wizardCompleted) return;
    const poll = async () => {
      if (gatewayBusy) return;
      try {
        const status = await invoke<GatewayStatus>('get_gateway_status');
        setGatewayStatus(status);
        setGatewayRunning(status.running);
      } catch {
        /* 忽略瞬时错误，避免打断操作 */
      }
    };
    const id = window.setInterval(poll, 5000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void poll();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [hydrated, wizardCompleted, gatewayBusy]);

  /** 检查更新 */
  useEffect(() => {
    if (!hydrated) return;
    const doCheck = async () => {
      try {
        const info = await checkForUpdate();
        if (info.available) {
          setUpdateAvailable(true);
          setUpdateVersion(info.version || '');
          setUpdateNotes(info.body || '');
        }
      } catch {
        /* 忽略更新检查失败 */
      }
    };
    // 启动 3 秒后检查一次，不阻塞主流程
    const t = window.setTimeout(doCheck, 3000);
    return () => window.clearTimeout(t);
  }, [hydrated]);

  /** 触发更新下载 */
  const handleUpdate = async () => {
    if (isUpdating) return;
    setIsUpdating(true);
    try {
      await downloadAndInstallUpdate((progress) => {
        setUpdateProgress(progress);
      });
      // relaunch 后应用会重启，这里不需要做其他处理
    } catch (e) {
      toast.error(`更新失败: ${e}`);
      setIsUpdating(false);
      setUpdateProgress(null);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [status, instList, dm] = await Promise.all([
        invoke<GatewayStatus>('get_gateway_status'),
        invoke<Instance[]>('list_instances'),
        invoke<{provider?: string; model_name?: string}>('get_default_model').catch(() => null),
      ]);
      setGatewayStatus(status);
      setGatewayRunning(status.running);
      setInstances(instList);
      setDefaultModel(dm);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`加载数据失败：${msg}`);
      console.error('Load data error:', e);
    }
    setLoading(false);
  };

  const handleStartGateway = async () => {
    if (gatewayBusy) return;
    setGatewayBusy(true);
    // 使用 custom toast 显示加载状态，带手动关闭按钮
    const tid = toast.custom(
      (t) => (
        <div className={`flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 shadow-lg max-w-md ${t.visible ? 'animate-in' : 'animate-out'}`}>
          <Loader2 className="w-5 h-5 text-blue-500 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-blue-800 font-medium">正在启动网关…</div>
            <div className="text-xs text-blue-600 mt-0.5">
              同步配置、通道插件自检、清端口、等监听。插件齐全时约 10～40 秒；若正在补全微信等插件的 npm/编译，首启可达数分钟。
            </div>
          </div>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="shrink-0 p-1 hover:bg-blue-100 rounded-lg transition-colors"
            title="关闭提示"
          >
            <X className="w-4 h-4 text-blue-500" />
          </button>
        </div>
      ),
      { id: 'gateway-start', duration: Infinity }
    );
    try {
      const result = await invoke<string>('start_gateway');
      setGatewayRunning(true);
      setGatewayStatus(prev => (prev ? { ...prev, running: true } : null));
      toast.dismiss(tid);
      toast.success(result || '网关已启动', { duration: 4000 });
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.dismiss(tid);
      if (msg.includes('未配置默认大模型') || msg.includes('models.yaml')) {
        toast.error(
          <span>
            网关启动失败：{msg.includes('未配置默认大模型') ? '未配置默认大模型' : '缺少模型配置'}
            <br />
            <button
              className="underline mt-1 text-blue-600"
              onClick={() => navigate('/models')}
            >
              前往「大模型配置」→
            </button>
          </span>,
          { duration: 8000 }
        );
      } else {
        toast.error(`启动失败：${msg}`, { duration: 6000 });
      }
      console.error('Start gateway error:', e);
    } finally {
      setGatewayBusy(false);
    }
  };

  const handleStopGateway = async () => {
    if (gatewayBusy) return;
    setGatewayBusy(true);
    // 使用 custom toast 显示加载状态，带手动关闭按钮
    const tid = toast.custom(
      (t) => (
        <div className={`flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 shadow-lg max-w-md ${t.visible ? 'animate-in' : 'animate-out'}`}>
          <Loader2 className="w-5 h-5 text-amber-500 animate-spin shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-amber-800 font-medium">正在停止网关…</div>
            <div className="text-xs text-amber-600 mt-0.5">
              结束进程并释放端口，约 1～5 秒
            </div>
          </div>
          <button
            onClick={() => toast.dismiss(t.id)}
            className="shrink-0 p-1 hover:bg-amber-100 rounded-lg transition-colors"
            title="关闭提示"
          >
            <X className="w-4 h-4 text-amber-500" />
          </button>
        </div>
      ),
      { id: 'gateway-stop', duration: Infinity }
    );
    try {
      const result = await invoke<string>('stop_gateway');
      setGatewayRunning(false);
      setGatewayStatus(prev => (prev ? { ...prev, running: false } : null));
      toast.dismiss(tid);
      toast.success(result || '网关已停止', { duration: 4000 });
      await loadData();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.dismiss(tid);
      toast.error(`停止失败：${msg}`, { duration: 6000 });
      console.error('Stop gateway error:', e);
    } finally {
      setGatewayBusy(false);
    }
  };

  const formatUptime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return h > 0 ? `${h}小时${m}分钟` : `${m}分钟`;
  };

  if (!hydrated) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">加载中...</p>
      </div>
    );
  }

  if (!wizardCompleted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">正在进入向导...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => navigate('/wizard')}
              title="重新进入向导"
              className="p-2 text-gray-500 hover:text-gray-700"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">快泛claw</h1>
              <p className="text-sm text-gray-500">一站式安装与管理系统</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="设置"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Update available banner */}
      {updateAvailable && (
        <div className="bg-blue-50 border-b border-blue-200">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center">
                <Download className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-medium text-blue-900">
                  发现新版本 v{updateVersion}
                </div>
                {updateNotes && (
                  <div className="text-xs text-blue-700 mt-0.5 line-clamp-1">{updateNotes}</div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-3">
              {isUpdating && updateProgress && (
                <div className="text-xs text-blue-700">
                  下载中 {updateProgress.percentage}%
                </div>
              )}
              <button
                type="button"
                onClick={handleUpdate}
                disabled={isUpdating}
                className="px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-1.5"
              >
                {isUpdating ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    更新中…
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4" />
                    更新
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Gateway status banner — always visible, color-coded */}
        <div className={`rounded-xl border-l-4 shadow-sm mb-6 p-4 flex items-center gap-4
          ${gatewayRunning
            ? 'bg-green-50 border-green-500'
            : 'bg-amber-50 border-amber-400'}`}
        >
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0
            ${gatewayRunning ? 'bg-green-100' : 'bg-amber-100'}`}>
            <div className={`w-3 h-3 rounded-full ${gatewayRunning ? 'bg-green-500' : 'bg-amber-400'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-base ${gatewayRunning ? 'text-green-800' : 'text-amber-800'}`}>
              OpenClaw 网关 · {gatewayRunning ? '运行中' : '已停止'}
            </div>
            {gatewayRunning && gatewayStatus && (
              <div className="text-sm text-green-700 mt-0.5">
                端口 {gatewayStatus.port} · 已运行 {formatUptime(gatewayStatus.uptime_seconds)} · 内存 {gatewayStatus.memory_mb.toFixed(0)} MB · {gatewayStatus.instances_running ?? instances.length} 个实例
                {gatewayStatus.version && <span className="ml-2 text-green-600/70">v{gatewayStatus.version}</span>}
              </div>
            )}
            {!gatewayRunning && (
              <div className="text-sm text-amber-700 mt-0.5">
                点击下方「启动网关」开启 OpenClaw-CN 网关进程
              </div>
            )}
          </div>
          <div className="flex gap-2 shrink-0">
            {gatewayRunning ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    invoke<string>('open_openclaw_console')
                      .then((msg) => toast.success(msg || '已打开'))
                      .catch((e) => toast.error(String(e)));
                  }}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 flex items-center gap-1.5"
                >
                  <Monitor className="w-4 h-4" />
                  控制台
                </button>
                <button
                  type="button"
                  onClick={handleStopGateway}
                  disabled={gatewayBusy}
                  className="px-3 py-1.5 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {gatewayBusy ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Square className="w-4 h-4" />
                  )}
                  {gatewayBusy ? '停止中…' : '停止'}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={handleStartGateway}
                disabled={gatewayBusy}
                className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 flex items-center gap-1.5 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {gatewayBusy ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {gatewayBusy ? '启动中…' : '启动网关'}
              </button>
            )}
            <button
              type="button"
              onClick={loadData}
              disabled={gatewayBusy}
              title={gatewayBusy ? '网关操作中，请稍候' : '刷新状态'}
              className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50 flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-4 h-4 ${gatewayBusy ? 'opacity-50' : ''}`} />
            </button>
          </div>
        </div>

        {/* Help hint when gateway is running */}
        {gatewayRunning && (
          <div className="mb-6 px-4 py-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 space-y-1">
            <div className="font-medium">使用提示</div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">LLM 无回复</span>
              <span>请确认已在「<button type="button" onClick={() => navigate('/models')} className="underline hover:no-underline">大模型配置</button>」保存并<strong>重启网关</strong>后，模型调用才生效。</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-mono text-xs bg-blue-100 px-1.5 py-0.5 rounded shrink-0 mt-0.5">Control UI token_mismatch</span>
              <span>这是网关会话 Token（与 LLM API Key 不同），请在控制台右上角设置中填入与管理器一致的 Token，或重新启动网关生成新 Token。</span>
            </div>
          </div>
        )}

        {defaultModel?.provider && defaultModel?.model_name && (
          <div className="mb-6 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-700 flex items-center justify-between">
            <div>
              当前默认模型：<span className="font-medium">{defaultModel.provider}</span>
              {' / '}
              <span className="font-medium">{defaultModel.model_name}</span>
            </div>
            <button
              type="button"
              onClick={() => navigate('/models')}
              className="underline hover:no-underline text-blue-600"
            >
              修改
            </button>
          </div>
        )}

        {/* Quick Actions */}
        <div className="grid grid-cols-2 md:grid-cols-8 gap-4 mb-6">
          {[
            { icon: Plus, label: '创建实例', path: '/instances/new', color: 'bg-blue-500' },
            { icon: Bot, label: '机器人商店', path: '/robots', color: 'bg-purple-500' },
            { icon: Plug, label: '聊天插件', path: '/plugins', color: 'bg-orange-500' },
            { icon: Database, label: '模型配置', path: '/models', color: 'bg-teal-500' },
            {
              icon: FolderOpen, label: 'OpenClaw配置', path: null,
              action: 'open_openclaw_config', color: 'bg-gray-500',
            },
            {
              icon: FolderOpen, label: '管理端配置', path: null,
              action: 'open_manager_config_dir', color: 'bg-gray-400',
            },
            { icon: Database, label: '备份恢复', path: '/backup', color: 'bg-indigo-500' },
            { icon: BarChart3, label: 'Token用量', path: '/usage', color: 'bg-green-500' },
          ].map((item, i) => (
            <button
              type="button"
              key={i}
              onClick={() => {
                if (item.action === 'open_openclaw_config') {
                  invoke<string>('open_openclaw_config')
                    .then((msg) => toast.success(msg || '已打开 OpenClaw 配置文件'))
                    .catch((e) => {
                      toast.error(String(e));
                      console.error(e);
                    });
                } else if (item.action === 'open_manager_config_dir') {
                  invoke<string>('open_manager_config_dir')
                    .then((msg) => toast.success(msg || '已打开管理端配置目录'))
                    .catch((e) => {
                      toast.error(String(e));
                      console.error(e);
                    });
                } else if (item.path) {
                  navigate(item.path);
                }
              }}
              className={`${item.color} text-white rounded-xl p-4 flex flex-col items-center hover:opacity-90 transition-opacity`}
            >
              <item.icon className="w-8 h-8 mb-2" />
              <span className="text-sm font-medium">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Instances List */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">运行中的实例</h2>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => navigate('/instances')}
                className="text-blue-500 hover:text-blue-600 text-sm flex items-center"
              >
                查看全部 <ChevronRight className="w-4 h-4 ml-1" />
              </button>
              <button
                type="button"
                onClick={() => navigate('/instances/new')}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center"
              >
                <Plus className="w-4 h-4 mr-1" />
                新建
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center py-8 text-gray-500">加载中...</div>
          ) : instances.length === 0 ? (
            <div className="text-center py-8">
              <div className="text-gray-400 mb-4">暂无实例</div>
              <button
                type="button"
                onClick={() => navigate('/instances/new')}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                创建第一个实例
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {instances.slice(0, 5).map(inst => (
                <div key={inst.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center">
                    <div className={`w-2 h-2 rounded-full mr-3 ${inst.enabled ? 'bg-green-500' : 'bg-red-500'}`} />
                    <div>
                      <div className="font-medium text-gray-900">{inst.name}</div>
                      <div className="text-sm text-gray-500">{inst.robot_id} · {inst.channel_type}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500">消息: {inst.message_count}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
