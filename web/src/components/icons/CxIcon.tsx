import * as React from 'react';

/**
 * Codex-style icon library — warm cream aesthetic, 1.5px line weight, 24x24 grid.
 * Designed for readability at 14-18px. Each icon has a Chinese title for a11y.
 */

export type CxIconProps = React.SVGProps<SVGSVGElement> & {
  size?: number | string;
  strokeWidth?: number;
  title?: string;
};

const base = (size: number | string, strokeWidth: number, props: React.SVGProps<SVGSVGElement>, title?: string) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': props['aria-hidden'] ?? true,
  role: props.role ?? 'img',
  children: title ? <title>{title}</title> : undefined,
});

/* ===== Sidebar Navigation ===== */

export const CxIconHome: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '首页', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3.4 11.2 12 4l8.6 7.2" />
    <path d="M5.2 10v9.2c0 .5.4.8.8.8H10v-5.5h4v5.5h4c.4 0 .8-.3.8-.8V10" />
  </svg>
);

export const CxIconInstances: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '实例管理', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3.2" y="4.2" width="13.6" height="5.6" rx="1.5" />
    <rect x="7.2" y="14.2" width="13.6" height="5.6" rx="1.5" />
    <circle cx="6.4" cy="7" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="10.4" cy="17" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconModels: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '模型配置', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="2.6" />
    <circle cx="5" cy="6" r="1.4" />
    <circle cx="19" cy="6" r="1.4" />
    <circle cx="5" cy="18" r="1.4" />
    <circle cx="19" cy="18" r="1.4" />
    <path d="M6.2 7.1l4.4 3.6M17.8 7.1l-4.4 3.6M6.2 16.9l4.4-3.5M17.8 16.9l-4.4-3.5" />
  </svg>
);

export const CxIconRobots: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '机器人商店', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="4.2" y="7.4" width="15.6" height="11" rx="2.4" />
    <circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <path d="M9.5 16h5" />
    <path d="M12 4.5v3" />
    <circle cx="12" cy="3.6" r="1" />
    <path d="M2.5 11.5v5M21.5 11.5v5" />
  </svg>
);

export const CxIconUsage: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = 'Token 用量', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 20h16" />
    <path d="M6.5 16V12M11 16V8M15.5 16V10.5M20 16V5.5" />
  </svg>
);

export const CxIconBackup: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '备份恢复', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3.2 4 6.6v5c0 4.6 3.4 8.4 8 9.2 4.6-.8 8-4.6 8-9.2v-5z" />
    <path d="M9 12l2.2 2.2L15 10.4" />
  </svg>
);

export const CxIconSettings: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '设置', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2.4M12 19.1v2.4M4.2 4.2l1.7 1.7M18.1 18.1l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.2 19.8l1.7-1.7M18.1 5.9l1.7-1.7" />
  </svg>
);

export const CxIconModules: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '模块', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5" />
    <rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5" />
  </svg>
);

export const CxIconWizardRobot: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '向导机器人', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="4.2" y="7.4" width="15.6" height="11" rx="2.4" />
    <path d="M2.6 11.6h1.6M19.8 11.6h1.6" />
    <path d="M12 4.4v3" />
    <circle cx="12" cy="3.6" r="0.9" />
    <circle cx="9" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="12.5" r="1" fill="currentColor" stroke="none" />
    <path d="M9.8 16.2c.6.6 1.4 1 2.2 1s1.6-.4 2.2-1" />
  </svg>
);

export const CxIconChannel: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '渠道', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 8.5h18M3 15.5h18" />
    <circle cx="7" cy="8.5" r="1.6" />
    <circle cx="15" cy="15.5" r="1.6" />
    <path d="M8.6 8.5h6.8M8.6 15.5h6.8" />
  </svg>
);

export const CxIconModelConfig: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '模型配置', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2.2 2.2M16.3 16.3l2.2 2.2M5.5 18.5l2.2-2.2M16.3 7.7l2.2-2.2" />
  </svg>
);

