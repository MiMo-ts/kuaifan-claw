import { useNavigate } from "react-router-dom";
import ModelConfigComponent from "../components/wizard/ModelConfig";
import { useAppStore } from "../stores/appStore";
import { moduleDefinition } from "../modules/registry";

export default function ModelConfigPage() {
  const navigate = useNavigate();
  const activeModule = useAppStore((state) => state.activeModule);
  const activeModuleDefinition = moduleDefinition(activeModule);

  return (
    <div className="p-5" style={{ background: "var(--cx-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold" style={{ color: "var(--cx-text)" }}>
            {activeModuleDefinition.name} 大模型配置
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--cx-text-mute)" }}>
            统一保存模型凭据，并投影到当前模块的运行配置
          </p>
        </div>

        <div className="cx-card-elev p-5">
          <ModelConfigComponent
            onNext={() => navigate("/home")}
            onPrev={() => navigate("/home")}
            moduleId={activeModule}
          />
        </div>
      </div>
    </div>
  );
}
