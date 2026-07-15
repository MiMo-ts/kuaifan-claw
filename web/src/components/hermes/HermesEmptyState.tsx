import React from "react";
import { CxIconCpu, CxIconMessageSquare, CxIconPlus, CxIconZap } from "../icons";

export interface HermesEmptyStateProps {
  hasSessions: boolean;
  onSuggest: (text: string) => void;
  onNew: () => void;
}

const suggestions = [
  {
    title: "整理任务",
    description: "从一段材料中提炼结论和下一步。",
    prompt: "请帮我整理当前任务，列出关键结论、风险和下一步行动。",
    icon: CxIconMessageSquare,
  },
  {
    title: "调用工具",
    description: "检查项目状态并给出可执行建议。",
    prompt: "请检查当前工作目录的项目状态，并给出下一步建议。",
    icon: CxIconZap,
  },
  {
    title: "分析代码",
    description: "定位问题根因并制定修复方案。",
    prompt: "请分析当前项目中最可能影响稳定性的代码问题。",
    icon: CxIconCpu,
  },
];

export const HermesEmptyState: React.FC<HermesEmptyStateProps> = ({
  hasSessions,
  onSuggest,
  onNew,
}) => (
  <div className="flex flex-1 items-center justify-center px-6 py-8">
    <div className="w-full max-w-[620px] text-center">
      <div
        className="mx-auto mb-4 flex h-11 w-11 items-center justify-center rounded-lg"
        style={{ background: "var(--cx-accent-soft)", border: "1px solid var(--cx-border-soft)" }}
      >
        <CxIconMessageSquare className="h-5 w-5" style={{ color: "var(--cx-accent)" }} />
      </div>
      <h2 className="text-[17px] font-semibold" style={{ color: "var(--cx-text)" }}>
        {hasSessions ? "开始新对话或选择历史会话" : "开始使用 Hermes"}
      </h2>
      <p className="mt-1.5 text-[12.5px]" style={{ color: "var(--cx-text-mute)" }}>
        历史会话位于右上角，当前对话会在回复完成后持续保留。
      </p>

      <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {suggestions.map(({ title, description, prompt, icon: Icon }) => (
          <button
            key={title}
            type="button"
            onClick={() => onSuggest(prompt)}
            className="min-h-[86px] rounded-md border p-3 text-left transition-colors"
            style={{ background: "var(--cx-bg-elev)", borderColor: "var(--cx-border-soft)" }}
          >
            <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--cx-text)" }}>
              <Icon className="h-3.5 w-3.5" style={{ color: "var(--cx-accent)" }} />
              {title}
            </span>
            <span className="mt-1.5 block text-[11px] leading-relaxed" style={{ color: "var(--cx-text-mute)" }}>
              {description}
            </span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onNew}
        className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[12px] font-medium"
        style={{ background: "var(--cx-accent)", color: "#fff" }}
      >
        <CxIconPlus className="h-3.5 w-3.5" />新建会话
      </button>
    </div>
  </div>
);

export default HermesEmptyState;