export const CxIconCredentials: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '凭证', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="6" width="18" height="13" rx="1.8" />
    <path d="M3 10h18" />
    <circle cx="8" cy="14.5" r="1.2" />
    <path d="M11.5 14.5h7" />
  </svg>
);

export const CxIconConfirm: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '确认', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="M8 12.5l3 3 5-6" />
  </svg>
);

export const CxIconNameTag: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '名称标签', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3.5 12.5 12 4l8 8-8.5 8.5a1.5 1.5 0 0 1-2.1 0L3.5 14.6a1.5 1.5 0 0 1 0-2.1z" />
    <circle cx="15" cy="9" r="1.4" />
  </svg>
);

/* ===== Arrows & Chevrons ===== */

export const CxIconArrowLeft: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '返回', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M19 12H5M11 6l-6 6 6 6" />
  </svg>
);

export const CxIconArrowRight: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '前进', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const CxIconChevronRight: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '展开', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M9 6l6 6-6 6" />
  </svg>
);

export const CxIconChevronDown: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '展开', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const CxIconChevronUp: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '收起', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);

export const CxIconChevronsLeft: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '折叠侧栏', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M11 6l-6 6 6 6M18 6l-6 6 6 6" />
  </svg>
);

export const CxIconClose: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '关闭', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const CxIconCheck: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '完成', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </svg>
);

export const CxIconCheckCircle: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '已完成', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 12.5l3 3 5-6" />
  </svg>
);

export const CxIconXCircle: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '错误', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </svg>
);

export const CxIconPlus: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '添加', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const CxIconMinus: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '减少', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M5 12h14" />
  </svg>
);

export const CxIconSearch: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '搜索', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </svg>
);

/* ===== Actions ===== */

export const CxIconEdit: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '编辑', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M14.5 5.5l4 4L8 20H4v-4z" />
    <path d="M13.5 6.5l4 4" />
  </svg>
);

export const CxIconEdit2: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '编辑', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 20h4l10-10-4-4L4 16z" />
    <path d="M14 6l4 4" />
  </svg>
);

export const CxIconTrash: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '删除', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    <path d="M5.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h8a1.5 1.5 0 0 0 1.5-1.4l1-12" />
    <path d="M10 11v6M14 11v6" />
  </svg>
);

export const CxIconTrash2: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '删除', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 6h18" />
    <path d="M19 6l-1.2 13.2a1.5 1.5 0 0 1-1.5 1.4H7.7a1.5 1.5 0 0 1-1.5-1.4L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V3.6a.6.6 0 0 1 .6-.6h4.8a.6.6 0 0 1 .6.6V6" />
  </svg>
);

export const CxIconRefresh: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '刷新', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 12a8 8 0 0 1 14-5.3" />
    <path d="M18 3v4h-4" />
    <path d="M20 12a8 8 0 0 1-14 5.3" />
    <path d="M6 21v-4h4" />
  </svg>
);

export const CxIconRotateCcw: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '撤销', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </svg>
);

export const CxIconDownload: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '下载', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 4v12" />
    <path d="M6 11l6 6 6-6" />
    <path d="M4 20h16" />
  </svg>
);

export const CxIconUpload: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '上传', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 20V8" />
    <path d="M6 13l6-6 6 6" />
    <path d="M4 4h16" />
  </svg>
);

/* ===== Status & Feedback ===== */

export const CxIconWarn: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '警告', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3.5 21 20H3z" />
    <path d="M12 10v5" />
    <circle cx="12" cy="17.5" r="0.6" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconAlertTriangle: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '警告', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </svg>
);

export const CxIconAlertCircle: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '提示', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8v5M12 16h.01" />
  </svg>
);

export const CxIconInfo: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '信息', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h.01" />
  </svg>
);

export const CxIconSpinner: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '加载中', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </svg>
);

export const CxIconLoader: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '加载中', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3a9 9 0 0 1 9 9" opacity={0.4} />
    <path d="M3 12a9 9 0 0 1 9-9" />
  </svg>
);

