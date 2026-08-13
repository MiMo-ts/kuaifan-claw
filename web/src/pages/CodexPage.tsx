import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  CircleAlert,
  FolderCog,
  FolderOpen,
  LoaderCircle,
  MessagesSquare,
  Palette,
  Play,
  PlugZap,
  RefreshCw,
  Save,
  Settings2,
  Stethoscope,
  Wrench,
} from "lucide-react";
import { getStoredApiKey, saveApiKey } from "../services/proxyApi";

const KUAIFAN_BASE_URL = "https://kuaifanio.cn/v1";

const managerSections = [
  { id: "provider", label: "供应商与模型", icon: Settings2 },
  { id: "tools", label: "MCP、Skills 与插件", icon: PlugZap },
  { id: "sessions", label: "会话与工作区", icon: MessagesSquare },
  { id: "appearance", label: "增强与外观", icon: Palette },
  { id: "maintenance", label: "启动与维护", icon: Wrench },
  { id: "diagnostics", label: "诊断与日志", icon: Stethoscope },
] as const;

type ManagerSection = (typeof managerSections)[number]["id"];

const managerSectionDetails: Record<ManagerSection, { title: string; description: string }> = {
  provider: { title: "供应商与模型", description: "获取快泛可用模型、选择默认模型，并保存为 Codex++ 的活动供应商。" },
  tools: { title: "MCP、Skills 与插件", description: "控制 Codex++ 中的插件入口、模型白名单与服务档位显示。" },
  sessions: { title: "会话与工作区", description: "配置会话删除、导出、项目迁移以及 Zed / Worktree 集成行为。" },
  appearance: { title: "增强与外观", description: "控制 Codex++ 注入增强、Computer Use 防护和中文化菜单。" },
  maintenance: { title: "启动与维护", description: "配置启动优化与传递给 ChatGPT 桌面应用的启动参数。" },
  diagnostics: { title: "诊断与日志", description: "查看运行器、快泛配置及 Codex++ 配置文件的实时状态。" },
};

interface InstallStatus {
  installed: boolean;
  executablePath?: string;
  installerAvailable: boolean;
}

interface Model {
  id: string;
  name?: string;
  badge?: string;
}

interface CodexRuntimeStatus {
  runtimeAvailable: boolean;
  runtimePath?: string;
  runtimeRunning: boolean;
  launchRequested: boolean;
  launchError?: string;
  configured: boolean;
  configuredModel?: string;
  configPath: string;
  settingsPath: string;
  backupPath?: string;
}

interface CodexManagerPreferences {
  providerSyncEnabled: boolean;
  enhancementsEnabled: boolean;
  computerUseGuardEnabled: boolean;
  codexAppPluginMarketplaceUnlock: boolean;
  codexAppPluginAutoExpand: boolean;
  codexAppModelWhitelistUnlock: boolean;
  codexAppServiceTierControls: boolean;
  codexAppSessionDelete: boolean;
  codexAppMarkdownExport: boolean;
  codexAppPasteFix: boolean;
  codexAppProjectMove: boolean;
  codexAppThreadIdBadge: boolean;
  codexAppConversationView: boolean;
  codexAppThreadScrollRestore: boolean;
  codexAppZedRemoteOpen: boolean;
  zedRemoteProjectRegistryEnabled: boolean;
  zedRemoteSyncToZedSettings: boolean;
  codexAppUpstreamWorktreeCreate: boolean;
  codexAppForceChineseLocale: boolean;
  codexAppFastStartup: boolean;
  codexAppNativeMenuPlacement: boolean;
  codexAppNativeMenuLocalization: boolean;
  codexExtraArgs: string[];
}

