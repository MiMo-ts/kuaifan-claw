import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Loader2, CheckCircle, Terminal, Smartphone, ChevronRight, Bot, Wifi, Download } from 'lucide-react';

/** 与后端 list_robot_templates 对齐，用于进入创建页时合并最新描述 / skills / MCP */
interface RobotTemplateSync {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  system_prompt?: string;
  icon: string;
  color: string;
  default_skills: string[];
  default_mcp: string[];
  tags: string[];
  downloaded?: boolean;
  skills_installed?: number;
  skills_total?: number;
}

interface Props {
  onComplete: () => void;
  onPrev: () => void;
  selectedRobot: any;
  isLastStep: boolean;
}

const CHANNELS = [
  { id: 'dingtalk', name: '钉钉', icon: '📱' },
  { id: 'feishu', name: '飞书', icon: '📱' },
  { id: 'wxwork', name: '企业微信', icon: '📱' },
  { id: 'wechat_clawbot', name: '微信 ClawBot', icon: '💬' },
  { id: 'telegram', name: 'Telegram', icon: '📱' },
  { id: 'qq', name: 'QQ', icon: '📱' },
];

const PROVIDER_OPTIONS = [
  { id: 'openrouter', name: 'OpenRouter（推荐免费模型）' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Claude（Anthropic）' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'minimax', name: 'MiniMax（M2 系列）' },
  { id: 'ollama', name: 'Ollama 本地模型' },
  { id: 'volc_ark', name: '火山方舟 · 豆包' },
  { id: 'nvidia', name: 'NVIDIA NIM' },
  { id: 'xiaomi', name: '小米 MiMo' },
  { id: 'baidu', name: '百度文心一言' },
  { id: 'aliyun', name: '阿里通义千问' },
  { id: 'zhipu', name: '智谱 GLM' },
  { id: 'moonshot', name: 'Kimi（月之暗面）' },
];

export default function CreateInstance({ onComplete, onPrev, selectedRobot }: Props) {
  const [step, setStep] = useState(1);
  const [instanceName, setInstanceName] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [channelConfig, setChannelConfig] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  /** 微信通道：是否勾选「已完成扫码」以进入下一步 */
  const [wechatLoginAck, setWechatLoginAck] = useState(false);
  const [wechatPluginInstalled, setWechatPluginInstalled] = useState(false);
  const [wechatPluginInstalling, setWechatPluginInstalling] = useState(false);
  const [wechatLoginOpening, setWechatLoginOpening] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [defaultModel, setDefaultModel] = useState<{provider?: string; model_name?: string} | null>(null);
  const [localRobots, setLocalRobots] = useState<any[]>([]);
  const [showLocalRobots, setShowLocalRobots] = useState(false);
  const [overrideModel, setOverrideModel] = useState(false);
  const [modelProvider, setModelProvider] = useState('');
  const [modelName, setModelName] = useState('');
  const [volcCustomEpId, setVolcCustomEpId] = useState('');
  const [instModelList, setInstModelList] = useState<any[]>([]);
  const [instModelLoading, setInstModelLoading] = useState(false);
  const [keySource, setKeySource] = useState<'global' | 'instance'>('global');
  const [instanceKey, setInstanceKey] = useState('');
  const [activeRobot, setActiveRobot] = useState<any>(selectedRobot);

  useEffect(() => { setActiveRobot(selectedRobot); }, [selectedRobot]);

  /** 与机器人商店同步：模板文案、默认 skill/MCP 以磁盘+后端为准，避免沿用旧内存对象 */
  useEffect(() => {
    if (step !== 1) return;
    let cancelled = false;
    (async () => {
      try {
        const [templates, robots] = await Promise.all([
          invoke<RobotTemplateSync[]>('list_robot_templates'),
          invoke<any[]>('list_robots'),
        ]);
        if (cancelled) return;
        setLocalRobots(robots || []);
        const rid = selectedRobot?.id ?? activeRobot?.id;
        if (!rid) return;
        const fresh = templates.find((t) => t.id === rid);
        if (fresh) {
          setActiveRobot((prev: any) => ({ ...(prev || {}), ...fresh }));
        }
      } catch (e) {
        console.error('sync robot template failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [step, selectedRobot?.id, activeRobot?.id]);

  useEffect(() => {
    invoke<{provider?: string; model_name?: string}>('get_default_model')
      .then(m => { if (m?.provider) setDefaultModel(m); })
      .catch(() => {});
    invoke<any[]>('list_robots')
      .then(robots => setLocalRobots(robots || []))
      .catch(() => {});
  }, []);

  /** 切换通道时重置微信扫码确认 */
  useEffect(() => {
    setWechatLoginAck(false);
  }, [selectedChannel]);

  /** 第 2 步且选择微信时，查询插件是否已安装 */
  useEffect(() => {
    if (step !== 2 || selectedChannel !== 'wechat_clawbot') return;
    invoke<boolean>('check_plugin_installed', { pluginId: 'wechat_clawbot' })
      .then(setWechatPluginInstalled)
      .catch(() => setWechatPluginInstalled(false));
  }, [step, selectedChannel]);

  useEffect(() => {
    if (!overrideModel || !modelProvider) return;
    setInstModelLoading(true);
    setInstModelList([]);
    setModelName('');
    setVolcCustomEpId('');
    invoke<any[]>('list_models', {
      providerId: modelProvider,
      apiKey: null,
    }).then(models => {
      setInstModelList(models || []);
    }).catch(() => {
      setInstModelList([]);
    }).finally(() => {
      setInstModelLoading(false);
    });
  }, [overrideModel, modelProvider]);

  const handleCreate = async () => {
    setCreateError(null);
    if (!selectedChannel) {
      setCreateError('未选择聊天通道，请使用「上一步」回到第 2 步选择通道。');
      return;
    }
    if (overrideModel && !modelName) {
      setCreateError('请在第 3 步中选择具体模型，或取消「本实例指定模型」勾选。');
      return;
    }
    if (
      overrideModel
      && modelProvider === 'volc_ark'
      && modelName === '__volc_custom_ep__'
      && !volcCustomEpId.trim()
    ) {
      setCreateError('请在「自定义」下填写火山方舟推理接入点 ID（ep-xxxx）。');
      return;
    }
    const trimmedName = instanceName.trim();
    if (!trimmedName) {
      setCreateError('请填写实例名称。');
      return;
    }

    setCreating(true);
    try {
      const resolvedModelName =
        modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__'
          ? volcCustomEpId.trim()
          : modelName;
      const modelConfig = overrideModel && modelProvider && modelName
        ? {
            provider: modelProvider,
            model_name: resolvedModelName,
            api_key: keySource === 'instance' && instanceKey ? instanceKey : null,
            api_base: null,
            temperature: 0.7,
            max_tokens: 4096,
          }
        : null;
      await invoke('create_instance', {
        name: trimmedName,
        robotId: activeRobot?.id ?? null,
        channelType: selectedChannel,
        channelConfig,
        modelConfig,
        maxHistory: 50,
        responseMode: 'stream',
      });
      setCreated(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCreateError(msg || '创建失败，请查看日志或重试。');
      console.error('Create instance error:', e);
    } finally {
      setCreating(false);
    }
  };

  const installWechatPlugin = async () => {
    setWechatPluginInstalling(true);
    try {
      await invoke<string>('install_plugin', { pluginId: 'wechat_clawbot' });
      setWechatPluginInstalled(true);
      toast.success('微信插件已安装');
    } catch (e) {
      toast.error(String(e));
    } finally {
      setWechatPluginInstalling(false);
    }
  };

  const openWechatLogin = async () => {
    setWechatLoginOpening(true);
    try {
      const msg = await invoke<string>('open_wechat_clawbot_login_terminal');
      toast.success(msg, { duration: 6000 });
    } catch (e) {
      toast.error(String(e), { duration: 8000 });
    } finally {
      setWechatLoginOpening(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">创建实例</h2>
        <p className="text-gray-600">将机器人绑定到聊天通道，完成配置</p>
      </div>

      {/* 步骤指示：1选机器人 2选通道 3模型 4通道凭证 5确认 6名称 */}
      <div className="flex justify-center space-x-4">
        {[
          { n: 1, label: '机器人' },
          { n: 2, label: '通道' },
          { n: 3, label: '模型' },
          { n: 4, label: '凭证' },
          { n: 5, label: '确认' },
          { n: 6, label: '名称' },
        ].map(({ n, label }) => (
          <div key={n} className="flex items-center">
            <div className={`w-8 h-8 rounded-full flex flex-col items-center justify-center text-xs
              ${step >= n ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-500'}`}
            >
              {step > n ? <CheckCircle className="w-4 h-4" /> : n}
            </div>
            <div className={`w-12 h-0.5 mx-2 ${step > n ? 'bg-blue-500' : 'bg-gray-200'}`} />
          </div>
        ))}
      </div>

      {/* 步骤内容 */}
      <div className="max-w-xl mx-auto">
        {created ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
              <CheckCircle className="w-8 h-8 text-green-500" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">实例创建成功！</h3>
            <p className="text-gray-500 mb-4">实例 &quot;{instanceName}&quot; 已成功创建</p>
            {selectedChannel === 'wechat_clawbot' && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-6 text-left">
                若网关此前在运行，系统会在<strong>后台</strong>重启网关以加载微信通道（含插件检查，可能需 1～3 分钟）。
                请稍后在首页确认「网关 · 运行中」；未完成前微信可能暂不可用，也可手动点「重启网关」。
              </p>
            )}
            <button
              type="button"
              onClick={onComplete}
              className="px-8 py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600"
            >
              进入首页
            </button>
          </div>
        ) : (
        <>
        {/* ── 步骤 1：选机器人（可选）── */}
        {step === 1 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">已选择的机器人 <span className="text-sm font-normal text-gray-500">（可选）</span></h3>
            {activeRobot?.id && (
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                <div className="flex items-center">
                  <span className="text-4xl mr-3">{activeRobot.icon}</span>
                  <div>
                    <div className="font-medium text-gray-900">{activeRobot.name}</div>
                    <div className="text-sm text-gray-600 whitespace-pre-wrap mt-1">
                      {activeRobot.description}
                    </div>
                    {activeRobot.system_prompt && String(activeRobot.system_prompt).trim().length > 0 && (
                      <details className="mt-2 text-sm">
                        <summary className="cursor-pointer text-blue-600 hover:text-blue-800 select-none">
                          查看人设、职能与工作流
                        </summary>
                        <div className="mt-2 text-gray-600 whitespace-pre-wrap max-h-48 overflow-y-auto rounded border border-blue-100 bg-white/80 px-2 py-1.5">
                          {activeRobot.system_prompt}
                        </div>
                      </details>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!activeRobot && (
              <div className="p-4 bg-gray-50 rounded-lg border border-dashed border-gray-300 text-center">
                <p className="text-sm text-gray-500 mb-2">
                  未选择机器人，将使用通用人设 + openclaw 默认 skills
                </p>
                <button
                  type="button"
                  onClick={onPrev}
                  className="text-sm text-blue-600 hover:text-blue-800 underline"
                >
                  返回机器人商店选择机器人
                </button>
              </div>
            )}

            {localRobots.length > 0 && (
              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setShowLocalRobots(v => !v)}
                  className="flex items-center gap-1 text-sm text-teal-600 hover:text-teal-800"
                >
                  <Bot className="w-4 h-4" />
                  已下载的机器人（{localRobots.length}）<ChevronRight className={`w-4 h-4 transition-transform ${showLocalRobots ? 'rotate-90' : ''}`} />
                </button>
                {showLocalRobots && (
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {localRobots.map(r => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => { setActiveRobot({ ...r, id: r.id }); setShowLocalRobots(false); }}
                      className="p-3 border border-gray-200 rounded-lg text-left hover:border-blue-400 hover:bg-blue-50 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{r.icon || '🤖'}</span>
                        <div>
                          <div className="font-medium text-sm">{r.name}</div>
                          <div className="text-xs text-gray-500">
                            {r.category ? `${r.category} · ${r.id}` : r.id}
                          </div>
                        </div>
                      </div>
                    </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStep(2)}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
              >
                {activeRobot?.id ? '下一步：选择聊天通道' : '下一步：选择聊天通道（通用人设）'}
              </button>
            </div>
          </div>
        )}

        {/* ── 步骤 2：选通道 ── */}
        {step === 2 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">选择聊天通道</h3>
            <div className="grid grid-cols-3 gap-3">
              {CHANNELS.map(ch => (
                <button
                  key={ch.id}
                  onClick={() => {
                    if (selectedChannel !== ch.id) {
                      setChannelConfig({});
                      setWechatLoginAck(false);
                    }
                    setSelectedChannel(ch.id);
                  }}
                  className={`p-4 rounded-lg border text-center transition-colors
                    ${selectedChannel === ch.id
                      ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
                      : 'border-gray-200 bg-white hover:border-blue-300'
                    }
                  `}
                >
                  <div className="text-3xl mb-2">{ch.icon}</div>
                  <div className="text-sm font-medium text-gray-900">{ch.name}</div>
                </button>
              ))}
            </div>

            {selectedChannel === 'wechat_clawbot' && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-4 space-y-3 text-left">
                <div className="flex items-center gap-2 text-emerald-900 font-medium">
                  <Smartphone className="w-5 h-5 shrink-0" />
                  微信 ClawBot：扫码绑定
                </div>
                <p className="text-sm text-emerald-800/90 space-y-1">
                  <span className="block">
                    请先安装插件（与钉钉/飞书相同的一键安装）。若已安装，点击下方在新窗口中执行登录命令。
                  </span>
                  <span className="block mt-2 font-medium text-emerald-900">
                    推荐：终端里的 ASCII 二维码常因字体变形难以扫描。请以运行后输出的「用浏览器打开以下链接」为准，复制到手机或电脑浏览器打开，再用微信扫码（与官方 CLI 行为一致）。
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={installWechatPlugin}
                    disabled={wechatPluginInstalled || wechatPluginInstalling}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-emerald-300 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
                  >
                    {wechatPluginInstalling ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    {wechatPluginInstalled ? '插件已安装' : '一键安装微信插件'}
                  </button>
                  <button
                    type="button"
                    onClick={openWechatLogin}
                    disabled={wechatLoginOpening || !wechatPluginInstalled}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {wechatLoginOpening ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Terminal className="w-4 h-4" />
                    )}
                    发起扫码登录（新窗口）
                  </button>
                </div>
                <label className="flex items-start gap-2 cursor-pointer text-sm text-emerald-900">
                  <input
                    type="checkbox"
                    checked={wechatLoginAck}
                    onChange={e => setWechatLoginAck(e.target.checked)}
                    className="mt-0.5 rounded border-emerald-400"
                  />
                  <span>我已在微信中完成扫码授权，可继续下一步</span>
                </label>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                上一步
              </button>
              <button
                onClick={() => setStep(3)}
                disabled={
                  !selectedChannel
                  || (selectedChannel === 'wechat_clawbot' && !wechatLoginAck)
                }
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一步：选择模型
              </button>
            </div>
          </div>
        )}

        {/* ── 步骤 3：模型配置 ── */}
        {step === 3 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">选择模型</h3>
            <p className="text-sm text-gray-500">每个实例可单独配置模型，也可使用向导全局默认模型</p>

            <div className="border rounded-lg p-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overrideModel}
                  onChange={e => setOverrideModel(e.target.checked)}
                  className="rounded w-4 h-4"
                />
                <span className="text-sm font-medium text-gray-700">本实例指定模型（覆盖向导默认）</span>
              </label>
            </div>

            {!overrideModel && defaultModel?.provider && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="text-sm text-gray-700">
                  将使用向导默认模型：
                  <span className="font-semibold text-blue-700">{defaultModel.provider}</span>
                  {' / '}
                  <span className="font-semibold text-blue-700">{defaultModel.model_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setOverrideModel(true);
                    setModelProvider(defaultModel.provider || '');
                    setModelName('');
                    setInstModelList([]);
                  }}
                  className="mt-2 text-xs text-blue-600 underline hover:no-underline"
                >
                  修改此实例的模型
                </button>
              </div>
            )}
            {!overrideModel && !defaultModel?.provider && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                <p className="text-sm text-amber-700">未配置向导默认模型，请勾选上方「本实例指定模型」进行配置</p>
              </div>
            )}

            {overrideModel && (
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">供应商</label>
                  <select
                    value={modelProvider}
                    onChange={e => {
                      setModelProvider(e.target.value);
                      setModelName('');
                      setInstModelList([]);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="">— 选择供应商 —</option>
                    {PROVIDER_OPTIONS.map(p => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>

                {modelProvider && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">
                      模型 {modelProvider === 'ollama' ? '（本地）' : ''}
                    </label>
                    {instModelLoading ? (
                      <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                        <Loader2 className="w-4 h-4 animate-spin" />加载模型列表…
                      </div>
                    ) : instModelList.length > 0 ? (
                      <div className="max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y">
                        {instModelList.map(m => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => {
                              setModelName(m.id);
                              if (m.id !== '__volc_custom_ep__') setVolcCustomEpId('');
                            }}
                            className={`w-full text-left px-3 py-2 text-sm transition-colors
                              ${modelName === m.id
                                ? 'bg-blue-50 border-l-2 border-blue-500 text-blue-700 font-medium'
                                : 'hover:bg-gray-50 text-gray-700'}`}
                          >
                            <div className="flex items-center gap-2">
                              <span>{m.name || m.id}</span>
                              {m.is_free && (
                                <span className="text-xs bg-green-100 text-green-700 px-1.5 py-0.5 rounded">免费</span>
                              )}
                            </div>
                            <div className="text-xs text-gray-400 mt-0.5 font-mono truncate">{m.id}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-gray-400 py-2">
                        暂无可用模型，请先在「大模型配置」保存该供应商的 API Key
                      </div>
                    )}
                    {modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' && (
                      <div className="mt-2">
                        <label className="block text-xs text-gray-600 mb-1">推理接入点 ID（ep-xxxx）</label>
                        <input
                          type="text"
                          value={volcCustomEpId}
                          onChange={e => setVolcCustomEpId(e.target.value)}
                          placeholder="从方舟控制台「在线推理」复制接入点 ID"
                          className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-400"
                        />
                      </div>
                    )}
                  </div>
                )}

                {modelProvider && (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">API Key 来源</label>
                    <div className="flex gap-4">
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="keySource"
                          value="global"
                          checked={keySource === 'global'}
                          onChange={() => setKeySource('global')}
                          className="text-blue-600"
                        />
                        <span>复用全局已保存的 Key</span>
                      </label>
                      <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name="keySource"
                          value="instance"
                          checked={keySource === 'instance'}
                          onChange={() => setKeySource('instance')}
                          className="text-blue-600"
                        />
                        <span>本实例专用 Key</span>
                      </label>
                    </div>
                    {keySource === 'global' && (
                      <p className="mt-1 text-xs text-gray-400 flex items-center gap-1">
                        <Wifi className="w-3 h-3" />
                        将使用「大模型配置」中保存的全局 Key，无需重复填写
                      </p>
                    )}
                    {keySource === 'instance' && (
                      <input
                        type="password"
                        value={instanceKey}
                        onChange={e => setInstanceKey(e.target.value)}
                        placeholder="输入本实例专用的 API Key"
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button onClick={() => setStep(2)} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                上一步：选择通道
              </button>
              <button
                onClick={() => setStep(4)}
                disabled={
                  overrideModel
                  && (!modelName
                    || (modelProvider === 'volc_ark'
                      && modelName === '__volc_custom_ep__'
                      && !volcCustomEpId.trim()))
                }
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一步：通道凭证
              </button>
            </div>
          </div>
        )}

        {/* ── 步骤 4：通道凭证 ── */}
        {step === 4 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">配置通道凭证</h3>
            <p className="text-sm text-gray-500">
              {CHANNELS.find(c => c.id === selectedChannel)?.name ?? '当前通道'}
              ：请填写各开放平台控制台中的凭证，将随实例写入本机配置。
            </p>

            {selectedChannel === 'dingtalk' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">AppKey（Client ID）</label>
                  <input
                    type="text"
                    value={channelConfig.clientId || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, clientId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="钉钉开放平台 — 企业内部应用 AppKey"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">App Secret（Client Secret）</label>
                  <input
                    type="password"
                    value={channelConfig.clientSecret || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, clientSecret: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="钉钉开放平台 — AppSecret"
                  />
                </div>
              </>
            )}

            {selectedChannel === 'feishu' && (
              <>
                <div className="mb-1">
                  <span className="text-sm font-medium text-gray-700">飞书应用凭证</span>
                  <p className="text-xs text-gray-500 mt-1">
                    请在飞书开放平台创建自建应用，在「凭证与基础信息」中获取 App ID 与 App Secret。
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">App ID</label>
                  <input
                    type="text"
                    value={channelConfig.appId || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, appId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="飞书开放平台 — 自建应用 App ID（如 cli_xxx）"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">App Secret</label>
                  <input
                    type="password"
                    value={channelConfig.appSecret || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, appSecret: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="飞书开放平台 — App Secret"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    白名单（可选）
                  </label>
                  <textarea
                    rows={2}
                    value={channelConfig.allowFrom || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, allowFrom: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                    placeholder="飞书 Open ID，每行一个，留空则不限制（如 ou_xxx）"
                  />
                </div>
              </>
            )}

            {selectedChannel === 'wxwork' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">机器人 Bot ID</label>
                  <input
                    type="text"
                    value={channelConfig.botId || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, botId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="企业微信客户端 → 工作台 → 智能机器人 → API模式 → Bot ID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">机器人 Secret</label>
                  <input
                    type="password"
                    value={channelConfig.secret || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, secret: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="同上一页面获取的 Secret"
                  />
                </div>
              </>
            )}

            {selectedChannel === 'qq' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">App ID</label>
                  <input
                    type="text"
                    value={channelConfig.appId || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, appId: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="QQ 开放平台机器人 — AppID"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Client Secret（AppSecret）</label>
                  <input
                    type="password"
                    value={channelConfig.clientSecret || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, clientSecret: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="QQ 开放平台 — Client Secret / AppSecret"
                  />
                </div>
                <div className="border-t border-gray-200 pt-3 mt-2">
                  <label className="block text-sm font-medium text-gray-700 mb-1">凭证拼接（token 格式）</label>
                  <input
                    type="text"
                    value={channelConfig.token || ''}
                    onChange={e => setChannelConfig({ ...channelConfig, token: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="AppID:Secret（官方 CLI 风格，如 1903703794:BID9wWs1wgNtBG7l）"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    三种填法任选一种：① App ID + Client Secret 单独填上方；② 直接填整条 token（格式 AppID:Secret）；③ token 与单独字段混用，以单独字段优先。
                  </p>
                </div>
              </>
            )}

            {selectedChannel === 'telegram' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Bot Token</label>
                <input
                  type="text"
                  value={channelConfig.botToken || ''}
                  onChange={e => setChannelConfig({ ...channelConfig, botToken: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="BotFather → @你的机器人 → API Token（格式 123456:ABC-DEF...）"
                />
              </div>
            )}

            {selectedChannel === 'wechat_clawbot' && (
              <div className="space-y-3">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 space-y-3">
                  <div className="text-sm text-yellow-900 space-y-2">
                    <p>
                      <strong>授权码从哪来？</strong>
                      仅在终端里<strong>单独出现「请输入 / 请填写设备授权码」</strong>一类提示时，才把终端里显示的那段字符粘贴到下方。
                      多数情况下扫码成功后，登录态会由 OpenClaw 自动保存，<strong>此处可留空</strong>。
                    </p>
                    <p>
                      <strong>扫码后微信里没回复？</strong>
                      先确认：创建实例后已在管理端<strong>重启网关</strong>、该实例为<strong>已启用</strong>，且大模型/API Key 正常。
                      仍无回复时查看 <span className="font-mono text-xs">data/logs/openclaw-gateway.log</span> 是否有微信渠道或 Agent 报错。
                    </p>
                  </div>
                  <div>
                    <div className="flex items-center mb-2">
                      <Smartphone className="w-4 h-4 text-yellow-600 mr-2" />
                      <span className="text-sm font-medium text-yellow-800">设备授权码（可选）</span>
                    </div>
                    <input
                      type="text"
                      value={channelConfig.authCode || ''}
                      onChange={e => setChannelConfig({ ...channelConfig, authCode: e.target.value })}
                      className="w-full px-3 py-2 border border-yellow-300 rounded-lg focus:ring-2 focus:ring-yellow-500 bg-white"
                      placeholder="一般留空；仅当终端明确要求填写授权码时再粘贴"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={() => setStep(3)} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                上一步：选择模型
              </button>
              <button onClick={() => setStep(5)} className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                下一步：确认配置
              </button>
            </div>
          </div>
        )}

        {/* ── 步骤 5：确认配置 ── */}
        {step === 5 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">确认配置</h3>
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-500">机器人</span>
                <span className="font-medium">{activeRobot?.name || selectedRobot?.name || '未选择（使用通用人设）'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">聊天通道</span>
                <span className="font-medium">{CHANNELS.find(c => c.id === selectedChannel)?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">模型</span>
                <span className="font-medium">
                  {overrideModel && modelProvider && modelName
                    ? `${modelProvider} / ${modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' ? volcCustomEpId.trim() : modelName}`
                    : defaultModel?.provider
                      ? `${defaultModel.provider} / ${defaultModel.model_name}（向导默认）`
                      : '向导默认'}
                </span>
              </div>
              {overrideModel && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Key 来源</span>
                  <span className="text-sm font-medium text-blue-600">
                    {keySource === 'global' ? '复用全局已保存 Key' : '本实例专用 Key'}
                  </span>
                </div>
              )}
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(4)} className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                上一步：通道凭证
              </button>
              <button onClick={() => setStep(6)} className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
                下一步：实例名称
              </button>
            </div>
          </div>
        )}

        {/* ── 步骤 6：实例名称 ── */}
        {step === 6 && (
          <div className="space-y-4">
            <h3 className="text-lg font-medium text-gray-900">设置实例名称</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">实例名称</label>
              <input
                type="text"
                value={instanceName}
                onChange={e => setInstanceName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder={`${CHANNELS.find(c => c.id === selectedChannel)?.name}-${activeRobot?.name || '通用人设'}-01`}
              />
            </div>
            {createError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {createError}
              </div>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setStep(5)}
                className="flex-1 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                上一步：确认配置
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={!instanceName.trim() || creating}
                className="flex-1 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center justify-center"
              >
                {creating ? <Loader2 className="w-5 h-5 animate-spin mr-2" /> : null}
                {creating ? '创建中...' : '创建实例'}
              </button>
            </div>
          </div>
        )}
        </>
        )}

      </div>
    </div>
  );
}