/* ===== Chat & Communication ===== */

export const CxIconSend: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '发送', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M21 3 3 11l7 2.4L13.4 21z" />
    <path d="M21 3l-11 10" />
  </svg>
);

export const CxIconStop: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '停止', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="6" y="6" width="12" height="12" rx="1.6" />
  </svg>
);

export const CxIconSquare: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '方块', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="1.4" />
  </svg>
);

export const CxIconPlay: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '启动', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M7 5.2v13.6a.8.8 0 0 0 1.2.7l11.2-6.8a.8.8 0 0 0 0-1.4L8.2 4.5a.8.8 0 0 0-1.2.7z" />
  </svg>
);

export const CxIconPower: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '电源', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3v9" />
    <path d="M17.5 6.5a8 8 0 1 0 4 9.5" />
  </svg>
);

export const CxIconPaperclip: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '附件', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M19.5 11.6 11.3 19.8a4.5 4.5 0 1 1-6.4-6.4l8.9-8.9a3 3 0 1 1 4.2 4.2l-8.9 8.9a1.5 1.5 0 1 1-2.1-2.1l7.8-7.8" />
  </svg>
);

/* ===== Energy & Stats ===== */

export const CxIconBolt: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '闪电', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M13.5 2.5 4 14h7l-1 7.5 9.5-11.5h-7z" />
  </svg>
);

export const CxIconZap: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '性能', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 14h6L8 22l12-12h-6l2-8z" />
  </svg>
);

export const CxIconWallet: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '钱包', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 7.5A2 2 0 0 1 5 5.5h12a2 2 0 0 1 2 2V8" />
    <path d="M3 8v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-3.5a1 1 0 0 0-1-1H15a2.5 2.5 0 0 1 0-5h6V8a2 2 0 0 0-2-2H5a2 2 0 0 1-2-2v3.5z" />
    <circle cx="16" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconDollarSign: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '货币', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 2v20" />
    <path d="M17 6.5h-7a2.5 2.5 0 0 0 0 5h4a2.5 2.5 0 0 1 0 5H7" />
  </svg>
);

export const CxIconTrendingUp: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '上升', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 17l6-6 4 4 8-9" />
    <path d="M14 6h7v7" />
  </svg>
);

export const CxIconActivity: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '活动', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 12h4l2-6 4 12 2-6h6" />
  </svg>
);

export const CxIconBarChart3: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '图表', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 3v18h18" />
    <path d="M7 16V12M12 16V8M17 16v-3" />
  </svg>
);

/* ===== Misc / Dev ===== */

export const CxIconHash: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '哈希', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M4 9h16M4 15h16M10 4 8 20M16 4l-2 16" />
  </svg>
);

export const CxIconDatabase: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '数据库', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <ellipse cx="12" cy="5.5" rx="8" ry="2.5" />
    <path d="M4 5.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    <path d="M4 11.5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
  </svg>
);

export const CxIconServer: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '服务器', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="4" width="18" height="6" rx="1.5" />
    <rect x="3" y="14" width="18" height="6" rx="1.5" />
    <path d="M7 7h.01M7 17h.01" />
  </svg>
);

export const CxIconCpu: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = 'CPU', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="5" y="5" width="14" height="14" rx="1.8" />
    <rect x="9" y="9" width="6" height="6" rx="0.8" />
    <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
  </svg>
);

export const CxIconLayers: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '层级', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3 2.5 8 12 13 21.5 8z" />
    <path d="M2.5 13 12 18l9.5-5" />
    <path d="M2.5 18 12 23l9.5-5" />
  </svg>
);

export const CxIconMonitor: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '监控', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="4" width="18" height="13" rx="1.8" />
    <path d="M8 21h8M12 17v4" />
  </svg>
);

export const CxIconTerminal: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '终端', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="1.8" />
    <path d="M7 9l3 3-3 3M13 15h5" />
  </svg>
);

/* ===== Files ===== */

export const CxIconFile: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '文件', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h6" />
  </svg>
);

