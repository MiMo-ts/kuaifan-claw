import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import { Plus, ArrowLeft, Download, Loader2, ChevronDown, ChevronUp, RefreshCw, CheckCircle, XCircle, SkipForward } from 'lucide-react';

interface RobotTemplate {
  id: string;
  category: string;
  subcategory: string;
  name: string;
  description: string;
  /** 与后端 builtin 模板一致：完整人设、工作流与合规说明 */
  system_prompt?: string;
  icon: string;
  color: string;
  default_skills: string[];
  default_mcp?: string[];
  tags: string[];
  downloaded?: boolean;
  skills_installed?: number;
  skills_total?: number;
}

/** 单个 Skill 的下载状态 */
interface SkillStatus {
  skill_id: string;
  status: 'pending' | 'downloading' | 'success' | 'failed' | 'skipped';
  message?: string;
}

interface DownloadState {
  /** key: skill_id */
  skills: Record<string, SkillStatus>;
  overall: 'idle' | 'downloading' | 'done' | 'partial' | 'error';
  errorMessage?: string;
}

/** 人类可读的 Skill 名称映射（fallback 用 skill_id） */
const SKILL_LABELS: Record<string, string> = {
  // 电商
  douyin_content: '抖音内容创作',
  douyin_script: '抖音脚本生成',
  douyin_comment: '抖音评论分析',
  xiaohongshu_copy: '小红书文案',
  xiaohongshu_seo: '小红书 SEO',
  xiaohongshu_hashtag: '小红书标签',
  product_selector: '选品工具',
  taobao_api: '淘宝 API',
  video_script: '短视频脚本',
  // 金融
  tushare: '金融数据 Tushare',
  stock_news: '股票新闻',
  news_sentiment: '新闻舆情',
  quant_algo: '量化算法',
  stock_monitor: '股票监控',
  // 内容创作
  comic_script: '漫画脚本',
  novel_writer: '小说写作',
  story_outline: '故事大纲',
  copywriter: '文案创作',
  // 办公效率
  doc_writer: '文档写作',
  meeting_minutes: '会议纪要',
  ppt_generator: 'PPT 大纲',
  email_writer: '邮件撰写',
  calendar: '日程管理',
  excel_analyzer: 'Excel 数据分析',
  data_analysis: '数据分析',
  document_parser: '文档解析',
  internal_comms: '内部沟通',
  git_commit: 'Git 提交摘要',
  feishu_doc_collab: '飞书文档协作',
  // 文档处理
  pdf_reader: 'PDF 阅读',
  pdf_edit: 'PDF 编辑',
  word_writer: 'Word 文档',
  // 企业服务（历史 id，旧实例或文档可能仍引用）
  contract_review: '合同审查',
  expense_report: '差旅报销',
  feishu_attendance: '飞书考勤',
  feishu_doc: '飞书文档读取',
  work_report: '团队日报',
  travel_manager: '差旅规划',
  feishu_power_skill: '飞书深度自动化',
  feishu_sheets: '飞书在线表格',
  feishu_pro: '飞书全功能套件',
  // 通用
  web_search: '网页搜索',
};

