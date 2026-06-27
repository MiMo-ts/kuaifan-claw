import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
import toast from 'react-hot-toast';
import {
  CxIconArrowLeft,
  CxIconCheckCircle,
  CxIconChevronDown,
  CxIconChevronUp,
  CxIconDownload,
  CxIconLoader,
  CxIconPackages,
  CxIconPlus,
  CxIconRefresh,
  CxIconRobots,
  CxIconSearch,
  CxIconSkipForward,
  CxIconSparkles,
  CxIconTag,
  CxIconXCircle,
} from "../components/icons";
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
  default_mcp?: string[];
  tags: string[];
  downloaded?: boolean;
  skills_installed?: number;
  skills_total?: number;
}

interface SkillStatus {
  skill_id: string;
  status: 'pending' | 'downloading' | 'success' | 'failed' | 'skipped';
  message?: string;
}

interface DownloadState {
  skills: Record<string, SkillStatus>;
  overall: 'idle' | 'downloading' | 'done' | 'partial' | 'error';
  errorMessage?: string;
}

const SKILL_LABELS: Record<string, string> = {
  douyin_content: '抖音内容创作', douyin_script: '抖音脚本生成',
  douyin_comment: '抖音评论分析', xiaohongshu_copy: '小红书文案',
  xiaohongshu_seo: '小红书 SEO', xiaohongshu_hashtag: '小红书标签',
  product_selector: '选品工具', taobao_api: '淘宝 API',
  video_script: '短视频脚本', tushare: '金融数据 Tushare',
  stock_news: '股票新闻', news_sentiment: '新闻舆情',
  quant_algo: '量化算法', stock_monitor: '股票监控',
  comic_script: '漫画脚本', novel_writer: '小说写作',
  story_outline: '故事大纲', copywriter: '文案创作',
  doc_writer: '文档写作', meeting_minutes: '会议纪要',
  ppt_generator: 'PPT 大纲', email_writer: '邮件撰写',
  calendar: '日程管理', excel_analyzer: 'Excel 数据分析',
  data_analysis: '数据分析', document_parser: '文档解析',
  internal_comms: '内部沟通', git_commit: 'Git 提交摘要',
  feishu_doc_collab: '飞书文档协作', pdf_reader: 'PDF 阅读',
  pdf_edit: 'PDF 编辑', word_writer: 'Word 文档',
  contract_review: '合同审查', expense_report: '差旅报销',
  feishu_attendance: '飞书考勤', feishu_doc: '飞书文档读取',
  work_report: '团队日报', travel_manager: '差旅规划',
  feishu_power_skill: '飞书深度自动化', feishu_sheets: '飞书在线表格',
  feishu_pro: '飞书全功能套件', web_search: '网页搜索',
};

function skillLabel(id: string): string {
  return SKILL_LABELS[id] ?? id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

const C = {
  bg: 'var(--cx-bg)', bgSoft: 'var(--cx-bg-soft)', bgElev: 'var(--cx-bg-elev)',
  bgHover: 'var(--cx-bg-hover)', border: 'var(--cx-border)', borderSoft: 'var(--cx-border-soft)',
  text: 'var(--cx-text)', textSoft: 'var(--cx-text-soft)',
  textMute: 'var(--cx-text-mute)', textDim: 'var(--cx-text-dim)',
  accent: 'var(--cx-accent)', accentSoft: 'var(--cx-accent-soft)', accentHover: 'var(--cx-accent-hover)',
};

function StatusIcon({ status }: { status: SkillStatus['status'] }) {
  if (status === 'success') return <CxIconCheckCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cx-success)' }} />;
  if (status === 'failed') return <CxIconXCircle className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--cx-error)' }} />;
  if (status === 'skipped') return <CxIconSkipForward className="w-3.5 h-3.5 shrink-0" style={{ color: C.textMute }} />;
  if (status === 'downloading') return <CxIconLoader className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: C.accent }} />;
  return <CxIconLoader className="w-3.5 h-3.5 text-current opacity-30 animate-spin shrink-0" />;
}

