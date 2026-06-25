import React, { useEffect, useState } from 'react';
import Navbar from '../components/Navbar';
import { useAuthStore } from '../stores/authStore';
import axios from 'axios';

interface Stats {
  total: number;
  active: number;
  used: number;
  disabled: number;
}

const DashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, used: 0, disabled: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const response = await axios.get('/api/stats/invite-codes');
        setStats({
          total: response.data.total,
          active: response.data.active,
          used: response.data.used,
          disabled: response.data.disabled
        });
      } catch (error) {
        console.error('获取统计数据失败:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

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
        <div className="mb-10">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">控制台</h1>
          <p className="text-slate-500 mt-1">欢迎回来，{user?.username}</p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-10">
          {statCards.map((stat) => (
            <div key={stat.label} className="card p-6 hover:shadow-hover transition-shadow duration-200">
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

        {/* System Info */}
        <div className="card p-8">
          <h2 className="text-lg font-semibold text-slate-900 mb-6">系统信息</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-sm text-slate-600">状态</span>
                <span className="text-sm font-medium text-slate-900 ml-auto">正常运行</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-violet-500 rounded-full" />
                <span className="text-sm text-slate-600">用户角色</span>
                <span className="text-sm font-medium text-slate-900 ml-auto">{user?.role === 'admin' ? '管理员' : '代理'}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-amber-500 rounded-full" />
                <span className="text-sm text-slate-600">邮箱</span>
                <span className="text-sm font-medium text-slate-900 ml-auto truncate ml-4">{user?.email || '—'}</span>
              </div>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-slate-400 rounded-full" />
                <span className="text-sm text-slate-600">版本</span>
                <span className="text-sm font-medium text-slate-900 ml-auto">1.0.0</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-2 h-2 bg-slate-400 rounded-full" />
                <span className="text-sm text-slate-600">最后更新</span>
                <span className="text-sm font-medium text-slate-900 ml-auto">{new Date().toLocaleDateString()}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
