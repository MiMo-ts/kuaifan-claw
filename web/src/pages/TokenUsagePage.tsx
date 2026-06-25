import toast from 'react-hot-toast';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import {
  CxIconActivity,
  CxIconArrowLeft,
  CxIconBarChart3,
  CxIconBolt,
  CxIconHash,
  CxIconLayers,
  CxIconMessageSquare,
  CxIconModels,
  CxIconRefresh,
  CxIconServer,
  CxIconSparkles,
  CxIconTrendingUp,
  CxIconWallet,
} from "../components/icons";


// ─── Types ───

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
  lastActivity?: number;
}

interface MessageCounts {
  total: number; user: number; assistant: number;
  toolCalls: number; toolResults: number; errors: number;
}

interface ModelUsageEntry {
  provider: string; model: string; count: number; totals: SessionUsage;
}

interface DailyBreakdown {
  date: string; tokens: number; cost: number;
  messages?: number; toolCalls?: number; errors?: number;
}

interface GatewaySession {
  key: string; label?: string; sessionId: string; updatedAt: number;
  agentId?: string; channel?: string; chatType?: string;
  origin?: Record<string, unknown>;
  usage?: SessionUsage;
  modelProvider?: string; model?: string;
}

interface GatewayResult {
  updatedAt: number; startDate: string; endDate: string;
  sessions: GatewaySession[];
  totals: SessionUsage;
  aggregates: {
    messages: MessageCounts;
    byModel: ModelUsageEntry[];
    byProvider: ModelUsageEntry[];
    daily: DailyBreakdown[];
  };
}

