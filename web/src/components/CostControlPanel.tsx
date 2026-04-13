import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  DollarSign, AlertTriangle, Plus, Trash2, RefreshCw,
  CheckCircle, X, Clock, Target, Bell, Edit2
} from 'lucide-react';

// ─── 类型定义 ─────────────────────────────────────────────────────

interface CostBudget {
  id: string;
  name: string;
  budget_type: string;
  limit_amount: number;
  alert_threshold: number;
  provider: string | null;
  model: string | null;
  enabled: boolean;
  current_spend: number;
  reset_period: string | null;
  last_reset: string | null;
  created_at: string;
}

interface CostAlert {
  id: string;
  budget_id: string;
  alert_type: string;
  threshold: number;
  current_spend: number;
  message: string;
  triggered_at: string;
  acknowledged: boolean;
}

interface BudgetCreateRequest {
  name: string;
  budget_type: string;
  limit_amount: number;
  alert_threshold: number;
  provider: string | null;
  model: string | null;
  reset_period: string | null;
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

const BUDGET_TYPE_NAMES: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  total: '总计',
};

function providerName(id: string | null) {
  if (!id) return '全部';
  return PROVIDER_NAMES[id] || id;
}

function fmtCost(n: number) {
  if (n >= 1) return '$' + n.toFixed(4);
  if (n > 0) return '$' + n.toFixed(6);
  return '$0.00';
}

