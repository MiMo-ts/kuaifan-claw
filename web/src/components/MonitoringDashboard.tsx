import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  Activity, TrendingUp, AlertTriangle, CheckCircle, XCircle,
  Clock, Zap, DollarSign, RefreshCw, Filter, Eye
} from 'lucide-react';

// ─── 类型定义 ─────────────────────────────────────────────────────

interface RealTimeMetrics {
  timestamp: string;
  provider: string;
  model: string;
  requests_total: number;
  requests_success: number;
  requests_error: number;
  tokens_total: number;
  cost_total: number;
  avg_response_time_ms: number;
  rpm: number;
  tpm: number;
}

interface MonitoringSummary {
  total_requests: number;
  total_tokens: number;
  total_cost: number;
  total_errors: number;
  active_providers: number;
  active_models: number;
  avg_response_time_ms: number;
  overall_rpm: number;
  overall_tpm: number;
  top_provider: string | null;
  top_model: string | null;
}

interface ModelUsageStats {
  provider: string;
  model: string;
  request_count: number;
  total_prompt_tokens: number;
  total_completion_tokens: number;
  total_tokens: number;
  total_cost: number;
  avg_response_time_ms: number | null;
  error_count: number;
  success_rate: number;
}

interface ProviderUsageStats {
  provider: string;
  request_count: number;
  total_tokens: number;
  total_cost: number;
  model_count: number;
  top_model: string | null;
}

// ─── 辅助函数 ─────────────────────────────────────────────────────

const PROVIDER_NAMES: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google Gemini',
  deepseek: 'DeepSeek',
  openrouter: 'OpenRouter',
  ollama: 'Ollama',
  minimax: 'MiniMax',
  volc_ark: '火山方舟',
  nvidia: 'NVIDIA NIM',
  aliyun: '阿里通义',
  zhipu: '智谱 GLM',
  moonshot: 'Kimi',
  baidu: '百度文心',
  xiaomi: '小米 MiMo',
};

function providerName(id: string) {
  return PROVIDER_NAMES[id] || id;
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toLocaleString();
}

function fmtCost(n: number) {
  if (n >= 1) return '$' + n.toFixed(4);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}

function fmtMs(ms: number) {
  if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
  return ms.toFixed(0) + 'ms';
}

// ─── 主组件 ─────────────────────────────────────────────────────