export const CxIconFileText: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '文档', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 3h9l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
    <path d="M14 3v5h6" />
    <path d="M8 13h8M8 17h6" />
  </svg>
);

export const CxIconImage: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '图片', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="M21 16l-5-5-9 9" />
  </svg>
);

export const CxIconFilm: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '视频', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="1.8" />
    <path d="M3 8h18M3 16h18M7 3v18M11 3v18M15 3v18M19 3v18" opacity={0.6} />
  </svg>
);

/* ===== Auth & Security ===== */

export const CxIconKey: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '密钥', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="8" cy="14" r="4" />
    <path d="M10.8 11.2 21 1" />
    <path d="M17 5l3 3M14 8l3 3" />
  </svg>
);

export const CxIconShield: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '安全', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3 4 6v6c0 4.5 3.4 8.4 8 9 4.6-.6 8-4.5 8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);

export const CxIconEye: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '显示', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

export const CxIconEyeOff: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '隐藏', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 3l18 18" />
    <path d="M10.5 6.5c.5-.1 1-.2 1.5-.2 6.5 0 10 7 10 7-.7 1.4-1.7 2.7-3 3.7" />
    <path d="M6.5 8C4 9.5 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.2-1" />
    <path d="M9.5 9.5a3 3 0 0 0 4.2 4.2" />
  </svg>
);

export const CxIconLogIn: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '登录', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    <path d="M10 17l5-5-5-5M15 12H3" />
  </svg>
);

export const CxIconUserPlus: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '添加用户', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="10" cy="8" r="3.5" />
    <path d="M3.5 20c.6-3.4 3.4-5.5 6.5-5.5s5.9 2.1 6.5 5.5" />
    <path d="M19 7v6M16 10h6" />
  </svg>
);

export const CxIconUser: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '用户', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20c0-3.6 3.6-6.5 8-6.5s8 2.9 8 6.5" />
  </svg>
);

export const CxIconLogout: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '退出', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" />
    <path d="M14 7l5 5-5 5M19 12H7" />
  </svg>
);

/* ===== Navigation ===== */

export const CxIconExternal: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '外部链接', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M14 4h6v6M20 4l-9 9M9 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
  </svg>
);

export const CxIconExternalLink: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '外部链接', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5" />
  </svg>
);

export const CxIconArrowUpRight: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '右上箭头', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

export const CxIconQR: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '二维码', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <path d="M14 14h3v3M14 19h3M19 14v3M19 19h2v2" />
  </svg>
);

export const CxIconBell: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '通知', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2H4.5z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const CxIconClock: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '时钟', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </svg>
);

export const CxIconTarget: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '目标', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconSparkles: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '闪光', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
    <path d="M19 14l.7 1.8L21.5 16.5l-1.8.7L19 19l-.7-1.8L16.5 16.5l1.8-.7z" />
    <path d="M5 14l.7 1.8L7.5 16.5l-1.8.7L5 19l-.7-1.8L2.5 16.5l1.8-.7z" />
  </svg>
);

export const CxIconMessageCircle: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '消息', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M21 12a9 9 0 1 1-3.6-7.2L21 4l-1 4.4A8.9 8.9 0 0 1 21 12z" />
    <path d="M8 11h.01M12 11h.01M16 11h.01" strokeWidth={strokeWidth + 0.4} />
  </svg>
);

export const CxIconMessageSquare: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '消息', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-9l-5 4z" />
    <path d="M8 9h.01M12 9h.01M16 9h.01" strokeWidth={strokeWidth + 0.4} />
  </svg>
);

export const CxIconSmartphone: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '手机', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="6" y="2" width="12" height="20" rx="2.5" />
    <path d="M10 18h4" />
  </svg>
);

