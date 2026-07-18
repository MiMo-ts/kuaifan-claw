import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconAlertCircle,
  CxIconArrowLeft,
  CxIconArrowRight,
  CxIconChannel,
  CxIconCheckCircle,
  CxIconChevronRight,
  CxIconConfirm,
  CxIconCredentials,
  CxIconDownload,
  CxIconInfo,
  CxIconLoader,
  CxIconModelConfig,
  CxIconNameTag,
  CxIconQR,
  CxIconSmartphone,
  CxIconSparkles,
  CxIconWifi,
  CxIconWizardRobot,
} from "../icons";
import QuickBindModal, { type QuickBindPlatform, type QuickBindCompleteData } from './QuickBindModal';
import type { ModuleId } from '../../modules/registry';

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
  moduleId?: ModuleId;
}

const C = {
  bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
  bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
  text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
  textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
  accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)', accentHover: 'var(--cx-accent-hover)',
  success: 'var(--cx-success)', successSoft: 'var(--cx-success-soft)',
  warn: 'var(--cx-warn)', warnSoft: 'var(--cx-warn-soft)',
  error: 'var(--cx-error)', errorSoft: 'var(--cx-error-soft)',
};

const STEPS = [
  { n: 1, label: '机器人', desc: '选择要运行的模板' },
  { n: 2, label: '渠道', desc: '选择接入通道' },
  { n: 3, label: '模型', desc: '配置 AI 模型' },
  { n: 4, label: '凭证', desc: '填写通道凭证' },
  { n: 5, label: '确认', desc: '核对所有信息' },
  { n: 6, label: '命名', desc: '设置实例名称' },
];

const ALL_CHANNELS = [
  // OpenClaw 渠道（需安装 npm 插件）
  { id: 'feishu', name: '飞书', icon: '📨', modules: ['openclaw'], pluginId: 'feishu' },
  { id: 'wxwork', name: '企业微信', icon: '🏢', modules: ['openclaw'], pluginId: 'wecom' },
  { id: 'wechat_clawbot', name: '微信', icon: '💬', modules: ['openclaw'], pluginId: 'wechat_clawbot' },
  { id: 'qq', name: 'QQ', icon: '🐧', modules: ['openclaw'], pluginId: 'qq' },
  // Hermes 渠道（内置平台适配器，无需安装插件）
  { id: 'feishu', name: '飞书', icon: '📨', modules: ['hermes'] },
];

function getChannels(moduleId: string) {
  return ALL_CHANNELS.filter(ch => ch.modules.includes(moduleId));
}

