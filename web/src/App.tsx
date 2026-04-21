import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import WizardPage from './pages/WizardPage';
import HomePage from './pages/HomePage';
import RobotShopPage from './pages/RobotShopPage';
import InstanceCreatePage from './pages/InstanceCreatePage';
import InstancePage from './pages/InstancePage';
import ModelConfigPage from './pages/ModelConfigPage';
import PluginPage from './pages/PluginPage';
import SettingsPage from './pages/SettingsPage';
import BackupPage from './pages/BackupPage';
import TokenUsagePage from './pages/TokenUsagePage';
import InviteCodePage from './pages/InviteCodePage';
import { useAppStore } from './stores/appStore';
import InstallProgressBridge from './components/InstallProgressBridge';

/** 始终显示向导（不管 wizardCompleted 状态）；用于设置页和首页的「重新进入向导」入口 */
function AlwaysWizard() {
  const setCurrentStep = useAppStore((s) => s.setCurrentStep);
  useEffect(() => {
    setCurrentStep(1);
  }, [setCurrentStep]);
  return <WizardPage />;
}

/** 已完成向导的用户访问 `/` 时进入首页，避免再次卡在向导 */
function WizardOrSetup() {
  const wizardCompleted = useAppStore((s) => s.wizardCompleted);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const unsub = useAppStore.persist.onFinishHydration(() => setReady(true));
    if (useAppStore.persist.hasHydrated()) {
      setReady(true);
    }
    return unsub;
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-600">加载中...</p>
      </div>
    );
  }
  if (wizardCompleted) {
    return <Navigate to="/home" replace />;
  }
  return <WizardPage />;
}

function App() {
  const { initialized, setInitialized } = useAppStore();
  const [inviteCodeValidated, setInviteCodeValidated] = useState(false);
  const [checkingInviteCode, setCheckingInviteCode] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const dataDir = await invoke<string>('get_data_dir');
        console.log('Data directory:', dataDir);
        console.log('检查邀请码状态');

        // 从本地存储中读取邀请码验证状态
        const storedStatus = localStorage.getItem('inviteCodeValidated');
        if (storedStatus === 'true') {
          setInviteCodeValidated(true);
        }
      } catch (e) {
        console.error('Init error:', e);
      } finally {
        setCheckingInviteCode(false);
        setInitialized(true);
      }
    };
    init();

    // 监听自定义事件，当邀请码验证成功时更新状态
    const handleInviteCodeValidated = (e: CustomEvent) => {
      console.log('收到邀请码验证成功事件:', e.detail);
      if (e.detail.validated) {
        setInviteCodeValidated(true);
      }
    };

    window.addEventListener('inviteCodeValidated', handleInviteCodeValidated as EventListener);

    return () => {
      window.removeEventListener('inviteCodeValidated', handleInviteCodeValidated as EventListener);
    };
  }, [setInitialized]);

  if (!initialized || checkingInviteCode) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto mb-4"></div>
          <p className="text-gray-600">正在加载...</p>
        </div>
      </div>
    );
  }

  // 如果邀请码未验证，显示邀请码验证页面
  if (!inviteCodeValidated) {
    return <InviteCodePage />;
  }

  return (
    <BrowserRouter>
      <InstallProgressBridge />
      <div className="min-h-screen bg-gray-50">
        <Toaster position="top-right" />
        <Routes>
          {/* 根路径重定向到向导页面 */}
          <Route path="/" element={<WizardOrSetup />} />
          <Route path="/wizard" element={<AlwaysWizard />} />
          <Route path="/home" element={<HomePage />} />
          <Route path="/robots" element={<RobotShopPage />} />
          <Route path="/instances/new" element={<InstanceCreatePage />} />
          <Route path="/instances" element={<InstancePage />} />
          <Route path="/models" element={<ModelConfigPage />} />
          <Route path="/plugins" element={<PluginPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/backup" element={<BackupPage />} />
          <Route path="/usage" element={<TokenUsagePage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