export const CxIconWifi: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '网络', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M2 9c5.5-5.3 14.5-5.3 20 0" />
    <path d="M5.5 12.5c4-3.7 9-3.7 13 0" />
    <path d="M9 16c2-1.8 4-1.8 6 0" />
    <circle cx="12" cy="19" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconGitBranch: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '分支', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="6" cy="5" r="2" />
    <circle cx="6" cy="19" r="2" />
    <circle cx="18" cy="9" r="2" />
    <path d="M6 7v10" />
    <path d="M18 11c0 4-6 4-6 8" />
  </svg>
);

export const CxIconPlug: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '接入', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M9 2v5M15 2v5" />
    <path d="M6 7h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 16v6" />
  </svg>
);

export const CxIconPalette: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '主题', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 3a9 9 0 1 0 0 18c1 0 2-1 2-2v-1a2 2 0 0 1 2-2h2a4 4 0 0 0 4-4 9 9 0 0 0-10-9z" />
    <circle cx="7.5" cy="11" r="1" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15" cy="7.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="17.5" cy="11" r="1" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconSun: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '亮色', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
);

export const CxIconMoon: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '暗色', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />
  </svg>
);

export const CxIconFilter: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '筛选', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 5h18l-7 8v6l-4-2v-4z" />
  </svg>
);

export const CxIconTag: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '标签', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 12V4h8l10 10-8 8z" />
    <circle cx="8" cy="9" r="1.4" />
  </svg>
);

export const CxIconSkipForward: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '跳过', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M5 5v14l9-7z" />
    <path d="M19 5v14" />
  </svg>
);

export const CxIconBox: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '盒子', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4M12 11v10" />
  </svg>
);

export const CxIconPackages: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '包集合', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M2.5 8 9 4.5l3.5 1.9" />
    <path d="M2.5 8v6L9 17.5l3.5-1.9" />
    <path d="M12.5 6.4 19 3l5.5 3v6L19 15l-5.5-3" />
    <path d="M12.5 6.4v6" />
  </svg>
);

export const CxIconPlugins: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '插件', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M9 2v5M15 2v5" />
    <path d="M6 7h12v3a6 6 0 0 1-12 0z" />
    <path d="M12 16v6" />
    <circle cx="9" cy="4" r="0.7" fill="currentColor" stroke="none" />
    <circle cx="15" cy="4" r="0.7" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconListTree: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '树形列表', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 4h4M3 12h4M3 20h4" />
    <circle cx="11" cy="4" r="1.6" />
    <circle cx="11" cy="12" r="1.6" />
    <circle cx="11" cy="20" r="1.6" />
    <path d="M13 4h5a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-5" />
    <path d="M13 20h5" />
  </svg>
);

export const CxIconPin: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '固定', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M9 3h6l-1 6 3 3-1 1h-4v6l-1 2-1-2v-6H6l-1-1 3-3z" />
  </svg>
);

export const CxIconChevronLeft: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '返回', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M15 6l-6 6 6 6" />
  </svg>
);

export const CxIconBoxes: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '盒子堆叠', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="3" width="7" height="7" rx="1.4" />
    <rect x="14" y="3" width="7" height="7" rx="1.4" />
    <rect x="3" y="14" width="7" height="7" rx="1.4" />
    <rect x="14" y="14" width="7" height="7" rx="1.4" />
  </svg>
);

export const CxIconGrid3X3: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '网格', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="3" y="3" width="18" height="18" rx="1.6" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
  </svg>
);

export const CxIconShoppingBag: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '商店', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

export const CxIconArrowDown: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '下箭头', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 5v14M5 12l7 7 7-7" />
  </svg>
);

export const CxIconArrowUp: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '上箭头', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
);

export const CxIconPackage: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '包', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4M12 11v10" />
  </svg>
);

export const CxIconCopy: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '复制', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <rect x="8" y="8" width="12" height="12" rx="1.8" />
    <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
  </svg>
);

export const CxIconMoreVertical: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '更多', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);

export const CxIconMoreHorizontal: React.FC<CxIconProps> = ({ size = 18, strokeWidth = 1.5, title = '更多', ...props }) => (
  <svg {...base(size, strokeWidth, props, title)} {...props}>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </svg>
);