export default function MonitoringDashboard() {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [metrics, setMetrics] = useState<RealTimeMetrics[]>([]);
  const [modelStats, setModelStats] = useState<ModelUsageStats[]>([]);
  const [providerStats, setProviderStats] = useState<ProviderUsageStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [filterProvider, setFilterProvider] = useState<string>('all');
  const [loadError, setLoadError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [s, m, model, provider] = await Promise.all([
        invoke<MonitoringSummary>('get_monitoring_summary'),
        invoke<RealTimeMetrics[]>('get_realtime_metrics'),
        invoke<ModelUsageStats[]>('get_usage_by_model', { provider: null }),
        invoke<ProviderUsageStats[]>('get_usage_by_provider'),
      ]);
      setSummary(s);
      setMetrics(m);
      setModelStats(model);
      setProviderStats(provider);
      setLastUpdate(new Date());
    } catch (err) {
      console.error('监控数据加载失败:', err);
      setLoadError(String(err));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    if (autoRefresh) {
      const interval = setInterval(loadData, 5000);
      return () => clearInterval(interval);
    }
  }, [loadData, autoRefresh]);

  const filteredMetrics = filterProvider === 'all'
    ? metrics
    : metrics.filter(m => m.provider === filterProvider);

  const providers = [...new Set(metrics.map(m => m.provider))];

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            全模型实时监控
          </h2>
          <p className="text-sm text-gray-500">
            实时追踪所有模型和供应商的用量、性能与费用
            {lastUpdate && (
              <span className="ml-2">
                · 最后更新: {lastUpdate.toLocaleTimeString('zh-CN')}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            自动刷新 (5s)
          </label>
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
        <strong>数据来源说明：</strong>
        本页展示的是<strong>写入本机 metrics 目录</strong>的用量汇总，与网关侧会话统计<strong>并列存在</strong>，合起来才覆盖「管理端测试 + 网关里真实对话」等场景。
        <span className="block mt-1">
          · <strong>本标签（模型监控）</strong>：读取{' '}
          <code className="text-xs bg-amber-100 px-1 rounded">metrics/token_usage.jsonl</code>
          （例如管理端「测试连接」成功后会追加）与{' '}
          <code className="text-xs bg-amber-100 px-1 rounded">detailed_usage.jsonl</code>
          （若有其它模块写入详细用量行），并与桌面应用进程内的短期热数据合并（若有）。
        </span>
        <strong className="block mt-2">飞书 / QQ 等通道上的多轮对话</strong>
        的 Token 与费用由 OpenClaw 网关在会话维度记账，请到左侧「<strong>网关会话</strong>」标签通过网关 RPC 查看；这些对话<strong>默认不会</strong>写入上述两个 jsonl，因此仅看本页<strong>不等于</strong>「全项目唯一账单」。
        <span className="block mt-2">
          <strong>自动刷新每 5 秒会重新读上述 jsonl。</strong>
          若通道正在聊天而本页数字几乎不变，属预期——请同时打开「网关会话」看会话级用量。
        </span>
      </div>

      {loadError && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          加载失败：{loadError}
        </div>
      )}

      {/* 概览卡片 */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          <OverviewCard
            icon={<Activity className="w-5 h-5" />}
            label="总请求数"
            value={fmtNum(summary.total_requests)}
            color="blue"
          />
          <OverviewCard
            icon={<TrendingUp className="w-5 h-5" />}
            label="总 Token"
            value={fmtNum(summary.total_tokens)}
            color="indigo"
          />
          <OverviewCard
            icon={<DollarSign className="w-5 h-5" />}
            label="总费用"
            value={fmtCost(summary.total_cost)}
            color="green"
          />
          <OverviewCard
            icon={<Clock className="w-5 h-5" />}
            label="平均响应"
            value={fmtMs(summary.avg_response_time_ms)}
            color="orange"
          />
          <OverviewCard
            icon={<Zap className="w-5 h-5" />}
            label="活跃供应商"
            value={`${summary.active_providers} / ${summary.active_models}`}
            color="purple"
            sublabel="供应商 / 模型"
          />
        </div>
      )}

      {/* 筛选器 */}
      <div className="flex items-center gap-4">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={filterProvider}
          onChange={(e) => setFilterProvider(e.target.value)}
          className="text-sm border-gray-200 rounded-lg focus:ring-blue-500 focus:border-blue-500"
        >
          <option value="all">全部供应商</option>
          {providers.map(p => (
            <option key={p} value={p}>{providerName(p)}</option>
          ))}
        </select>
      </div>

      {/* 按模型分布 */}
      {modelStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-indigo-600" />
            模型用量排行
          </h3>
          <div className="space-y-3">
            {modelStats.slice(0, 10).map((stat, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-sm font-medium">
                  {i + 1}
                </div>
                <div className="w-40 text-sm">
                  <div className="text-gray-500">{providerName(stat.provider)}</div>
                  <div className="font-mono text-xs truncate max-w-[160px]" title={stat.model}>
                    {stat.model}
                  </div>
                </div>
                <div className="flex-1 bg-gray-100 rounded-full h-6 overflow-hidden">
                  <div
                    className="bg-indigo-500 h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min((stat.total_tokens / (modelStats[0]?.total_tokens || 1)) * 100, 100)}%`
                    }}
                  />
                </div>
                <div className="w-16 text-right text-sm text-gray-600">
                  {fmtNum(stat.total_tokens)}
                </div>
                <div className="w-16 text-right text-sm text-gray-500">
                  {stat.request_count} 次
                </div>
                <div className="w-20 text-right">
                  {stat.success_rate >= 99 ? (
                    <span className="inline-flex items-center gap-1 text-green-600 text-sm">
                      <CheckCircle className="w-4 h-4" />
                      {stat.success_rate.toFixed(1)}%
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-red-600 text-sm">
                      <XCircle className="w-4 h-4" />
                      {stat.success_rate.toFixed(1)}%
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 供应商分布 */}
      {providerStats.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Activity className="w-5 h-5 text-blue-600" />
            供应商分布
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {providerStats.map((stat, i) => {
              const pct = (stat.total_tokens / (providerStats.reduce((a, b) => a + b.total_tokens, 0) || 1)) * 100;
              return (
                <div key={i} className="border border-gray-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-gray-900">{providerName(stat.provider)}</span>
                    <span className="text-sm text-gray-500">{pct.toFixed(1)}%</span>
                  </div>
                  <div className="text-2xl font-bold text-blue-600 mb-1">
                    {fmtNum(stat.total_tokens)}
                  </div>
                  <div className="text-xs text-gray-500">
                    {stat.request_count} 请求 · {stat.model_count} 模型
                  </div>
                  <div className="mt-2 bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-blue-500 h-full rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 实时指标表格 */}
      {filteredMetrics.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Eye className="w-5 h-5 text-green-600" />
            实时指标详情
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-3 px-4 font-medium text-gray-600">供应商</th>
                  <th className="text-left py-3 px-4 font-medium text-gray-600">模型</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">请求数</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">成功</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">失败</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">Token</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">费用</th>
                  <th className="text-right py-3 px-4 font-medium text-gray-600">响应时间</th>
                </tr>
              </thead>
              <tbody>
                {filteredMetrics.map((m, i) => (
                  <tr key={i} className="border-b border-gray-100 hover:bg-gray-50">
                    <td className="py-3 px-4 text-gray-700">{providerName(m.provider)}</td>
                    <td className="py-3 px-4 font-mono text-xs text-gray-600 max-w-[160px] truncate">
                      {m.model}
                    </td>
                    <td className="py-3 px-4 text-right text-gray-900">{m.requests_total}</td>
                    <td className="py-3 px-4 text-right text-green-600">{m.requests_success}</td>
                    <td className="py-3 px-4 text-right text-red-600">{m.requests_error}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtNum(m.tokens_total)}</td>
                    <td className="py-3 px-4 text-right text-gray-900">{fmtCost(m.cost_total)}</td>
                    <td className="py-3 px-4 text-right text-gray-600">{fmtMs(m.avg_response_time_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 空状态 */}
      {metrics.length === 0 && !loading && (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <Activity className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无监控数据</h3>
          <p className="text-gray-500">
            开始使用模型后，实时监控数据将在这里显示。
          </p>
        </div>
      )}
    </div>
  );
}

// ─── 小组件 ─────────────────────────────────────────────────────

function OverviewCard({
  icon,
  label,
  value,
  color,
  sublabel,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: 'blue' | 'indigo' | 'green' | 'orange' | 'purple' | 'red';
  sublabel?: string;
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-600 border-indigo-200',
    green: 'bg-green-50 text-green-600 border-green-200',
    orange: 'bg-orange-50 text-orange-600 border-orange-200',
    purple: 'bg-purple-50 text-purple-600 border-purple-200',
    red: 'bg-red-50 text-red-600 border-red-200',
  };

  return (
    <div className={`rounded-xl border p-4 ${colors[color]}`}>
      <div className="flex items-center gap-2 mb-2">
        {icon}
        <span className="text-sm font-medium opacity-80">{label}</span>
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sublabel && <div className="text-xs opacity-60 mt-1">{sublabel}</div>}
    </div>
  );
}
