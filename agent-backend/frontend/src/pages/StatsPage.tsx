import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface Stats {
  total: number;
  active: number;
  used: number;
  disabled: number;
  platformStats: Array<{ id: string; count: number }>;
  dateStats: Array<{ id: string; count: number }>;
}

const StatsPage: React.FC = () => {
  const [stats, setStats] = useState<Stats>({
    total: 0,
    active: 0,
    used: 0,
    disabled: 0,
    platformStats: [],
    dateStats: []
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/stats/invite-codes');
      setStats(response.data);
    } catch (error) {
      console.error('获取统计数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const statCards = [
    { label: '总邀请码', value: stats.total, color: 'slate' },
    { label: '活跃', value: stats.active, color: 'emerald' },
    { label: '已使用', value: stats.used, color: 'violet' },
    { label: '已禁用', value: stats.disabled, color: 'amber' },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">统计分析</h1>
          <p className="text-slate-500 mt-1">邀请码使用概览</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
          {statCards.map((stat) => (
            <div key={stat.label} className="card p-6">
              <p className="text-sm font-medium text-slate-500 mb-2">{stat.label}</p>
              <p className={`text-4xl font-bold tracking-tight ${
                stat.color === 'emerald' ? 'text-emerald-600' :
                stat.color === 'violet' ? 'text-violet-600' :
                stat.color === 'amber' ? 'text-amber-600' :
                'text-slate-900'
              }`}>
                {loading ? (
                  <span className="inline-block w-12 h-8 bg-slate-100 rounded animate-pulse" />
                ) : (
                  stat.value
                )}
              </p>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Platform Distribution */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-5">平台分布</h2>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : stats.platformStats.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <p>暂无平台数据</p>
              </div>
            ) : (
              <div className="space-y-4">
                {stats.platformStats.map((platform) => {
                  const maxCount = Math.max(...stats.platformStats.map(p => p.count), 1);
                  const percentage = (platform.count / maxCount) * 100;
                  return (
                    <div key={platform.id} className="flex items-center gap-4">
                      <span className="w-20 text-sm text-slate-600 truncate">{platform.id}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-violet-500 to-purple-500 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-8 text-sm font-medium text-slate-700 text-right">{platform.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Daily Trend */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-slate-900 mb-5">每日趋势</h2>
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 bg-slate-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : stats.dateStats.length === 0 ? (
              <div className="text-center py-10 text-slate-400">
                <p>暂无日期数据</p>
              </div>
            ) : (
              <div className="space-y-4">
                {stats.dateStats.slice(0, 7).map((date) => {
                  const maxCount = Math.max(...stats.dateStats.map(d => d.count), 1);
                  const percentage = (date.count / maxCount) * 100;
                  return (
                    <div key={date.id} className="flex items-center gap-4">
                      <span className="w-20 text-sm text-slate-600 truncate">{date.id}</span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                      <span className="w-8 text-sm font-medium text-slate-700 text-right">{date.count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