const PROVIDER_NAMES: Record<string, string> = {
  kuaifan: '快泛API',
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

function fillMissingDailyEntries(
  daily: DailyBreakdown[], startDate: string, endDate: string,
): DailyBreakdown[] {
  const filled = new Map<string, DailyBreakdown>();
  for (const d of daily) filled.set(d.date, d);
  const result: DailyBreakdown[] = [];
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const cur = new Date(start);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    const existing = filled.get(iso);
    result.push(existing ?? { date: iso, tokens: 0, cost: 0, messages: 0, toolCalls: 0, errors: 0 });
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
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

function fmtDateShort(s: string) { return s.slice(5); }

// ─── Design tokens ───

const C = {
  bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
  bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
  text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
  textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
  accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)', accentHover: 'var(--cx-accent-hover)',
};

type Tab = 'manager' | 'gateway';

export default function TokenUsagePage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('gateway');

  const [mgrSummary, setMgrSummary] = useState<ManagerSummary | null>(null);
  const [mgrEvents, setMgrEvents] = useState<ManagerRecord[]>([]);
  const [mgrLoading, setMgrLoading] = useState(false);

  const [gwData, setGwData] = useState<GatewayResult | null>(null);
  const [gwLoading, setGwLoading] = useState(false);
  const [gwError, setGwError] = useState<string | null>(null);

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

  const loadGateway = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    if (!silent) { setGwLoading(true); setGwError(null); }
    try {
      const data = await invoke<GatewayResult>('get_gateway_usage', {
        usageType: 'sessions', params: { limit: 1000 },
      });
      setGwData(data);
      if (silent) setGwError(null);
    } catch (err) {
      if (!silent) setGwError(String(err));
    }
    if (!silent) setGwLoading(false);
  }, []);

  useEffect(() => {
    if (tab === 'manager') loadManager();
    else if (tab === 'gateway') loadGateway();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'gateway') return;
    const t = window.setInterval(() => { void loadGateway({ silent: true }); }, 15000);
    return () => window.clearInterval(t);
  }, [tab, loadGateway]);

  const tabs: { id: Tab; label: string; icon: any }[] = [
    { id: 'gateway', label: '网关会话', icon: CxIconMessageSquare },
    { id: 'manager', label: '管理端', icon: CxIconServer },
  ];

  const busy = (tab === 'manager' && mgrLoading) || (tab === 'gateway' && gwLoading);

  return (
    <div className="min-h-full" style={{ background: C.bg }}>
      <header
        className="sticky top-0 z-20 backdrop-blur-md"
        style={{ background: 'rgba(255, 255, 255, 0.92)', borderBottom: `1px solid ${C.borderSoft}` }}
      >
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate('/home')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: C.textMute }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}
            title="返回首页"
          >
            <CxIconArrowLeft size={16} />
          </button>

          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: C.accentSoft, boxShadow: `inset 0 0 0 1px ${C.accent}26` }}
            >
              <CxIconBarChart3 className="w-3.5 h-3.5" style={{ color: C.accent }} strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-[14px] font-semibold leading-tight" style={{ color: C.text }}>
                用量统计与监控
              </h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: C.textMute }}>
                模型用量
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              if (tab === 'manager') loadManager();
              else if (tab === 'gateway') void loadGateway();
            }}
            disabled={busy}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: C.textMute, opacity: busy ? 0.6 : 1 }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}
            title="刷新"
          >
            <CxIconRefresh
              className="w-4 h-4"
              style={{ animation: busy ? 'cx-spin 1s linear infinite' : 'none' }}
            />
          </button>
        </div>

        <div className="max-w-[1400px] mx-auto px-6">
          <div className="flex items-center gap-0.5 overflow-x-auto cx-scroll-slim">
            {tabs.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className="relative flex items-center gap-1.5 h-10 px-3.5 text-[12.5px] font-medium transition-colors duration-150 shrink-0"
                  style={{ color: active ? C.text : C.textMute }}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = C.textSoft; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = C.textMute; }}
                >
                  <Icon className="w-3.5 h-3.5" strokeWidth={active ? 2.25 : 1.75} />
                  <span>{t.label}</span>
                  {active && (
                    <span
                      className="absolute bottom-0 left-2 right-2 h-[2px] rounded-t-full"
                      style={{ background: C.accent }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-7">
        {tab === 'manager' ? (
          <ManagerTab summary={mgrSummary} events={mgrEvents} loading={mgrLoading} onRefresh={loadManager} />
        ) : (
          <GatewayTab data={gwData} loading={gwLoading} error={gwError} onRefresh={loadGateway} />
        )}
      </main>
    </div>
  );
}

function ManagerTab({ summary, events, loading, onRefresh }: {
  summary: ManagerSummary | null;
  events: ManagerRecord[];
  loading: boolean;
  onRefresh: () => void;
}) {
  return (
    <>
      <div
        className="flex items-start gap-3 p-4 mb-6 rounded-xl"
        style={{
          background: 'linear-gradient(135deg, #eef3fc 0%, #f3f0eb 100%)',
          border: `1px solid ${C.accent}30`,
        }}
      >
        <CxIconSparkles className="w-4 h-4 mt-0.5 shrink-0" style={{ color: C.accent }} />
        <div className="text-[12.5px] leading-relaxed" style={{ color: C.textSoft }}>
          <strong style={{ color: C.text }}>统计说明：</strong>
          此标签页记录<strong style={{ color: C.text }}>本管理端</strong>发起的 API 调用（主要是「模型配置 → 测试连接」）。
          <strong style={{ color: C.text }}>飞书 / QQ / 网关里的真实对话不写入此文件。</strong>
          要看真实对话用量，请切换到「网关会话」标签。
        </div>
      </div>

      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={<CxIconHash className="w-3.5 h-3.5" />} label="提示词 Token" value={fmtNum(summary.total_prompt_tokens)} tone="neutral" />
          <StatCard icon={<CxIconBarChart3 className="w-3.5 h-3.5" />} label="生成 Token" value={fmtNum(summary.total_completion_tokens)} tone="neutral" />
          <StatCard icon={<CxIconModels size={20} className="w-3.5 h-3.5" />} label="合计 Token" value={fmtNum(summary.total_tokens)} tone="accent" />
          <StatCard icon={<CxIconActivity className="w-3.5 h-3.5" />} label="调用次数" value={summary.record_count} tone="neutral" />
        </div>
      )}

      {summary && Object.keys(summary.by_provider).length > 0 && (
        <Panel title="供应商分布" icon={CxIconLayers}>
          <div className="space-y-3">
            {Object.entries(summary.by_provider).map(([p, tokens]) => {
              const pct = summary.total_tokens > 0 ? (tokens / summary.total_tokens) * 100 : 0;
              return (
                <div key={p} className="flex items-center gap-3">
                  <div className="w-32 text-[12.5px] shrink-0" style={{ color: C.textSoft }}>
                    {providerName(p)}
                  </div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden relative" style={{ background: C.bgSoft }}>
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: `${Math.min(pct, 100)}%`,
                        background: `linear-gradient(90deg, ${C.accent} 0%, ${C.accentHover} 100%)`,
                      }}
                    />
                  </div>
                  <div className="w-12 text-right text-[11.5px] tabular-nums" style={{ color: C.textMute }}>
                    {pct.toFixed(1)}%
                  </div>
                  <div className="w-20 text-right text-[12px] tabular-nums" style={{ color: C.text }}>
                    {fmtNum(tokens)}
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title="最近调用记录"
        icon={CxIconActivity}
        right={
          <button
            onClick={onRefresh}
            disabled={loading}
            className="text-[11.5px] flex items-center gap-1 transition-colors duration-150"
            style={{ color: C.accent }}
          >
            <CxIconRefresh className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </button>
        }
      >
        {loading ? (
          <div className="text-center py-10 text-[12.5px]" style={{ color: C.textMute }}>加载中…</div>
        ) : events.length === 0 ? (
          <EmptyState icon={<CxIconActivity className="w-6 h-6" />} title="暂无调用记录" desc="打开「模型配置」→ 点击「测试连接」后会追加记录。" />
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: `1px solid ${C.borderSoft}` }}>
                  {['时间', '供应商', '模型', '来源', '提示词', '生成', '合计'].map((h, i) => (
                    <th key={h} className={`px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider ${i >= 4 ? 'text-right' : 'text-left'}`} style={{ color: C.textDim }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="transition-colors duration-100" style={{ borderBottom: `1px solid ${C.borderSoft}` }}
                    onMouseEnter={(ev) => { ev.currentTarget.style.background = C.bgSoft; }}
                    onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}>
                    <td className="px-5 py-3 text-[11.5px] tabular-nums" style={{ color: C.textSoft }}>
                      {new Date(e.ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-5 py-3" style={{ color: C.text }}>{providerName(e.provider)}</td>
                    <td className="px-5 py-3 font-mono text-[11px] max-w-[200px] truncate" style={{ color: C.textSoft }}>{e.model}</td>
                    <td className="px-5 py-3 font-mono text-[10.5px]" style={{ color: C.textMute }}>{e.source}</td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{e.prompt_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{e.completion_tokens.toLocaleString()}</td>
                    <td className="px-5 py-3 text-right tabular-nums font-semibold" style={{ color: C.text }}>{e.total_tokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function GatewayTab({ data, loading, error, onRefresh }: {
  data: GatewayResult | null;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
}) {
  if (error) {
    return (
      <Panel>
        <div className="text-center py-10">
          <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
            style={{ background: 'var(--cx-error-soft)', color: 'var(--cx-error)' }}>
            <CxIconActivity className="w-5 h-5" />
          </div>
          <div className="text-[14px] font-semibold mb-1" style={{ color: 'var(--cx-error)' }}>加载失败</div>
          <div className="text-[12px] mb-1" style={{ color: C.textSoft }}>{error}</div>
          <div className="text-[11.5px] mb-5" style={{ color: C.textMute }}>
            常见原因：网关未启动 → 请先在首页「启动网关」；或 Token 已过期（重启网关可刷新认证）。
          </div>
          <button
            onClick={onRefresh}
            className="px-4 h-8 rounded-lg text-[12px] font-medium text-white transition-colors duration-150"
            style={{ background: C.accent }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.accentHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.accent; }}
          >
            重试
          </button>
        </div>
      </Panel>
    );
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="cx-shimmer h-[88px] rounded-xl" />
          ))}
        </div>
        <div className="cx-shimmer h-[280px] rounded-xl" />
      </div>
    );
  }

  if (!data) return null;

  const totals = data.totals;
  const totalTokens = totals.totalTokens ?? 0;
  const totalCost = totals.totalCost ?? 0;
  const totalInput = totals.input ?? 0;
  const totalOutput = totals.output ?? 0;
  const totalCacheRead = totals.cacheRead ?? 0;
  const totalCacheWrite = totals.cacheWrite ?? 0;
  const agg = data.aggregates;

  const filledDaily = fillMissingDailyEntries(agg.daily ?? [], data.startDate, data.endDate);
  const maxDailyTokens = Math.max(1, ...filledDaily.map((d) => d.tokens || 0));
  const totalDailyTokens = filledDaily.reduce((sum, d) => sum + (d.tokens || 0), 0);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span
            className="px-2 h-6 rounded-md text-[11px] font-medium flex items-center gap-1.5"
            style={{ background: C.bgSoft, color: C.textSoft }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: C.accent, boxShadow: '0 0 0 3px var(--cx-accent-soft)' }} />
            实时数据
          </span>
          <span className="text-[11.5px]" style={{ color: C.textMute }}>
            {data.startDate} ~ {data.endDate}
          </span>
        </div>
        <div className="text-[11.5px]" style={{ color: C.textMute }}>
          每 15 秒自动刷新 · 共 <span style={{ color: C.text, fontWeight: 500 }}>{data.sessions.length}</span> 个会话
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <StatCard icon={<CxIconHash className="w-3.5 h-3.5" />} label="输入 Token" value={fmtNum(totalInput)} tone="neutral" />
        <StatCard icon={<CxIconBarChart3 className="w-3.5 h-3.5" />} label="输出 Token" value={fmtNum(totalOutput)} tone="neutral" />
        <StatCard icon={<CxIconTrendingUp className="w-3.5 h-3.5" />} label="缓存读" value={fmtNum(totalCacheRead)} tone="neutral" />
        <StatCard icon={<CxIconTrendingUp className="w-3.5 h-3.5" />} label="缓存写" value={fmtNum(totalCacheWrite)} tone="neutral" />
        <StatCard icon={<CxIconModels size={20} className="w-3.5 h-3.5" />} label="合计 Token" value={fmtNum(totalTokens)} tone="accent" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-7">
        <StatCard icon={<CxIconWallet size={20} className="w-3.5 h-3.5" />} label="估算费用" value={fmtCost(totalCost)} tone="accent" />
        {agg.messages && (
          <>
            <StatCard icon={<CxIconMessageSquare className="w-3.5 h-3.5" />} label="用户消息" value={agg.messages.user} tone="neutral" />
            <StatCard icon={<CxIconBolt size={20} className="w-3.5 h-3.5" />} label="助手回复" value={agg.messages.assistant} tone="neutral" />
            <StatCard icon={<CxIconActivity className="w-3.5 h-3.5" />} label="总消息" value={agg.messages.total} tone="neutral" />
          </>
        )}
      </div>

      {agg.byModel && agg.byModel.length > 0 && (
        <Panel title="按模型分布" icon={CxIconLayers}>
          <div className="space-y-2.5">
            {agg.byModel.map((entry, i) => {
              const mTokens = entry.totals.totalTokens ?? 0;
              const pct = totalTokens > 0 ? (mTokens / totalTokens) * 100 : 0;
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-52 shrink-0" title={providerName(entry.provider ?? '') + ' / ' + entry.model}>
                    <div className="text-[12.5px] truncate" style={{ color: C.text }}>
                      {providerName(entry.provider ?? '')}
                    </div>
                    <div className="font-mono text-[11px] truncate" style={{ color: C.textMute }}>
                      {entry.model}
                    </div>
                  </div>
                  <div className="flex-1 h-5 rounded-md overflow-hidden relative" style={{ background: C.bgSoft }}>
                    <div
                      className="h-full rounded-md transition-all duration-500"
                      style={{
                        width: Math.min(pct, 100) + '%',
                        background: i === 0
                          ? 'linear-gradient(90deg, var(--cx-accent) 0%, var(--cx-accent-hover) 100%)'
                          : 'linear-gradient(90deg, #7a9bd1 0%, #94b0d9 100%)',
                      }}
                    />
                  </div>
                  <div className="w-12 text-right text-[11px] tabular-nums" style={{ color: C.textMute }}>
                    {pct.toFixed(1)}%
                  </div>
                  <div className="w-20 text-right text-[12px] tabular-nums" style={{ color: C.text }}>
                    {fmtNum(mTokens)}
                  </div>
                  <div className="w-16 text-right text-[11px] tabular-nums" style={{ color: C.textMute }}>
                    {entry.count} 次
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      {filledDaily.length > 0 && (
        <Panel
          title="日趋势"
          icon={CxIconTrendingUp}
          right={
            <span className="text-[11px] tabular-nums" style={{ color: C.textMute }}>
              累计 {fmtNum(totalDailyTokens)} tokens
            </span>
          }
        >
          <div className="flex items-end gap-[2px] h-44 pt-4 pb-5 px-1">
            {filledDaily.map((d, i) => {
              const tokens = d.tokens || 0;
              const h = maxDailyTokens > 0 ? Math.max(3, (tokens / maxDailyTokens) * 156) : 3;
              const hasActivity = tokens > 0;
              return (
                <div key={i} className="flex-1 flex flex-col items-center justify-end group relative">
                  {hasActivity && (
                    <div
                      className="absolute -top-1 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded text-[10px] tabular-nums pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-150 whitespace-nowrap z-10"
                      style={{ background: C.text, color: C.bgElev, boxShadow: 'var(--cx-shadow-md)' }}
                    >
                      {fmtNum(tokens)} · {fmtCost(d.cost ?? 0)}
                    </div>
                  )}
                  <div
                    className="w-full rounded-t transition-colors duration-150"
                    style={{
                      height: h + 'px',
                      background: hasActivity
                        ? 'linear-gradient(180deg, var(--cx-accent) 0%, var(--cx-accent-hover) 100%)'
                        : C.borderSoft,
                      opacity: hasActivity ? 1 : 0.5,
                    }}
                  />
                  {(i === 0 || i === filledDaily.length - 1 || (i + 1) % Math.ceil(filledDaily.length / 7) === 0) && (
                    <div className="text-[9.5px] mt-1 tabular-nums" style={{ color: C.textDim }}>
                      {fmtDateShort(d.date)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel
        title="会话列表"
        icon={CxIconMessageSquare}
        right={
          <span className="text-[11px]" style={{ color: C.textMute }}>
            最近 30 天 · 最多 1000 条
          </span>
        }
      >
        {data.sessions.length === 0 ? (
          <EmptyState icon={<CxIconMessageSquare className="w-6 h-6" />} title="暂无会话记录" desc="开始在飞书 / QQ 群里与机器人对话吧。" />
        ) : (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-[12px]">
              <thead>
                <tr style={{ borderBottom: '1px solid ' + C.borderSoft }}>
                  {['会话标签', '渠道', '模型', '输入', '输出', '缓存读', '合计', '费用', '消息', '最近活跃'].map((h, i) => (
                    <th key={h} className={'px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider whitespace-nowrap ' + (i >= 3 ? 'text-right' : 'text-left')} style={{ color: C.textDim }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s, i) => {
                  const channelLabel = s.channel || inferGatewayChannelFromSessionKey(s.key);
                  const modelLabel = formatGatewaySessionModel(s);
                  return (
                    <tr key={i} className="transition-colors duration-100" style={{ borderBottom: '1px solid ' + C.borderSoft }}
                      onMouseEnter={(ev) => { ev.currentTarget.style.background = C.bgSoft; }}
                      onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent'; }}>
                      <td className="px-4 py-3 max-w-[180px] truncate" style={{ color: C.text }} title={s.label || s.key}>
                        {s.label || <span style={{ color: C.textDim }} className="italic text-[11.5px]">未命名</span>}
                      </td>
                      <td className="px-4 py-3">
                        {channelLabel ? (
                          <span className="px-1.5 h-5 rounded text-[10.5px] inline-flex items-center font-medium" style={{ background: C.bgSoft, color: C.textSoft }} title={s.key}>
                            {channelLabel}
                          </span>
                        ) : (
                          <span style={{ color: C.textDim }}>—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] max-w-[180px] truncate" style={{ color: C.textSoft }} title={modelLabel}>
                        {modelLabel}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{fmtNum(s.usage?.input ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{fmtNum(s.usage?.output ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{fmtNum(s.usage?.cacheRead ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold" style={{ color: C.text }}>{fmtNum(s.usage?.totalTokens ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{fmtCost(s.usage?.totalCost ?? 0)}</td>
                      <td className="px-4 py-3 text-right tabular-nums" style={{ color: C.textSoft }}>{s.usage?.messageCounts?.total ?? '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-[11px]" style={{ color: C.textMute }}>
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
      </Panel>
    </>
  );
}

function Panel({
  title, icon: Icon, right, children,
}: {
  title?: string;
  icon?: any;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl mb-5 overflow-hidden"
      style={{
        background: C.bgElev,
        border: '1px solid ' + C.borderSoft,
        boxShadow: 'var(--cx-shadow-xs)',
      }}
    >
      {(title || right) && (
        <div className="flex items-center justify-between px-5 h-12" style={{ borderBottom: '1px solid ' + C.borderSoft }}>
          <div className="flex items-center gap-2">
            {Icon && <Icon className="w-3.5 h-3.5" style={{ color: C.accent }} strokeWidth={2} />}
            <h2 className="text-[13px] font-semibold" style={{ color: C.text }}>{title}</h2>
          </div>
          {right}
        </div>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

function StatCard({
  icon, label, value, tone = 'neutral',
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  tone?: 'neutral' | 'accent';
}) {
  const accent = tone === 'accent';
  return (
    <div
      className="rounded-xl p-4 transition-all duration-200"
      style={{
        background: accent
          ? 'linear-gradient(135deg, var(--cx-accent-soft) 0%, var(--cx-bg-elev) 70%)'
          : C.bgElev,
        border: '1px solid ' + (accent ? C.accent + '30' : C.borderSoft),
        boxShadow: 'var(--cx-shadow-xs)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-2">
        <span style={{ color: accent ? C.accent : C.textMute }}>{icon}</span>
        <span className="text-[11px] font-medium" style={{ color: C.textMute }}>{label}</span>
      </div>
      <div
        className="text-[22px] leading-none font-semibold tabular-nums tracking-tight"
        style={{ color: accent ? C.accent : C.text }}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string; }) {
  return (
    <div className="text-center py-12">
      <div className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center" style={{ background: C.bgSoft, color: C.textDim }}>
        {icon}
      </div>
      <div className="text-[13px] font-medium mb-1" style={{ color: C.textSoft }}>{title}</div>
      <div className="text-[11.5px]" style={{ color: C.textMute }}>{desc}</div>
    </div>
  );
}
