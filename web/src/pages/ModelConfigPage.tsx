import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import ModelConfigComponent from '../components/wizard/ModelConfig';

export default function ModelConfigPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">大模型配置</h1>
            <p className="text-sm text-gray-500">配置 AI 模型供应商和 API Key</p>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm p-6">
          <ModelConfigComponent
            onNext={() => navigate('/home')}
            onPrev={() => navigate('/home')}
          />
        </div>
      </div>
    </div>
  );
}
