import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Plus, Edit, Trash2, RefreshCw, ArrowLeft, Loader2, X, ChevronDown, ChevronUp, Zap } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import FeishuWizard from '../components/wizard/FeishuWizard';

interface Instance {
  id: string;
  name: string;
  enabled: boolean;
  robot_id: string;
  channel_type: string;
  message_count: number;
  channel_config?: Record<string, string>;
  model?: {
    provider?: string;
    model_name?: string;
    api_key?: string;
    temperature?: number;
    max_tokens?: number;
  };
}

/** 飞书 channel_config 与创建向导对齐；支持 YAML 中 allowFrom 为字符串数组 */
function feishuChannelToFlat(cfg: unknown): Record<string, string> {
  const base: Record<string, string> = {
    appId: '',
    appSecret: '',
    verificationToken: '',
    encryptKey: '',
    dmPolicy: 'pairing',
    allowFrom: '',
    groupPolicy: 'open',
    groupAllowFrom: '',
  };
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return base;
  const o = cfg as Record<string, unknown>;
  const pickStr = (k: string) => (typeof o[k] === 'string' ? (o[k] as string) : '');
  const pickLines = (k: string) => {
    const v = o[k];
    if (typeof v === 'string') return v;
    if (Array.isArray(v)) return v.map(x => String(x)).join('\n');
    return '';
  };
  return {
    ...base,
    appId: pickStr('appId'),
    appSecret: pickStr('appSecret'),
    verificationToken: pickStr('verificationToken'),
    encryptKey: pickStr('encryptKey'),
    dmPolicy: pickStr('dmPolicy') || 'pairing',
    allowFrom: pickLines('allowFrom'),
    groupPolicy: pickStr('groupPolicy') || 'open',
    groupAllowFrom: pickLines('groupAllowFrom'),
  };
}

const PROVIDER_OPTIONS = [
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Claude（Anthropic）' },
  { id: 'google', name: 'Google Gemini' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'minimax', name: 'MiniMax' },
  { id: 'ollama', name: 'Ollama 本地模型' },
  { id: 'volc_ark', name: '火山方舟 · 豆包' },
  { id: 'baidu', name: '百度文心一言' },
  { id: 'aliyun', name: '阿里通义千问' },
  { id: 'zhipu', name: '智谱 GLM' },
  { id: 'moonshot', name: 'Kimi（月之暗面）' },
];

