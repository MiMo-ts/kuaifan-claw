import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

const Navbar: React.FC = () => {
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  if (!user) {
    return null;
  }

  const navItems = [
    { path: '/dashboard', label: '控制台' },
    { path: '/invite-codes', label: '邀请码管理' },
    { path: '/stats', label: '统计分析' },
  ];

  if (user.role === 'admin') {
    navItems.push({ path: '/users', label: '用户管理' });
  }

  return (
    <nav className="bg-white border-b border-slate-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <img src="/images/kuaifan-icon.png" alt="快泛Claw" className="w-8 h-8 rounded-lg" />
            <span className="text-lg font-semibold text-slate-900 tracking-tight">快泛Claw 代理后台</span>
          </div>

          {/* Navigation */}
          <div className="hidden md:flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 text-sm font-medium rounded-xl transition-all duration-200 ${
                    isActive
                      ? 'bg-violet-50 text-violet-700'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>

          {/* User */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-sm font-medium text-slate-900">{user.username}</p>
              <p className="text-xs text-slate-500">{user.role === 'admin' ? '管理员' : '代理'}</p>
            </div>
            <button
              onClick={handleLogout}
              className="btn btn-ghost text-sm"
            >
              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              退出登录
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="md:hidden border-t border-slate-100 px-4 py-3">
        <div className="flex gap-2 overflow-x-auto">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-violet-50 text-violet-700'
                    : 'text-slate-600 bg-slate-50'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
