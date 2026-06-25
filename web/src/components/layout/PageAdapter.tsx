import { ReactNode } from "react";

/**
 * 将旧页面内容适配到 codex 米白外壳中。
 *
 * 作用：
 *  1. 提供暖色背景的滚动容器，使用 slim 滚动条样式
 *  2. 适配每页进入时的轻微淡入动画
 */
export default function PageAdapter({ children }: { children: ReactNode }) {
  return (
    <div
      className="h-full overflow-y-auto cx-scroll-slim cx-animate-fade-in"
      style={{ background: "var(--cx-bg)" }}
    >
      <div className="p-5">{children}</div>
    </div>
  );
}
