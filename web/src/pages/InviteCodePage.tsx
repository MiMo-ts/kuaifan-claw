import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import axios from 'axios';
import { getInviteCodeValidateUrl, API_CONFIG } from '../config/api';

const InviteCodePage = () => {
  const [inviteCode, setInviteCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!inviteCode.trim()) {
      toast.error('请输入邀请码');
      return;
    }

    setIsLoading(true);
    
    try {
      console.log('=== 开始验证邀请码 ===');
      console.log('邀请码:', inviteCode);
      console.log('API 地址:', getInviteCodeValidateUrl());
      
      // 调用代理后台 API 验证邀请码
      const response = await axios.post(getInviteCodeValidateUrl(), {
        code: inviteCode.trim(),
        platform: 'windows'
      });
      
      console.log('API 响应:', response);
      console.log('响应数据:', response.data);
      
      if (response.data.valid) {
        console.log('✅ 邀请码验证成功');
        // 验证成功，保存验证状态到本地存储
        localStorage.setItem('inviteCodeValidated', 'true');
        
        // 触发自定义事件，通知 App 组件邀请码验证成功
        const event = new CustomEvent('inviteCodeValidated', {
          detail: { validated: true }
        });
        window.dispatchEvent(event);
        
        // 验证成功，跳转到环境检查页面
        toast.success('邀请码验证成功');
        // 跳转到根路径，会自动重定向到环境配置页
        navigate('/');
      } else {
        console.log('❌ 邀请码验证失败');
        toast.error('邀请码验证失败，请检查邀请码是否正确');
      }
    } catch (error: any) {
      console.error('❌ 邀请码验证异常');
      console.error('错误详情:', error);
      console.error('错误响应:', error.response);
      console.error('错误消息:', error.message);
      
      let errorMessage = '邀请码验证失败，请检查邀请码是否正确';
      
      if (error.code === 'ERR_NETWORK') {
        errorMessage = '无法连接到代理后台，请确保代理后台正在运行';
      } else if (error.response) {
        errorMessage = error.response.data?.message || errorMessage;
      }
      
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-900 via-purple-900 to-blue-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full space-y-8 p-8 bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl border border-white/20">
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-r from-blue-500 to-purple-600 rounded-full mb-6">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-3xl font-bold text-white">
            邀请码验证
          </h2>
          <p className="mt-2 text-sm text-gray-200">
            请输入从代理平台获取的邀请码
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="relative">
            <div className={`absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none transition-all duration-300 ${isInputFocused ? 'text-blue-400' : 'text-gray-400'}`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
              </svg>
            </div>
            <input
              id="invite-code"
              name="invite-code"
              type="text"
              autoComplete="invite-code"
              required
              className="block w-full pl-10 pr-3 py-3 bg-white/10 border border-white/20 rounded-lg backdrop-blur-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              onFocus={() => setIsInputFocused(true)}
              onBlur={() => setIsInputFocused(false)}
              placeholder="请输入邀请码"
            />
          </div>

          <div>
            <button
              type="submit"
              disabled={isLoading}
              className="group relative w-full flex items-center justify-center py-3 px-6 border border-transparent text-base font-medium rounded-lg text-white bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-300 transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-3"></div>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              )}
              {isLoading ? '验证中...' : '验证邀请码'}
            </button>
          </div>

          <div className="text-center text-sm text-gray-300">
            <p>
              没有邀请码？
              <span className="ml-1 text-blue-400 hover:text-blue-300 cursor-pointer transition-colors">
                请联系您的代理获取
              </span>
            </p>
          </div>
        </form>
      </div>
    </div>
  );
};

export default InviteCodePage;