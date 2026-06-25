import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import { useAuthStore } from './stores/authStore'

// 应用启动时检查认证状态
function AppWithAuthCheck() {
  useEffect(() => {
    const checkAuth = useAuthStore.getState().checkAuth;
    checkAuth();
  }, []);

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWithAuthCheck />
  </React.StrictMode>,
)
