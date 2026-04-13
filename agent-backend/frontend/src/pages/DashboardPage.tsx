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
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">仪表盘</h1>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-600 mb-2">总邀请码</h3>
            <p className="text-3xl font-bold">{loading ? '加载中...' : stats.total}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-600 mb-2">活跃邀请码</h3>
            <p className="text-3xl font-bold text-green-600">{loading ? '加载中...' : stats.active}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-600 mb-2">已使用邀请码</h3>
            <p className="text-3xl font-bold text-blue-600">{loading ? '加载中...' : stats.used}</p>
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-gray-600 mb-2">已禁用邀请码</h3>
            <p className="text-3xl font-bold text-red-600">{loading ? '加载中...' : stats.disabled}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">系统信息</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">当前用户：{user?.username}</p>
              <p className="text-gray-600">角色：{user?.role === 'admin' ? '管理员' : '代理'}</p>
              <p className="text-gray-600">邮箱：{user?.email}</p>
            </div>
            <div>
              <p className="text-gray-600">系统状态：正常</p>
              <p className="text-gray-600">版本：1.0.0</p>
              <p className="text-gray-600">最后更新：{new Date().toLocaleDateString()}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
