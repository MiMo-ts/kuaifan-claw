import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RefreshCw, BarChart3, Clock, Hash, Database, Server, MessageSquare, TrendingUp, Monitor, Wallet } from 'lucide-react';
import MonitoringDashboard from '../components/MonitoringDashboard';
import CostControlPanel from '../components/CostControlPanel';

// ─── 管理端用量（来源：token_usage.jsonl）──────────────────────────────────

interface ManagerSummary {
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  record_count: number;
  by_provider: Record<string, number>;
}

interface ManagerRecord {
  ts: string;
  provider: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  source: string;
}

// ─── 网关用量（来源：OpenClaw Gateway API）────────────────────────────────

interface GatewaySession {
  key: string;
  label?: string;
  sessionId: string;
  updatedAt: number;
  agentId?: string;
  channel?: string;
  chatType?: string;
  origin?: Record<string, unknown>;
  usage?: SessionUsage;
  modelProvider?: string;
  model?: string;
}

interface SessionUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
  messageCounts?: MessageCounts;
  modelUsage?: ModelUsageEntry[];
  dailyBreakdown?: DailyBreakdown[];
  /** transcript 内最后一条带时间戳的活动（毫秒），比 store.updatedAt 更能反映真实最近对话 */
  lastActivity?: number;
}

interface MessageCounts {
  total: number;
  user: number;
  assistant: number;
  toolCalls: number;
  toolResults: number;
  errors: number;
}

interface ModelUsageEntry {
  provider: string;
  model: string;
  count: number;
  totals: SessionUsage;
}

interface DailyBreakdown {
  date: string;
  tokens: number;
  cost: number;
  messages?: number;
  toolCalls?: number;
  errors?: number;
}

interface GatewayResult {
  updatedAt: number;
  startDate: string;
  endDate: string;
  sessions: GatewaySession[];
  totals: SessionUsage;
  aggregates: {
    messages: MessageCounts;
    byModel: ModelUsageEntry[];
    byProvider: ModelUsageEntry[];
    daily: DailyBreakdown[];
  };
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  xiaomi: '小米 MiMo',
  minimax: 'MiniMax',
  volcengine: '火山方舟',
  baidu: '百度文心',
  aliyun: '阿里通义',
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  ollama: 'Ollama',
};

function providerName(id: string) {
  return PROVIDER_NAMES[id] || id;
}

/** store 未写 channel 时，与网关 usage.js 一致的 key 推断（如 agent:x:feishu:group:id → feishu） */
function inferGatewayChannelFromSessionKey(key: string): string | undefined {
  const raw = (key ?? '').trim();
  if (!raw.toLowerCase().startsWith('agent:')) return undefined;
  const parts = raw.split(':').filter(Boolean);
  if (parts.length < 4) return undefined;
  const rest = parts.slice(2);
  if (rest.length < 3) return undefined;
  const peerKinds = new Set(['dm', 'group', 'channel', 'thread', 'topic', 'space']);
  const kind = rest[1]?.toLowerCase() ?? '';
  if (peerKinds.has(kind)) return rest[0];
  return undefined;
}

/** store 未写 model 时，用本会话 usage.modelUsage 中 token 最多的一条 */
function formatGatewaySessionModel(s: GatewaySession): string {
  if (s.model?.trim()) return s.model.trim();
  const mu = s.usage?.modelUsage;
  if (mu && mu.length > 0) {
    const best = mu.reduce((a, b) =>
      (b.totals?.totalTokens ?? 0) > (a.totals?.totalTokens ?? 0) ? b : a,
    );
    const prov = best.provider ? providerName(best.provider) : '';
    const id = best.model?.trim() ?? '';
    if (prov && id) return `${prov} / ${id}`;
    if (id) return id;
    if (prov) return prov;
  }
  if (s.modelProvider?.trim()) return providerName(s.modelProvider);
  return '—';
}

