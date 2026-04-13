import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CheckCircle, AlertCircle, Loader2, Package } from "lucide-react";
import {
  INSTALL_PROGRESS_DOM_EVENT,
  InstallProgressPayload,
} from "../../utils/installProgressBridge";

interface RobotTemplate {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  system_prompt?: string;
  icon: string;
  color: string;
  default_skills: string[];
  default_mcp: string[];
  tags: string[];
  downloaded?: boolean;
}

interface McpRecommendation {
  id: string;
  name: string;
  description: string;
  setup_note: string;
  /** 常见实现可能依赖云端 API Key */
  requires_api_key?: boolean;
}

interface SkillInfo {
  id: string;
  name: string;
  description: string;
  license: string;
  stars: number;
  free: boolean;
  downloaded: boolean;
  notice?: string;
}

interface Props {
  onNext: () => void;
  onPrev: () => void;
  selectedRobot: RobotTemplate | null;
  setSelectedRobot: (robot: RobotTemplate | null) => void;
}

const CATEGORIES = [
  "全部",
  "电商机器人",
  "社交媒体机器人",
  "金融股票机器人",
  "内容创作机器人",
  "办公效率机器人",
  "企业服务机器人",
  "开发者机器人",
  "通用助手",
];

export default function RobotShop({
  onNext,
  onPrev,
  selectedRobot,
  setSelectedRobot,
}: Props) {
  const [templates, setTemplates] = useState<RobotTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState("全部");
  const [previewRobot, setPreviewRobot] = useState<RobotTemplate | null>(null);
  const [robotSkills, setRobotSkills] = useState<SkillInfo[]>([]);
  const [robotMcps, setRobotMcps] = useState<McpRecommendation[]>([]);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadResults, setDownloadResults] = useState<
    { skill: string; status: string; detail?: string }[]
  >([]);
  const [downloadLive, setDownloadLive] = useState<{
    message: string;
    percent: number | null;
    overallDone: number;
    overallTotal: number;
  } | null>(null);

  const skillsProgressActiveRef = useRef(false);
  const skillsDoneCountRef = useRef(0);
  const skillsTotalRef = useRef(0);
  /** 避免下载完成后用户已切换预览，把结果写到错误的机器人上 */
  const previewRobotIdRef = useRef<string | null>(null);

  useEffect(() => {
    previewRobotIdRef.current = previewRobot?.id ?? null;
  }, [previewRobot]);

  useEffect(() => {
    loadTemplates();
  }, []);

  /** 返回最新列表；quiet 时不盖全页 loading（下载后/窗口聚焦刷新用） */
  const loadTemplates = useCallback(
    async (opts?: { quiet?: boolean }): Promise<RobotTemplate[]> => {
      if (!opts?.quiet) setLoading(true);
      let list: RobotTemplate[] = [];
      try {
        list = await invoke<RobotTemplate[]>("list_robot_templates");
        setTemplates(list);
      } catch (e) {
        console.error("Load templates error:", e);
      }
      if (!opts?.quiet) setLoading(false);
      return list;
    },
    [],
  );

  /** 切回应用时静默刷新，与后端模板/磁盘 skills 对齐 */
  useEffect(() => {
    const onFocus = () => {
      loadTemplates({ quiet: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadTemplates]);

  const handlePreview = async (robot: RobotTemplate) => {
    setPreviewRobot(robot);
    skillsProgressActiveRef.current = false;
    setDownloading(false);
    setDownloadLive(null);
    setDownloadResults([]);
    setSkillsError(null);
    setRobotMcps([]);
    setSkillsLoading(true);
    setMcpLoading(true);
    setRobotSkills([]);
    try {
      const [skills, mcps] = await Promise.all([
        invoke<SkillInfo[]>("get_robot_skills", { robotId: robot.id }),
        invoke<McpRecommendation[]>("get_robot_mcp_recommendations", {
          robotId: robot.id,
        }),
      ]);
      setRobotSkills(skills);
      setRobotMcps(mcps);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setSkillsError(msg);
      setRobotSkills([]);
      setRobotMcps([]);
    }
    setSkillsLoading(false);
    setMcpLoading(false);
  };

  const onSkillsInstallProgress = useCallback((e: Event) => {
    if (!skillsProgressActiveRef.current) return;
    const d = (e as CustomEvent<InstallProgressPayload>).detail;

    if (d.stage === "skills-catalog") {
      setDownloadLive((prev) => {
        const total = prev?.overallTotal ?? skillsTotalRef.current;
        return {
          message: d.message,
          percent: d.percent ?? null,
          overallDone: prev?.overallDone ?? 0,
          overallTotal: total,
        };
      });
      return;
    }

    if (!d.stage.startsWith("skill-")) return;

    if (d.status === "finished" && d.message.includes("下载成功")) {
      skillsDoneCountRef.current += 1;
    }

    setDownloadLive((prev) => {
      const total = prev?.overallTotal ?? skillsTotalRef.current;
      return {
        message: d.message,
        percent: d.percent ?? null,
        overallDone: skillsDoneCountRef.current,
        overallTotal: total,
      };
    });
  }, []);

  useEffect(() => {
    window.addEventListener(
      INSTALL_PROGRESS_DOM_EVENT,
      onSkillsInstallProgress,
    );
    return () =>
      window.removeEventListener(
        INSTALL_PROGRESS_DOM_EVENT,
        onSkillsInstallProgress,
      );
  }, [onSkillsInstallProgress]);

  const handleDownloadSkills = async () => {
    if (!previewRobot) return;
    const targetRobotId = previewRobot.id;

    const freeSkills = robotSkills.filter((s) => s.free);
    const skippedSkills = robotSkills.filter((s) => !s.free);

    if (freeSkills.length === 0) {
      setDownloadResults(
        skippedSkills.map((s) => ({
          skill: s.name,
          status: "skipped",
          detail: "无免费包",
        })),
      );
      return;
    }

    setDownloading(true);
    setDownloadResults([]);
    skillsProgressActiveRef.current = true;
    skillsDoneCountRef.current = 0;
    skillsTotalRef.current = freeSkills.length;
    setDownloadLive({
      message: "准备下载…",
      percent: null,
      overallDone: 0,
      overallTotal: freeSkills.length,
    });

    type ApiRow = { skill_id: string; status: string; message: string };
    try {
      const raw = await invoke<{
        success_count: number;
        skip_count: number;
        total: number;
        results: ApiRow[];
      }>("download_skills", {
        robotId: previewRobot.id,
        skills: freeSkills.map((s) => s.id),
      });

      const nameById = new Map(robotSkills.map((s) => [s.id, s.name]));
      const fromApi: { skill: string; status: string; detail?: string }[] = (
        raw.results ?? []
      ).map((r) => ({
        skill: nameById.get(r.skill_id) ?? r.skill_id,
        status:
          r.status === "success"
            ? "success"
            : r.status === "skipped"
              ? "skipped"
              : "failed",
        detail: r.message,
      }));

      for (const s of skippedSkills) {
        fromApi.push({
          skill: s.name,
          status: "skipped",
          detail: "非免费，已跳过",
        });
      }

      if (previewRobotIdRef.current !== targetRobotId) {
        return;
      }
      setDownloadResults(fromApi);
      try {
        const refreshed = await invoke<SkillInfo[]>("get_robot_skills", {
          robotId: targetRobotId,
        });
        if (previewRobotIdRef.current === targetRobotId) {
          setRobotSkills(refreshed);
        }
      } catch {
        /* 忽略刷新失败 */
      }
      const freshTemplates = await loadTemplates({ quiet: true });
      const updatedCard = freshTemplates.find((t) => t.id === targetRobotId);
      if (
        updatedCard &&
        previewRobotIdRef.current === targetRobotId
      ) {
        setPreviewRobot(updatedCard);
      }
    } catch (err) {
      if (previewRobotIdRef.current !== targetRobotId) {
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setDownloadLive((prev) =>
        prev
          ? { ...prev, message: `下载失败：${msg}` }
          : {
              message: `下载失败：${msg}`,
              percent: null,
              overallDone: 0,
              overallTotal: freeSkills.length,
            },
      );
      setDownloadResults([
        { skill: "（整体）", status: "failed", detail: msg },
      ]);
    } finally {
      skillsProgressActiveRef.current = false;
      setDownloading(false);
      setDownloadLive(null);
    }
  };

  const handleSelectRobot = () => {
    if (previewRobot) {
      setSelectedRobot(previewRobot);
      setPreviewRobot(null);
    }
  };

  const filteredTemplates =
    selectedCategory === "全部"
      ? templates
      : templates.filter((t) => t.category === selectedCategory);

  const renderStars = (count: number) => {
    return [...Array(5)].map((_, i) => (
      <span key={i} className={i < count ? "text-yellow-400" : "text-gray-300"}>
        ★
      </span>
    ));
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold text-gray-900 mb-2">
          机器人商店
        </h2>
        <p className="text-gray-600">
          选择或创建专属机器人，每个机器人都有独特的技能和配置
        </p>
      </div>

      <div className="flex gap-4 mb-4">
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1 text-sm rounded-full transition-colors
                ${
                  selectedCategory === cat
                    ? "bg-blue-500 text-white"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }
              `}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 max-h-[300px] overflow-y-auto">
        {filteredTemplates.map((robot) => (
          <div
            key={robot.id}
            onClick={() => handlePreview(robot)}
            className={`
              p-4 rounded-lg border cursor-pointer transition-all
              ${
                previewRobot?.id === robot.id
                  ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
                  : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-md"
              }
            `}
          >
            <div className="flex items-center mb-2">
              <span className="text-3xl mr-2">{robot.icon}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-900 truncate">{robot.name}</span>
                  {robot.downloaded ? (
                    <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium flex-shrink-0">已下载</span>
                  ) : (
                    <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium flex-shrink-0">未下载</span>
                  )}
                </div>
                <div className="text-xs text-gray-500">{robot.subcategory}</div>
              </div>
            </div>
            <p className="text-sm text-gray-500 line-clamp-2">
              {robot.description}
            </p>
            <div className="flex flex-wrap gap-1 mt-2">
              {robot.tags.slice(0, 3).map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      {previewRobot && (
        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center mb-3">
            <span className="text-4xl mr-3">{previewRobot.icon}</span>
            <div>
              <h3 className="text-lg font-semibold text-gray-900">
                {previewRobot.name}
              </h3>
              <p className="text-sm text-gray-500">
                {previewRobot.category} · {previewRobot.subcategory}
              </p>
            </div>
          </div>
          <p className="text-gray-600 mb-3 whitespace-pre-wrap">{previewRobot.description}</p>
          {previewRobot.system_prompt && previewRobot.system_prompt.trim().length > 0 && (
            <details className="mb-4 rounded-lg border border-gray-200 bg-white">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-lg">
                人设、职能与工作流（点击展开）
              </summary>
              <div className="px-3 pb-3 pt-1 text-sm text-gray-600 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto border-t border-gray-100">
                {previewRobot.system_prompt}
              </div>
            </details>
          )}

          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              内置 Skills（免费优先）
            </h4>
            <p className="text-xs text-gray-500 mb-2">
              技能从总仓库归档解压（{"skills/<id>/"}），HTTPS
              下载且国内镜像优先，无需 Git
              登录。若网络仍失败，可在环境变量中配置 OPENCLAW_GITHUB_MIRROR_PREFIXES。
            </p>
            {skillsLoading && (
              <div className="flex items-center gap-2 text-sm text-blue-600 py-2">
                <Loader2
                  className="w-4 h-4 animate-spin shrink-0"
                  aria-hidden
                />
                正在加载技能列表…
              </div>
            )}
            {skillsError && (
              <div className="text-sm text-red-600 mb-2 rounded border border-red-100 bg-red-50 px-2 py-1">
                加载失败：{skillsError}
              </div>
            )}
            <div className="space-y-2 max-h-[150px] overflow-y-auto">
              {robotSkills.map((skill) => (
                <div
                  key={skill.id}
                  className="flex items-center justify-between p-2 bg-white rounded border"
                >
                  <div className="flex items-center">
                    {skill.downloaded ? (
                      <span
                        className="mr-2 inline-flex shrink-0"
                        title="已下载到本机"
                      >
                        <CheckCircle
                          className="w-4 h-4 text-blue-500"
                          aria-label="已下载到本机"
                        />
                      </span>
                    ) : skill.free ? (
                      <span
                        className="mr-2 inline-flex shrink-0"
                        title="免费技能：需点击下方「下载免费 Skills」才会拉到本机"
                      >
                        <Package
                          className="w-4 h-4 text-emerald-600"
                          aria-label="免费技能，尚未下载"
                        />
                      </span>
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-500 mr-2 shrink-0" />
                    )}
                    <div>
                      <div className="text-sm font-medium text-gray-900">
                        {skill.name}
                        {skill.downloaded ? (
                          <span className="ml-1 text-xs font-normal text-blue-600">
                            已下载
                          </span>
                        ) : skill.free ? (
                          <span className="ml-1 text-xs font-normal text-amber-600">
                            未下载
                          </span>
                        ) : null}
                      </div>
                      <div className="text-xs text-gray-500">
                        {skill.description}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center">
                    {renderStars(Math.min(5, Math.floor(skill.stars / 300)))}
                    <span className="text-xs text-gray-400 ml-1">
                      ({skill.stars})
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mb-4">
            <h4 className="text-sm font-medium text-gray-700 mb-2">
              推荐 MCP（与 Skills 配套）
            </h4>
            <p className="text-xs text-gray-500 mb-2">
              MCP 由 OpenClaw 侧进程提供；此处仅列出与本机器人场景匹配的推荐项，需在配置中自行接入，本向导不会自动安装 MCP。
            </p>
            {mcpLoading && (
              <div className="flex items-center gap-2 text-sm text-blue-600 py-2">
                <Loader2
                  className="w-4 h-4 animate-spin shrink-0"
                  aria-hidden
                />
                正在加载 MCP 推荐…
              </div>
            )}
            {!mcpLoading && robotMcps.length === 0 && (
              <p className="text-xs text-gray-400">本模板暂无 MCP 推荐</p>
            )}
            {!mcpLoading && robotMcps.length > 0 && (
              <ul className="space-y-2 max-h-[140px] overflow-y-auto">
                {robotMcps.map((m) => (
                  <li
                    key={m.id}
                    className="p-2 bg-white rounded border text-sm"
                  >
                    <div className="font-medium text-gray-900">
                      {m.name}{" "}
                      <code className="text-xs font-mono text-gray-500">
                        {m.id}
                      </code>
                      {m.requires_api_key ? (
                        <span className="ml-2 text-xs text-amber-700 font-normal">
                          可能需 API Key
                        </span>
                      ) : (
                        <span className="ml-2 text-xs text-green-700 font-normal">
                          默认无第三方 Key
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-600 mt-0.5">
                      {m.description}
                    </div>
                    <div className="text-xs text-amber-700 mt-1">{m.setup_note}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {downloading && downloadLive && downloadLive.overallTotal > 0 && (
            <div className="mb-4 p-3 bg-white rounded border border-blue-100 space-y-2">
              <div className="flex items-start justify-between gap-2 text-sm">
                <div className="flex items-center gap-2 text-gray-700 min-w-0">
                  <Loader2
                    className="w-4 h-4 text-blue-600 shrink-0 animate-spin"
                    aria-hidden
                  />
                  <span className="break-words">{downloadLive.message}</span>
                </div>
                <span className="text-xs text-gray-500 shrink-0 tabular-nums">
                  {downloadLive.overallDone}/{downloadLive.overallTotal}
                </span>
              </div>
              <div
                className="h-2 bg-gray-200 rounded-full overflow-hidden"
                role="progressbar"
                aria-valuenow={Math.round(
                  downloadLive.overallTotal > 0
                    ? Math.min(
                        100,
                        (100 *
                          (downloadLive.overallDone +
                            (downloadLive.percent != null
                              ? downloadLive.percent / 100
                              : 0))) /
                          downloadLive.overallTotal,
                      )
                    : 0,
                )}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-blue-500 transition-[width] duration-300 ease-out"
                  style={{
                    width: `${
                      downloadLive.overallTotal > 0
                        ? Math.min(
                            100,
                            (100 *
                              (downloadLive.overallDone +
                                (downloadLive.percent != null
                                  ? downloadLive.percent / 100
                                  : 0))) /
                              downloadLive.overallTotal,
                          )
                        : 0
                    }%`,
                  }}
                />
              </div>
            </div>
          )}

          {downloadResults.length > 0 && previewRobot && (
            <div className="mb-4 p-3 bg-white rounded border">
              <h4 className="text-sm font-medium text-gray-700 mb-2">
                下载结果
                <span className="ml-2 text-xs font-normal text-gray-500">
                  （当前：{previewRobot.name}）
                </span>
              </h4>
              <div className="space-y-1">
                {downloadResults.map((r, i) => (
                  <div key={i} className="flex items-start text-sm gap-2">
                    {r.status === "success" ? (
                      <CheckCircle className="w-4 h-4 text-green-500 mr-0 shrink-0 mt-0.5" />
                    ) : r.status === "failed" ? (
                      <AlertCircle className="w-4 h-4 text-red-500 mr-0 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-yellow-500 mr-0 shrink-0 mt-0.5" />
                    )}
                    <span
                      className={
                        r.status === "skipped"
                          ? "text-gray-400"
                          : r.status === "failed"
                            ? "text-red-700"
                            : "text-gray-700"
                      }
                    >
                      {r.skill}{" "}
                      {r.status === "skipped"
                        ? r.detail
                          ? `（${r.detail}）`
                          : "（已跳过）"
                        : r.status === "failed"
                          ? r.detail
                            ? `（${r.detail}）`
                            : "（失败）"
                          : r.detail
                            ? `（${r.detail}）`
                            : "（完成）"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleDownloadSkills}
              disabled={
                downloading || skillsLoading || robotSkills.length === 0
              }
              className="px-4 py-2 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 disabled:opacity-50 flex items-center gap-2"
            >
              {downloading ? (
                <>
                  <Loader2
                    className="w-4 h-4 animate-spin shrink-0"
                    aria-hidden
                  />
                  下载中…
                </>
              ) : (
                "下载免费 Skills"
              )}
            </button>
            <button
              type="button"
              onClick={handleSelectRobot}
              disabled={!previewRobot?.downloaded}
              className="px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              title={!previewRobot?.downloaded ? '请先下载 Skills 再选择此机器人' : ''}
            >
              {!previewRobot?.downloaded ? '未下载，请先下载' : '选择此机器人'}
            </button>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center pt-4 border-t">
        <button
          type="button"
          onClick={onPrev}
          className="px-4 py-2 text-gray-600 hover:text-gray-900"
        >
          上一步
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!selectedRobot}
          className={`px-6 py-2 rounded-lg font-medium transition-colors
            ${
              !selectedRobot
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-blue-500 text-white hover:bg-blue-600"
            }
          `}
        >
          {selectedRobot ? `已选择: ${selectedRobot.name}` : "请先选择机器人"}
        </button>
      </div>
    </div>
  );
}