const PROVIDER_OPTIONS = [
  { id: 'kuaifan', name: '快泛API（推荐免费模型）' },
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

function Stepper({ step }: { step: number }) {
  return (
    <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid ' + C.borderSoft, background: C.bgSoft }}>
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-[10.5px] font-mono uppercase tracking-[0.08em]" style={{ color: C.textDim }}>
          Step {step} / {STEPS.length}
        </span>
        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: C.borderSoft }}>
          <div
            className="h-full transition-all duration-500"
            style={{
              width: ((step - 1) / (STEPS.length - 1) * 100) + '%',
              background: 'linear-gradient(90deg, ' + C.accent + ' 0%, ' + C.accentHover + ' 100%)',
            }}
          />
        </div>
      </div>
      <div className="flex items-center gap-0.5">
        {STEPS.map((s) => {
          const isCompleted = step > s.n;
          const isCurrent = step === s.n;
          return (
            <div
              key={s.n}
              className="flex-1 flex flex-col items-start px-2 py-1.5 rounded-md transition-colors"
              style={{ background: isCurrent ? C.accentSoft : 'transparent' }}
            >
              <div className="flex items-center gap-1.5 w-full">
                <div
                  className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-semibold shrink-0"
                  style={{
                    background: isCompleted ? C.success : isCurrent ? C.accent : C.bgElev,
                    color: isCompleted || isCurrent ? '#fff' : C.textDim,
                    border: '1px solid ' + (isCompleted ? C.success : isCurrent ? C.accent : C.border),
                  }}
                >
                  {isCompleted ? <CxIconCheckCircle className="w-3 h-3" /> : s.n}
                </div>
                <span
                  className="text-[11.5px] font-medium truncate"
                  style={{ color: isCurrent ? C.accent : isCompleted ? C.text : C.textMute }}
                >
                  {s.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StepHeader({ title, desc, icon: Icon }: { title: string; desc: string; icon?: any }) {
  return (
    <div className="px-6 pt-5 pb-3">
      <div className="flex items-center gap-2.5">
        {Icon && (
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: C.accentSoft, color: C.accent }}
          >
            <Icon className="w-3.5 h-3.5" strokeWidth={2} />
          </div>
        )}
        <div>
          <h2 className="text-[15px] font-semibold leading-tight" style={{ color: C.text }}>{title}</h2>
          <p className="text-[11.5px] leading-tight mt-0.5" style={{ color: C.textMute }}>{desc}</p>
        </div>
      </div>
    </div>
  );
}


function NavFooter({
  onPrev, onNext, prevLabel = '上一步', nextLabel = '下一步',
  nextDisabled = false, loading = false,
}: {
  onPrev: () => void; onNext: () => void;
  prevLabel?: string; nextLabel?: string;
  nextDisabled?: boolean; loading?: boolean;
}) {
  return (
    <div className="px-6 py-4 flex items-center gap-2" style={{ borderTop: '1px solid ' + C.borderSoft, background: C.bgSoft }}>
      <button
        type="button"
        onClick={onPrev}
        className="h-9 px-3.5 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150"
        style={{ color: C.textSoft, background: C.bgElev, border: '1px solid ' + C.border }}
        onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = C.bgElev; e.currentTarget.style.color = C.textSoft; }}
      >
        <CxIconArrowLeft size={14} />
        {prevLabel}
      </button>
      <div className="flex-1" />
      <button
        type="button"
        onClick={onNext}
        disabled={nextDisabled || loading}
        className="h-9 px-4 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-all duration-150 disabled:cursor-not-allowed"
        style={{
          background: nextDisabled || loading ? C.bgHover : C.accent,
          color: nextDisabled || loading ? C.textMute : '#fff',
          boxShadow: nextDisabled || loading ? 'none' : '0 1px 2px rgba(91,127,189,0.25)',
        }}
        onMouseEnter={(e) => { if (!nextDisabled && !loading) e.currentTarget.style.background = C.accentHover; }}
        onMouseLeave={(e) => { if (!nextDisabled && !loading) e.currentTarget.style.background = C.accent; }}
      >
        {loading ? <CxIconLoader className="w-3.5 h-3.5 animate-spin" /> : null}
        {nextLabel}
        {!loading && <CxIconArrowRight size={14} />}
      </button>
    </div>
  );
}

function cxInput(extra = '') {
  return 'w-full h-9 px-3 rounded-lg text-[12.5px] transition-colors duration-150 outline-none ' + extra;
}
function cxTextarea(extra = '') {
  return 'w-full px-3 py-2 rounded-lg text-[12.5px] transition-colors duration-150 outline-none resize-none ' + extra;
}
const inputStyle = {
  background: 'var(--cx-bg-elev)',
  color: 'var(--cx-text)',
  border: '1px solid var(--cx-border)',
};
function focusRing(e: any) {
  e.currentTarget.style.borderColor = 'var(--cx-accent)';
  e.currentTarget.style.boxShadow = '0 0 0 3px var(--cx-accent-ring)';
}
function blurRing(e: any) {
  e.currentTarget.style.borderColor = 'var(--cx-border)';
  e.currentTarget.style.boxShadow = 'none';
}

export default function CreateInstance({ onComplete, onPrev, selectedRobot, moduleId = 'openclaw' }: Props) {
  const [step, setStep] = useState(1);
  const [instanceName, setInstanceName] = useState('');
  const [selectedChannel, setSelectedChannel] = useState('');
  const [channelConfig, setChannelConfig] = useState<Record<string, string>>({});
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [wechatLoginAck, setWechatLoginAck] = useState(false);
  const [pluginState, setPluginState] = useState<Record<string, { installed: boolean; installing: boolean }>>({});
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
  const [quickBindOpen, setQuickBindOpen] = useState(false);
  const [quickBindPlatform, setQuickBindPlatform] = useState<QuickBindPlatform>('feishu');
  const [wechatQuickBindOpen, setWechatQuickBindOpen] = useState(false);

  useEffect(() => { setActiveRobot(selectedRobot); }, [selectedRobot]);

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
    return () => { cancelled = true; };
  }, [step, selectedRobot?.id, activeRobot?.id]);

  useEffect(() => {
    invoke<{provider?: string; model_name?: string}>('get_default_model')
      .then(m => { if (m?.provider) setDefaultModel(m); })
      .catch(() => {});
    invoke<any[]>('list_robots')
      .then(robots => setLocalRobots(robots || []))
      .catch(() => {});
  }, []);

  useEffect(() => { setWechatLoginAck(false); }, [selectedChannel]);

  useEffect(() => {
    if (step !== 2) return;
    const pluginIds = getChannels(moduleId).filter(ch => ch.pluginId).map(ch => ch.pluginId!);
    for (const pid of pluginIds) {
      invoke<boolean>('check_plugin_installed', { pluginId: pid })
        .then(installed => setPluginState(prev => ({ ...prev, [pid]: { ...prev[pid], installed } })))
        .catch(() => setPluginState(prev => ({ ...prev, [pid]: { ...prev[pid], installed: false } })));
    }
  }, [step]);

  const installPlugin = async (pluginId: string, label: string) => {
    setPluginState(prev => ({ ...prev, [pluginId]: { ...prev[pluginId], installing: true } }));
    try {
      await invoke<string>('install_plugin', { pluginId });
      setPluginState(prev => ({ ...prev, [pluginId]: { installed: true, installing: false } }));
      toast.success(`${label}插件已安装`);
    } catch (e) {
      setPluginState(prev => ({ ...prev, [pluginId]: { ...prev[pluginId], installing: false } }));
      toast.error(String(e));
    }
  };

  useEffect(() => {
    if (!overrideModel || !modelProvider) return;
    setInstModelLoading(true);
    setInstModelList([]);
    setModelName('');
    setVolcCustomEpId('');
    invoke<any[]>('list_models', { providerId: modelProvider, apiKey: null })
      .then(models => { setInstModelList(models || []); })
      .catch(() => { setInstModelList([]); })
      .finally(() => { setInstModelLoading(false); });
  }, [overrideModel, modelProvider]);

  const handleCreate = async () => {
    setCreateError(null);
    if (!selectedChannel) { setCreateError('未选择聊天渠道，请使用「上一步」回到第 2 步选择渠道。'); return; }
    if (overrideModel && !modelName) { setCreateError('请在第 3 步中选择具体模型，或取消「本实例指定模型」勾选。'); return; }
    if (overrideModel && modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' && !volcCustomEpId.trim()) {
      setCreateError('请在「自定义」下填写火山方舟推理接入点 ID（ep-xxxx）。');
      return;
    }
    const trimmedName = instanceName.trim();
    if (!trimmedName) { setCreateError('请填写实例名称。'); return; }
    setCreating(true);
    try {
      const resolvedModelName = modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__'
        ? volcCustomEpId.trim() : modelName;
      const modelConfig = overrideModel && modelProvider && modelName
        ? { provider: modelProvider, model_name: resolvedModelName,
            api_key: keySource === 'instance' && instanceKey ? instanceKey : null,
            api_base: null, temperature: 0.7, max_tokens: 4096 }
        : null;
      await invoke('create_instance', {
        name: trimmedName, robotId: activeRobot?.id ?? null,
        channelType: selectedChannel, channelConfig, modelConfig,
        maxHistory: 50, responseMode: 'stream', moduleId,
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


  return (
    <div className="flex flex-col" style={{ minHeight: 560 }}>
      <Stepper step={step} />

      <div className="flex-1">
        {created ? (
          <div className="text-center py-12 px-6">
            <div className="w-14 h-14 mx-auto rounded-full flex items-center justify-center mb-4" style={{ background: C.successSoft, color: C.success }}>
              <CxIconCheckCircle className="w-7 h-7" strokeWidth={2} />
            </div>
            <h2 className="text-[18px] font-semibold mb-1.5" style={{ color: C.text }}>实例创建成功</h2>
            <p className="text-[12.5px] mb-5" style={{ color: C.textMute }}>
              实例 "{instanceName}" 已成功创建
            </p>
            {selectedChannel === 'wechat_clawbot' && (
              <div className="text-left text-[12px] px-3.5 py-2.5 rounded-lg mb-5 max-w-md mx-auto" style={{ background: C.warnSoft, color: C.warn, border: '1px solid ' + C.warn + '40' }}>
                <div className="flex items-start gap-2">
                  <CxIconInfo className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div>
                    若网关此前在运行，系统会在<strong>后台</strong>重启网关以加载微信通道（含插件检查，可能需 1–2 分钟）。
                    请稍后在首页确认「网关 · 运行中」；未完成前微信可能暂不可用，也可手动点「重启网关」。
                  </div>
                </div>
              </div>
            )}
            <button
              type="button"
              onClick={onComplete}
              className="h-9 px-5 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5"
              style={{ background: C.accent, color: '#fff', boxShadow: '0 1px 2px rgba(91,127,189,0.25)' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.accentHover; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = C.accent; }}
            >
              进入首页
              <CxIconArrowRight size={14} />
            </button>
          </div>
        ) : (
          <>
            {/* ===== 步骤 1：选机器人 ===== */}
            {step === 1 && (
              <div>
                <StepHeader title="选择机器人" desc="可从商店已下载的模板中挑选，或使用通用助手" icon={CxIconWizardRobot} />
                <div className="px-6 pb-6 space-y-3">
                  {activeRobot?.id ? (
                    <div
                      className="p-4 rounded-lg flex items-start gap-3"
                      style={{ background: C.accentSoft, border: '1px solid ' + C.accent + '40' }}
                    >
                      <div
                        className="w-12 h-12 rounded-lg flex items-center justify-center text-[24px] shrink-0"
                        style={{ background: C.bgElev, boxShadow: 'inset 0 0 0 1px ' + C.borderSoft }}
                      >
                        {activeRobot.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-semibold" style={{ color: C.text }}>{activeRobot.name}</span>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ background: C.accent, color: '#fff' }}>已选</span>
                        </div>
                        <div className="text-[10.5px] font-mono mt-0.5" style={{ color: C.textDim }}>{activeRobot.id}</div>
                        <div className="text-[12px] mt-1.5 leading-relaxed" style={{ color: C.textSoft }}>
                          {activeRobot.description}
                        </div>
                        {activeRobot.system_prompt && String(activeRobot.system_prompt).trim().length > 0 && (
                          <details className="mt-2">
                            <summary className="text-[11.5px] cursor-pointer select-none" style={{ color: C.accent }}>
                              查看人设、职能与工作流
                            </summary>
                            <div
                              className="mt-2 px-2.5 py-2 rounded-md text-[11.5px] leading-relaxed max-h-40 overflow-y-auto"
                              style={{ background: C.bgElev, color: C.textSoft, border: '1px solid ' + C.borderSoft, whiteSpace: 'pre-wrap' }}
                            >
                              {activeRobot.system_prompt}
                            </div>
                          </details>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div
                      className="p-5 rounded-lg text-center"
                      style={{ background: C.bgSoft, border: '1px dashed ' + C.border }}
                    >
                      <CxIconWizardRobot size={28} className="mx-auto mb-2" style={{ color: C.textDim }} />
                      <div className="text-[12.5px] font-medium" style={{ color: C.textSoft }}>未选择机器人</div>
                      <div className="text-[11px] mt-1 mb-3" style={{ color: C.textMute }}>将使用通用人设 + openclaw 默认 skills</div>
                      <button
                        type="button"
                        onClick={onPrev}
                        className="h-8 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5"
                        style={{ background: C.bgElev, color: C.textSoft, border: '1px solid ' + C.border }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = C.bgElev; }}
                      >
                        去机器人商店挑选
                        <CxIconArrowRight size={14} />
                      </button>
                    </div>
                  )}

                  {localRobots.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowLocalRobots(v => !v)}
                        className="flex items-center gap-1 text-[11.5px] font-medium"
                        style={{ color: C.accent }}
                      >
                        <CxIconWizardRobot size={14} />
                        已下载的机器人（{localRobots.length}）
                        <CxIconChevronRight className={`w-3.5 h-3.5 transition-transform ${showLocalRobots ? 'rotate-90' : ''}`} />
                      </button>
                      {showLocalRobots && (
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          {localRobots.map(r => (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => { setActiveRobot({ ...r, id: r.id }); setShowLocalRobots(false); }}
                              className="p-3 rounded-lg text-left transition-colors"
                              style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft }}
                              onMouseEnter={(e) => { e.currentTarget.style.borderColor = C.accent; e.currentTarget.style.background = C.accentSoft; }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderColor = C.borderSoft; e.currentTarget.style.background = C.bgElev; }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-[22px]">{r.icon || '🤖'}</span>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[12.5px] font-medium truncate" style={{ color: C.text }}>{r.name}</div>
                                  <div className="text-[10.5px] font-mono truncate" style={{ color: C.textDim }}>
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
                </div>
                <NavFooter
                  onPrev={onPrev}
                  onNext={() => setStep(2)}
                  prevLabel="返回商店"
                  nextLabel={activeRobot?.id ? '下一步：选渠道' : '下一步（通用助手）'}
                />
              </div>
            )}


            {/* ===== 步骤 2：选渠道 ===== */}
            {step === 2 && (
              <div>
                <StepHeader title="选择聊天渠道" desc="点击卡片选择通道，需先安装对应插件" icon={CxIconChannel} />
                <div className="px-6 pb-6 space-y-3">
                  <div className="grid grid-cols-3 gap-2.5">
                    {getChannels(moduleId).map(ch => {
                      const ps = ch.pluginId ? pluginState[ch.pluginId] : null;
                      const installed = ps?.installed ?? false;
                      const installing = ps?.installing ?? false;
                      const active = selectedChannel === ch.id;
                      return (
                        <button
                          key={ch.id}
                          type="button"
                          onClick={() => {
                            if (selectedChannel !== ch.id) { setChannelConfig({}); setWechatLoginAck(false); }
                            setSelectedChannel(ch.id);
                          }}
                          className="rounded-lg text-left transition-all overflow-hidden"
                          style={{
                            background: active ? C.accentSoft : C.bgElev,
                            border: '1px solid ' + (active ? C.accent : C.border),
                            boxShadow: active ? '0 0 0 1px ' + C.accent : 'none',
                          }}
                        >
                          <div className="p-3.5 pb-2">
                            <div className="text-[26px] mb-1 leading-none">{ch.icon}</div>
                            <div className="text-[12.5px] font-semibold" style={{ color: active ? C.accent : C.text }}>
                              {ch.name}
                            </div>
                          </div>
                          {ch.pluginId && (
                            <div
                              className="px-3 py-1.5 flex items-center justify-center text-[10.5px] font-medium"
                              style={{ borderTop: '1px solid ' + (active ? C.accent + '40' : C.borderSoft), background: C.bgSoft, color: C.textMute }}
                            >
                              {installing ? (
                                <span className="inline-flex items-center gap-1" style={{ color: C.textSoft }}>
                                  <CxIconLoader className="w-3 h-3 animate-spin" />安装中
                                </span>
                              ) : installed ? (
                                <span className="inline-flex items-center gap-1" style={{ color: C.success }}>
                                  <CxIconCheckCircle className="w-3 h-3" />已安装
                                </span>
                              ) : (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); installPlugin(ch.pluginId!, ch.name); }}
                                  onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); installPlugin(ch.pluginId!, ch.name); } }}
                                  className="inline-flex items-center gap-1 cursor-pointer"
                                  style={{ color: C.accent }}
                                >
                                  <CxIconDownload className="w-3 h-3" />安装插件
                                </span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  <div className="text-[11px] flex items-start gap-1.5 px-2.5 py-2 rounded-md" style={{ background: C.warnSoft, color: C.warn }}>
                    <CxIconInfo className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>未安装的渠道卡片仍可选择，但下一步需要安装后才能继续。</span>
                  </div>
                </div>
                <NavFooter
                  onPrev={() => setStep(1)}
                  onNext={() => setStep(3)}
                  prevLabel="上一步"
                  nextLabel="下一步：选模型"
                  nextDisabled={!selectedChannel}
                />
              </div>
            )}

            {/* ===== 步骤 3：选模型 ===== */}
            {step === 3 && (
              <div>
                <StepHeader title="配置 AI 模型" desc="使用向导默认，或为本实例单独指定" icon={CxIconModelConfig} />
                <div className="px-6 pb-6 space-y-3">
                  <label
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-pointer"
                    style={{ background: C.bgSoft, border: '1px solid ' + C.borderSoft }}
                  >
                    <input
                      type="checkbox"
                      checked={overrideModel}
                      onChange={e => setOverrideModel(e.target.checked)}
                      className="w-4 h-4 rounded"
                      style={{ accentColor: C.accent }}
                    />
                    <span className="text-[12.5px] font-medium" style={{ color: C.text }}>
                      本实例指定模型（覆盖向导默认）
                    </span>
                  </label>

                  {!overrideModel && defaultModel?.provider && (
                    <div
                      className="p-3.5 rounded-lg"
                      style={{ background: C.accentSoft, border: '1px solid ' + C.accent + '40' }}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-[10.5px] font-mono uppercase tracking-wider mb-1" style={{ color: C.accent }}>
                            向导默认
                          </div>
                          <div className="text-[13px] font-semibold" style={{ color: C.text }}>
                            {defaultModel.provider} <span style={{ color: C.textMute }}>/</span> {defaultModel.model_name}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideModel(true);
                            setModelProvider(defaultModel!.provider!);
                          }}
                          className="text-[11.5px] font-medium underline-offset-2 hover:underline shrink-0"
                          style={{ color: C.accent }}
                        >
                          改成本实例
                        </button>
                      </div>
                    </div>
                  )}

                  {!overrideModel && !defaultModel?.provider && (
                    <div
                      className="p-3 rounded-lg text-[12px] flex items-start gap-2"
                      style={{ background: C.warnSoft, color: C.warn, border: '1px solid ' + C.warn + '40' }}
                    >
                      <CxIconAlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>未配置向导默认模型，请勾选上方的「本实例指定模型」进行配置。</span>
                    </div>
                  )}

                  {overrideModel && (
                    <div className="space-y-3">
                      <div>
                        <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>供应商</label>
                        <select
                          value={modelProvider}
                          onChange={e => {
                            setModelProvider(e.target.value);
                            setModelName('');
                            setInstModelList([]);
                          }}
                          className={cxInput('appearance-none cursor-pointer')}
                          style={inputStyle}
                          onFocus={focusRing}
                          onBlur={blurRing}
                        >
                          <option value="">— 选择供应商 —</option>
                          {PROVIDER_OPTIONS.map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>
                      </div>

                      {modelProvider && (
                        <div>
                          <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>
                            模型 {modelProvider === 'ollama' ? '（本地）' : ''}
                          </label>
                          {instModelLoading ? (
                            <div className="flex items-center gap-2 text-[12px] py-2" style={{ color: C.textMute }}>
                              <CxIconLoader className="w-3.5 h-3.5 animate-spin" />加载模型列表…
                            </div>
                          ) : instModelList.length > 0 ? (
                            <div className="max-h-48 overflow-y-auto rounded-lg" style={{ border: '1px solid ' + C.border }}>
                              {instModelList.map(m => {
                                const sel = modelName === m.id;
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => { setModelName(m.id); if (m.id !== '__volc_custom_ep__') setVolcCustomEpId(''); }}
                                    className="w-full text-left px-3 py-2 text-[12px] transition-colors"
                                    style={{
                                      background: sel ? C.accentSoft : C.bgElev,
                                      borderLeft: '2px solid ' + (sel ? C.accent : 'transparent'),
                                      color: sel ? C.accent : C.textSoft,
                                    }}
                                    onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = C.bgSoft; }}
                                    onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = C.bgElev; }}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="font-medium">{m.name || m.id}</span>
                                      {m.is_free && (
                                        <span
                                          className="text-[9.5px] font-mono px-1.5 py-0.5 rounded"
                                          style={{ background: C.successSoft, color: C.success }}
                                        >
                                          FREE
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[10.5px] font-mono mt-0.5 truncate" style={{ color: C.textDim }}>{m.id}</div>
                                  </button>
                                );
                              })}
                            </div>
                          ) : (
                            <div
                              className="text-[12px] py-2.5 px-3 rounded-lg flex items-start gap-2"
                              style={{ background: C.warnSoft, color: C.warn }}
                            >
                              <CxIconInfo className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                              <span>暂无可用模型，请先在「大模型配置」保存该供应商的 API Key。</span>
                            </div>
                          )}
                          {modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' && (
                            <div className="mt-2">
                              <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>
                                推理接入点 ID（ep-xxxx）
                              </label>
                              <input
                                type="text"
                                value={volcCustomEpId}
                                onChange={e => setVolcCustomEpId(e.target.value)}
                                placeholder="从方舟控制台「在线推理」复制接入点 ID"
                                className={cxInput('font-mono')}
                                style={{ ...inputStyle, borderColor: C.warn }}
                                onFocus={focusRing}
                                onBlur={blurRing}
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {modelProvider && (
                        <div>
                          <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>API Key 来源</label>
                          <div className="flex gap-4 mb-2">
                            {[
                              { v: 'global' as const, l: '复用全局已保存的 Key' },
                              { v: 'instance' as const, l: '本实例专用 Key' },
                            ].map(opt => {
                              const sel = keySource === opt.v;
                              return (
                                <label key={opt.v} className="flex items-center gap-1.5 cursor-pointer">
                                  <input
                                    type="radio"
                                    name="keySource"
                                    value={opt.v}
                                    checked={sel}
                                    onChange={() => setKeySource(opt.v)}
                                    className="w-3.5 h-3.5"
                                    style={{ accentColor: C.accent }}
                                  />
                                  <span className="text-[12px]" style={{ color: C.textSoft }}>{opt.l}</span>
                                </label>
                              );
                            })}
                          </div>
                          {keySource === 'global' && (
                            <div className="text-[11px] flex items-center gap-1.5" style={{ color: C.textMute }}>
                              <CxIconWifi className="w-3 h-3" />将使用「大模型配置」中保存的全局 Key，无需重复填写
                            </div>
                          )}
                          {keySource === 'instance' && (
                            <input
                              type="password"
                              value={instanceKey}
                              onChange={e => setInstanceKey(e.target.value)}
                              placeholder="输入本实例专用的 API Key"
                              className={cxInput()}
                              style={inputStyle}
                              onFocus={focusRing}
                              onBlur={blurRing}
                            />
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
                <NavFooter
                  onPrev={() => setStep(2)}
                  onNext={() => setStep(4)}
                  prevLabel="上一步"
                  nextLabel="下一步：填凭证"
                  nextDisabled={
                    overrideModel && (!modelName
                      || (modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' && !volcCustomEpId.trim()))
                  }
                />
              </div>
            )}


            {/* ===== 步骤 4：通道凭证 ===== */}
            {step === 4 && (
              <div>
                <StepHeader
                  title="配置通道凭证"
                  desc={getChannels(moduleId).find(c => c.id === selectedChannel)?.name || '当前渠道'}
                  icon={CxIconCredentials}
                />
                <div className="px-6 pb-6 space-y-3">
                  {selectedChannel === 'feishu' && (
                    <div
                      className="rounded-lg p-4 space-y-2.5"
                      style={{ background: C.accentSoft, border: '1px solid ' + C.accent + '40' }}
                    >
                      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: C.accent }}>
                        <CxIconSparkles className="w-4 h-4" />推荐：扫码快捷绑定
                      </div>
                      <p className="text-[12px] leading-relaxed" style={{ color: C.textSoft }}>
                        使用飞书 App 扫描二维码，自动创建应用并获取凭证，无需手动填写下方表单。
                      </p>
                      <button
                        type="button"
                        onClick={() => { setQuickBindPlatform('feishu'); setQuickBindOpen(true); }}
                        className="h-8 px-3.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5"
                        style={{ background: C.accent, color: '#fff', boxShadow: '0 1px 2px rgba(91,127,189,0.25)' }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = C.accentHover; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = C.accent; }}
                      >
                        <CxIconQR className="w-3.5 h-3.5" />扫码绑定飞书
                      </button>
                    </div>
                  )}

                  {selectedChannel === 'wechat_clawbot' && (
                    <div
                      className="rounded-lg p-4 space-y-2.5"
                      style={{ background: C.successSoft, border: '1px solid ' + C.success + '40' }}
                    >
                      <div className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: C.success }}>
                        <CxIconQR className="w-4 h-4" />扫码绑定微信
                      </div>
                      <p className="text-[12px] leading-relaxed" style={{ color: C.textSoft }}>
                        页面内直接显示微信扫码二维码。扫码成功后 bot_token 自动填入下方。
                      </p>
                      <button
                        type="button"
                        onClick={() => setWechatQuickBindOpen(true)}
                        className="h-8 px-3.5 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5"
                        style={{ background: C.success, color: '#fff' }}
                      >
                        <CxIconQR className="w-3.5 h-3.5" />扫码绑定微信
                      </button>
                    </div>
                  )}

                  <p className="text-[11.5px]" style={{ color: C.textMute }}>
                    {getChannels(moduleId).find(c => c.id === selectedChannel)?.name ?? '当前渠道'}：也可手动填写各开放平台控制台中的凭证。
                  </p>

                  {selectedChannel === 'feishu' && (
                    <>
                      <div>
                        <span className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>飞书应用凭证</span>
                        <p className="text-[11px] mb-2" style={{ color: C.textMute }}>
                          请在飞书开放平台创建自建应用，在「凭证与基础信息」中获取 App ID 与 App Secret。
                        </p>
                      </div>
                      <Field label="App ID" value={channelConfig.appId || ''} onChange={v => setChannelConfig({ ...channelConfig, appId: v })}
                        placeholder="飞书开放平台 → 自建应用 App ID（如 cli_xxx）" />
                      <Field label="App Secret" type="password" value={channelConfig.appSecret || ''}
                        onChange={v => setChannelConfig({ ...channelConfig, appSecret: v })}
                        placeholder="飞书开放平台 → App Secret" />
                      <div>
                        <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>
                          白名单（可选）
                        </label>
                        <textarea
                          rows={2}
                          value={channelConfig.allowFrom || ''}
                          onChange={e => setChannelConfig({ ...channelConfig, allowFrom: e.target.value })}
                          className={cxTextarea()}
                          style={inputStyle}
                          onFocus={focusRing}
                          onBlur={blurRing}
                          placeholder={'飞书 Open ID，每行一个，留空则不限制（如 ou_xxx）'}
                        />
                      </div>
                    </>
                  )}

                  {selectedChannel === 'wxwork' && (
                    <>
                      <Field label="机器人 Bot ID" value={channelConfig.botId || ''} onChange={v => setChannelConfig({ ...channelConfig, botId: v })}
                        placeholder="企业微信客户端 → 工作台 → 智能机器人 → API模式 → Bot ID" />
                      <Field label="机器人 Secret" type="password" value={channelConfig.secret || ''}
                        onChange={v => setChannelConfig({ ...channelConfig, secret: v })}
                        placeholder="同一页面获取的 Secret" />
                    </>
                  )}

                  {selectedChannel === 'qq' && (
                    <>
                      <Field label="App ID" value={channelConfig.appId || ''} onChange={v => setChannelConfig({ ...channelConfig, appId: v })}
                        placeholder="QQ 开放平台机器人 → AppID" />
                      <Field label="Client Secret（AppSecret）" type="password" value={channelConfig.clientSecret || ''}
                        onChange={v => setChannelConfig({ ...channelConfig, clientSecret: v })}
                        placeholder="QQ 开放平台 → Client Secret / AppSecret" />
                      <div className="pt-2 mt-1" style={{ borderTop: '1px dashed ' + C.borderSoft }}>
                        <Field label="凭证拼接（token 格式）" value={channelConfig.token || ''}
                          onChange={v => setChannelConfig({ ...channelConfig, token: v })}
                          placeholder="AppID:Secret（官方 CLI 风格，如 1903703794:BID9wWs1wgNtBG7l）" />
                        <p className="mt-1 text-[11px] leading-relaxed" style={{ color: C.textMute }}>
                          三种填法任选一种：① App ID + Client Secret 单独填上面；② 直接填整条 token（格式 AppID:Secret）；③ token 与单独字段混用，以单独字段优先。
                        </p>
                      </div>
                    </>
                  )}

                  {selectedChannel === 'wechat_clawbot' && (
                    <div
                      className="p-3.5 rounded-lg space-y-2.5"
                      style={{ background: C.warnSoft, border: '1px solid ' + C.warn + '40' }}
                    >
                      <div className="text-[12px] space-y-1.5" style={{ color: C.warn }}>
                        <p>
                          <strong>授权码从哪来？</strong>仅在终端里<strong>单独出现</strong>「请输入 / 请填写设备授权码」一类提示时，才把终端里显示的那段字符粘贴到下方。
                          多数情况下扫码成功后，登录态会由 OpenClaw 自动保存，<strong>此处可留空</strong>。
                        </p>
                        <p>
                          <strong>扫码后微信里没回复？</strong>先确认：创建实例后已在管理端<strong>重启网关</strong>、该实例中<strong>已启用</strong>，且大模型 API Key 正常。
                          仍无回复时查看 <span className="font-mono text-[10.5px]">data/logs/openclaw-gateway.log</span> 是否有微信链路或 Agent 报错。
                        </p>
                      </div>
                      <div>
                        <label className="block text-[11.5px] font-medium mb-1.5 flex items-center gap-1" style={{ color: C.warn }}>
                          <CxIconSmartphone className="w-3 h-3" />设备授权码（可选）
                        </label>
                        <input
                          type="text"
                          value={channelConfig.authCode || ''}
                          onChange={e => setChannelConfig({ ...channelConfig, authCode: e.target.value })}
                          className={cxInput()}
                          style={{ ...inputStyle, borderColor: C.warn }}
                          onFocus={focusRing}
                          onBlur={blurRing}
                          placeholder="一般留空；仅当终端明确要求填写授权码时再粘贴"
                        />
                      </div>
                    </div>
                  )}
                </div>
                <NavFooter
                  onPrev={() => setStep(3)}
                  onNext={() => setStep(5)}
                  prevLabel="上一步"
                  nextLabel="下一步：确认"
                />
              </div>
            )}


            {/* ===== 步骤 5：确认配置 ===== */}
            {step === 5 && (
              <div>
                <StepHeader title="确认配置" desc="核对信息后进入下一步命名" icon={CxIconConfirm} />
                <div className="px-6 pb-6 space-y-2">
                  <div
                    className="rounded-lg divide-y"
                    style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft }}
                  >
                    <ConfirmRow label="机器人" value={activeRobot?.name || selectedRobot?.name || '未选择（使用通用人设）'} />
                    <ConfirmRow label="聊天渠道" value={getChannels(moduleId).find(c => c.id === selectedChannel)?.name || '—'} />
                    <ConfirmRow
                      label="模型"
                      value={
                        overrideModel && modelProvider && modelName
                          ? `${modelProvider} / ${modelProvider === 'volc_ark' && modelName === '__volc_custom_ep__' ? volcCustomEpId.trim() : modelName}`
                          : defaultModel?.provider
                            ? `${defaultModel.provider} / ${defaultModel.model_name}（向导默认）`
                            : '向导默认'
                      }
                    />
                    {overrideModel && (
                      <ConfirmRow
                        label="Key 来源"
                        value={keySource === 'global' ? '复用全局已保存 Key' : '本实例专用 Key'}
                        valueColor={C.accent}
                      />
                    )}
                  </div>
                </div>
                <NavFooter
                  onPrev={() => setStep(4)}
                  onNext={() => setStep(6)}
                  prevLabel="上一步"
                  nextLabel="下一步：命名"
                />
              </div>
            )}

            {/* ===== 步骤 6：实例名称 ===== */}
            {step === 6 && (
              <div>
                <StepHeader title="设置实例名称" desc="用于在实例列表中识别此实例" icon={CxIconNameTag} />
                <div className="px-6 pb-6 space-y-3">
                  <div>
                    <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>实例名称</label>
                    <input
                      type="text"
                      value={instanceName}
                      onChange={e => setInstanceName(e.target.value)}
                      className={cxInput()}
                      style={inputStyle}
                      onFocus={focusRing}
                      onBlur={blurRing}
                      placeholder={`${getChannels(moduleId).find(c => c.id === selectedChannel)?.name}-${activeRobot?.name || '通用助手'}-01`}
                    />
                    <p className="mt-1.5 text-[11px]" style={{ color: C.textMute }}>
                      建议使用「渠道-机器人-序号」格式便于区分。
                    </p>
                  </div>
                  {createError && (
                    <div
                      className="text-[12px] px-3 py-2 rounded-lg flex items-start gap-2"
                      style={{ background: C.errorSoft, color: C.error, border: '1px solid ' + C.error + '40' }}
                    >
                      <CxIconAlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span>{createError}</span>
                    </div>
                  )}
                </div>
                <div
                  className="px-6 py-4 flex items-center gap-2"
                  style={{ borderTop: '1px solid ' + C.borderSoft, background: C.bgSoft }}
                >
                  <button
                    type="button"
                    onClick={() => setStep(5)}
                    className="h-9 px-3.5 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-colors duration-150"
                    style={{ color: C.textSoft, background: C.bgElev, border: '1px solid ' + C.border }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = C.bgElev; e.currentTarget.style.color = C.textSoft; }}
                  >
                    <CxIconArrowLeft size={14} />上一步
                  </button>
                  <div className="flex-1" />
                  <button
                    type="button"
                    onClick={handleCreate}
                    disabled={!instanceName.trim() || creating}
                    className="h-9 px-5 rounded-lg text-[12.5px] font-medium inline-flex items-center gap-1.5 transition-all duration-150 disabled:cursor-not-allowed"
                    style={{
                      background: !instanceName.trim() || creating ? C.bgHover : C.accent,
                      color: !instanceName.trim() || creating ? C.textMute : '#fff',
                      boxShadow: !instanceName.trim() || creating ? 'none' : '0 1px 2px rgba(91,127,189,0.25)',
                    }}
                    onMouseEnter={(e) => { if (instanceName.trim() && !creating) e.currentTarget.style.background = C.accentHover; }}
                    onMouseLeave={(e) => { if (instanceName.trim() && !creating) e.currentTarget.style.background = C.accent; }}
                  >
                    {creating ? <CxIconLoader className="w-3.5 h-3.5 animate-spin" /> : null}
                    {creating ? '创建中…' : '创建实例'}
                    {!creating && <CxIconArrowRight size={14} />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>


      {quickBindOpen && (
        <QuickBindModal
          platform={quickBindPlatform}
          onComplete={(data: QuickBindCompleteData) => {
            setQuickBindOpen(false);
            if (data.appId && data.appSecret) {
              setChannelConfig(prev => ({
                ...prev,
                appId: data.appId!,
                appSecret: data.appSecret!,
                allowFrom: data.allowFrom ?? prev.allowFrom,
                dmPolicy: data.dmPolicy ?? prev.dmPolicy,
              }));
              toast.success('飞书绑定成功，凭证已自动填入');
            } else {
              toast.error('绑定成功但未获取到完整凭证，请手动填写');
            }
          }}
          onCancel={() => setQuickBindOpen(false)}
        />
      )}

      {wechatQuickBindOpen && (
        <QuickBindModal
          platform="wechat"
          onComplete={(data: QuickBindCompleteData) => {
            setWechatQuickBindOpen(false);
            if (data.authCode) {
              setChannelConfig(prev => ({ ...prev, authCode: data.authCode! }));
              setWechatLoginAck(true);
              toast.success('微信绑定成功，bot_token 已自动填入');
            } else {
              toast.error('绑定成功但未获取到 token，请重试');
            }
          }}
          onCancel={() => setWechatQuickBindOpen(false)}
        />
      )}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void;
  placeholder?: string; type?: string;
}) {
  return (
    <div>
      <label className="block text-[11.5px] font-medium mb-1.5" style={{ color: C.textSoft }}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={cxInput('font-mono')}
        style={inputStyle}
        onFocus={focusRing}
        onBlur={blurRing}
      />
    </div>
  );
}

function ConfirmRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
      <span className="text-[11.5px] font-mono uppercase tracking-wider" style={{ color: C.textMute }}>{label}</span>
      <span
        className="text-[12.5px] font-medium text-right truncate max-w-[60%]"
        style={{ color: valueColor || C.text }}
      >
        {value}
      </span>
    </div>
  );
}