export default function CodexPage() {
  const [installStatus, setInstallStatus] = useState<InstallStatus | null>(null);
  const [runtime, setRuntime] = useState<CodexRuntimeStatus | null>(null);
  const [preferences, setPreferences] = useState<CodexManagerPreferences | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [activeSection, setActiveSection] = useState<ManagerSection>("provider");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = async () => {
    const [installResult, runtimeResult, preferencesResult] = await Promise.allSettled([
      invoke<InstallStatus>("get_codex_install_status"),
      invoke<CodexRuntimeStatus>("get_codex_runtime_status"),
      invoke<CodexManagerPreferences>("get_codex_manager_preferences"),
    ]);
    if (installResult.status === "fulfilled") setInstallStatus(installResult.value);
    if (runtimeResult.status === "fulfilled") setRuntime(runtimeResult.value);
    if (preferencesResult.status === "fulfilled") setPreferences(preferencesResult.value);
    if (installResult.status === "rejected" && runtimeResult.status === "rejected") {
      setError("Codex 状态检测失败，请刷新重试。");
    } else if (preferencesResult.status === "rejected") {
      setError(preferencesResult.reason instanceof Error ? preferencesResult.reason.message : String(preferencesResult.reason));
    }
  };

  const loadModels = async () => {
    setLoadingModels(true);
    setError("");
    try {
      const result = await invoke<Model[]>("list_codex_kuaifan_marketplace_models");
      if (!result.length) throw new Error("快泛模型广场没有返回可用模型，请稍后重试。");
      setModels(result);
      setModel((current) => result.some((entry) => entry.id === current) ? current : result[0].id);
      setNotice(`已从模型广场获取 ${result.length} 个快泛模型。`);
    } catch (reason) {
      setModels([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoadingModels(false);
    }
  };

  const saveAndLaunch = async () => {
    if (!apiKey.trim()) {
      setError("请输入快泛 API Key 后再启动 Codex++。");
      return;
    }
    if (!model) {
      setError("请先获取并选择默认模型。");
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      saveApiKey(apiKey.trim(), "kuaifan");
      const next = await invoke<CodexRuntimeStatus>("save_and_launch_codex_kuaifan", {
        request: {
          apiKey: apiKey.trim(),
          model,
          modelList: models.map((entry) => entry.id),
        },
      });
      setRuntime(next);
      try {
        const updatedPreferences = await invoke<CodexManagerPreferences>("get_codex_manager_preferences");
        setPreferences(updatedPreferences);
      } catch {
        // The launch result remains valid even if the non-critical UI refresh fails.
      }
      if (next.launchError) {
        setError(`快泛配置已保存，但 Codex++ 未能启动：${next.launchError}`);
      } else if (next.launchRequested) {
        setNotice("快泛配置已保存，Codex++ 正在后台启动，快泛claw 可继续操作。");
      } else {
        setNotice("快泛配置已保存。");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving(false);
    }
  };

  const savePreferences = async (): Promise<boolean> => {
    if (!preferences) return false;
    setSavingPreferences(true);
    setError("");
    setNotice("");
    try {
      const next = await invoke<CodexManagerPreferences>("save_codex_manager_preferences", { request: preferences });
      setPreferences(next);
      setNotice("Codex++ 管理设置已保存。启动器会在下次启动时读取这些设置。");
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally {
      setSavingPreferences(false);
    }
  };

  const applyPreferencesAndLaunch = async () => {
    if (await savePreferences()) await saveAndLaunch();
  };

  const openContainingFolder = async (path?: string) => {
    if (!path) return;
    setError("");
    try {
      const folder = path.replace(/[\\/][^\\/]+$/, "");
      const message = await invoke<string>("open_folder", { path: folder || path });
      setNotice(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const refreshDashboard = async () => {
    setNotice("");
    await Promise.all([refresh(), loadModels()]);
  };

  const updatePreference = <K extends keyof CodexManagerPreferences>(key: K, value: CodexManagerPreferences[K]) => {
    setPreferences((current) => current ? { ...current, [key]: value } : current);
  };

  useEffect(() => {
    const storedApiKey = getStoredApiKey("kuaifan") ?? "";
    setApiKey(storedApiKey);
    void refresh();
    void loadModels();
  }, []);

  const canLaunch = Boolean(apiKey.trim() && model);

  return (
    <div className="h-full overflow-y-auto p-5" style={{ background: "var(--cx-bg)" }}>
      <div className="mx-auto max-w-6xl space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold" style={{ color: "var(--cx-text)" }}>Codex 控制台</h1>
            <p className="mt-1 text-sm" style={{ color: "var(--cx-text-mute)" }}>快泛 API 配置与 Codex++ 管理</p>
          </div>
          <button
            type="button"
            onClick={() => void refreshDashboard()}
            className="cx-btn cx-btn-secondary h-11 w-11 p-0"
            title="刷新 Codex 状态和模型广场目录"
            aria-label="刷新 Codex 状态和模型广场目录"
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        </header>

        <section aria-label="Codex 运行状态" className="grid gap-3 md:grid-cols-3">
          <StatusCard
            label="ChatGPT 桌面应用"
            value={installStatus?.installed ? "已检测到" : "未安装"}
            detail={installStatus?.executablePath ?? "通过 Codex 安装向导安装"}
            tone={installStatus?.installed ? "success" : "warning"}
          />
          <StatusCard
            label="Codex++ 运行器"
            value={runtime?.runtimeRunning ? "运行中" : runtime?.runtimeAvailable ? "就绪" : "未检测到"}
            detail={runtime?.runtimePath ?? "未发现 codex-plus-plus.exe"}
            tone={runtime?.runtimeRunning || runtime?.runtimeAvailable ? "success" : "warning"}
          />
          <StatusCard
            label="模型广场目录"
            value={loadingModels ? "加载中" : `${models.length} 个`}
            detail="https://kuaifanio.cn/pricing"
            tone={models.length ? "success" : "neutral"}
          />
        </section>

        <section className="cx-card-elev p-4 md:p-5" aria-labelledby="kuaifan-config-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="kuaifan-config-title" className="font-semibold" style={{ color: "var(--cx-text)" }}>快泛 API</h2>
              <p className="mt-1 text-sm" style={{ color: "var(--cx-text-mute)" }}>{KUAIFAN_BASE_URL} · 模型目录：https://kuaifanio.cn/pricing</p>
            </div>
            {runtime?.configured ? <span className="cx-badge cx-badge-success inline-flex items-center gap-1.5"><CheckCircle2 size={14} aria-hidden="true" />已写入 Codex</span> : null}
          </div>

          <div className="mt-5 grid gap-x-4 gap-y-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
            <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--cx-text)" }}>
              API Key
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                type="password"
                autoComplete="off"
                className="h-11 rounded border px-3"
                style={{ borderColor: "var(--cx-border)", background: "var(--cx-bg)" }}
              />
              <span className="text-xs font-normal" style={{ color: "var(--cx-text-dim)" }}>默认模型从公开模型广场获取，不需要登录；API Key 仅用于启动 Codex++。</span>
            </label>

            <div className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--cx-text)" }}>
              <div className="flex items-center gap-3">
                <label htmlFor="codex-default-model">默认模型</label>
              </div>
              <select
                id="codex-default-model"
                value={model}
                onChange={(event) => setModel(event.target.value)}
                disabled={!models.length}
                className="h-11 w-full rounded border px-3 disabled:cursor-not-allowed disabled:opacity-60"
                style={{ borderColor: "var(--cx-border)", background: "var(--cx-bg)" }}
              >
                {!model ? <option value="">选择模型</option> : null}
                {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name || entry.id}{entry.badge ? ` · ${entry.badge}` : ""}</option>)}
              </select>
              <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t pt-3" style={{ borderColor: "var(--cx-border-soft)" }}>
                <button
                  type="button"
                  onClick={() => void loadModels()}
                  disabled={loadingModels}
                  className="cx-btn cx-btn-secondary h-11 shrink-0 gap-2 disabled:cursor-not-allowed"
                >
                  {loadingModels ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <RefreshCw size={15} aria-hidden="true" />}
                  获取模型
                </button>
                <span className="text-xs font-normal" style={{ color: "var(--cx-text-dim)" }}>
                  {loadingModels ? "正在刷新模型广场" : models.length ? `已加载 ${models.length} 个模型` : "等待获取模型"}
                </span>
              </div>
            </div>

            <div className="flex justify-end border-t pt-4 lg:col-span-2" style={{ borderColor: "var(--cx-border-soft)" }}>
              <button
                type="button"
                disabled={!canLaunch}
                onClick={() => void saveAndLaunch()}
                className="cx-btn cx-btn-primary h-11 w-full min-w-44 justify-center gap-2 sm:w-auto disabled:cursor-not-allowed"
              >
                {saving ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                {saving ? "保存并启动中" : "保存并启动 Codex++"}
              </button>
            </div>
          </div>

          {error ? <Message tone="error" text={error} /> : null}
          {notice ? <Message tone="success" text={notice} /> : null}
          {runtime?.backupPath ? <p className="mt-3 break-all text-xs" style={{ color: "var(--cx-text-dim)" }}>配置备份：{runtime.backupPath}</p> : null}
        </section>

        <section className="cx-card-elev overflow-hidden" aria-label="Codex++ 管理功能">
          <div className="border-b p-4" style={{ borderColor: "var(--cx-border-soft)" }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <FolderCog size={18} style={{ color: "var(--cx-accent)" }} aria-hidden="true" />
                <h2 className="font-semibold" style={{ color: "var(--cx-text)" }}>Codex++ 管理</h2>
              </div>
              <button type="button" onClick={() => void savePreferences()} disabled={!preferences || savingPreferences} className="cx-btn cx-btn-secondary h-10 gap-2 disabled:cursor-not-allowed">
                {savingPreferences ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                保存管理设置
              </button>
            </div>
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Codex++ 管理类别">
              {managerSections.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveSection(section.id)}
                    className="inline-flex h-10 shrink-0 items-center gap-2 rounded border px-3 text-sm transition-colors"
                    style={{
                      borderColor: active ? "var(--cx-accent)" : "var(--cx-border)",
                      background: active ? "var(--cx-accent-soft)" : "var(--cx-bg)",
                      color: active ? "var(--cx-accent)" : "var(--cx-text-soft)",
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 md:p-5">
            {!preferences ? <div className="flex min-h-32 items-center justify-center text-sm" style={{ color: "var(--cx-text-mute)" }}><LoaderCircle size={18} className="mr-2 animate-spin" aria-hidden="true" />正在读取 Codex++ 管理设置</div> : null}
            {preferences ? <ManagerPanel activeSection={activeSection} preferences={preferences} runtime={runtime} model={model} modelCount={models.length} canLaunch={canLaunch} saving={saving} savingPreferences={savingPreferences} onChange={updatePreference} onSavePreferences={() => void savePreferences()} onSaveAndLaunch={() => void saveAndLaunch()} onApplyPreferencesAndLaunch={() => void applyPreferencesAndLaunch()} onRefresh={() => void refreshDashboard()} onOpenFolder={(path) => void openContainingFolder(path)} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ManagerPanel({ activeSection, preferences, runtime, model, modelCount, canLaunch, saving, savingPreferences, onChange, onSavePreferences, onSaveAndLaunch, onApplyPreferencesAndLaunch, onRefresh, onOpenFolder }: {
  activeSection: ManagerSection;
  preferences: CodexManagerPreferences;
  runtime: CodexRuntimeStatus | null;
  model: string;
  modelCount: number;
  canLaunch: boolean;
  saving: boolean;
  savingPreferences: boolean;
  onChange: <K extends keyof CodexManagerPreferences>(key: K, value: CodexManagerPreferences[K]) => void;
  onSavePreferences: () => void;
  onSaveAndLaunch: () => void;
  onApplyPreferencesAndLaunch: () => void;
  onRefresh: () => void;
  onOpenFolder: (path?: string) => void;
}) {
  const detail = managerSectionDetails[activeSection];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold" style={{ color: "var(--cx-text)" }}>{detail.title}</h3>
          <p className="mt-1 max-w-3xl text-sm" style={{ color: "var(--cx-text-mute)" }}>{detail.description}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeSection === "maintenance" ? <button type="button" onClick={onSaveAndLaunch} disabled={!canLaunch || saving} className="cx-btn cx-btn-primary h-10 gap-2 disabled:cursor-not-allowed disabled:opacity-50" title={!canLaunch ? "请先填写快泛 API Key 并选择默认模型" : undefined}><Play size={15} aria-hidden="true" />启动 Codex++</button> : null}
          {activeSection === "diagnostics" ? <button type="button" onClick={onRefresh} className="cx-btn cx-btn-secondary h-10 gap-2"><RefreshCw size={15} aria-hidden="true" />刷新状态</button> : null}
        </div>
      </div>

      {activeSection === "provider" ? <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <DiagnosticRow label="当前默认模型" value={model || runtime?.configuredModel || "未选择"} detail={modelCount ? `模型目录已加载，共 ${modelCount} 个模型` : "尚未获取模型，请点击“获取模型”"} />
          <DiagnosticRow label="快泛服务地址" value="OpenAI 兼容接口" detail={KUAIFAN_BASE_URL} />
        </div>
        <SettingsGrid>
          <SettingSwitch label="启动前修复历史会话归属" description="启动 Codex++ 前同步会话的供应商归属，避免历史会话使用错误的模型来源。" checked={preferences.providerSyncEnabled} onChange={(value) => onChange("providerSyncEnabled", value)} />
          <SettingSwitch label="模型白名单解锁" description="显示并允许使用快泛返回的全部模型，不受 Codex 默认模型白名单限制。" checked={preferences.codexAppModelWhitelistUnlock} onChange={(value) => onChange("codexAppModelWhitelistUnlock", value)} />
        </SettingsGrid>
      </div> : null}

      {activeSection === "tools" ? <SettingsGrid>
        <SettingSwitch label="插件市场解锁" description="启用 Codex 插件市场入口及内置市场修复逻辑。" checked={preferences.codexAppPluginMarketplaceUnlock} onChange={(value) => onChange("codexAppPluginMarketplaceUnlock", value)} />
        <SettingSwitch label="插件列表全部展开" description="打开插件页时自动展开完整列表，便于检查 Skills 与插件状态。" checked={preferences.codexAppPluginAutoExpand} onChange={(value) => onChange("codexAppPluginAutoExpand", value)} />
        <SettingSwitch label="模型白名单解锁" description="允许插件和工具页显示快泛模型目录中的可用模型。" checked={preferences.codexAppModelWhitelistUnlock} onChange={(value) => onChange("codexAppModelWhitelistUnlock", value)} />
        <SettingSwitch label="服务档位控制" description="显示 Codex 服务档位控制项，供具备权限的账号切换。" checked={preferences.codexAppServiceTierControls} onChange={(value) => onChange("codexAppServiceTierControls", value)} />
      </SettingsGrid> : null}

      {activeSection === "sessions" ? <SettingsGrid>
        <SettingSwitch label="会话删除" description="在 Codex++ 中启用本地会话删除及备份保护。" checked={preferences.codexAppSessionDelete} onChange={(value) => onChange("codexAppSessionDelete", value)} />
        <SettingSwitch label="Markdown 导出" description="为会话提供 Markdown 导出入口。" checked={preferences.codexAppMarkdownExport} onChange={(value) => onChange("codexAppMarkdownExport", value)} />
        <SettingSwitch label="粘贴修复" description="修复大段文本和代码粘贴时的输入兼容问题。" checked={preferences.codexAppPasteFix} onChange={(value) => onChange("codexAppPasteFix", value)} />
        <SettingSwitch label="会话项目移动" description="允许把会话重新关联到项目工作区。" checked={preferences.codexAppProjectMove} onChange={(value) => onChange("codexAppProjectMove", value)} />
        <SettingSwitch label="会话 ID 标识" description="在会话界面显示线程 ID，便于定位和诊断。" checked={preferences.codexAppThreadIdBadge} onChange={(value) => onChange("codexAppThreadIdBadge", value)} />
        <SettingSwitch label="对话居中宽度" description="使用更易阅读的居中对话区域。" checked={preferences.codexAppConversationView} onChange={(value) => onChange("codexAppConversationView", value)} />
        <SettingSwitch label="会话滚动位置恢复" description="重新打开会话后恢复上次阅读位置。" checked={preferences.codexAppThreadScrollRestore} onChange={(value) => onChange("codexAppThreadScrollRestore", value)} />
        <SettingSwitch label="Zed 远程项目入口" description="显示从 Codex 会话打开 Zed 远程项目的入口。" checked={preferences.codexAppZedRemoteOpen} onChange={(value) => onChange("codexAppZedRemoteOpen", value)} />
        <SettingSwitch label="记录 Zed 项目" description="保存最近使用的 Zed 远程项目记录。" checked={preferences.zedRemoteProjectRegistryEnabled} onChange={(value) => onChange("zedRemoteProjectRegistryEnabled", value)} />
        <SettingSwitch label="同步 Zed 设置" description="将项目选择同步到 Zed 远程项目设置。" checked={preferences.zedRemoteSyncToZedSettings} onChange={(value) => onChange("zedRemoteSyncToZedSettings", value)} />
        <SettingSwitch label="上游 Worktree 创建" description="允许从会话工作区创建上游 Git worktree。" checked={preferences.codexAppUpstreamWorktreeCreate} onChange={(value) => onChange("codexAppUpstreamWorktreeCreate", value)} />
      </SettingsGrid> : null}

      {activeSection === "appearance" ? <SettingsGrid>
        <SettingSwitch label="启用 Codex 增强" description="启用 Codex++ 的界面、会话和工具增强注入。" checked={preferences.enhancementsEnabled} onChange={(value) => onChange("enhancementsEnabled", value)} />
        <SettingSwitch label="Windows Computer Use Guard" description="在 Windows 上为 Computer Use 提供额外操作防护。" checked={preferences.computerUseGuardEnabled} onChange={(value) => onChange("computerUseGuardEnabled", value)} />
        <SettingSwitch label="界面中文化设置" description="将 Codex++ 可本地化的界面文本优先显示为中文。" checked={preferences.codexAppForceChineseLocale} onChange={(value) => onChange("codexAppForceChineseLocale", value)} />
        <SettingSwitch label="原生菜单位置增强" description="改善 Windows 原生菜单的挂载和定位行为。" checked={preferences.codexAppNativeMenuPlacement} onChange={(value) => onChange("codexAppNativeMenuPlacement", value)} />
        <SettingSwitch label="原生菜单汉化" description="翻译 Codex 原生菜单中的可本地化项目。" checked={preferences.codexAppNativeMenuLocalization} onChange={(value) => onChange("codexAppNativeMenuLocalization", value)} />
      </SettingsGrid> : null}

      {activeSection === "maintenance" ? <div className="space-y-4">
        <SettingsGrid>
          <SettingSwitch label="快速启动" description="在 Codex++ 启动时启用启动优化规则，缩短初始化等待。" checked={preferences.codexAppFastStartup} onChange={(value) => onChange("codexAppFastStartup", value)} />
        </SettingsGrid>
        <label className="grid gap-1.5 text-sm font-medium" style={{ color: "var(--cx-text)" }}>
          ChatGPT 启动参数
          <textarea value={preferences.codexExtraArgs.join("\n")} onChange={(event) => onChange("codexExtraArgs", event.target.value.split("\n"))} className="min-h-28 resize-y rounded border p-3 font-mono text-sm" style={{ borderColor: "var(--cx-border)", background: "var(--cx-bg)" }} placeholder="每行一个 Chromium 启动参数，例如 --force_high_performance_gpu" />
          <span className="text-xs font-normal" style={{ color: "var(--cx-text-dim)" }}>这些参数由 Codex++ 启动器传递给 ChatGPT 桌面应用。</span>
        </label>
        <button type="button" onClick={() => onOpenFolder(runtime?.runtimePath)} className="cx-btn cx-btn-secondary h-10 gap-2"><FolderOpen size={15} aria-hidden="true" />打开 Codex++ 运行器目录</button>
      </div> : null}

      {activeSection === "diagnostics" ? <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <DiagnosticRow label="Codex++ 运行器" value={runtime?.runtimeRunning ? "运行中" : runtime?.runtimeAvailable ? "就绪" : "未检测到"} detail={runtime?.runtimePath ?? "未发现运行器"} />
          <DiagnosticRow label="快泛配置" value={runtime?.configured ? "已写入" : "未写入"} detail={runtime?.configPath ?? "未读取配置路径"} />
          <DiagnosticRow label="Codex++ 设置" value="已受管" detail={runtime?.settingsPath ?? "未读取设置路径"} />
          <DiagnosticRow label="最近备份" value={runtime?.backupPath ? "可恢复" : "暂无本次备份"} detail={runtime?.backupPath ?? "保存或启动配置后创建"} />
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onRefresh} className="cx-btn cx-btn-secondary h-10 gap-2"><RefreshCw size={15} aria-hidden="true" />刷新诊断</button>
          <button type="button" onClick={() => onOpenFolder(runtime?.configPath)} className="cx-btn cx-btn-secondary h-10 gap-2"><FolderOpen size={15} aria-hidden="true" />打开 Codex 配置目录</button>
          <button type="button" onClick={() => onOpenFolder(runtime?.settingsPath)} className="cx-btn cx-btn-secondary h-10 gap-2"><FolderOpen size={15} aria-hidden="true" />打开 Codex++ 设置目录</button>
        </div>
      </div> : null}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4" style={{ borderColor: "var(--cx-border-soft)" }}>
        <p className="text-xs" style={{ color: "var(--cx-text-dim)" }}>开关变更仅在保存后写入 Codex++ 设置文件；“保存并启动”会立即应用配置并拉起运行器。</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onSavePreferences} disabled={savingPreferences} className="cx-btn cx-btn-secondary h-10 gap-2 disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} aria-hidden="true" />保存并应用此分类</button>
          <button type="button" onClick={onApplyPreferencesAndLaunch} disabled={!canLaunch || saving || savingPreferences} className="cx-btn cx-btn-primary h-10 gap-2 disabled:cursor-not-allowed disabled:opacity-50" title={!canLaunch ? "请先填写快泛 API Key 并选择默认模型" : undefined}><Play size={15} aria-hidden="true" />保存并启动 Codex++</button>
        </div>
      </div>
    </div>
  );
}

function SettingsGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-3 md:grid-cols-2">{children}</div>;
}

function SettingSwitch({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex min-h-[76px] cursor-pointer items-center justify-between gap-4 rounded border px-3 py-3 transition-colors hover:bg-[var(--cx-bg-hover)]" style={{ borderColor: "var(--cx-border-soft)", color: "var(--cx-text)" }}>
      <span className="grid gap-1">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs" style={{ color: "var(--cx-text-mute)" }}>{description}</span>
      </span>
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(event) => onChange(event.currentTarget.checked)} className="h-5 w-5 shrink-0 accent-[var(--cx-accent)]" />
    </label>
  );
}

function DiagnosticRow({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded border p-3" style={{ borderColor: "var(--cx-border-soft)" }}><p className="text-xs" style={{ color: "var(--cx-text-mute)" }}>{label}</p><p className="mt-1 font-medium" style={{ color: "var(--cx-text)" }}>{value}</p><p className="mt-1 break-all text-xs" style={{ color: "var(--cx-text-dim)" }}>{detail}</p></div>;
}

function StatusCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: "success" | "warning" | "neutral" }) {
  const color = tone === "success" ? "var(--cx-success)" : tone === "warning" ? "var(--cx-warn)" : "var(--cx-text)";
  return <div className="cx-card-elev p-4"><p className="text-sm" style={{ color: "var(--cx-text-mute)" }}>{label}</p><p className="mt-2 font-semibold" style={{ color }}>{value}</p><p className="mt-1 break-all text-xs" style={{ color: "var(--cx-text-dim)" }}>{detail}</p></div>;
}

function Message({ tone, text }: { tone: "error" | "success"; text: string }) {
  const success = tone === "success";
  return <div className="mt-4 flex items-start gap-2 rounded border px-3 py-2 text-sm" style={{ borderColor: success ? "var(--cx-success)" : "var(--cx-error)", background: success ? "var(--cx-success-soft)" : "var(--cx-error-soft)", color: success ? "var(--cx-success)" : "var(--cx-error)" }} role={success ? "status" : "alert"}>{success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" aria-hidden="true" /> : <CircleAlert size={16} className="mt-0.5 shrink-0" aria-hidden="true" />}<span>{text}</span></div>;
}
