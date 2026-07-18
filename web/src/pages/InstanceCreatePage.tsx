import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconArrowLeft,
  CxIconExternalLink,
  CxIconRobots,
  CxIconSparkles,
} from "../components/icons";
import CreateInstance from '../components/wizard/CreateInstance';
import { useAppStore } from '../stores/appStore';

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

const C = {
  bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
  bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
  text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
  textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
  accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)', accentHover: 'var(--cx-accent-hover)',
};

export default function InstanceCreatePage() {
  const navigate = useNavigate();
  const activeModule = useAppStore((state) => state.activeModule);
  const [searchParams] = useSearchParams();
  const robotId = searchParams.get('robotId');
  const [selectedRobot, setSelectedRobot] = useState<RobotTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!robotId) { setSelectedRobot(null); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      try {
        const list = await invoke<RobotTemplate[]>('list_robot_templates');
        if (cancelled) return;
        const r = list.find((x) => x.id === robotId);
        setSelectedRobot(r ?? null);
        if (!r) toast.error('未找到该机器人模板，请从机器人商店重新选择');
      } catch (e) {
        console.error(e);
        toast.error('加载机器人模板失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [robotId]);

  return (
    <div className="min-h-full" style={{ background: C.bg }}>
      <header
        className="sticky top-0 z-20"
        style={{ background: C.bgElev, borderBottom: '1px solid ' + C.borderSoft }}
      >
        <div className="max-w-[920px] mx-auto px-6 h-14 flex items-center gap-4">
          <button
            onClick={() => navigate('/home')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: C.textMute }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}
          >
            <CxIconArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: C.accentSoft, boxShadow: 'inset 0 0 0 1px ' + C.accent + '26' }}
            >
              <CxIconSparkles className="w-3.5 h-3.5" style={{ color: C.accent }} strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[14px] font-semibold leading-tight" style={{ color: C.text }}>创建实例</h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: C.textMute }}>
                6 步引导 · 配置机器人 · 绑定渠道 · 启动运行
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/robots')}
            className="hidden sm:inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11.5px] font-medium transition-colors duration-150"
            style={{ color: C.textMute, border: '1px solid ' + C.borderSoft, background: C.bgElev }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.bgElev; e.currentTarget.style.color = C.textMute; }}
          >
            <CxIconRobots className="w-3.5 h-3.5" />
            机器人商店
            <CxIconExternalLink className="w-3 h-3 opacity-60" />
          </button>
        </div>
      </header>

      <main className="max-w-[920px] mx-auto px-6 py-6">
        {loading ? (
          <div className="rounded-xl p-6 cx-shimmer" style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, height: 480 }} />
        ) : (
          <section
            className="rounded-xl overflow-hidden"
            style={{
              background: C.bgElev,
              border: '1px solid ' + C.borderSoft,
              boxShadow: 'var(--cx-shadow-sm)',
            }}
          >
            <CreateInstance
              onComplete={() => { toast.success('实例已创建'); navigate('/home'); }}
              onPrev={() => navigate('/robots')}
              selectedRobot={selectedRobot}
              isLastStep
              moduleId={activeModule}
            />
          </section>
        )}
      </main>
    </div>
  );
}
