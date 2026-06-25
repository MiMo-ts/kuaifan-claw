import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'agent';
  createdAt: string;
}

const UserPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    role: 'agent' as 'admin' | 'agent',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const params = searchKeyword ? { search: searchKeyword } : {};
      const response = await axios.get('/api/users/list', { params });
      setUsers(response.data);
    } catch (error) {
      console.error('获取用户失败:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, [searchKeyword]);

  const handleCreate = async () => {
    setError(null);
    try {
      await axios.post('/api/users/create', formData);
      fetchUsers();
      setFormData({ username: '', email: '', role: 'agent', password: '' });
    } catch (error: unknown) {
      console.error('创建用户失败:', error);
      setError((error as any)?.response?.data?.message || (error as any)?.response?.data?.errors?.[0]?.msg || '创建用户失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setError(null);
    try {
      await axios.put(`/api/users/update/${editingUser.id}`, formData);
      fetchUsers();
      setEditingUser(null);
      setFormData({ username: '', email: '', role: 'agent', password: '' });
    } catch (error: unknown) {
      console.error('更新用户失败:', error);
      setError((error as any)?.response?.data?.message || (error as any)?.response?.data?.errors?.[0]?.msg || '更新用户失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('确定要删除这个用户吗？')) {
      try {
        await axios.delete(`/api/users/delete/${id}`);
        fetchUsers();
      } catch (error) {
        console.error('删除用户失败:', error);
      }
    }
  };

  const startEditing = (user: User) => {
    setEditingUser(user);
    setFormData({
      username: user.username,
      email: user.email,
      role: user.role,
      password: ''
    });
  };

  const cancelEditing = () => {
    setEditingUser(null);
    setFormData({ username: '', email: '', role: 'agent', password: '' });
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-10">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">用户管理</h1>
          <p className="text-slate-500 mt-1">管理用户账户和角色</p>
        </div>

        {/* Create/Edit Form */}
        <div className="card p-6 mb-8">
          <h2 className="text-base font-semibold text-slate-900 mb-5">
            {editingUser ? '编辑用户' : '创建新用户'}
          </h2>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm mb-5">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                用户名 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="input"
                placeholder="请输入用户名"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">邮箱</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="input"
                placeholder="选填"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                角色 <span className="text-red-500">*</span>
              </label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'agent' })}
                className="input"
                required
              >
                <option value="agent">代理</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-slate-700">
                密码 {editingUser ? '（留空不修改）' : ''} <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="input"
                minLength={editingUser ? 0 : 6}
                placeholder={editingUser ? '不修改请留空' : '至少6个字符'}
                required={!editingUser}
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={editingUser ? handleUpdate : handleCreate}
              className="btn btn-primary"
            >
              {editingUser ? '更新用户' : '创建用户'}
            </button>
            {editingUser && (
              <button
                onClick={cancelEditing}
                className="btn btn-secondary"
              >
                取消
              </button>
            )}
          </div>
        </div>

        {/* Users List */}
        <div className="card">
          <div className="px-6 py-5 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-base font-semibold text-slate-900">用户列表</h2>
            <input
              type="text"
              placeholder="搜索用户名或邮箱..."
              value={searchKeyword}
              onChange={(e) => {
                setSearchKeyword(e.target.value);
                fetchUsers();
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
          ) : users.length === 0 ? (
            <div className="p-10 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-slate-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                </svg>
              </div>
              <p className="text-slate-500">暂无用户</p>
              <p className="text-sm text-slate-400 mt-1">在上方创建您的第一个用户</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">用户名</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">邮箱</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">角色</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">创建时间</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map((user) => (
                    <tr key={user.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900">{user.username}</td>
                      <td className="px-6 py-4 text-sm text-slate-600">{user.email || '—'}</td>
                      <td className="px-6 py-4">
                        <span className={`badge ${user.role === 'admin' ? 'badge-info' : 'badge-neutral'}`}>
                          {user.role === 'admin' ? '管理员' : '代理'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-500">{new Date(user.createdAt).toLocaleDateString()}</td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => startEditing(user)}
                            className="btn btn-ghost text-xs py-1.5 px-3"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDelete(user.id)}
                            className="btn btn-danger text-xs py-1.5 px-3"
                          >
                            删除
                          </button>
                        </div>
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

export default UserPage;
