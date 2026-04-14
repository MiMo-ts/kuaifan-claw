import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CheckCircle, Loader2, AlertCircle, Server, Wifi } from 'lucide-react';
import toast from 'react-hot-toast';

interface Provider {
  id: string;
  name: string;
  enabled: boolean;
  api_key_configured: boolean;
  free_models_count: number;
  total_models_count: number;
}

interface ModelEntry {
  id: string;
  name: string;
  context_window: number | null;
  is_free: boolean;
  badge: string | null;
}

interface Props {
  onNext: () => void;
  onPrev: () => void;
}

function contextLabel(ctx: number | null): string {
  if (!ctx) return '';
  if (ctx >= 1000000) return `${(ctx / 1000000).toFixed(0)}M`;
  if (ctx >= 1000) return `${(ctx / 1000).toFixed(0)}K`;
  return String(ctx);
}

/** 各供应商控制台文档（便于用户取 Key / 核对模型名） */
const PROVIDER_DOCS: Record<string, { href: string; label: string }> = {
  openrouter: { href: 'https://openrouter.ai/keys', label: 'OpenRouter' },
  openai: { href: 'https://platform.openai.com/api-keys', label: 'OpenAI 控制台' },
  anthropic: { href: 'https://console.anthropic.com/', label: 'Anthropic 控制台' },
  google: { href: 'https://aistudio.google.com/apikey', label: 'Google AI Studio' },
  deepseek: { href: 'https://platform.deepseek.com', label: 'DeepSeek 控制台' },
  minimax: { href: 'https://platform.minimaxi.com/document/guides/models-intro', label: 'MiniMax 模型与 API 文档' },
  volc_ark: { href: 'https://console.volcengine.com/ark', label: '火山方舟控制台' },
  nvidia: { href: 'https://build.nvidia.com/', label: 'NVIDIA Build' },
  aliyun: { href: 'https://dashscope.console.aliyun.com/', label: '阿里云 DashScope' },
  zhipu: { href: 'https://open.bigmodel.cn/', label: '智谱开放平台' },
  moonshot: { href: 'https://platform.moonshot.cn/', label: 'Kimi 开放平台' },
  grok: { href: 'https://console.x.ai/', label: 'xAI Console' },
  baidu: { href: 'https://console.bce.baidu.com/qianfan/', label: '百度千帆' },
  xiaomi: { href: 'https://lmproxy.cn', label: 'MiMo 代理说明' },
};

/** 火山方舟「自定义接入点」列表项 id（与 model.rs / 静态目录一致） */
const VOLC_CUSTOM_EP = '__volc_custom_ep__';