function skillLabel(id: string): string {
  return SKILL_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatusIcon({ status }: { status: SkillStatus['status'] }) {
  if (status === 'success') return <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
  if (status === 'skipped') return <SkipForward className="w-4 h-4 text-gray-400 shrink-0" />;
  if (status === 'downloading') return <Loader2 className="w-4 h-4 text-blue-500 animate-spin shrink-0" />;
  return <Loader2 className="w-4 h-4 text-gray-300 animate-spin shrink-0" />;
}

export default function RobotShopPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<RobotTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadingRobots, setDownloadingRobots] = useState<Record<string, boolean>>({});
  /** key: robotId */
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>({});
  /** 展开详情面板的 robotId */
  const [expandedRobot, setExpandedRobot] = useState<string | null>(null);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<RobotTemplate[]>('list_robot_templates');
      setTemplates(result || []);
    } catch (e) {
      console.error(e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadTemplates();
  }, [loadTemplates]);

  useEffect(() => {
    const onFocus = () => loadTemplates();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadTemplates]);

  // 下载全部 Skills
  const handleDownload = async (robot: RobotTemplate) => {
    if (downloadingRobots[robot.id]) return;

    // 初始化所有 Skill 为 pending
    const initSkills: Record<string, SkillStatus> = {};
    for (const sid of robot.default_skills) {
      initSkills[sid] = { skill_id: sid, status: 'pending' };
    }
    setDownloadStates(prev => ({
      ...prev,
      [robot.id]: { skills: initSkills, overall: 'downloading' },
    }));
    setDownloadingRobots(prev => ({ ...prev, [robot.id]: true }));

    try {
      const res = await invoke<{
        success_count: number;
        fail_count: number;
        results: Array<{ skill_id: string; status: string; message: string }>;
      }>('download_skills', {
        robotId: robot.id,
        skills: robot.default_skills,
      });

      // 用后端返回的逐个结果更新状态
      const updated: Record<string, SkillStatus> = {};
      for (const r of res.results) {
        updated[r.skill_id] = {
          skill_id: r.skill_id,
          status: r.status as SkillStatus['status'],
          message: r.message,
        };
      }
      setDownloadStates(prev => ({
        ...prev,
        [robot.id]: {
          skills: updated,
          overall: res.fail_count === 0 ? 'done' : res.success_count === 0 ? 'error' : 'partial',
          errorMessage: res.fail_count > 0
            ? `${res.fail_count} 个 Skill 安装失败，请点击重试按钮重试`
            : undefined,
        },
      }));

      if (res.fail_count === 0) {
        toast.success(`${robot.name}：全部 ${res.results.length} 个 Skill 已就绪`);
        await loadTemplates();
      } else {
        toast.error(`${robot.name}：${res.fail_count} 个 Skill 安装失败，可展开详情重试`);
      }
    } catch (e) {
      setDownloadStates(prev => ({
        ...prev,
        [robot.id]: {
          skills: initSkills,
          overall: 'error',
          errorMessage: String(e),
        },
      }));
      toast.error(`下载失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloadingRobots(prev => {
        const n = { ...prev };
        delete n[robot.id];
        return n;
      });
    }
  };

  // 重试单个失败的 Skill
  const handleRetrySkill = async (robotId: string, skillId: string) => {
    setDownloadStates(prev => {
      const cur = prev[robotId];
      if (!cur) return prev;
      return {
        ...prev,
        [robotId]: {
          ...cur,
          skills: {
            ...cur.skills,
            [skillId]: { skill_id: skillId, status: 'downloading' },
          },
        },
      };
    });

    try {
      const res = await invoke<{ skill_id: string; status: string; message: string }>(
        'download_skill_retry',
        { robotId, skillId },
      );
      const succeeded = res.status === 'success';
      setDownloadStates(prev => {
        const cur = prev[robotId];
        if (!cur) return prev;
        const newSkills = { ...cur.skills };
        newSkills[skillId] = { skill_id: res.skill_id, status: res.status as SkillStatus['status'], message: res.message };
        const failCount = Object.values(newSkills).filter(s => s.status === 'failed').length;
        const successCount = Object.values(newSkills).filter(s => s.status === 'success' || s.status === 'skipped').length;
        return {
          ...prev,
          [robotId]: {
            ...cur,
            skills: newSkills,
            overall: failCount === 0 ? 'done' : successCount === 0 ? 'error' : 'partial',
            errorMessage: failCount > 0 ? `${failCount} 个 Skill 安装失败` : undefined,
          },
        };
      });

      if (succeeded) {
        toast.success(`${skillLabel(skillId)} 安装成功`);
        await loadTemplates();
      } else {
        toast.error(`${skillLabel(skillId)} 仍失败: ${res.message}`);
      }
    } catch (e) {
      setDownloadStates(prev => {
        const cur = prev[robotId];
        if (!cur) return prev;
        return {
          ...prev,
          [robotId]: {
            ...cur,
            skills: {
              ...cur.skills,
              [skillId]: { skill_id: skillId, status: 'failed', message: String(e) },
            },
          },
        };
      });
      toast.error(`重试失败: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 重新下载全部（重置状态）
  const handleRetryAll = (robot: RobotTemplate) => {
    handleDownload(robot);
  };

  const categories = [...new Set(templates.map(t => t.category))];

  const downloadState = (robotId: string): DownloadState | null =>
    downloadStates[robotId] ?? null;

  const isDownloading = (robotId: string) => !!downloadingRobots[robotId];

  const overallBadge = (robot: RobotTemplate) => {
    const ds = downloadState(robot.id);
    if (isDownloading(robot.id) || ds?.overall === 'downloading') {
      return (
        <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium flex items-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" />下载中…
        </span>
      );
    }
    if (robot.downloaded) {
      return <span className="text-xs px-1.5 py-0.5 bg-green-100 text-green-700 rounded-full font-medium">已下载</span>;
    }
    if (ds?.overall === 'partial') {
      return (
        <span
          className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded-full font-medium cursor-pointer hover:bg-orange-200"
          title={ds.errorMessage}
        >
          部分失败
        </span>
      );
    }
    if (ds?.overall === 'error') {
      return <span className="text-xs px-1.5 py-0.5 bg-red-100 text-red-700 rounded-full font-medium">全部失败</span>;
    }
    if ((robot.skills_installed ?? 0) > 0 && (robot.skills_total ?? 0) > 0) {
      return (
        <span className="text-xs px-1.5 py-0.5 bg-orange-100 text-orange-800 rounded-full font-medium">
          部分下载 {robot.skills_installed}/{robot.skills_total}
        </span>
      );
    }
    return <span className="text-xs px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded-full font-medium">未下载</span>;
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <button
            type="button"
            onClick={() => navigate('/home')}
            className="p-2 text-gray-500 hover:text-gray-700"
            title="返回首页"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">机器人商店</h1>
            <p className="text-gray-500">选择机器人，创建专属 Agent</p>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12 text-gray-500">加载中...</div>
        ) : (
          <div className="space-y-8">
            {categories.map(cat => (
              <div key={cat}>
                <h2 className="text-lg font-semibold text-gray-800 mb-4">{cat}</h2>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {templates.filter(t => t.category === cat).map(robot => (
                    <div key={robot.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow">
                      {/* 卡片头部 */}
                      <div className="p-5">
                        <div className="flex items-start justify-between">
                          <div className="flex items-start flex-1">
                            <span className="text-4xl mr-4">{robot.icon}</span>
                            <div className="flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h3 className="font-semibold text-gray-900">{robot.name}</h3>
                                {overallBadge(robot)}
                              </div>
                              <p className="text-sm text-gray-500 mt-1 line-clamp-2" title={robot.description}>
                                {robot.description}
                              </p>
                            </div>
                          </div>
                        </div>

                        {/* 操作按钮行 */}
                        <div className="mt-4 flex items-center justify-between gap-2">
                          {/* 展开详情 */}
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedRobot(prev => (prev === robot.id ? null : robot.id))
                            }
                            aria-expanded={expandedRobot === robot.id}
                            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
                          >
                            {expandedRobot === robot.id ? (
                              <ChevronUp className="w-3.5 h-3.5" />
                            ) : (
                              <ChevronDown className="w-3.5 h-3.5" />
                            )}
                            {expandedRobot === robot.id ? '收起详情' : '查看详情'}
                          </button>

                          <div className="flex items-center gap-2">
                            {!robot.downloaded && (
                              <button
                                type="button"
                                onClick={() => handleDownload(robot)}
                                disabled={isDownloading(robot.id)}
                                className="px-3 py-1.5 text-sm border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 disabled:opacity-50 flex items-center gap-1.5"
                              >
                                {isDownloading(robot.id) ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Download className="w-3.5 h-3.5" />
                                )}
                                {isDownloading(robot.id) ? '下载中…' : '下载'}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                navigate(`/instances/new?robotId=${encodeURIComponent(robot.id)}`)
                              }
                              className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 ${
                                robot.downloaded
                                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                              }`}
                              disabled={!robot.downloaded}
                              title={!robot.downloaded ? '请先下载 Skills 再创建实例' : ''}
                            >
                              <Plus className="w-3.5 h-3.5" />
                              创建实例
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Skill 详情面板 */}
                      {expandedRobot === robot.id && (
                        <div className="border-t border-gray-100 px-5 py-4 bg-gray-50/50 rounded-b-xl space-y-4">
                          <div>
                            <h4 className="text-xs font-semibold text-gray-600 mb-2">功能说明（完整）</h4>
                            <p className="text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
                              {robot.description}
                            </p>
                          </div>
                          {robot.system_prompt && robot.system_prompt.trim().length > 0 && (
                            <div>
                              <h4 className="text-xs font-semibold text-gray-600 mb-2">
                                人设、职能与工作流
                              </h4>
                              <div
                                className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white px-3 py-2.5 shadow-inner"
                                role="region"
                                aria-label="机器人人设与工作流全文"
                              >
                                {robot.system_prompt}
                              </div>
                            </div>
                          )}

                          <div className="border-t border-gray-200 pt-3 space-y-2">
                            <h4 className="text-xs font-semibold text-gray-600">默认 Skills</h4>
                            <div className="space-y-2">
                            {(downloadState(robot.id)?.skills
                              ? Object.values(downloadState(robot.id)!.skills)
                              : robot.default_skills.map(sid => ({
                                  skill_id: sid,
                                  status: 'pending' as const,
                                  message: undefined as string | undefined,
                                }))
                            ).map(skill => (
                              <div
                                key={skill.skill_id}
                                className="flex items-center justify-between gap-3 py-1.5 px-2 rounded-lg hover:bg-white/80 transition-colors"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <StatusIcon status={skill.status} />
                                  <span className="text-sm text-gray-700 truncate">
                                    {skillLabel(skill.skill_id)}
                                  </span>
                                  <code className="text-xs text-gray-400 shrink-0">{skill.skill_id}</code>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  {skill.message && skill.status === 'failed' && (
                                    <span
                                      className="text-xs text-red-500 max-w-[160px] truncate"
                                      title={skill.message}
                                    >
                                      {skill.message.split('\n')[0]}
                                    </span>
                                  )}
                                  {skill.status === 'failed' && !isDownloading(robot.id) && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleRetrySkill(robot.id, skill.skill_id)
                                      }
                                      className="flex items-center gap-1 text-xs text-orange-600 hover:text-orange-700 font-medium"
                                      title="重试此 Skill"
                                    >
                                      <RefreshCw className="w-3 h-3" />
                                      重试
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                            </div>
                          </div>

                          {/* 底部操作 */}
                          {(downloadState(robot.id)?.overall === 'partial' ||
                            downloadState(robot.id)?.overall === 'error') && (
                            <button
                              type="button"
                              onClick={() => handleRetryAll(robot)}
                              disabled={isDownloading(robot.id)}
                              className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm border border-orange-200 text-orange-600 rounded-lg hover:bg-orange-50 disabled:opacity-50"
                            >
                              <RefreshCw className="w-3.5 h-3.5" />
                              全部重试
                            </button>
                          )}
                          {downloadState(robot.id)?.overall === 'done' && (
                            <div className="mt-3 flex items-center justify-center gap-1.5 text-sm text-green-600 font-medium">
                              <CheckCircle className="w-4 h-4" />
                              全部安装成功
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
