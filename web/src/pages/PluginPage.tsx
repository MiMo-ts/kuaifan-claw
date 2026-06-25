import { useNavigate } from "react-router-dom";
import PluginConfigComponent from "../components/wizard/PluginConfig";

export default function PluginPage() {
  const navigate = useNavigate();

  return (
    <div className="p-5" style={{ background: "var(--cx-bg)" }}>
      <div className="max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-xl font-semibold" style={{ color: "var(--cx-text)" }}>
            聊天插件管理
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--cx-text-mute)" }}>
            选择需要安装的聊天平台插件
          </p>
        </div>
        <div className="cx-card-elev p-5">
          <PluginConfigComponent onNext={() => navigate("/home")} onPrev={() => navigate("/home")} />
        </div>
      </div>
    </div>
  );
}