export default function ModelConfig({ onNext, onPrev }: Props) {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedProvider, setSelectedProvider] = useState<string>('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [setDefault, setSetDefault] = useState(false);

  const [models, setModels] = useState<ModelEntry[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  /** 火山方舟选「自定义 ep」时，用户输入的接入点 ID */
  const [volcCustomEpId, setVolcCustomEpId] = useState('');
  // 追踪磁盘上是否已有该供应商的 Key（用于「Key 已保存，无需重复填写」场景）
  const [hasStoredKey, setHasStoredKey] = useState(false);
  // 防止 provider 未加载完时 apiKey 变化导致多余加载
  const [providerReady, setProviderReady] = useState(false);

  /** 当前全局默认模型（用于判断当前供应商+模型是否为默认） */
  const [currentDefault, setCurrentDefault] = useState<{ provider: string; model: string } | null>(null);

  /** 代理设置 */
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyUsername, setProxyUsername] = useState('');
  const [proxyPassword, setProxyPassword] = useState('');

  useEffect(() => {
    loadProviders();
  }, []);

  // 切换供应商时，从磁盘读取 api_key 和全局默认模型（并行）。
  // currentDefault 不在本 effect 依赖中，避免 setCurrentDefault → 触发自身死循环。
  useEffect(() => {
    if (!providerReady) return;
    loadStoredKeyAndModels();
  }, [providerReady, selectedProvider]);

  const loadStoredKeyAndModels = async () => {
    setHasStoredKey(false);
    setVolcCustomEpId('');
    setModelsLoading(true);
    setModelsError(null);
    setModels([]);
    setSelectedModel('');

    try {
      // 并行加载：供应商配置（api_key）+ 全局默认模型
      const [cfg, defaultModel] = await Promise.all([
        invoke<{ api_key?: string; proxy_url?: string; proxy_username?: string; proxy_password?: string }>('get_provider_config', { providerId: selectedProvider }),
        invoke<{ provider?: string; model_name?: string }>('get_default_model', {}),
      ]);
      const stored = cfg?.api_key || '';
      setApiKey(stored);
      setHasStoredKey(stored.length > 0);
      // 加载代理设置
      setProxyUrl(cfg?.proxy_url || '');
      setProxyUsername(cfg?.proxy_username || '');
      setProxyPassword(cfg?.proxy_password || '');

      // 同步全局默认模型状态
      const dm = defaultModel?.provider && defaultModel?.model_name
        ? { provider: defaultModel.provider, model: defaultModel.model_name }
        : null;
      setCurrentDefault(dm);

      // 若当前供应商+模型恰好是全局默认，自动选中（不必用户再打勾）
      if (dm && dm.provider === selectedProvider) {
        // resolvedModelName 在此处为 selectedModel（因为 apiKey 尚未稳定，useEffect 会在后面触发 loadModels）
        // setSelectedModel 的值在 loadModels 里被 '' 覆盖了，这里先记住，等模型列表加载后再设
        setSetDefault(true);
      } else {
        setSetDefault(false);
      }

      setModelsLoading(false);
    } catch {
      setApiKey('');
      setHasStoredKey(false);
      setCurrentDefault(null);
      setModelsLoading(false);
    }
  };

  // apiKey 稳定后（用户手动输入或从磁盘加载完毕）触发模型列表拉取
  // 将 currentDefault 也加入依赖：当 loadStoredKeyAndModels 更新了 currentDefault 后，
  // 此 effect 重新执行，loadModels 能看到新的当前默认模型并自动选中。
  useEffect(() => {
    if (!providerReady) return;
    loadModels();
  }, [selectedProvider, apiKey, providerReady, currentDefault]);

  const loadProviders = async () => {
    setLoading(true);
    try {
      const result = await invoke<Provider[]>('list_providers');
      setProviders(result);
      setProviderReady(true);
    } catch (e) {
      console.error('Load providers error:', e);
    }
    setLoading(false);
  };

  const loadModels = async () => {
    setModelsLoading(true);
    setModelsError(null);
    setModels([]);
    // 关键：apiKey / currentDefault 变化会反复触发本函数。若开头清空 selectedModel，
    // 用户已点选的模型会在列表刷新前变成空串，保存时 resolvedModelName 为空 → 不会调用 set_default_model，
    // 网关一直报「未配置默认大模型」。因此保留「刷新后仍存在于新列表」的选中项。
    const prevSelected = selectedModel;
    const prevVolcEp = volcCustomEpId;

    try {
      const result = await invoke<ModelEntry[]>('list_models', {
        providerId: selectedProvider,
        apiKey: apiKey || null,
      });
      setModels(result);

      let nextId = '';
      let nextVolc = '';

      if (prevSelected && result.some(m => m.id === prevSelected)) {
        nextId = prevSelected;
        if (prevSelected === VOLC_CUSTOM_EP) {
          nextVolc = prevVolcEp;
        }
      } else if (currentDefault && currentDefault.provider === selectedProvider) {
        const match = result.find(m => m.id === currentDefault.model);
        if (match) {
          nextId = match.id;
        } else if (selectedProvider === 'volc_ark' && currentDefault.model.startsWith('ep-')) {
          nextId = VOLC_CUSTOM_EP;
          nextVolc = currentDefault.model;
        }
      }

      setSelectedModel(nextId);
      setVolcCustomEpId(nextVolc);
    } catch (e) {
      setModelsError(String(e));
      setSelectedModel('');
      setVolcCustomEpId('');
    } finally {
      setModelsLoading(false);
    }
  };

  const resolvedModelName =
    selectedProvider === 'volc_ark' && selectedModel === VOLC_CUSTOM_EP
      ? volcCustomEpId.trim()
      : selectedModel;

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await invoke<{ success: boolean; message: string }>('test_model_connection', {
        provider: selectedProvider,
        modelName: resolvedModelName,
        apiKey,
        proxyUrl: proxyUrl || null,
        proxyUsername: proxyUsername || null,
        proxyPassword: proxyPassword || null,
      });
      setTestResult(result);
    } catch (e) {
      setTestResult({ success: false, message: String(e) });
    }
    setTesting(false);
  };

  /** 保存供应商 Key；若勾选全局默认则写入 models.yaml 并同步 openclaw.json。成功返回 true。 */
  const handleSave = async (): Promise<boolean> => {
    try {
      await invoke('save_provider_config', {
        providerId: selectedProvider,
        apiKey,
        proxyUrl: proxyUrl || null,
        proxyUsername: proxyUsername || null,
        proxyPassword: proxyPassword || null,
      });
      if (setDefault) {
        const name = resolvedModelName.trim();
        if (!name) {
          toast.error(
            '无法写入全局默认模型：当前未选中具体模型。请先点击下方列表中的某一模型，再保存（填写 API Key 后列表会刷新，需重新点选模型）。',
            { duration: 7000 },
          );
          return false;
        }
        await invoke('set_default_model', {
          provider: selectedProvider,
          modelName: name,
        });
      }
      toast.success(
        setDefault
          ? '已保存：全局默认模型已写入配置并同步到 openclaw.json，请启动或重启网关后生效。'
          : '供应商配置已保存',
        { duration: 4000 },
      );
      return true;
    } catch (e) {
      const msg = String(e);
      console.error('Save error:', e);
      toast.error(msg, { duration: 6000 });
      return false;
    }
  };

  const currentProvider = providers.find(p => p.id === selectedProvider);
  const isOllama = selectedProvider === 'ollama';
  const isOpenRouter = selectedProvider === 'openrouter';

  /** 非 Ollama：统一展示「可选模型」列表（含 OpenRouter 与各云厂商静态目录） */
  const renderCloudModelSection = () => {
    const doc = PROVIDER_DOCS[selectedProvider];
    const panelClass = isOpenRouter
      ? 'bg-blue-50 border-blue-200'
      : 'bg-slate-50 border-slate-200';
    const titleClass = isOpenRouter ? 'text-blue-900' : 'text-slate-900';
    const freeCount = models.filter(m => m.is_free).length;

    return (
      <div className={`rounded-lg border p-4 ${panelClass}`}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {isOpenRouter && <Wifi className="w-4 h-4 text-blue-600 shrink-0" />}
          <h3 className={`font-medium ${titleClass}`}>
            {isOpenRouter
              ? 'OpenRouter · 可选模型（OpenRouter 官方 API 实时拉取）'
              : `${currentProvider?.name ?? selectedProvider} · 可选模型`}
          </h3>
          {models.length > 0 && (
            <span
              className={`text-xs px-2 py-0.5 rounded-full ml-auto ${
                isOpenRouter ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-700'
              }`}
            >
              {isOpenRouter && `${freeCount} 个免费 / `}
              共 {models.length} 个
            </span>
          )}
        </div>

        {isOpenRouter && (
          <p className="text-xs text-blue-900/90 mb-2 leading-relaxed">
            模型列表由 OpenRouter 接口实时返回；免费档以角标标注。请选用列表中的<strong>原始模型 ID</strong>（免费模型多为{' '}
            <code className="bg-blue-100 px-1 rounded text-[11px]">…:free</code>），勿把中文拼进 ID。
          </p>
        )}

        {!isOpenRouter && (
          <p className="text-sm text-slate-600 mb-2">
            请<strong>先点击</strong>下方某一模型完成选择，再填写 API Key 并「测试连接」。各厂商控制台若更名，请以文档为准。
          </p>
        )}

        {selectedProvider === 'minimax' && (
          <p className="text-xs text-slate-700 bg-white/80 border border-slate-200 rounded px-2 py-1.5 mb-2">
            文本对话为 <strong>M2.1 / M2.5 / M2.7</strong> 等系列；「海螺」多为视频等多模态产品，请在{' '}
            <a href="https://platform.minimaxi.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
              MiniMax 开放平台
            </a>{' '}
            核对当前可用的 <code className="text-xs bg-slate-100 px-1 rounded">model</code> 字段。
            <span className="block mt-1 text-slate-600">
              若选 <strong>M2.5（标准）</strong> 对话失败、换 <strong>M2.5 高速</strong> 正常，多为账号侧产品线/线路差异，建议默认选高速或 M2.7。
            </span>
          </p>
        )}

        {selectedProvider === 'volc_ark' && (
          <div className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded px-2 py-1.5 mb-2 space-y-1">
            <p>
              <strong>鉴权</strong>：请使用火山方舟控制台「
              <a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
                API Key 管理
              </a>
              」里创建的 <strong>Ark API Key</strong>（长串密钥），<strong>不是</strong>火山引擎账号的 Access Key（AK）/ Secret Key（SK）。
            </p>
            <p>
              <strong>模型名</strong>：对话接口为 <code className="bg-amber-100 px-1 rounded">/api/v3/chat/completions</code>，<code className="bg-amber-100 px-1 rounded">model</code> 一般填控制台为推理接入点分配的 <strong>接入点 ID（ep-xxxx）</strong>，或模型广场展示的模型 ID。选列表第一项「自定义」后，在下方输入框粘贴完整 ep-xxxx。接入后请对照
              {' '}<a href="https://www.volcengine.com/docs/82379/1298459" target="_blank" rel="noopener noreferrer" className="underline text-blue-700">Base URL 及鉴权</a>
              {' '}/{' '}
              <a href="https://www.volcengine.com/docs/82379/1494384" target="_blank" rel="noopener noreferrer" className="underline text-blue-700">对话 API</a>。
            </p>
            <p className="text-amber-800">
              <strong>生图 / 生视频</strong>：Seedream、Seedance 虽也暴露为 OpenAI-compatible 端点，但 prompt 格式与纯对话不同；本管理端测连仅验证「对话」能力。纯文生图请对照
              {' '}<a href="https://www.volcengine.com/docs/82379/1541523" target="_blank" rel="noopener noreferrer" className="underline text-blue-700">图片生成 API</a>
              {' '}/{' '}
              <a href="https://www.volcengine.com/docs/82379/1520757" target="_blank" rel="noopener noreferrer" className="underline text-blue-700">视频生成 API</a>。
            </p>
          </div>
        )}

        {doc && (
          <a
            href={doc.href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-600 hover:underline mb-2 inline-block"
          >
            {doc.label}（取 Key / 核对模型名）
          </a>
        )}

        {modelsLoading && (
          <div
            className={`flex items-center gap-2 text-sm py-2 ${isOpenRouter ? 'text-blue-600' : 'text-slate-600'}`}
          >
            <Loader2 className="w-4 h-4 animate-spin" />
            {isOpenRouter ? '正在从 OpenRouter 获取模型列表…' : '正在加载模型列表…'}
          </div>
        )}

        {modelsError && !modelsLoading && (
          <div className="text-sm text-red-600 py-1">{modelsError}</div>
        )}

        {!modelsLoading && !modelsError && models.length > 0 && (
          <div className="max-h-80 overflow-y-auto space-y-1 pr-1 mt-2">
            {models.map(m => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  setSelectedModel(m.id);
                  if (m.id !== '__volc_custom_ep__') setVolcCustomEpId('');
                }}
                className={`w-full text-left px-3 py-2 rounded border transition-colors
                  ${selectedModel === m.id
                    ? isOpenRouter
                      ? 'border-blue-500 bg-white ring-2 ring-blue-200'
                      : 'border-blue-500 bg-white ring-2 ring-blue-100'
                    : isOpenRouter
                      ? 'border-gray-200 bg-white hover:border-blue-300'
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }
                `}
              >
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-900">{m.name}</span>
                  {m.is_free && (
                    <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">免费</span>
                  )}
                  {m.badge && (!m.is_free || m.badge !== '免费') && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded ${
                        isOpenRouter ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {m.badge}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5 font-mono break-all">{m.id}</div>
                {m.context_window != null && (
                  <div className="text-xs text-slate-400 mt-0.5">
                    上下文约 {contextLabel(m.context_window)}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        {selectedProvider === 'volc_ark' && selectedModel === '__volc_custom_ep__' && (
          <div className="mt-2">
            <label className="block text-xs text-slate-600 mb-1">推理接入点 ID</label>
            <input
              type="text"
              value={volcCustomEpId}
              onChange={e => setVolcCustomEpId(e.target.value)}
              placeholder="例如 ep-20250101-xxxxx"
              className="w-full px-3 py-2 border border-amber-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-400"
            />
          </div>
        )}

        {!modelsLoading && !modelsError && models.length === 0 && (
          <div className="text-sm text-slate-500 py-2">暂无可选模型，请稍后重试或检查网络</div>
        )}

        {isOpenRouter && !apiKey && !modelsLoading && (
          <div className="mt-2 text-xs text-blue-800 bg-blue-100 rounded px-2 py-1">
            填入 API Key 后可实时拉取完整模型目录（通常 150+）
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">大模型配置</h2>
        <p className="text-gray-600">配置 AI 模型供应商和 API Key</p>
      </div>

      <div className="flex gap-6">
        {/* 左侧供应商列表 */}
        <div className="w-56 shrink-0 space-y-2 max-h-[70vh] overflow-y-auto pr-1">
          <div className="text-sm font-medium text-gray-700 mb-2">供应商列表</div>
          {providers.map(p => (
            <button
              key={p.id}
              onClick={() => setSelectedProvider(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors
                ${selectedProvider === p.id
                  ? 'bg-blue-100 text-blue-700 border border-blue-300'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 border border-transparent'
                }
              `}
            >
              <div className="font-medium leading-tight">{p.name}</div>
              {p.id === 'ollama' && (
                <div className="text-xs text-blue-500 mt-0.5 flex items-center gap-1">
                  <Server className="w-3 h-3" />
                  本地
                </div>
              )}
              {p.id !== 'ollama' && (
                <div className="text-xs text-gray-500 mt-0.5">
                  {p.id === 'openrouter' ? '免费模型 + 完整目录' : '右侧选模型'}
                </div>
              )}
            </button>
          ))}
        </div>

        {/* 右侧配置区域 */}
        <div className="flex-1 space-y-4">

          {/* --- 模型选择：Ollama 本地 / 其余供应商统一「可选模型」列表 --- */}
          {isOllama ? (
            <div className="bg-indigo-50 border border-indigo-200 rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Server className="w-4 h-4 text-indigo-600" />
                <h3 className="font-medium text-indigo-900">本地已安装模型（可选）</h3>
              </div>
              {modelsLoading && (
                <div className="flex items-center gap-2 text-sm text-indigo-600 py-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  正在连接 localhost:11434…
                </div>
              )}
              {modelsError && !modelsLoading && (
                <div className="bg-red-50 border border-red-200 rounded p-3">
                  <div className="flex items-start gap-2 text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-medium">无法连接 Ollama</div>
                      <div className="mt-1 text-xs opacity-80">{modelsError}</div>
                      <div className="mt-2 text-xs">
                        请确保已安装 Ollama 并运行：{' '}
                        <code className="bg-red-100 px-1 rounded">ollama pull llama3</code>
                        {'  '}等命令拉取模型
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {!modelsLoading && !modelsError && models.length > 0 && (
                <div className="max-h-80 overflow-y-auto space-y-1">
                  {models.map(m => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setSelectedModel(m.id)}
                      className={`w-full text-left px-3 py-2 rounded border transition-colors
                        ${selectedModel === m.id
                          ? 'border-indigo-400 bg-white ring-2 ring-indigo-200'
                          : 'border-gray-200 bg-white hover:border-indigo-300'
                        }
                      `}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900">{m.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">
                          {m.context_window ? `上下文 ${contextLabel(m.context_window)}` : '本地'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {!modelsLoading && !modelsError && models.length === 0 && (
                <div className="text-sm text-indigo-600 py-2">未检测到模型，请先拉取</div>
              )}
            </div>
          ) : (
            renderCloudModelSection()
          )}

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {selectedProvider === 'ollama' ? 'Ollama 无需 API Key（本地服务）' : 'API Key'}
            </label>
            {selectedProvider !== 'ollama' && (
              <div className="relative">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={hasStoredKey ? '已保存 — 输入新值可替换' : '输入 API Key'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
                {hasStoredKey && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-green-600 bg-green-50 px-2 py-0.5 rounded border border-green-200">
                    已保存
                  </span>
                )}
              </div>
            )}
            {selectedProvider === 'ollama' && (
              <div className="px-3 py-2 bg-gray-100 rounded-lg text-sm text-gray-500 border border-gray-200">
                Ollama 直接连接本地模型，无需配置 API Key
              </div>
            )}
          </div>

          {/* 代理设置（仅 OpenAI、Google 和 Grok 支持） */}
          {(selectedProvider === 'openai' || selectedProvider === 'google' || selectedProvider === 'grok') && (
            <div className="space-y-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
              <label className="block text-sm font-medium text-gray-700">
                代理服务设置（可选）
              </label>
              <div>
                <input
                  type="text"
                  value={proxyUrl}
                  onChange={(e) => setProxyUrl(e.target.value)}
                  placeholder="代理地址，例如 http://127.0.0.1:7890"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <input
                    type="text"
                    value={proxyUsername}
                    onChange={(e) => setProxyUsername(e.target.value)}
                    placeholder="代理用户名"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
                <div>
                  <input
                    type="password"
                    value={proxyPassword}
                    onChange={(e) => setProxyPassword(e.target.value)}
                    placeholder="代理密码"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
                  />
                </div>
              </div>
              <p className="text-xs text-gray-500">
                如使用代理服务，请填写代理地址及账号密码以提高连接稳定性
              </p>
            </div>
          )}

          {/* 测试按钮 */}
          <div className="flex items-center gap-4">
            {selectedProvider !== 'ollama' && (
              <button
                onClick={handleTest}
                disabled={
                  !apiKey
                  || !selectedModel
                  || testing
                  || (selectedProvider === 'volc_ark'
                    && selectedModel === '__volc_custom_ep__'
                    && !volcCustomEpId.trim())
                }
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 disabled:opacity-50 flex items-center"
              >
                {testing ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                测试连接
              </button>
            )}
            {selectedProvider === 'ollama' && (
              <button
                onClick={loadModels}
                disabled={modelsLoading}
                className="px-4 py-2 text-sm bg-indigo-100 text-indigo-700 rounded-lg hover:bg-indigo-200 disabled:opacity-50 flex items-center"
              >
                {modelsLoading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
                刷新模型列表
              </button>
            )}
            {testResult && (
              <div className={`flex items-center text-sm ${testResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {testResult.success ? <CheckCircle className="w-4 h-4 mr-1" /> : null}
                {testResult.message}
              </div>
            )}
          </div>

          {/* 设为默认 */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="setDefault"
              checked={setDefault}
              onChange={(e) => setSetDefault(e.target.checked)}
              disabled={
                !selectedModel
                || (selectedProvider === 'volc_ark'
                  && selectedModel === '__volc_custom_ep__'
                  && !volcCustomEpId.trim())
              }
              className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500 disabled:opacity-50"
            />
            <label htmlFor="setDefault" className="ml-2 text-sm text-gray-700 disabled:opacity-50">
              设为全局默认模型
            </label>
          </div>
        </div>
      </div>

      <div className="flex justify-between items-center pt-4 border-t">
        <button onClick={onPrev} className="px-4 py-2 text-gray-600 hover:text-gray-900">
          上一步
        </button>
        <button
          onClick={async () => {
            const ok = await handleSave();
            if (ok) onNext();
          }}
          disabled={
            selectedProvider !== 'ollama'
            && !apiKey
            && !hasStoredKey
          }
          className="px-6 py-2 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 disabled:opacity-50"
        >
          保存并下一步
        </button>
      </div>
    </div>
  );
}