export default function InstancePage() {
  const navigate = useNavigate();
  const { robots } = useAppStore();
  const [instances, setInstances] = useState<Instance[]>([]);
  const [loading, setLoading] = useState(true);

  // 编辑弹窗状态
  const [editing, setEditing] = useState(false);
  const [editTarget, setEditTarget] = useState<Instance | null>(null);
  const [editName, setEditName] = useState('');
  const [editEnabled, setEditEnabled] = useState(true);
  const [editChannelConfig, setEditChannelConfig] = useState<Record<string, string>>({});
  const [editModelProvider, setEditModelProvider] = useState('');
  const [editModelName, setEditModelName] = useState('');
  const [editVolcCustomEpId, setEditVolcCustomEpId] = useState('');
  const [editKeySource, setEditKeySource] = useState<'global' | 'instance'>('global');
  const [editInstanceKey, setEditInstanceKey] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [modelList, setModelList] = useState<any[]>([]);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [modelSectionOpen, setModelSectionOpen] = useState(true);
  const [feishuAdvancedOpen, setFeishuAdvancedOpen] = useState(false);
  const [showFeishuWizard, setShowFeishuWizard] = useState(false);

  useEffect(() => { loadInstances(); }, []);

  const loadInstances = async () => {
    setLoading(true);
    try {
      const result = await invoke<Instance[]>('list_instances');
      setInstances(result);
    } catch (e) { toast.error(String(e)); }
    finally { setLoading(false); }
  };

  // 获取机器人显示名（从模板或本地机器人列表）
  const getRobotName = (robotId: string) => {
    // 先查 builtin templates
    const builtinNames: Record<string, string> = {
      'robot_ecom_001': '抖音/小红书带货助手',
      'robot_ecom_002': '淘宝天猫运营助手',
      'robot_social_001': '小红书运营助手',
      'robot_social_002': '抖音内容创作助手',
      'robot_social_003': '微信公众号助手',
      'robot_stock_001': 'A股资讯助手',
      'robot_stock_002': '数字货币监控助手',
      'robot_content_001': '漫剧剧本生成器',
      'robot_content_002': '小说创作助手',
      'robot_office_001': '企业文档助手',
      'robot_office_002': '企业服务助手',
      'robot_general_001': '私人秘书',
      'robot_general_002': '智能客服基础版',
    };
    if (builtinNames[robotId]) return builtinNames[robotId];
    // 从 zustand 缓存中查
    if (robots?.length) {
      const found = robots.find((r: { id: string; name: string }) => r.id === robotId);
      if (found) return found.name;
    }
    return robotId;
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该实例？相关配置信息将一并清除。')) return;
    try {
      await invoke('delete_instance', { instanceId: id });
      toast.success('实例已删除');
      await loadInstances();
    } catch (e) { toast.error(String(e)); }
  };

  // 打开编辑弹窗
  const openEdit = async (inst: Instance) => {
    setEditTarget(inst);
    setEditName(inst.name);
    setEditEnabled(inst.enabled);
    if (inst.channel_type === 'feishu') {
      const flat = feishuChannelToFlat(inst.channel_config);
      setEditChannelConfig(flat);
      setFeishuAdvancedOpen(
        flat.dmPolicy !== 'pairing'
        || flat.groupPolicy !== 'open'
        || flat.allowFrom.trim().length > 0
        || flat.groupAllowFrom.trim().length > 0,
      );
    } else {
      setEditChannelConfig((inst.channel_config as Record<string, string>) || {});
      setFeishuAdvancedOpen(false);
    }
    setEditModelProvider(inst.model?.provider || '');
    const mid = inst.model?.model_name || '';
    if (inst.model?.provider === 'volc_ark' && mid.startsWith('ep-')) {
      setEditModelName('__volc_custom_ep__');
      setEditVolcCustomEpId(mid);
    } else {
      setEditModelName(mid);
      setEditVolcCustomEpId('');
    }
    const existingKey = inst.model?.api_key?.trim();
    if (existingKey) {
      setEditKeySource('instance');
      setEditInstanceKey(existingKey);
    } else {
      setEditKeySource('global');
      setEditInstanceKey('');
    }
    setModelList([]);
    setModelSectionOpen(true);
    setEditing(true);
  };

  const listModelsApiKey =
    editKeySource === 'instance' && editInstanceKey.trim() ? editInstanceKey.trim() : null;

  // 加载模型列表（本实例 Key 时带上 apiKey，便于需鉴权的供应商拉取列表）
  useEffect(() => {
    if (!editModelProvider) { setModelList([]); return; }
    setModelListLoading(true);
    invoke<any[]>('list_models', { providerId: editModelProvider, apiKey: listModelsApiKey })
      .then(setModelList)
      .catch(() => setModelList([]))
      .finally(() => setModelListLoading(false));
  }, [editModelProvider, editKeySource, editInstanceKey]);

  // 保存编辑
  const handleEditSave = async () => {
    if (!editTarget) return;
    if (
      editModelProvider === 'volc_ark'
      && editModelName === '__volc_custom_ep__'
      && !editVolcCustomEpId.trim()
    ) {
      toast.error('请填写火山方舟推理接入点 ID（ep-xxxx）');
      return;
    }
    const resolvedEditModel =
      editModelProvider === 'volc_ark' && editModelName === '__volc_custom_ep__'
        ? editVolcCustomEpId.trim()
        : editModelName;
    setEditSaving(true);
    try {
      await invoke('update_instance', {
        instanceId: editTarget.id,
        name: editName.trim() || null,
        enabled: editEnabled,
        channelType: null,
        channelConfig: Object.keys(editChannelConfig).length > 0 ? editChannelConfig : null,
        modelConfig: editModelProvider && editModelName ? {
          provider: editModelProvider,
          model_name: resolvedEditModel,
          api_key:
            editKeySource === 'instance' && editInstanceKey.trim()
              ? editInstanceKey.trim()
              : null,
          api_base: null,
          temperature: 0.7,
          max_tokens: 4096,
        } : null,
      });
      toast.success('实例已更新');
      setEditing(false);
      await loadInstances();
    } catch (e) { toast.error(String(e)); }
    finally { setEditSaving(false); }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button type="button" onClick={() => navigate('/home')} className="p-2 text-gray-500 hover:text-gray-700" title="返回首页">
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">实例管理</h1>
              <p className="text-gray-500">管理所有 Agent 实例</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button type="button" onClick={loadInstances} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg flex items-center hover:bg-gray-200">
              <RefreshCw className="w-4 h-4 mr-2" />
              刷新
            </button>
            <button type="button" onClick={() => navigate('/instances/new')} className="px-4 py-2 bg-blue-500 text-white rounded-lg flex items-center hover:bg-blue-600">
              <Plus className="w-4 h-4 mr-2" />
              创建实例
            </button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : instances.length === 0 ? (
          <div className="bg-white rounded-xl shadow-sm p-12 text-center">
            <div className="text-gray-400 mb-4">暂无实例</div>
            <button type="button" onClick={() => navigate('/instances/new')} className="px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
              创建第一个实例
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl shadow-sm overflow-hidden">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">实例名称</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">机器人</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">通道</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">消息</th>
                  <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">状态</th>
                  <th className="px-6 py-3 text-right text-sm font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {instances.map(inst => (
                  <tr key={inst.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{inst.name}</div>
                    </td>
                    <td className="px-6 py-4 text-gray-600">{getRobotName(inst.robot_id)}</td>
                    <td className="px-6 py-4 text-gray-600">
                      {{ dingtalk: '钉钉', feishu: '飞书', wxwork: '企业微信', wechat_clawbot: '微信 ClawBot', telegram: 'Telegram', qq: 'QQ' }[inst.channel_type] || inst.channel_type}
                    </td>
                    <td className="px-6 py-4 text-gray-600">{inst.message_count}</td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 text-xs rounded-full ${inst.enabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-700'}`}>
                        {inst.enabled ? '运行中' : '已停用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => openEdit(inst)}
                          className="p-1 text-gray-500 hover:text-blue-600" title="编辑">
                          <Edit className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDelete(inst.id)}
                          className="p-1 text-red-500 hover:text-red-700" title="删除">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 编辑弹窗 */}
      {editing && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] flex flex-col">
            {/* 弹窗头部 */}
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900">编辑实例</h2>
              <button type="button" onClick={() => setEditing(false)} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            {/* 弹窗内容 */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {/* 实例名称 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">实例名称</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500" />
              </div>
              {/* 机器人（只读） */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">机器人</label>
                <div className="px-3 py-2 bg-gray-50 rounded-lg text-gray-700 text-sm">
                  {editTarget ? getRobotName(editTarget.robot_id) : ''}
                </div>
              </div>
              {/* 启用状态 */}
              <div className="flex items-center gap-3">
                <input type="checkbox" id="editEnabled" checked={editEnabled}
                  onChange={e => setEditEnabled(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600" />
                <label htmlFor="editEnabled" className="text-sm text-gray-700">启用实例</label>
              </div>
              {/* 通道凭证 */}
              {editTarget && editTarget.channel_type === 'feishu' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="block text-sm font-medium text-gray-700">通道凭证</label>
                    <button
                      type="button"
                      onClick={() => setShowFeishuWizard(true)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-50 border border-blue-200 text-blue-600 text-xs hover:bg-blue-100 transition-colors"
                    >
                      <Zap className="w-3 h-3" />
                      飞书向导
                    </button>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">App ID</label>
                    <input
                      type="text"
                      value={editChannelConfig.appId || ''}
                      onChange={e => setEditChannelConfig(prev => ({ ...prev, appId: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="飞书开放平台 — 自建应用 App ID（如 cli_xxx）"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">App Secret</label>
                    <input
                      type="password"
                      value={editChannelConfig.appSecret || ''}
                      onChange={e => setEditChannelConfig(prev => ({ ...prev, appSecret: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="飞书开放平台 — App Secret"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">事件订阅 Verification Token（Webhook 可选）</label>
                    <input
                      type="text"
                      value={editChannelConfig.verificationToken || ''}
                      onChange={e => setEditChannelConfig(prev => ({ ...prev, verificationToken: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="启用事件订阅时填写"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">加密密钥 Encrypt Key（Webhook 可选）</label>
                    <input
                      type="text"
                      value={editChannelConfig.encryptKey || ''}
                      onChange={e => setEditChannelConfig(prev => ({ ...prev, encryptKey: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                      placeholder="事件加密时填写"
                    />
                  </div>

                  <div className="border border-gray-200 rounded-lg overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setFeishuAdvancedOpen(v => !v)}
                      className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium text-gray-800"
                    >
                      <span>配对码与白名单（访问控制）</span>
                      {feishuAdvancedOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                    </button>
                    {feishuAdvancedOpen && (
                      <div className="px-3 py-3 space-y-3 border-t border-gray-100 bg-white">
                        <p className="text-xs text-gray-500 leading-relaxed">
                          配对码由网关在「私信策略」为 pairing 时自动生成，并通过机器人回复给首次私聊的用户，无需在此手动填写。
                          若改为 allowlist，请在下方的私信白名单中填写允许的飞书 Open ID（ou_xxx 等）。
                        </p>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">私信策略（dmPolicy）</label>
                          <select
                            value={editChannelConfig.dmPolicy || 'pairing'}
                            onChange={e => setEditChannelConfig(prev => ({ ...prev, dmPolicy: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="pairing">pairing — 未知用户需输入配对码（默认）</option>
                            <option value="allowlist">allowlist — 仅白名单用户可发私信</option>
                            <option value="open">open — 任何人可发私信</option>
                            <option value="disabled">disabled — 关闭私信</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">私信白名单（allowFrom）</label>
                          <textarea
                            rows={3}
                            value={editChannelConfig.allowFrom || ''}
                            onChange={e => setEditChannelConfig(prev => ({ ...prev, allowFrom: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            placeholder={'飞书 Open ID，每行一个（如 ou_xxx）\ndmPolicy 为 allowlist 时生效'}
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">群聊策略（groupPolicy）</label>
                          <select
                            value={editChannelConfig.groupPolicy || 'open'}
                            onChange={e => setEditChannelConfig(prev => ({ ...prev, groupPolicy: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="open">open — 任何群聊均可触发（默认）</option>
                            <option value="allowlist">allowlist — 仅白名单群聊可触发</option>
                            <option value="disabled">disabled — 关闭群聊响应</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-600 mb-1">群聊白名单（groupAllowFrom）</label>
                          <textarea
                            rows={3}
                            value={editChannelConfig.groupAllowFrom || ''}
                            onChange={e => setEditChannelConfig(prev => ({ ...prev, groupAllowFrom: e.target.value }))}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            placeholder={'飞书 Open ID，每行一个\ngroupPolicy 为 allowlist 时生效'}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
              {editTarget && editTarget.channel_type === 'qq' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">通道凭证</label>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">App ID</label>
                      <input type="text" value={editChannelConfig.appId || ''}
                        onChange={e => setEditChannelConfig(prev => ({ ...prev, appId: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="QQ 开放平台机器人 — AppID" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Client Secret</label>
                      <input type="password" value={editChannelConfig.clientSecret || ''}
                        onChange={e => setEditChannelConfig(prev => ({ ...prev, clientSecret: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="QQ 开放平台 — Client Secret" autoComplete="off" />
                    </div>
                    <div className="border-t border-gray-200 pt-2">
                      <label className="block text-xs text-gray-500 mb-1">凭证拼接（token 格式）</label>
                      <input type="text" value={editChannelConfig.token || ''}
                        onChange={e => setEditChannelConfig(prev => ({ ...prev, token: e.target.value }))}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        placeholder="AppID:Secret（官方 CLI 风格，如 1903703794:BID9wWs1wgNtBG7l）" />
                      <p className="mt-1 text-xs text-gray-500">
                        三种填法任选：① App ID + Client Secret 单独填上方；② 直接填 token（格式 AppID:Secret）；③ token 与单独字段混用，单独字段优先。
                      </p>
                    </div>
                  </div>
                </div>
              )}
              {editTarget && ['dingtalk', 'wxwork', 'telegram', 'wechat_clawbot'].includes(editTarget.channel_type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">通道凭证</label>
                  <div className="space-y-2">
                    {Object.entries(editChannelConfig).map(([k, v]) => (
                      <div key={k}>
                        <label className="block text-xs text-gray-500 mb-1">{k}</label>
                        <input type={k.toLowerCase().includes('secret') || k.toLowerCase().includes('key') && k !== 'appId' ? 'password' : 'text'}
                          value={v} onChange={e => setEditChannelConfig(prev => ({ ...prev, [k]: e.target.value }))}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                          autoComplete="off" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* 模型配置（可收放） */}
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => setModelSectionOpen(v => !v)}
                  className="w-full flex items-center justify-between px-3 py-2.5 bg-gray-50 hover:bg-gray-100 text-left text-sm font-medium text-gray-800"
                >
                  <span>模型配置</span>
                  {modelSectionOpen ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
                </button>
                {modelSectionOpen && (
                  <div className="px-3 py-3 space-y-3 border-t border-gray-100 bg-white">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">供应商</label>
                      <select
                        value={editModelProvider}
                        onChange={e => {
                          setEditModelProvider(e.target.value);
                          setEditModelName('');
                          setEditVolcCustomEpId('');
                          setModelList([]);
                        }}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                      >
                        <option value="">跟随向导默认模型</option>
                        {PROVIDER_OPTIONS.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>

                    {editModelProvider && (
                      <>
                        <div className="space-y-2">
                          <span className="text-xs text-gray-500">API Key</span>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="editKeySource"
                              checked={editKeySource === 'global'}
                              onChange={() => setEditKeySource('global')}
                              className="text-blue-600"
                            />
                            <span>复用「大模型配置」中已保存的 Key</span>
                          </label>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input
                              type="radio"
                              name="editKeySource"
                              checked={editKeySource === 'instance'}
                              onChange={() => setEditKeySource('instance')}
                              className="text-blue-600"
                            />
                            <span>本实例专用 Key（写入实例配置）</span>
                          </label>
                          {editKeySource === 'instance' && (
                            <input
                              type="password"
                              value={editInstanceKey}
                              onChange={e => setEditInstanceKey(e.target.value)}
                              autoComplete="off"
                              placeholder="输入该供应商的 API Key"
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-xs text-gray-500 mb-1">模型</label>
                          {modelListLoading ? (
                            <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                              <Loader2 className="w-4 h-4 animate-spin" />
                              加载中…
                            </div>
                          ) : modelList.length > 0 ? (
                            <select
                              value={editModelName}
                              onChange={e => {
                                const v = e.target.value;
                                setEditModelName(v);
                                if (v !== '__volc_custom_ep__') setEditVolcCustomEpId('');
                              }}
                              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white max-h-40"
                            >
                              <option value="">请选择模型</option>
                              {modelList.map(m => (
                                <option key={m.id} value={m.id}>
                                  {(m.name || m.id) + (m.is_free ? '（免费）' : '')}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="text-sm text-gray-400">
                              {editKeySource === 'instance' && !editInstanceKey.trim()
                                ? '请先填写本实例 API Key，或在「大模型配置」保存全局 Key 后改用复用。'
                                : '暂无可用模型，请检查 Key 或先在「大模型配置」保存该供应商的 Key。'}
                            </div>
                          )}
                          {editModelProvider === 'volc_ark' && editModelName === '__volc_custom_ep__' && (
                            <div className="mt-2">
                              <label className="block text-xs text-gray-600 mb-1">推理接入点 ID（ep-xxxx）</label>
                              <input
                                type="text"
                                value={editVolcCustomEpId}
                                onChange={e => setEditVolcCustomEpId(e.target.value)}
                                placeholder="方舟控制台「在线推理」复制的接入点 ID"
                                className="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-amber-400"
                              />
                              <p className="text-xs text-gray-500 mt-1">
                                鉴权请用方舟「API Key 管理」中的 Ark API Key，不是火山引擎账号的 AK/SK。
                              </p>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
            {/* 弹窗底部 */}
            <div className="px-6 py-4 border-t flex gap-3 justify-end">
              <button type="button" onClick={() => setEditing(false)} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200">
                取消
              </button>
              <button type="button" onClick={handleEditSave} disabled={editSaving}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 flex items-center">
                {editSaving && <Loader2 className="w-4 h-4 animate-spin mr-2" />}
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 飞书自动化配置向导弹窗（管理端实例编辑中） */}
      {showFeishuWizard && (
        <FeishuWizard
          onComplete={({ appId, appSecret }) => {
            setEditChannelConfig(prev => ({
              ...prev,
              appId,
              appSecret,
            }));
            setShowFeishuWizard(false);
          }}
          onCancel={() => setShowFeishuWizard(false)}
        />
      )}
    </div>
  );
}
