import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import { useAppStore } from '../stores/appStore';
import EnvCheck from '../components/wizard/EnvCheck';
import OpenClawInstall from '../components/wizard/OpenClawInstall';
import ModelConfig from '../components/wizard/ModelConfig';
import WizardNav from '../components/wizard/WizardNav';
import toast from 'react-hot-toast';

const STEPS = [
  { id: 1, name: '环境检测', component: EnvCheck },
  { id: 2, name: '安装 OpenClaw-CN', component: OpenClawInstall },
  { id: 3, name: '大模型配置', component: ModelConfig },
];

export default function WizardPage() {
  const navigate = useNavigate();
  const { wizardCompleted, setWizardCompleted, currentStep, setCurrentStep } = useAppStore();

  useEffect(() => {
    if (!wizardCompleted) {
      setCurrentStep(1);
    }
  }, [wizardCompleted, setCurrentStep]);

  // 检查用户是否已配置全局默认模型
  const checkDefaultModel = useCallback(async () => {
    try {
      const dm = await invoke<{ provider?: string; model_name?: string }>('get_default_model');
      return !!dm.provider && !!dm.model_name;
    } catch {
      return false;
    }
  }, []);

  // 步骤3完成后：必须验证默认模型已配置才允许进入主页
  const handleFinish = async () => {
    const configured = await checkDefaultModel();
    if (!configured) {
      toast.error(
        '请先在大模型配置页选择模型并勾选「设为全局默认模型」，保存后再完成向导',
        { duration: 6000 },
      );
      return false;
    }
    setWizardCompleted(true);
    navigate('/home', { replace: true });
    return true;
  };

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const StepComponent = STEPS.find(s => s.id === currentStep)?.component || STEPS[0].component;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            OpenClaw-CN Manager
          </h1>
          <p className="text-gray-600">一站式安装与管理系统</p>
        </div>

        <div className="mb-8">
          <WizardNav steps={STEPS} currentStep={currentStep} />
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 min-h-[400px]">
          <StepComponent
            onNext={currentStep === STEPS.length ? handleFinish : handleNext}
            onPrev={handlePrev}
          />
        </div>
      </div>
    </div>
  );
}
