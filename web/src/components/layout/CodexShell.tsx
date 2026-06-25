import { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import CodexSidebar from "./CodexSidebar";
import CodexChatArea from "./CodexChatArea";

export interface CodexShellProps {
  children?: ReactNode;
  mainContent?: ReactNode;
  activeSidebarKey?: string;
  showChat?: boolean;
  topBarContent?: ReactNode;
  chatProps?: {
    title?: string;
    gatewayRunning?: boolean;
    gatewayBusy?: boolean;
    onToggleGateway?: () => void;
    onOpenModelConfig?: () => void;
  };
}

export default function CodexShell({
  children,
  mainContent,
  activeSidebarKey,
  showChat = true,
  topBarContent,
  chatProps,
}: CodexShellProps) {
  const location = useLocation();

  const currentSidebarKey =
    activeSidebarKey ??
    (() => {
      const path = location.pathname;
      if (path === "/home" || path === "/") return "new-chat";
      return undefined;
    })();

  const content = mainContent ?? children;

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: "var(--cx-bg)" }}
    >
      <CodexSidebar
        activeKey={currentSidebarKey}
        gatewayRunning={chatProps?.gatewayRunning}
      />

      <main className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {showChat ? (
          <CodexChatArea
            title={chatProps?.title ?? "新对话"}
            gatewayRunning={chatProps?.gatewayRunning}
            gatewayBusy={chatProps?.gatewayBusy}
            onToggleGateway={chatProps?.onToggleGateway}
          />
        ) : (
          <>
            {topBarContent && (
              <div
                className="h-11 px-5 flex items-center shrink-0 backdrop-blur-md"
                style={{
                  borderBottom: "1px solid var(--cx-border-soft)",
                  background: "var(--cx-topbar-bg)",
                }}
              >
                {topBarContent}
              </div>
            )}
            <div
              key={location.pathname}
              className="flex-1 min-h-0 overflow-y-auto cx-scroll-slim cx-animate-fade-in"
            >
              {content}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

export { CodexSidebar, CodexChatArea };