function StatusBadge({ status, count }: { status: SkillStatus['status']; count?: string }) {
  const map: Record<SkillStatus['status'], { bg: string; color: string; label: string }> = {
    success: { bg: 'var(--cx-success-soft)', color: 'var(--cx-success)', label: '已下载' },
    failed: { bg: 'var(--cx-error-soft)', color: 'var(--cx-error)', label: '失败' },
    skipped: { bg: 'var(--cx-bg-soft)', color: 'var(--cx-text-mute)', label: '跳过' },
    downloading: { bg: 'var(--cx-accent-soft)', color: 'var(--cx-accent)', label: '下载中' },
    pending: { bg: 'var(--cx-bg-soft)', color: 'var(--cx-text-mute)', label: '待下载' },
  };
  const m = map[status];
  return (
    <span className="inline-flex items-center gap-1 px-1.5 h-5 rounded-full text-[10px] font-medium"
      style={{ background: m.bg, color: m.color }}>
      {m.label}{count && <span style={{ opacity: 0.7 }}>{count}</span>}
    </span>
  );
}

export default function RobotShopPage() {
  const navigate = useNavigate();
  const [templates, setTemplates] = useState<RobotTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const STORAGE_KEY = 'openclaw-robot-shop-dl';
  const [downloadingRobots, setDownloadingRobots] = useState<Record<string, boolean>>({});
  const [downloadStates, setDownloadStates] = useState<Record<string, DownloadState>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
  });
  const [expandedRobots, setExpandedRobots] = useState<Set<string>>(new Set());
  const [activeCategory, setActiveCategory] = useState<string>('全部');
  const [searchQuery, setSearchQuery] = useState('');

  const saveDownloadStates = (ds: Record<string, DownloadState>) => {
    setDownloadStates(ds);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
  };

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const result = await invoke<RobotTemplate[]>('list_robot_templates');
      setTemplates(result || []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, []);

  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => {
    const onFocus = () => loadTemplates();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadTemplates]);

  const handleDownload = async (robot: RobotTemplate) => {
    if (downloadingRobots[robot.id]) return;
    const initSkills: Record<string, SkillStatus> = {};
    for (const sid of robot.default_skills) {
      initSkills[sid] = { skill_id: sid, status: 'pending' };
    }
    setDownloadStates(prev => {
      const ds = { ...prev, [robot.id]: { skills: initSkills, overall: 'downloading' as const } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
      return ds;
    });
    setDownloadingRobots(prev => ({ ...prev, [robot.id]: true }));

    try {
      const res = await invoke<{
        success_count: number;
        fail_count: number;
        results: Array<{ skill_id: string; status: string; message: string }>;
      }>('download_skills', { robotId: robot.id, skills: robot.default_skills });

      const updated: Record<string, SkillStatus> = {};
      for (const r of res.results) {
        updated[r.skill_id] = { skill_id: r.skill_id, status: r.status as SkillStatus['status'], message: r.message };
      }
      setDownloadStates(prev => {
        const ds = { ...prev, [robot.id]: {
          skills: updated,
          overall: (res.fail_count === 0 ? 'done' : res.success_count === 0 ? 'error' : 'partial') as DownloadState['overall'],
          errorMessage: res.fail_count > 0 ? res.fail_count + ' 个 Skill 安装失败' : undefined,
        }};
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
        return ds;
      });

      if (res.fail_count === 0) {
        toast.success(robot.name + '：全部 ' + res.results.length + ' 个 Skill 已就绪');
        await loadTemplates();
      } else {
        toast.error(robot.name + '：' + res.fail_count + ' 个 Skill 安装失败，可展开详情重试');
      }
    } catch (e) {
      setDownloadStates(prev => {
        const ds = { ...prev, [robot.id]: { skills: initSkills, overall: 'error' as const, errorMessage: String(e) }};
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
        return ds;
      });
      toast.error('下载失败: ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setDownloadingRobots(prev => { const n = { ...prev }; delete n[robot.id]; return n; });
    }
  };

  const handleRetrySkill = async (robotId: string, skillId: string) => {
    setDownloadStates(prev => {
      const cur = prev[robotId];
      if (!cur) return prev;
      const ds = { ...prev, [robotId]: { ...cur, skills: { ...cur.skills, [skillId]: { skill_id: skillId, status: 'downloading' as const } } } };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
      return ds;
    });
    try {
      const res = await invoke<{ skill_id: string; status: string; message: string }>('download_skill_retry', { robotId, skillId });
      const succeeded = res.status === 'success';
      setDownloadStates(prev => {
        const cur = prev[robotId];
        if (!cur) return prev;
        const newSkills = { ...cur.skills };
        newSkills[skillId] = { skill_id: res.skill_id, status: res.status as SkillStatus['status'], message: res.message };
        const failCount = Object.values(newSkills).filter(s => s.status === 'failed').length;
        const successCount = Object.values(newSkills).filter(s => s.status === 'success' || s.status === 'skipped').length;
        const ds = { ...prev, [robotId]: { ...cur, skills: newSkills,
          overall: (failCount === 0 ? 'done' : successCount === 0 ? 'error' : 'partial') as DownloadState['overall'],
          errorMessage: failCount > 0 ? failCount + ' 个 Skill 安装失败' : undefined,
        }};
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
        return ds;
      });
      if (succeeded) { toast.success(skillLabel(skillId) + ' 安装成功'); await loadTemplates(); }
      else { toast.error(skillLabel(skillId) + ' 仍失败: ' + res.message); }
    } catch (e) {
      setDownloadStates(prev => {
        const cur = prev[robotId];
        if (!cur) return prev;
        const ds = { ...prev, [robotId]: { ...cur, skills: { ...cur.skills, [skillId]: { skill_id: skillId, status: 'failed' as const, message: String(e) } } } };
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(ds)); } catch {}
        return ds;
      });
      toast.error('重试失败: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const handleRetryAll = (robot: RobotTemplate) => handleDownload(robot);

  const categories = ['全部', ...Array.from(new Set(templates.map(t => t.category)))];

  const filteredTemplates = templates.filter(t => {
    if (activeCategory !== '全部' && t.category !== activeCategory) return false;
    if (searchQuery && !(t.name.includes(searchQuery) || t.description.includes(searchQuery))) return false;
    return true;
  });

  const groupedByCategory = filteredTemplates.reduce((acc, t) => {
    if (!acc[t.category]) acc[t.category] = [];
    acc[t.category].push(t);
    return acc;
  }, {} as Record<string, RobotTemplate[]>);

  const downloadState = (robotId: string): DownloadState | null => downloadStates[robotId] ?? null;
  const isDownloading = (robotId: string) => !!downloadingRobots[robotId] || downloadState(robotId)?.overall === 'downloading';

  const overallBadge = (robot: RobotTemplate) => {
    const ds = downloadState(robot.id);
    if (isDownloading(robot.id) || ds?.overall === 'downloading') return <StatusBadge status="downloading" />;
    if (robot.downloaded) return <StatusBadge status="success" />;
    if (ds?.overall === 'partial') return <StatusBadge status="failed" count=' 部分失败' />;
    if (ds?.overall === 'error') return <StatusBadge status="failed" count=' 全部失败' />;
    if ((robot.skills_installed ?? 0) > 0 && (robot.skills_total ?? 0) > 0) {
      return <StatusBadge status="pending" count={' ' + robot.skills_installed + '/' + robot.skills_total} />;
    }
    return <StatusBadge status="pending" />;
  };

  const stats = {
    total: templates.length,
    downloaded: templates.filter(t => t.downloaded).length,
    categories: categories.length - 1,
  };

  return (
    <div className="min-h-full" style={{ background: C.bg }}>
      <header className="sticky top-0 z-20"
        style={{ background: C.bgElev, borderBottom: '1px solid ' + C.borderSoft }}>
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-4">
          <button onClick={() => navigate('/home')}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-colors duration-150"
            style={{ color: C.textMute }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
            <CxIconArrowLeft size={16} />
          </button>
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg, #5b7fbd 0%, #7a9bd1 100%)', boxShadow: '0 1px 3px rgba(91,127,189,0.25)' }}>
              <CxIconRobots className="w-3.5 h-3.5 text-white" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-[14px] font-semibold leading-tight" style={{ color: C.text }}>机器人商店</h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: C.textMute }}>
                选择机器人 · 下载 Skills · 创建专属 Agent
              </p>
            </div>
          </div>
          <button onClick={() => loadTemplates()} disabled={loading}
            className="h-8 px-3 rounded-lg text-[12px] font-medium flex items-center gap-1.5 transition-colors duration-150"
            style={{ background: C.bgSoft, color: C.textSoft, border: '1px solid ' + C.borderSoft }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = C.bgSoft; }}>
            <CxIconRefresh className={'w-3.5 h-3.5' + (loading ? ' animate-spin' : '')} />
            刷新
          </button>
        </div>
      </header>

      <main className="max-w-[1400px] mx-auto px-6 py-6">
        <div className="grid grid-cols-3 gap-3 mb-5">
          <div className="rounded-xl p-3.5 flex items-center gap-3"
            style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: C.accentSoft, color: C.accent }}>
              <CxIconPackages className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[18px] font-semibold leading-none tabular-nums" style={{ color: C.text }}>{stats.total}</div>
              <div className="text-[11px] mt-1" style={{ color: C.textMute }}>机器人总数</div>
            </div>
          </div>
          <div className="rounded-xl p-3.5 flex items-center gap-3"
            style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--cx-success-soft)', color: 'var(--cx-success)' }}>
              <CxIconCheckCircle className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[18px] font-semibold leading-none tabular-nums" style={{ color: C.text }}>{stats.downloaded}</div>
              <div className="text-[11px] mt-1" style={{ color: C.textMute }}>已下载</div>
            </div>
          </div>
          <div className="rounded-xl p-3.5 flex items-center gap-3"
            style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}>
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'var(--cx-warn-soft)', color: 'var(--cx-warn)' }}>
              <CxIconTag className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <div className="text-[18px] font-semibold leading-none tabular-nums" style={{ color: C.text }}>{stats.categories}</div>
              <div className="text-[11px] mt-1" style={{ color: C.textMute }}>分类</div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 mb-5">
          <div className="relative flex-1 max-w-sm">
            <CxIconSearch className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: C.textMute }} />
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索机器人或描述..."
              className="w-full h-9 pl-9 pr-3 rounded-lg text-[12.5px] outline-none transition-colors duration-150"
              style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, color: C.text }}
              onFocus={(e) => { e.currentTarget.style.borderColor = C.accent; }}
              onBlur={(e) => { e.currentTarget.style.borderColor = C.borderSoft; }} />
          </div>
          <div className="flex items-center gap-1 overflow-x-auto cx-scroll-slim pb-0.5">
            {categories.map(cat => {
              const active = activeCategory === cat;
              const count = cat === '全部' ? templates.length : templates.filter(t => t.category === cat).length;
              return (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className="h-8 px-3 rounded-lg text-[12px] font-medium whitespace-nowrap transition-all duration-150 flex items-center gap-1.5"
                  style={{ background: active ? C.accent : C.bgElev, color: active ? '#fff' : C.textSoft, border: '1px solid ' + (active ? C.accent : C.borderSoft), boxShadow: active ? '0 1px 2px rgba(91,127,189,0.25)' : 'none' }}
                  onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = C.bgHover; } }}
                  onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = C.bgElev; } }}>
                  {cat}<span className="text-[10px] opacity-70">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading && templates.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="cx-shimmer rounded-xl" style={{ height: 168 }} />
            ))}
          </div>
        ) : filteredTemplates.length === 0 ? (
          <div className="text-center py-16">
            <div className="w-14 h-14 rounded-2xl mx-auto mb-3 flex items-center justify-center"
              style={{ background: C.bgSoft, color: C.textDim }}>
              <CxIconSparkles className="w-6 h-6" />
            </div>
            <div className="text-[14px] font-medium" style={{ color: C.textSoft }}>
              {searchQuery ? '未找到匹配的机器人' : '该分类暂无机器人'}
            </div>
            <div className="text-[11.5px] mt-1" style={{ color: C.textMute }}>
              {searchQuery ? '试试其他关键词' : '切换分类试试'}
            </div>
          </div>
        ) : (
          <div className="space-y-7">
            {Object.entries(groupedByCategory).map(([category, robots]) => (
              <section key={category}>
                <div className="flex items-baseline gap-2 mb-3">
                  <h2 className="text-[15px] font-semibold" style={{ color: C.text }}>{category}</h2>
                  <span className="text-[10.5px] font-mono" style={{ color: C.textDim }}>{robots.length} 个</span>
                  <div className="flex-1 h-px ml-2" style={{ background: C.borderSoft }} />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {robots.map(robot => (
                    <RobotCard key={robot.id} robot={robot}
                      ds={downloadState(robot.id)}
                      downloading={isDownloading(robot.id)}
                      expanded={expandedRobots.has(robot.id)}
                      badge={overallBadge(robot)}
                      onToggleExpand={() => setExpandedRobots(prev => {
                        const next = new Set(prev);
                        next.has(robot.id) ? next.delete(robot.id) : next.add(robot.id);
                        return next;
                      })}
                      onDownload={() => handleDownload(robot)}
                      onRetrySkill={(skillId) => handleRetrySkill(robot.id, skillId)}
                      onRetryAll={() => handleRetryAll(robot)}
                      onCreate={() => navigate('/instances/new?robotId=' + encodeURIComponent(robot.id))}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function RobotCard({
  robot, ds, downloading, expanded, badge,
  onToggleExpand, onDownload, onRetrySkill, onRetryAll, onCreate,
}: {
  robot: RobotTemplate;
  ds: DownloadState | null;
  downloading: boolean;
  expanded: boolean;
  badge: React.ReactNode;
  onToggleExpand: () => void;
  onDownload: () => void;
  onRetrySkill: (skillId: string) => void;
  onRetryAll: () => void;
  onCreate: () => void;
}) {
  const tags = (robot.tags ?? []).slice(0, 3);
  return (
    <div className="rounded-xl overflow-hidden transition-all duration-200"
      style={{ background: C.bgElev, border: '1px solid ' + C.borderSoft, boxShadow: 'var(--cx-shadow-xs)' }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = '0 4px 14px rgba(44,36,22,0.07)'; e.currentTarget.style.borderColor = C.border; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'var(--cx-shadow-xs)'; e.currentTarget.style.borderColor = C.borderSoft; }}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0 text-[22px]"
            style={{ background: C.bgSoft, boxShadow: 'inset 0 0 0 1px ' + C.borderSoft }}>
            {robot.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[14px] font-semibold truncate" style={{ color: C.text }}>{robot.name}</h3>
              {badge}
            </div>
            <div className="text-[10.5px] font-mono mt-0.5 truncate" style={{ color: C.textDim }}>{robot.id}</div>
            <p className="text-[11.5px] mt-1.5 line-clamp-2 leading-relaxed" style={{ color: C.textSoft }} title={robot.description}>
              {robot.description}
            </p>
          </div>
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-3">
            {tags.map(tag => (
              <span key={tag} className="px-1.5 h-4 rounded text-[10px] inline-flex items-center font-medium"
                style={{ background: C.bgSoft, color: C.textMute, border: '1px solid ' + C.borderSoft }}>
                {tag}
              </span>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 mt-4 -mx-1">
          <button onClick={onToggleExpand}
            className="h-7 px-2 text-[11px] flex items-center gap-1 rounded transition-colors duration-150"
            style={{ color: C.textMute }}
            onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; e.currentTarget.style.color = C.text; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = C.textMute; }}>
            {expanded ? <CxIconChevronUp className="w-3 h-3" /> : <CxIconChevronDown className="w-3 h-3" />}
            {expanded ? '收起' : '详情'}
          </button>
          <div className="flex-1" />
          {downloading && ds && (
            <div className="flex-1 min-w-0 mr-2">
              <div className="flex items-center gap-1.5 mb-0.5">
                <CxIconLoader className="w-2.5 h-2.5 animate-spin" style={{ color: C.accent }} />
                <span className="text-[10px] font-medium" style={{ color: C.accent }}>
                  {Object.values(ds.skills).filter(s => s.status === 'success' || s.status === 'skipped').length}/{Object.keys(ds.skills).length} Skills
                </span>
              </div>
              <div className="w-full h-1 rounded-full" style={{ background: C.borderSoft }}>
                <div className="h-full rounded-full transition-all duration-500" style={{
                  background: C.accent,
                  width: Math.round(Object.values(ds.skills).filter(s => s.status === 'success' || s.status === 'skipped').length / Math.max(1, Object.keys(ds.skills).length) * 100) + '%'
                }} />
              </div>
            </div>
          )}
          {!robot.downloaded && (
            <button onClick={onDownload} disabled={downloading}
              className="h-7 px-2.5 rounded-md text-[11.5px] font-medium flex items-center gap-1 shrink-0 transition-colors duration-150"
              style={{ background: 'transparent', color: C.accent, border: '1px solid ' + C.accent + '60' }}
              onMouseEnter={(e) => { e.currentTarget.style.background = C.accentSoft; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
              {downloading ? <CxIconLoader className="w-3 h-3 animate-spin" /> : <CxIconDownload className="w-3 h-3" />}
              {downloading ? '下载中' : '下载'}
            </button>
          )}
          <button onClick={onCreate} disabled={!robot.downloaded}
            title={!robot.downloaded ? '请先下载 Skills 再创建实例' : ''}
            className="h-7 px-3 rounded-md text-[11.5px] font-medium flex items-center gap-1 transition-colors duration-150"
            style={{ background: robot.downloaded ? C.accent : C.bgSoft, color: robot.downloaded ? '#fff' : C.textDim, border: '1px solid ' + (robot.downloaded ? C.accent : C.borderSoft), boxShadow: robot.downloaded ? '0 1px 2px rgba(91,127,189,0.2)' : 'none', cursor: robot.downloaded ? 'pointer' : 'not-allowed' }}
            onMouseEnter={(e) => { if (robot.downloaded) e.currentTarget.style.background = C.accentHover; }}
            onMouseLeave={(e) => { if (robot.downloaded) e.currentTarget.style.background = C.accent; }}>
            <CxIconPlus className="w-3 h-3" />创建实例
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-4 py-3.5" style={{ background: C.bgSoft, borderTop: '1px solid ' + C.borderSoft }}>
          {robot.system_prompt && robot.system_prompt.trim().length > 0 && (
            <details className="mb-3">
              <summary className="text-[11px] font-semibold cursor-pointer mb-1.5 select-none"
                style={{ color: C.textSoft }}>人设、职能与工作流</summary>
              <div className="text-[11px] leading-relaxed rounded-lg px-3 py-2 max-h-40 overflow-y-auto cx-scroll-slim whitespace-pre-wrap mt-1"
                style={{ background: C.bgElev, color: C.textSoft, border: '1px solid ' + C.borderSoft }}>
                {robot.system_prompt}
              </div>
            </details>
          )}

          <div className="text-[10.5px] font-semibold uppercase tracking-wider mb-2" style={{ color: C.textDim }}>
            默认 Skills · {robot.default_skills?.length || 0}
          </div>
          <div className="space-y-1">
            {(ds?.skills
              ? Object.values(ds.skills)
              : (robot.default_skills || []).map(sid => ({ skill_id: sid, status: 'pending' as const, message: undefined as string | undefined }))
            ).map(skill => (
              <div key={skill.skill_id} className="flex items-center gap-2 py-1.5 px-2 rounded-md transition-colors duration-150"
                onMouseEnter={(e) => { e.currentTarget.style.background = C.bgHover; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                <StatusIcon status={skill.status} />
                <span className="text-[12px] flex-1 truncate" style={{ color: C.textSoft }}>{skillLabel(skill.skill_id)}</span>
                <code className="text-[10px] font-mono" style={{ color: C.textDim }}>{skill.skill_id}</code>
                {skill.message && skill.status === 'failed' && (
                  <span className="text-[10px] max-w-[140px] truncate" style={{ color: 'var(--cx-error)' }} title={skill.message}>
                    {skill.message.split('\n')[0]}
                  </span>
                )}
                {skill.status === 'failed' && !downloading && (
                  <button onClick={() => onRetrySkill(skill.skill_id)}
                    className="flex items-center gap-1 text-[10.5px] font-medium px-1.5 h-5 rounded transition-colors duration-150"
                    style={{ color: 'var(--cx-error)' }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--cx-error-soft)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}>
                    <CxIconRefresh className="w-2.5 h-2.5" />重试
                  </button>
                )}
              </div>
            ))}
          </div>

          {(ds?.overall === 'partial' || ds?.overall === 'error') && (
            <button onClick={onRetryAll} disabled={downloading}
              className="mt-3 w-full h-8 text-[11.5px] flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors duration-150"
              style={{ background: 'var(--cx-error-soft)', color: 'var(--cx-error)', border: '1px solid var(--cx-error)30' }}>
              <CxIconRefresh className="w-3 h-3" />全部重试
            </button>
          )}
          {ds?.overall === 'done' && (
            <div className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] font-medium"
              style={{ color: 'var(--cx-success)' }}>
              <CxIconCheckCircle className="w-3.5 h-3.5" />全部安装成功
            </div>
          )}
        </div>
      )}
    </div>
  );
}
