import React, { useState, useEffect } from 'react';
import Navbar from '../components/Navbar';
import axios from 'axios';

interface User {
  _id: string;
  username: string;
  email: string;
  role: 'admin' | 'agent';
  createdAt: string;
}

const UserPage: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    role: 'agent' as 'admin' | 'agent',
    password: ''
  });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/users/list');
      setUsers(response.data);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    setError(null);
    try {
      await axios.post('/api/users/create', formData);
      fetchUsers();
      setFormData({ username: '', email: '', role: 'agent', password: '' });
    } catch (error: unknown) {
      console.error('Error creating user:', error);
      setError((error as any)?.response?.data?.message || (error as any)?.response?.data?.errors?.[0]?.msg || '创建用户失败');
    }
  };

  const handleUpdate = async () => {
    if (!editingUser) return;
    setError(null);
    try {
      await axios.put(`/api/users/update/${editingUser._id}`, formData);
      fetchUsers();
      setEditingUser(null);
      setFormData({ username: '', email: '', role: 'agent', password: '' });
    } catch (error: unknown) {
      console.error('Error updating user:', error);
      setError((error as any)?.response?.data?.message || (error as any)?.response?.data?.errors?.[0]?.msg || '更新用户失败');
    }
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('确定要删除这个用户吗？')) {
      try {
        await axios.delete(`/api/users/delete/${id}`);
        fetchUsers();
      } catch (error) {
        console.error('Error deleting user:', error);
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

  return (
    <div className="min-h-screen bg-gray-100">
      <Navbar />
      <div className="container mx-auto p-6">
        <h1 className="text-2xl font-bold mb-6">用户管理</h1>
        <div className="bg-white p-6 rounded-lg shadow mb-6">
          <h2 className="text-xl font-bold mb-4">{editingUser ? '编辑用户' : '创建用户'}</h2>
          {error && (
            <div className="bg-red-100 text-red-700 p-3 rounded mb-4">
              {error}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-gray-700 mb-2">用户名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
                placeholder="请输入用户名"
              />
            </div>
            <div>
              <label className="block text-gray-700 mb-2">邮箱</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="选填"
              />
            </div>
            <div>
              <label className="block text-gray-700 mb-2">角色 <span className="text-red-500">*</span></label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value as 'admin' | 'agent' })}
                className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              >
                <option value="agent">代理</option>
                <option value="admin">管理员</option>
              </select>
            </div>
          </div>
          <div className="mb-4">
            <label className="block text-gray-700 mb-2">密码 {editingUser ? '(留空表示不修改)' : ''} <span className="text-red-500">*</span></label>
            <input
              type="password"
              value={formData.password}
              onChange={(e) => setFormData({ ...formData, password: e.target.value })}
              className="w-full px-4 py-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              minLength={editingUser ? 0 : 6}
              placeholder={editingUser ? '留空表示不修改' : '至少6个字符'}
              required={!editingUser}
            />
          </div>
          <button
            onClick={editingUser ? handleUpdate : handleCreate}
            className="bg-blue-500 text-white py-2 px-4 rounded hover:bg-blue-600 transition"
          >
            {editingUser ? '更新用户' : '创建用户'}
          </button>
          {editingUser && (
            <button
              onClick={() => {
                setEditingUser(null);
                setFormData({ username: '', email: '', role: 'agent', password: '' });
              }}
              className="ml-4 bg-gray-500 text-white py-2 px-4 rounded hover:bg-gray-600 transition"
            >
              取消
            </button>
          )}
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-4">用户列表</h2>
          {loading ? (
            <div className="text-center py-10">加载中...</div>
          ) : users.length === 0 ? (
            <div className="text-center py-10">暂无用户</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-100">
                    <th className="px-4 py-2 text-left">用户名</th>
                    <th className="px-4 py-2 text-left">邮箱</th>
                    <th className="px-4 py-2 text-left">角色</th>
                    <th className="px-4 py-2 text-left">创建时间</th>
                    <th className="px-4 py-2 text-left">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user._id} className="border-t">
                      <td className="px-4 py-2">{user.username}</td>
                      <td className="px-4 py-2">{user.email}</td>
                      <td className="px-4 py-2">
                        <span className={`px-2 py-1 rounded ${user.role === 'admin' ? 'bg-purple-100 text-purple-800' : 'bg-blue-100 text-blue-800'}`}>
                          {user.role === 'admin' ? '管理员' : '代理'}
                        </span>
                      </td>
                      <td className="px-4 py-2">{new Date(user.createdAt).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => startEditing(user)}
                          className="text-blue-500 hover:text-blue-700 mr-4"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => handleDelete(user._id)}
                          className="text-red-500 hover:text-red-700"
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

export default UserPage;
