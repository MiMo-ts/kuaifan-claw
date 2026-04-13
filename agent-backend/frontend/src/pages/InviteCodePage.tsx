import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface InviteCode {
  _id: string;
  code: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'used' | 'disabled';
  usedBy: string | null;
  usedAt: string | null;
  platform: string | null;
}

const InviteCodePage: React.FC = () => {
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [count, setCount] = useState(1);
  const [expiresIn, setExpiresIn] = useState(30);

  useEffect(() => {
    fetchInviteCodes();
  }, []);

  const fetchInviteCodes = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/invite-codes/list');
      setInviteCodes(response.data);
    } catch (error) {
      console.error('Error fetching invite codes:', error);
    } finally {
      setLoading(false);
    }
  };

  const generateInviteCodes = async () => {
    setGenerating(true);
    try {
      const response = await axios.post('/api/invite-codes/generate', {
        count,
        expiresIn
      });
      setInviteCodes([...response.data, ...inviteCodes]);
    } catch (error) {
      console.error('Error generating invite codes:', error);
    } finally {
      setGenerating(false);
    }
  };

  const disableInviteCode = async (id: string) => {
    try {
      await axios.put(`/api/invite-codes/disable/${id}`);
      setInviteCodes(inviteCodes.map(code => 
        code._id === id ? { ...code, status: 'disabled' } : code
      ));
    } catch (error) {
      console.error('Error disabling invite code:', error);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">邀请码管理</h1>
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">生成邀请码</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-gray-700 mb-2">生成数量</label>
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-gray-700 mb-2">有效期（天）</label>
              <input
                type="number"
                min="1"
                max="365"
                value={expiresIn}
                onChange={(e) => setExpiresIn(Number(e.target.value))}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={generateInviteCodes}
                className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600 transition"
                disabled={generating}
              >
                {generating ? '生成中...' : '生成邀请码'}
              </button>
            </div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">邀请码列表</h2>
          {loading ? (
            <div className="text-center py-10">加载中...</div>
          ) : inviteCodes.length === 0 ? (
            <div className="text-center py-10">暂无邀请码</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-4 py-2 text-left">邀请码</th>
                    <th className="px-4 py-2 text-left">创建者</th>
                    <th className="px-4 py-2 text-left">创建时间</th>
                    <th className="px-4 py-2 text-left">过期时间</th>
                    <th className="px-4 py-2 text-left">状态</th>
                    <th className="px-4 py-2 text-left">使用平台</th>
                    <th className="px-4 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {inviteCodes.map((code) => (
                    <tr key={code._id} className="border-t">
                      <td className="px-4 py-2 font-mono">{code.code}</td>
                      <td className="px-4 py-2">{code.createdByName}</td>
                      <td className="px-4 py-2">{new Date(code.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">{new Date(code.expiresAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded ${code.status === 'active' ? 'bg-green-100 text-green-800' : code.status === 'used' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'}`}>
                          {code.status === 'active' ? '活跃' : code.status === 'used' ? '已使用' : '已禁用'}
                        </span>
                      </td>
                      <td className="px-4 py-2">{code.platform || '-'}</td>
                      <td className="px-4 py-2">
                        {code.status === 'active' && (
                          <button
                            onClick={() => disableInviteCode(code._id)}
                            className="text-red-500 hover:text-red-700"
                          >
                            禁用
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default InviteCodePage;
