import { useNavigate } from "react-router-dom";
import ModelConfigComponent from "../components/wizard/ModelConfig";

export default function ModelConfigPage() {
  const navigate = useNavigate();

  return (
    <div className="p-5" style={{ background: "var(--cx-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold" style={{ color: "var(--cx-text)" }}>
            大模型配置
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--cx-text-mute)" }}>
            配置 AI 模型供应商和 API Key
          </p>
        </div>

        <div className="cx-card-elev p-5">
          <ModelConfigComponent
            onNext={() => navigate("/home")}
            onPrev={() => navigate("/home")}
          />
        </div>
      </div>
    </div>
  );
}