/** 补全缺失日期（网关 agg.daily 只含实际有数据的日期） */
function fillMissingDailyEntries(
  daily: DailyBreakdown[],
  startDate: string,
  endDate: string,
): DailyBreakdown[] {
  const filled = new Map<string, DailyBreakdown>();
  for (const d of daily) {
    filled.set(d.date, d);
  }
  const result: DailyBreakdown[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const existing = filled.get(iso);
    result.push(
      existing ?? { date: iso, tokens: 0, cost: 0, messages: 0, toolCalls: 0, errors: 0 },
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n: number) {
  if (n >= 1) return '$' + n.toFixed(4);
  if (n > 0) return '$' + n.toFixed(6);
  return '—';
}

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function fmtDateShort(s: string) {
  return s.slice(5); // "2026-03-25" → "03-25"
}

// ─── 主组件 ───────────────────────────────────────────────────────────────

type Tab = 'manager' | 'gateway' | 'monitoring' | 'cost';

export default function TokenUsagePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('gateway');

  // ── 管理端状态 ──────────────────────────────────────────────────────────
  const [mgrSummary, setMgrSummary] = useState<ManagerSummary | null>(null);
  const [mgrEvents, setMgrEvents] = useState<ManagerRecord[]>([]);
  const [mgrLoading, setMgrLoading] = useState(false);

  // ── 网关状态 ─────────────────────────────────────────────────────────────
  const [gwData, setGwData] = useState<GatewayResult | null>(null);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

  // ── 管理端加载 ───────────────────────────────────────────────────────────
  const loadManager = async () => {
    setMgrLoading(true);
    try {
      const [s, e] = await Promise.all([
        invoke<ManagerSummary>('get_token_usage_summary'),
        invoke<ManagerRecord[]>('get_token_usage_events', { limit: 50 }),
      ]);
      setMgrSummary(s);
      setMgrEvents(e);
    } catch (err) {
      console.error('管理端用量加载失败:', err);
    }
    setMgrLoading(false);
  };

  // ── 网关加载 ─────────────────────────────────────────────────────────────
  const loadGateway = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) {
      setGwLoading(true);
      setGwError(null);
    }
    try {
      // 网关默认最近 30 天；勿传 `days`（协议 schema 不含该字段，会导致 sessions.usage 校验失败）。
      // limit=1000：只限制会话列表条数；网关侧补丁使汇总（合计/按模型/日趋势）遍历全量会话而非仅前 limit 个。
      const data = await invoke<GatewayResult>('get_gateway_usage', {
        usageType: 'sessions',
        params: { limit: 1000 },
      });
      setGwData(data);
      if (silent) setGwError(null);
    } catch (err) {
      if (!silent) setGwError(String(err));
    }
    if (!silent) setGwLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'manager') {
      loadManager();
    } else if (tab === 'gateway') {
      loadGateway();
    }
    // 「模型监控」「成本控制」各自加载，勿在此拉网关 WS
  }, [tab]);

  // 网关会话：定时拉取 sessions.usage（此前仅切换 Tab / 点刷新才更新，易误以为「不刷新」）
  useEffect(() => {
    if (tab !== 'gateway') return;
    const t = window.setInterval(() => {
      void loadGateway({ silent: true });
    }, 15000);
    return () => window.clearInterval(t);
  }, [tab, loadGateway]);

  // ── 渲染 ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center">
          <button onClick={() => navigate('/home')} className="p-2 text-gray-500 hover:text-gray-700 mr-4">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">用量统计与监控</h1>
            <p className="text-sm text-gray-500">模型用量、性能监控与成本控制</p>
          </div>
          <button
            onClick={() => {
              if (tab === 'manager') loadManager();
              else if (tab === 'gateway') void loadGateway();
            }}
            disabled={(tab === 'manager' && mgrLoading) || (tab === 'gateway' && gwLoading)}
            className="p-2 text-gray-500 hover:text-gray-700"
          >
            <RefreshCw className={`w-5 h-5 ${((tab === 'manager' && mgrLoading) || (tab === 'gateway' && gwLoading)) ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            <button
              onClick={() => setTab('gateway')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === 'gateway'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <MessageSquare className="w-4 h-4" />
                网关会话
              </div>
            </button>
            <button
              onClick={() => setTab('manager')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === 'manager'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Server className="w-4 h-4" />
                管理端
              </div>
            </button>
            <button
              onClick={() => setTab('monitoring')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === 'monitoring'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Monitor className="w-4 h-4" />
                模型监控
              </div>
            </button>
            <button
              onClick={() => setTab('cost')}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                tab === 'cost'
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Wallet className="w-4 h-4" />
                成本控制
              </div>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {tab === 'manager' ? (
          <ManagerTab
            summary={mgrSummary}
            events={mgrEvents}
            loading={mgrLoading}
            onRefresh={loadManager}
          />
        ) : tab === 'monitoring' ? (
          <MonitoringDashboard />
        ) : tab === 'cost' ? (
          <CostControlPanel />
        ) : (
          <GatewayTab
            data={gwData}
            loading={gwLoading}
            error={gwError}
            onRefresh={loadGateway}
          />
        )}
      </main>
    </div>
  );
}

// ─── 管理端面板 ───────────────────────────────────────────────────────────

function ManagerTab({ summary, events, loading, onRefresh }: {
  summary: ManagerSummary | null;
  events: ManagerRecord[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-blue-800">
          <strong>统计说明：</strong>此标签页记录<strong>本管理端</strong>发起的 API 调用（主要是「模型配置 → 测试连接」）。
          <strong>飞书 / QQ / 网关里的真实对话不写入此文件。</strong>
          要看真实对话用量，请切换到左侧「网关会话」标签。
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <StatCard icon={<Hash className="w-4 h-4" />} label="提示词 Token" value={fmtNum(summary.total_prompt_tokens)} />
          <StatCard icon={<BarChart3 className="w-4 h-4" />} label="生成 Token" value={fmtNum(summary.total_completion_tokens)} />
          <StatCard icon={<Database className="w-4 h-4" />} label="合计 Token" value={fmtNum(summary.total_tokens)} accent />
          <StatCard icon={<Clock className="w-4 h-4" />} label="调用次数" value={summary.record_count} />
        </div>
      )}

      {summary && Object.keys(summary.by_provider).length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">供应商分布</h2>
          <div className="space-y-3">
            {Object.entries(summary.by_provider).map(([p, tokens]) => (
              <div key={p} className="flex items-center gap-3">
                <div className="w-32 text-sm text-gray-700">{providerName(p)}</div>
                <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full rounded-full"
                    style={{ width: `${Math.min((tokens / summary.total_tokens) * 100, 100)}%` }}
                  />
                </div>
                <div className="w-24 text-right text-sm text-gray-600">{fmtNum(tokens)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">最近调用记录</h2>
        {loading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : events.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            暂无记录。打开「模型配置」→ 点击「测试连接」后会追加记录。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">时间</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">供应商</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">模型</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">来源</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">提示词</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">生成</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">合计</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-600">{new Date(e.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="py-3 px-4 text-gray-900">{providerName(e.provider)}</td>
                    <td className="py-3 px-4 text-gray-700 font-mono text-xs max-w-[180px] truncate">{e.model}</td>
                    <td className="py-3 px-4 text-gray-500 text-xs font-mono">{e.source}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{e.prompt_tokens}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{e.completion_tokens}</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">{e.total_tokens}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── 网关会话面板 ─────────────────────────────────────────────────────────

function GatewayTab({ data, loading, error, onRefresh }: {
  data: GatewayResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-red-600 font-medium mb-2">加载失败</div>
        <div className="text-red-500 text-sm mb-4">{error}</div>
        <div className="text-xs text-gray-500">
          常见原因：网关未启动 → 请先在首页「启动网关」；或 Token 已过期（重启网关可刷新认证）。
        </div>
        <button
          onClick={onRefresh}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700"
        >
          重试
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mr-3" />
        <span className="text-gray-500">正在从网关加载用量数据...</span>
      </div>
    );
  }

  if (!data) return null;

  const t = data.totals;
  const agg = data.aggregates;
  const totalInput = t.input ?? 0;
  const totalOutput = t.output ?? 0;
  const totalCacheRead = t.cacheRead ?? 0;
  const totalCacheWrite = t.cacheWrite ?? 0;
  const totalTokens = t.totalTokens ?? 0;
  const totalCost = t.totalCost ?? 0;

  // 日趋势：补全缺失日期（前端的 fillMissingDailyEntries 保证完整）
  const filledDaily = fillMissingDailyEntries(
    agg.daily ?? [],
    data.startDate,
    data.endDate,
  );
  const maxDailyTokens = filledDaily.length > 0
    ? Math.max(...filledDaily.map(d => d.tokens || 0))
    : 1;

  return (
    <>
      {/* 说明 */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
        <p className="text-sm text-green-800">
          <strong>统计说明：</strong>此标签页展示<strong>网关真实对话</strong>产生的 Token 消耗（按会话汇总，30 天内），
          数据来源于各会话的 transcript 文件。与「管理端」标签页互补。
        </p>
        <p className="text-xs text-green-700 mt-2">
          <strong>模型名称与用量对不上？</strong> 用量按<strong>当时请求里记录的模型 id</strong>归因；更换默认模型后请<strong>重启网关</strong>并确认已「保存并同步」到 openclaw.json。
          旧会话仍会显示历史模型名；新对话若仍显示旧模型，请检查实例/机器人绑定的 agent 是否仍指向旧 model.primary。
        </p>
        <p className="text-xs text-green-700 mt-2">
          本页约每 <strong>15 秒</strong>自动从网关拉取一次；也可点右上角刷新。汇总与「按模型分布」在网关写入 transcript 后才会变，刚发完消息若暂未变化，稍等或手动刷新即可。
          <strong> 若长期不更新：</strong>请<strong>停止并重新启动网关</strong>，以便应用用量汇总补丁（仅启动时写入 openclaw-cn 的 usage.js）。
        </p>
      </div>

      {/* 汇总卡片 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-8">
        <StatCard icon={<Hash className="w-4 h-4" />} label="输入 Token" value={fmtNum(totalInput)} />
        <StatCard icon={<BarChart3 className="w-4 h-4" />} label="输出 Token" value={fmtNum(totalOutput)} />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="缓存读" value={fmtNum(totalCacheRead)} />
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="缓存写" value={fmtNum(totalCacheWrite)} />
        <StatCard icon={<Database className="w-4 h-4" />} label="合计 Token" value={fmtNum(totalTokens)} accent />
      </div>

      {/* 费用 & 消息数 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <StatCard icon={<TrendingUp className="w-4 h-4" />} label="估算费用" value={fmtCost(totalCost)} accent />
        {agg.messages && (
          <>
            <StatCard icon={<MessageSquare className="w-4 h-4" />} label="用户消息" value={agg.messages.user} />
            <StatCard icon={<MessageSquare className="w-4 h-4" />} label="助手回复" value={agg.messages.assistant} />
            <StatCard icon={<Hash className="w-4 h-4" />} label="总消息" value={agg.messages.total} />
          </>
        )}
      </div>

      {/* 按模型分布 */}
      {agg.byModel && agg.byModel.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">按模型分布</h2>
          <div className="space-y-3">
            {agg.byModel.map((entry, i) => {
              const mTokens = entry.totals.totalTokens ?? 0;
              const pct = totalTokens > 0 ? (mTokens / totalTokens) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-48 text-sm text-gray-700 truncate" title={`${providerName(entry.provider ?? '')} / ${entry.model}`}>
                    <span className="text-gray-500">{providerName(entry.provider ?? '')}</span>
                    <br />
                    <span className="font-mono text-xs">{entry.model}</span>
                  </div>
                  <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                    <div
                      className="bg-indigo-500 h-full rounded-full"
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                  <div className="w-16 text-right text-sm text-gray-600">{pct.toFixed(1)}%</div>
                  <div className="w-24 text-right text-sm text-gray-600">{fmtNum(mTokens)}</div>
                  <div className="w-20 text-right text-xs text-gray-400">{entry.count} 次</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 日趋势（文本柱状图） */}
      {filledDaily.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6 mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-1">
            日趋势（{data.startDate} ~ {data.endDate}）
          </h2>
          <p className="text-xs text-gray-400 mb-4">柱高 = 当日 Token 消耗量（无活动日期显示空柱）</p>
          <div className="flex items-end gap-0.5 h-40 overflow-hidden">
            {filledDaily.map((d, i) => {
              const tokens = d.tokens || 0;
              const h = maxDailyTokens > 0 ? Math.max(2, (tokens / maxDailyTokens) * 152) : 2;
              const hasActivity = tokens > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center group">
                  <div
                    className={`w-full rounded-t transition-colors cursor-default ${hasActivity ? 'bg-blue-400 hover:bg-blue-600' : 'bg-gray-200 hover:bg-gray-300'}`}
                    style={{ height: `${h}px` }}
                    title={`${d.date}: ${tokens.toLocaleString()} tokens${d.cost ? ` (${fmtCost(d.cost)})` : ''}`}
                  />
                  <div className={`text-xs mt-1 -mb-1 ${hasActivity ? 'text-gray-500' : 'text-gray-300'}`}>
                    {fmtDateShort(d.date)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 会话列表 */}
      <div className="bg-white rounded-xl shadow-sm p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          最近会话（{data.sessions.length} 条，30 天内，最多 1000 条）
        </h2>
        {data.sessions.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            暂无会话记录。开始在飞书/Q 群里与机器人对话吧。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">会话标签</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">渠道</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">模型</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">输入</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">输出</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">缓存读</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">合计</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">费用</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">消息</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600" title="优先 transcript 最后活动时间">最近活跃</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s, i) => {
                  const channelLabel = s.channel || inferGatewayChannelFromSessionKey(s.key);
                  const modelLabel = formatGatewaySessionModel(s);
                  return (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-900 max-w-[160px] truncate" title={s.label || s.key}>
                      {s.label || <span className="text-gray-400 italic text-xs">未命名</span>}
                    </td>
                    <td className="py-3 px-4 text-gray-600">
                      {channelLabel ? (
                        <span className="px-1.5 py-0.5 bg-gray-100 rounded text-xs" title={s.key}>
                          {channelLabel}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-3 px-4 text-gray-700 font-mono text-xs max-w-[160px] truncate" title={modelLabel}>
                      {modelLabel}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtNum(s.usage?.input ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtNum(s.usage?.output ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtNum(s.usage?.cacheRead ?? 0)}</td>
                    <td className="py-3 px-4 text-right font-medium text-gray-900">{fmtNum(s.usage?.totalTokens ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtCost(s.usage?.totalCost ?? 0)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">
                      {s.usage?.messageCounts?.total ?? '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-500 text-xs">
                      {fmtDate(
                        typeof s.usage?.lastActivity === 'number' && s.usage.lastActivity > 0
                          ? s.usage.lastActivity
                          : s.updatedAt,
                      )}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─── 小组件 ───────────────────────────────────────────────────────────────

function StatCard({ icon, label, value, accent }: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6">
      <div className="flex items-center text-gray-500 mb-2">
        {icon}
        <span className="text-sm ml-2">{label}</span>
      </div>
      <div className={`text-2xl font-bold ${accent ? 'text-blue-600' : 'text-gray-900'}`}>
        {value}
      </div>
    </div>
  );
}