function fmtDate(s: string) {
  return new Date(s).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ─── 主组件 ─────────────────────────────────────────────────────

export default function CostControlPanel() {
  const [budgets, setBudgets] = useState<CostBudget[]>([]);
  const [alerts, setAlerts] = useState<CostAlert[]>([]);
  const [loading, setLoading] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [editingBudget, setEditingBudget] = useState<CostBudget | null>(null);

  // 创建表单状态
  const [formData, setFormData] = useState<BudgetCreateRequest>({
    name: '',
    budget_type: 'monthly',
    limit_amount: 10,
    alert_threshold: 0.8,
    provider: null,
    model: null,
    reset_period: null,
  });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [b, a] = await Promise.all([
        invoke<CostBudget[]>('get_cost_budgets'),
        invoke<CostAlert[]>('get_unacknowledged_alerts'),
      ]);
      setBudgets(b);
      setAlerts(a);
    } catch (err) {
      console.error('预算数据加载失败:', err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreate = async () => {
    if (!formData.name || formData.limit_amount <= 0) {
      alert('请填写完整的预算信息');
      return;
    }
    try {
      await invoke('create_cost_budget', { request: formData });
      setShowCreate(false);
      setFormData({
        name: '',
        budget_type: 'monthly',
        limit_amount: 10,
        alert_threshold: 0.8,
        provider: null,
        model: null,
        reset_period: null,
      });
      loadData();
    } catch (err) {
      console.error('创建预算失败:', err);
      alert('创建失败: ' + err);
    }
  };

  const handleDelete = async (budgetId: string) => {
    if (!confirm('确定要删除这个预算吗？')) return;
    try {
      await invoke('delete_cost_budget', { budgetId });
      loadData();
    } catch (err) {
      console.error('删除预算失败:', err);
    }
  };

  const handleReset = async (budgetId: string) => {
    try {
      await invoke('reset_budget', { budgetId });
      loadData();
    } catch (err) {
      console.error('重置预算失败:', err);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    try {
      await invoke('acknowledge_alert', { alertId });
      loadData();
    } catch (err) {
      console.error('确认告警失败:', err);
    }
  };

  const totalSpend = budgets.reduce((sum, b) => sum + b.current_spend, 0);
  const totalBudget = budgets.reduce((sum, b) => sum + b.limit_amount, 0);
  const overallPct = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-green-600" />
            成本控制
          </h2>
          <p className="text-sm text-gray-500">
            设置预算上限和告警阈值，避免意外超支
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            disabled={loading}
            className="p-2 text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            添加预算
          </button>
        </div>
      </div>

      {/* 告警列表 */}
      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-red-600" />
                <div>
                  <div className="text-sm font-medium text-red-800">{alert.message}</div>
                  <div className="text-xs text-red-600">
                    触发时间: {fmtDate(alert.triggered_at)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => handleAcknowledge(alert.id)}
                className="p-2 text-red-600 hover:bg-red-100 rounded-lg"
                title="确认告警"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 总览 */}
      {budgets.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
              <Target className="w-5 h-5 text-gray-600" />
              总体概览
            </h3>
            <div className="text-sm text-gray-500">
              {fmtCost(totalSpend)} / {fmtCost(totalBudget)}
            </div>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-4 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                overallPct >= 90 ? 'bg-red-500' :
                overallPct >= 75 ? 'bg-orange-500' :
                overallPct >= 50 ? 'bg-yellow-500' :
                'bg-green-500'
              }`}
              style={{ width: `${Math.min(overallPct, 100)}%` }}
            />
          </div>
          <div className="mt-2 text-right text-sm text-gray-500">
            {overallPct.toFixed(1)}% 已使用
          </div>
        </div>
      )}

      {/* 预算列表 */}
      {budgets.length > 0 ? (
        <div className="grid gap-4">
          {budgets.map((budget) => {
            const pct = (budget.current_spend / budget.limit_amount) * 100;
            const isOver = pct >= 100;
            const isWarning = pct >= 75;

            return (
              <div
                key={budget.id}
                className={`bg-white rounded-xl shadow-sm p-6 ${
                  isOver ? 'border-2 border-red-300' :
                  isWarning ? 'border-2 border-orange-300' : ''
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h4 className="font-semibold text-gray-900 flex items-center gap-2">
                      {budget.name}
                      {isOver && <span className="text-red-600 text-sm">(超限)</span>}
                      {isWarning && !isOver && <span className="text-orange-600 text-sm">(告警)</span>}
                    </h4>
                    <div className="text-sm text-gray-500 mt-1">
                      {providerName(budget.provider)} · {BUDGET_TYPE_NAMES[budget.budget_type] || budget.budget_type}
                      {budget.model && <span className="ml-2 font-mono">{budget.model}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleReset(budget.id)}
                      className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                      title="重置花费"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(budget.id)}
                      className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                      title="删除预算"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600">
                      {fmtCost(budget.current_spend)} / {fmtCost(budget.limit_amount)}
                    </span>
                    <span className={`font-medium ${
                      isOver ? 'text-red-600' :
                      isWarning ? 'text-orange-600' :
                      'text-green-600'
                    }`}>
                      {pct.toFixed(1)}%
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isOver ? 'bg-red-500' :
                        isWarning ? 'bg-orange-500' :
                        'bg-green-500'
                      }`}
                      style={{ width: `${Math.min(pct, 100)}%` }}
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500">
                  <div className="flex items-center gap-4">
                    <span className="flex items-center gap-1">
                      <Bell className="w-3 h-3" />
                      告警阈值: {(budget.alert_threshold * 100).toFixed(0)}%
                    </span>
                    {budget.last_reset && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        上次重置: {fmtDate(budget.last_reset)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {budget.enabled ? (
                      <>
                        <CheckCircle className="w-3 h-3 text-green-500" />
                        <span className="text-green-600">已启用</span>
                      </>
                    ) : (
                      <>
                        <X className="w-3 h-3 text-gray-400" />
                        <span className="text-gray-400">已禁用</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-gray-50 rounded-xl p-12 text-center">
          <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">暂无预算配置</h3>
          <p className="text-gray-500 mb-4">
            设置预算上限，避免模型使用超出预期费用
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm"
          >
            <Plus className="w-4 h-4" />
            创建第一个预算
          </button>
        </div>
      )}

      {/* 创建预算模态框 */}
      {showCreate && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900">创建新预算</h3>
              <button
                onClick={() => setShowCreate(false)}
                className="p-2 text-gray-500 hover:text-gray-700"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  预算名称
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如：月度 API 预算"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  预算类型
                </label>
                <select
                  value={formData.budget_type}
                  onChange={(e) => setFormData({ ...formData, budget_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                >
                  <option value="daily">每日</option>
                  <option value="weekly">每周</option>
                  <option value="monthly">每月</option>
                  <option value="total">总计（不重置）</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  预算上限 ($)
                </label>
                <input
                  type="number"
                  value={formData.limit_amount}
                  onChange={(e) => setFormData({ ...formData, limit_amount: parseFloat(e.target.value) || 0 })}
                  min="0"
                  step="0.01"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  告警阈值 ({Math.round(formData.alert_threshold * 100)}%)
                </label>
                <input
                  type="range"
                  value={formData.alert_threshold}
                  onChange={(e) => setFormData({ ...formData, alert_threshold: parseFloat(e.target.value) })}
                  min="0.5"
                  max="1.0"
                  step="0.05"
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>50%</span>
                  <span>75%</span>
                  <span>100%</span>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  限定供应商（可选）
                </label>
                <select
                  value={formData.provider || ''}
                  onChange={(e) => setFormData({ ...formData, provider: e.target.value || null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                >
                  <option value="">全部供应商</option>
                  {Object.entries(PROVIDER_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-6">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
              <button
                onClick={handleCreate}
                className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
