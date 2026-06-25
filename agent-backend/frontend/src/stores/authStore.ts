import { create } from 'zustand';
import axios from 'axios';

interface User {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'agent';
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  error: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  loading: true,
  error: null,
  login: async (username: string, password: string) => {
    set({ loading: true, error: null });
    try {
      console.log('开始登录请求...');
      const response = await axios.post('/api/auth/login', { username, password });
      console.log('登录响应:', response.data);
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      console.log('设置用户状态:', user);
      set({ user, token, loading: false });
      console.log('登录成功！');
    } catch (error: unknown) {
      console.error('登录出错:', error);
      const errorMsg = (error as any)?.response?.data?.message || '登录失败，请重试';
      set({ error: errorMsg, loading: false });
    }
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    delete axios.defaults.headers.common['Authorization'];
    set({ user: null, token: null });
  },
  checkAuth: async () => {
    const token = get().token;
    if (token) {
      set({ loading: true });
      try {
        axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
        const userStr = localStorage.getItem('user');
        if (userStr) {
          try {
            const user = JSON.parse(userStr);
            set({ user, loading: false });
          } catch (e) {
            set({ loading: false });
          }
        } else {
          set({ loading: false });
        }
      } catch (error) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        delete axios.defaults.headers.common['Authorization'];
        set({ user: null, token: null, loading: false });
      }
    } else {
      set({ loading: false });
    }
  },
}));
