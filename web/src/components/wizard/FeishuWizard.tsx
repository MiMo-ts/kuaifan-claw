import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { X, ExternalLink, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

interface Props {
  onComplete: (data: { appId: string; appSecret: string }) => void;
  onCancel: () => void;
}

interface WizardStep {
  step: number;
  title: string;
  description: string;
  url: string;
  urlLabel: string;
  checkLabel: string;
}

const FEISHU_WIZARD_STEPS: WizardStep[] = [
  {
    step: 1,
    title: '创建自建应用',
    description: '打开飞书开放平台，创建自建应用，填写应用名称和描述。创建完成后，在「凭证与基础信息」中复制 App ID 和 App Secret。',
    url: 'https://open.feishu.cn/app',
    urlLabel: '打开飞书开放平台',
    checkLabel: '已创建自建应用并获取 App ID',
  },
  {
    step: 2,
    title: '配置权限',
    description: '在应用后台的「权限管理」中，开通以下权限：im:message（获取与发送消息）、im:message.receive_v1（接收消息事件）、im:chat（获取群信息）。',
    url: 'https://open.feishu.cn/app',
    urlLabel: '打开飞书开放平台',
    checkLabel: '已开通所需权限',
  },
  {
    step: 3,
    title: '配置事件订阅',
    description: '在「事件订阅」中添加事件：接收消息（im.message.receive_v1），并填写请求地址。系统将自动提供 WebSocket 接入点地址。',
    url: 'https://open.feishu.cn/app',
    urlLabel: '打开飞书开放平台',
    checkLabel: '已配置事件订阅',
  },
  {
    step: 4,
    title: '发布应用',
    description: '在「版本管理与发布」中创建版本并提交审核。审核通过后，应用即可接收飞书消息。',
    url: 'https://open.feishu.cn/app',
    urlLabel: '打开飞书开放平台',
    checkLabel: '已完成发布',
  },
];

interface ProbeResult {
  success: boolean;
  appId?: string;
  appSecret?: string;
  error?: string;
  wsEndpoint?: string;
}

export default function FeishuWizard({ onComplete, onCancel }: Props) {
  const [currentStep, setCurrentStep] = useState(1);
  const [credentials, setCredentials] = useState({ appId: '', appSecret: '', verificationToken: '', encryptKey: '' });
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);

  const step = FEISHU_WIZARD_STEPS[currentStep - 1];
  if (!step) return null;

  const handleProbe = async () => {
    if (!credentials.appId.trim() || !credentials.appSecret.trim()) {
      toast.error('请先填写 App ID 和 App Secret');
      return;
    }
    setProbing(true);
    setProbeResult(null);
    try {
      const result = await invoke<ProbeResult>('probe_feishu', {
        appId: credentials.appId.trim(),
        appSecret: credentials.appSecret.trim(),
      });
      setProbeResult(result);
      if (result.success) {
        toast.success('飞书凭证验证成功！');
      } else {
        toast.error(result.error || '验证失败，请检查凭证是否正确');
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      setProbeResult({ success: false, error: errMsg });
      toast.error(`验证失败: ${errMsg}`);
    } finally {
      setProbing(false);
    }
  };

  const handleNext = () => {
    if (currentStep < FEISHU_WIZARD_STEPS.length) {
      setCurrentStep(currentStep + 1);
      setProbeResult(null);
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
      setProbeResult(null);
    }
  };

  const handleComplete = () => {
    if (!credentials.appId.trim() || !credentials.appSecret.trim()) {
      toast.error('App ID 和 App Secret 不能为空');
      return;
    }
    onComplete({ appId: credentials.appId.trim(), appSecret: credentials.appSecret.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">飞书自动化配置向导</h2>
            <p className="text-sm text-gray-500 mt-0.5">步骤 {currentStep} / {FEISHU_WIZARD_STEPS.length}</p>
          </div>
          <button onClick={onCancel} className="p-2 rounded-lg hover:bg-gray-100 transition-colors" title="取消">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-gray-100">
          <div
            className="h-full bg-blue-500 transition-all duration-300"
            style={{ width: `${(currentStep / FEISHU_WIZARD_STEPS.length) * 100}%` }}
          />
        </div>

        {/* Step content */}
        <div className="px-6 py-5 space-y-4">
          <div>
            <h3 className="text-base font-medium text-gray-900 mb-2">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-sm mr-2">
                {step.step}
              </span>
              {step.title}
            </h3>
            <p className="text-sm text-gray-600 leading-relaxed">{step.description}</p>
          </div>

          {/* Link to Feishu console */}
          <a
            href={step.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm hover:bg-blue-100 transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            {step.urlLabel}
          </a>

          {/* Credential inputs */}
          <div className="space-y-3 pt-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">App ID</label>
              <input
                type="text"
                value={credentials.appId}
                onChange={e => setCredentials(prev => ({ ...prev, appId: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="cli_xxxxxxxxxxxxxxxx"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">App Secret</label>
              <input
                type="password"
                value={credentials.appSecret}
                onChange={e => setCredentials(prev => ({ ...prev, appSecret: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="在飞书开放平台获取"
              />
            </div>
          </div>

          {/* Probe result */}
          {probeResult && (
            <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${probeResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              {probeResult.success ? (
                <CheckCircle className="w-4 h-4 text-green-600 shrink-0 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              )}
              <span className={probeResult.success ? 'text-green-800' : 'text-red-800'}>
                {probeResult.success ? '凭证验证成功' : probeResult.error || '验证失败'}
                {probeResult.wsEndpoint && <span className="block mt-1 text-xs text-gray-500">WebSocket 端点: {probeResult.wsEndpoint}</span>}
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex gap-3 justify-between">
          <div className="flex gap-2">
            {currentStep > 1 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
              >
                上一步
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 text-sm"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleProbe}
              disabled={probing || !credentials.appId.trim() || !credentials.appSecret.trim()}
              className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm disabled:opacity-50 flex items-center gap-1.5"
            >
              {probing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              验证凭证
            </button>
            {currentStep < FEISHU_WIZARD_STEPS.length ? (
              <button
                type="button"
                onClick={handleNext}
                className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 text-sm"
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                onClick={handleComplete}
                disabled={!credentials.appId.trim() || !credentials.appSecret.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 text-sm disabled:opacity-50"
              >
                完成并应用
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}