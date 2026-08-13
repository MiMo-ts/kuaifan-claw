import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import EnvCheck from "../components/wizard/EnvCheck";
import OpenClawInstall from "../components/wizard/OpenClawInstall";
import CodexInstall from "../components/wizard/CodexInstall";
import InfiniteCanvasInstall from "../components/wizard/InfiniteCanvasInstall";
import WizardNav from "../components/wizard/WizardNav";

const MODULE_LABELS: Record<string, string> = {
  openclaw: "OpenClaw",
  hermes: "Hermes",
  codex: "Codex",
  claude: "Claude",
  infinite_canvas: "画布与视频",
};

const SUPPORTED_MODULES = ["openclaw", "hermes", "codex", "claude", "infinite_canvas"] as const;
type WizardModuleId = (typeof SUPPORTED_MODULES)[number];

const STEPS: Record<string, { id: number; name: string; component: any }[]> = {
  openclaw: [
    { id: 1, name: "环境检测", component: EnvCheck },
    { id: 2, name: "安装 OpenClaw", component: OpenClawInstall },
  ],
  hermes: [
    { id: 1, name: "环境检测", component: EnvCheck },
    { id: 2, name: "安装 Hermes", component: OpenClawInstall },
  ],
  codex: [
    { id: 1, name: "安装 ChatGPT", component: CodexInstall },
  ],
  infinite_canvas: [
    { id: 1, name: "安装画布与视频", component: InfiniteCanvasInstall },
  ],
};

export default function WizardPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentStep, setCurrentStep, activeModule } = useAppStore();

  // 从 URL 参数读取模块，设置到 store（优先 URL > store）
  const moduleFromUrl = searchParams.get("module") || activeModule || "openclaw";
  const moduleId: WizardModuleId = (SUPPORTED_MODULES as readonly string[]).includes(moduleFromUrl)
    ? (moduleFromUrl as WizardModuleId)
    : "openclaw";
  const moduleLabel = MODULE_LABELS[moduleId] || moduleId;
  const steps = STEPS[moduleId] || STEPS.openclaw;

  // 首次进入时同步模块到 store
  useEffect(() => {
    if (moduleFromUrl !== activeModule) {
      useAppStore.getState().setActiveModule(moduleId);
    }
  }, []);

  useEffect(() => {
    setCurrentStep(1);
  }, [setCurrentStep]);

  const handleFinish = () => {
    navigate("/home", { replace: true });
    return true;
  };

  const handleNext = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handlePrev = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const StepComponent =
    steps.find((s) => s.id === currentStep)?.component || steps[0].component;

  return (
    <div style={{ background: "var(--cx-bg)", minHeight: "100vh" }}>
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-bold mb-2"
            style={{ color: "var(--cx-text)" }}
          >
            快泛 Claw
          </h1>
          <p style={{ color: "var(--cx-text-mute)", fontSize: 14 }}>
            {moduleLabel} 环境安装向导
          </p>
        </div>

        <div className="mb-8">
          <WizardNav steps={steps} currentStep={currentStep} />
        </div>

        <div className="cx-card-elev p-8" style={{ minHeight: 400 }}>
          <StepComponent
            onNext={
              currentStep === steps.length ? handleFinish : handleNext
            }
            onPrev={handlePrev}
          />
        </div>
      </div>
    </div>
  );
}
