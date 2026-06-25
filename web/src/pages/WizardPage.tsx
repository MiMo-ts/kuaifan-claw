import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "../stores/appStore";
import EnvCheck from "../components/wizard/EnvCheck";
import OpenClawInstall from "../components/wizard/OpenClawInstall";
import WizardNav from "../components/wizard/WizardNav";

const STEPS = [
  { id: 1, name: "环境检测", component: EnvCheck },
  { id: 2, name: "安装 OpenClaw-CN", component: OpenClawInstall },
];

export default function WizardPage() {
  const navigate = useNavigate();
  const { currentStep, setCurrentStep } = useAppStore();

  useEffect(() => {
    setCurrentStep(1);
  }, [setCurrentStep]);

  const handleFinish = () => {
    navigate("/home", { replace: true });
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

  const StepComponent =
    STEPS.find((s) => s.id === currentStep)?.component || STEPS[0].component;

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
            OpenClaw-CN 环境安装向导
          </p>
        </div>

        <div className="mb-8">
          <WizardNav steps={STEPS} currentStep={currentStep} />
        </div>

        <div className="cx-card-elev p-8" style={{ minHeight: 400 }}>
          <StepComponent
            onNext={
              currentStep === STEPS.length ? handleFinish : handleNext
            }
            onPrev={handlePrev}
          />
        </div>
      </div>
    </div>
  );
}
