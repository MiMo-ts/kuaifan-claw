import { ReactNode } from 'react';
import CodexShell from './CodexShell';
import PageAdapter from './PageAdapter';

interface CodexPageProps {
  children: ReactNode;
  activeSidebarKey?: string;
  /** Custom top bar title shown when chat is hidden */
  topBarTitle?: string;
}

/**
 * Wraps a page inside the Codex desktop-style shell layout.
 * Hides the chat area in favor of page content.
 */
export default function CodexPage({
  children,
  activeSidebarKey,
  topBarTitle,
}: CodexPageProps) {
  return (
    <CodexShell
      showChat={false}
      activeSidebarKey={activeSidebarKey}
      topBarContent={
        topBarTitle ? (
          <span className="text-[12px] font-medium font-mono" style={{ color: 'var(--cx-text)' }}>
            {topBarTitle}
          </span>
        ) : undefined
      }
      mainContent={<PageAdapter>{children}</PageAdapter>}
    />
  );
}
