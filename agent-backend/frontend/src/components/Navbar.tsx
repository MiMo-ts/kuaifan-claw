import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const Navbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) {
    return null;
  }

  return (
    <nav className="bg-gray-800 text-white p-4">
      <div className="container mx-auto flex justify-between items-center">
        <div className="text-xl font-bold">代理后台管理系统</div>
        <div className="flex space-x-6">
          <Link to="/dashboard" className="hover:text-blue-300">仪表盘</Link>
          <Link to="/invite-codes" className="hover:text-blue-300">邀请码管理</Link>
          {user.role === 'admin' && (
            <Link to="/users" className="hover:text-blue-300">用户管理</Link>
          )}
          <Link to="/stats" className="hover:text-blue-300">统计分析</Link>
          <button
            onClick={handleLogout}
            className="hover:text-red-300"
          >
            退出登录
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
