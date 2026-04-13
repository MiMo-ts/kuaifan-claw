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
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string, role: 'admin' | 'agent') => Promise<void>;
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
      console.log('Login request started');
      const response = await axios.post('/api/auth/login', { username, password });
      console.log('Login response:', response.data);
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      console.log('Setting user state:', user);
      set({ user, token, loading: false });
      console.log('Login successful');
    } catch (error: unknown) {
      console.error('Login error:', error);
      set({ error: (error as any)?.response?.data?.message || 'Login failed', loading: false });
    }
  },
  register: async (username: string, email: string, password: string, role: 'admin' | 'agent') => {
    set({ loading: true, error: null });
    try {
      const response = await axios.post('/api/auth/register', { username, email, password, role });
      const { token, user } = response.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
      axios.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      set({ user, token, loading: false });
    } catch (error: unknown) {
      set({ error: (error as any)?.response?.data?.message || 'Registration failed', loading: false });
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
        // 这里可以添加一个验证token的API端点
        // 暂时使用本地存储的用户信息
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
