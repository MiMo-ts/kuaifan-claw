import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import CreateInstance from '../components/wizard/CreateInstance';

interface RobotTemplate {
  id: string;
  name: string;
  description: string;
  system_prompt?: string;
  icon: string;
  color: string;
  category: string;
  subcategory: string;
  default_skills: string[];
  tags: string[];
}

/**
 * 独立「创建实例」流程（不经过完整向导），供首页 / 机器人商店跳转。
 */
export default function InstanceCreatePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId');
  const [selectedRobot, setSelectedRobot] = useState<RobotTemplate | null>(null);

  useEffect(() => {
    if (!robotId) {
      setSelectedRobot(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<RobotTemplate[]>('list_robot_templates');
        if (cancelled) return;
        const r = list.find((x) => x.id === robotId);
        setSelectedRobot(r ?? null);
        if (!r) {
          toast.error('未找到该机器人模板，请从机器人商店重新选择');
        }
      } catch (e) {
        console.error(e);
        toast.error('加载机器人模板失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [robotId]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 px-4 py-8">
      <div className="max-w-2xl mx-auto mb-4 flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/robots')}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          ← 返回机器人商店
        </button>
        <button
          type="button"
          onClick={() => navigate('/home')}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          回首页
        </button>
      </div>
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-2xl mx-auto">
        <CreateInstance
          onComplete={() => {
            toast.success('实例已创建');
            navigate('/home');
          }}
          onPrev={() => navigate('/robots')}
          selectedRobot={selectedRobot}
          isLastStep
        />
      </div>
    </div>
  );
}
