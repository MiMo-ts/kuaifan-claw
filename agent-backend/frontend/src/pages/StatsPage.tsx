import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface Stats {
  total: number;
  active: number;
  used: number;
  disabled: number;
  platformStats: Array<{ _id: string; count: number }>;
  dateStats: Array<{ _id: string; count: number }>;
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
      console.error('Error fetching stats:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">统计分析</h1>
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
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold mb-4">平台分布</h2>
            {loading ? (
              <div className="text-center py-10">加载中...</div>
            ) : stats.platformStats.length === 0 ? (
              <div className="text-center py-10">暂无平台数据</div>
            ) : (
              <div className="space-y-4">
                {stats.platformStats.map((platform) => (
                  <div key={platform._id} className="flex items-center">
                    <div className="w-32">{platform._id}</div>
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-500"
                        style={{ 
                          width: `${(platform.count / stats.total) * 100}%` 
                        }}
                      ></div>
                    </div>
                    <div className="w-16 text-right">{platform.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold mb-4">每日生成趋势</h2>
            {loading ? (
              <div className="text-center py-10">加载中...</div>
            ) : stats.dateStats.length === 0 ? (
              <div className="text-center py-10">暂无日期数据</div>
            ) : (
              <div className="space-y-2">
                {stats.dateStats.map((date) => (
                  <div key={date._id} className="flex items-center">
                    <div className="w-24">{date._id}</div>
                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-green-500 transition-all duration-500"
                        style={{ 
                          width: `${(date.count / Math.max(...stats.dateStats.map(d => d.count))) * 100}%` 
                        }}
                      ></div>
                    </div>
                    <div className="w-10 text-right">{date.count}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsPage;
