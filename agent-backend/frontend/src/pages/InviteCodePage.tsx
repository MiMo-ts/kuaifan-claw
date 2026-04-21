import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface InviteCode {
  id: string;
  code: string;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  expiresAt: string;
  status: 'active' | 'used' | 'disabled';
  usedBy: string | null;
  usedAt: string | null;
  platform: string | null;
  maxDevices: number;
  deviceCount: number;
}

const InviteCodePage: React.FC = () => {
  const [inviteCodes, setInviteCodes] = useState<InviteCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [count, setCount] = useState(1);
  const [expiresIn, setExpiresIn] = useState(30);

  useEffect(() => {
    fetchInviteCodes();
  }, [searchKeyword]);

  const fetchInviteCodes = async () => {
    setLoading(true);
    try {
      const params = searchKeyword ? { search: searchKeyword } : {};
      const response = await axios.get('/api/invite-codes/list', { params });
      setInviteCodes(response.data);
    } catch (error) {
      console.error('获取邀请码失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInviteCodes();
  }, []);

  const generateInviteCodes = async () => {
    setGenerating(true);
    try {
      const response = await axios.post('/api/invite-codes/generate', {
        count,
        expiresIn
      });
      setInviteCodes([...response.data, ...inviteCodes]);
    } catch (error) {
      console.error('生成邀请码失败:', error);
    } finally {
      setGenerating(false);
    }
  };

  const disableInviteCode = async (id: string) => {
    try {
      await axios.put(`/api/invite-codes/disable/${id}`);
      setInviteCodes(inviteCodes.map(code =>
        code.id === id ? { ...code, status: 'disabled' } : code
      ));
    } catch (error) {
      console.error('禁用邀请码失败:', error);
    }
  };

  const deleteInviteCode = async (id: string) => {
    if (window.confirm('确定要删除这个邀请码吗？此操作不可恢复。')) {
      try {
        await axios.delete(`/api/invite-codes/${id}`);
        setInviteCodes(inviteCodes.filter(code => code.id !== id));
      } catch (error) {
        console.error('删除邀请码失败:', error);
      }
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <span className="badge badge-success">活跃</span>;
      case 'used':
        return <span className="badge badge-info">已使用</span>;
      case 'disabled':
        return <span className="badge badge-danger">已禁用</span>;
      default:
        return <span className="badge badge-neutral">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">邀请码管理</h1>
          <p className="text-slate-500 mt-1">管理和生成邀请码</p>
        </div>

        {/* Generate Card */}
        <div className="card p-6 mb-8">
          <h2 className="text-base font-semibold text-slate-900 mb-5">生成新邀请码</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">数量</label>
              <input
                type="number"
                min="1"
                max="100"
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">有效期（天）</label>
              <input
                type="number"
                min="1"
                max="365"
                value={expiresIn}
                onChange={(e) => setExpiresIn(Number(e.target.value))}
                className="input"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={generateInviteCodes}
                className="btn btn-primary w-full"
                disabled={generating}
              >
                {generating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    生成中...
                  </span>
                ) : (
                  <>
                    <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                    </svg>
                    生成邀请码
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Codes List */}
        <div className="card">
          <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-900">邀请码列表</h2>
            <input
              type="text"
              placeholder="搜索邀请码或创建者..."
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
              }}
              className="input w-64"
            />
          </div>

          {loading ? (
            <div className="p-10 text-center">
              <div className="inline-flex items-center gap-2 text-slate-500">
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                加载中...
              </div>
            </div>
          ) : inviteCodes.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                </svg>
              </div>
              <p className="text-slate-500">暂无邀请码</p>
              <p className="text-sm text-slate-400 mt-1">在上方生成您的第一个邀请码</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">邀请码</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">设备数</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">创建者</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">创建时间</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">过期时间</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">状态</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {inviteCodes.map((code) => (
                    <tr key={code.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4">
                        <code className="text-sm font-mono font-medium text-slate-900 bg-slate-100 px-2 py-1 rounded">
                          {code.code}
                        </code>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`text-sm font-medium ${
                          code.deviceCount >= (code.maxDevices || 3)
                            ? 'text-red-600'
                            : code.deviceCount > 0
                            ? 'text-amber-600'
                            : 'text-slate-500'
                        }`}>
                          {code.deviceCount || 0} / {code.maxDevices || 3}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600">{code.createdByName}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{new Date(code.createdAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4 text-sm text-slate-500">{new Date(code.expiresAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4">{getStatusBadge(code.status)}</td>
                      <td className="px-6 py-4">
                        {code.status === 'active' && (
                          <button
                            onClick={() => disableInviteCode(code.id)}
                            className="btn btn-danger text-xs py-1.5 px-3"
                          >
                            禁用
                          </button>
                        )}
                        <button
                          onClick={() => deleteInviteCode(code.id)}
                          className="btn btn-danger text-xs py-1.5 px-3 ml-2"
                        >
                          删除
                        </button>
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
