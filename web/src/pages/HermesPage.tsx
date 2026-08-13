import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import toast from "react-hot-toast";
import { HermesComposer } from "../components/hermes/HermesComposer";
import { HermesEmptyState } from "../components/hermes/HermesEmptyState";
import { HermesMessageList } from "../components/hermes/HermesMessageList";
import {
  CxIconCpu,
  CxIconLoader,
  CxIconPlus,
  CxIconRefresh,
} from "../components/icons";
import {
  HermesApiClient,
  clientFromGuiUrl,
  type HermesStreamHandle,
} from "../services/hermesApi";
import { extractAssistantAttachments, extractKuaifanExportDirectories, extractKuaifanToolAttachments, mergeAssistantAttachments } from "../services/hermesAttachments";
import {
  mergeAuthoritativeMessages,
  parseHermesSlashCommand,
} from "../services/hermesProtocol";
import { useModuleSessionStore } from "../stores/moduleSessionStore";
import type {
  HermesAttachment,
  HermesClarifyPrompt,
  HermesLocalAttachment,
  HermesMessage,
  HermesSession,
  HermesSettings,
  HermesStreamEvent,
} from "../types/hermes";

const fontFamily: React.CSSProperties = {
  fontFamily: 'system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
};

export interface HermesPageProps {
  guiUrl?: string | null;
  version?: string;
  running?: boolean;
  port?: number;
  onToggle?: () => void;
  busy?: boolean;
  onRefresh?: () => void;
}

let localId = 0;
function makeLocalId(prefix: string): string {
  localId += 1;
  return `${prefix}-${Date.now().toString(36)}-${localId.toString(36)}`;
}

export const HermesPage: React.FC<HermesPageProps> = ({
  guiUrl,
  version,
  running = false,
  port = 0,
  onToggle,
  busy = false,
  onRefresh,
}) => {
  const client: HermesApiClient = useMemo(() => clientFromGuiUrl(guiUrl), [guiUrl]);
  const clientRef = useRef(client);
  const streamRef = useRef<HermesStreamHandle | null>(null);
  const activeAssistantIdRef = useRef<string | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const runtimeSessionIdRef = useRef<string | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [pendingText, setPendingText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingClarify, setPendingClarify] = useState<HermesClarifyPrompt | null>(null);
  const [settings, setSettings] = useState<HermesSettings>({});
  const [connectionOk, setConnectionOk] = useState<boolean | null>(null);
  const nextAssistantIdRef = useRef<string | null>(null);
  const pendingClarifyRef = useRef<HermesClarifyPrompt | null>(null);
  const sidebarSessionId = useModuleSessionStore((state) => state.activeSessionIdByModule.hermes);
  const setSidebarSession = useModuleSessionStore((state) => state.setActiveSession);

  useEffect(() => {
    pendingClarifyRef.current = pendingClarify;
  }, [pendingClarify]);

  useEffect(() => {
    clientRef.current = client;
    return () => client.dispose();
  }, [client]);

  const loadSessions = useCallback(async () => {
    if (!client.isConfigured()) {
      setConnectionOk(false);
      return;
    }
    setSessionsLoading(true);
    try {
      setSessions(await client.listSessions());
      setConnectionOk(true);
    } catch (error) {
      console.warn("[Hermes] listSessions failed, retrying in 3s...", error);
      await new Promise((r) => setTimeout(r, 3000));
      try {
        setSessions(await client.listSessions());
        setConnectionOk(true);
      } catch {
        setConnectionOk(false);
      }
    } finally {
      setSessionsLoading(false);
    }
  }, [client]);

  const loadMessages = useCallback(async (sessionId: string): Promise<number> => {
    setMessagesLoading(true);
    try {
      const detail = await clientRef.current.getSession(sessionId);
      if (activeSessionIdRef.current === sessionId) {
        setMessages((current) => mergeAuthoritativeMessages(current, detail.messages));
      }
      return detail.messages.length;
    } catch (error) {
      console.warn("[Hermes] getSession failed", error);
      return -1;
    } finally {
      setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!running) {
      setSessions([]);
      setConnectionOk(false);
      return;
    }
    void loadSessions();
    void client.getSettings().then(setSettings).catch(() => undefined);
    void client.health().then(setConnectionOk);
  }, [running, client, loadSessions]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => {
      void client.health().then(setConnectionOk);
    }, 8_000);
    return () => window.clearInterval(timer);
  }, [running, client]);

  const applyAssistantEvent = useCallback((assistantId: string, event: HermesStreamEvent) => {
    if (event.type === "clarify") {
      if (!event.requestId) return;
      setPendingClarify({
        requestId: event.requestId,
        question: event.question || "请选择或输入回答",
        choices: event.choices,
      });
      return;
    }

    setMessages((current) => current.map((message) => {
      if (message.id !== assistantId) return message;
      switch (event.type) {
        case "delta":
          return { ...message, content: message.content + event.text };
        case "reasoning":
          return { ...message, reasoning: (message.reasoning || "") + event.text };
        case "tool_call":
          return {
            ...message,
            toolCalls: [...(message.toolCalls || []), event.toolCall],
          };
        case "tool_result":
          return {
            ...message,
            toolCalls: (message.toolCalls || []).map((toolCall) =>
              toolCall.id === event.toolCallId
                ? {
                    ...toolCall,
                    result: event.result || toolCall.result,
                    status: event.status || "done",
                    finishedAt: Date.now(),
                    durationS: event.durationS ?? toolCall.durationS,
                  }
                : toolCall,
            ),
          };
        case "meta":
          return event.model ? { ...message, model: event.model } : message;
        case "final": {
          const finalized = extractAssistantAttachments(event.text || message.content);
          const toolAttachments = extractKuaifanToolAttachments(message.toolCalls || []);
          const exportDirectories = extractKuaifanExportDirectories(message.toolCalls || []);
          const mergedAttachments = mergeAssistantAttachments(finalized.attachments, toolAttachments);
          const attachmentsWithExport = mergedAttachments.map((attachment) => ({
            ...attachment,
            exportDir: attachment.exportDir
              || (attachment.localPath ? exportDirectories.get(attachment.localPath) : undefined),
          }));
          const immediateAttachments = attachmentsWithExport.filter((attachment) => !attachment.localPath);
          const localAttachments = attachmentsWithExport.filter((attachment) => attachment.localPath);
          if (localAttachments.length) {
            void clientRef.current.materializeAssistantAttachments(localAttachments).then((attachments) => {
              setMessages((latest) => latest.map((item) => {
                if (item.id !== assistantId) return item;
                const remote = (item.attachments || []).filter((entry) => !entry.localPath);
                return {
                  ...item,
                  attachments: [...remote, ...attachments],
                };
              }));
            });
          }
          return {
            ...message,
            content: finalized.text,
            attachments: (immediateAttachments.length || localAttachments.length)
              ? [
                  ...immediateAttachments,
                  ...localAttachments.map((attachment) => ({
                    ...attachment,
                    url: attachment.url || "",
                    state: "uploaded" as const,
                  })),
                ]
              : message.attachments,
            status: event.status === "interrupted"
              ? "cancelled"
              : event.status === "error"
                ? "error"
                : "done",
            errorMessage: event.status === "error"
              ? event.text || "Hermes 回复失败"
              : message.errorMessage,
          };
        }
        case "aborted":
          return { ...message, status: "cancelled" };
        case "error":
          return { ...message, status: "error", errorMessage: event.message };
        default:
          return message;
      }
    }));

    if (event.type === "final" || event.type === "aborted" || event.type === "error") {
      // Turn ended; drop any unresolved clarify UI for this turn.
      if (event.type === "aborted" || event.type === "error") {
        setPendingClarify(null);
      }
      const nextId = nextAssistantIdRef.current;
      if (nextId) {
        // Mid-turn follow-up was queued: keep streaming and retarget the listener.
        nextAssistantIdRef.current = null;
        activeAssistantIdRef.current = nextId;
        setStreaming(true);
      }
    }
  }, []);

  const openOrReuseStream = useCallback((runtimeSessionId: string) => {
    if (!runtimeSessionId) return;
    // Keep a single listener per turn chain so queued follow-ups continue on the same socket.
    if (streamRef.current && runtimeSessionIdRef.current === runtimeSessionId) {
      return;
    }
    streamRef.current?.close();
    streamRef.current = clientRef.current.openStream(runtimeSessionId, (event) => {
      const assistantId = activeAssistantIdRef.current;
      if (!assistantId) return;
      applyAssistantEvent(assistantId, event);
    });
  }, [applyAssistantEvent]);

  const submitPrompt = useCallback(async (text: string, localAttachments: HermesLocalAttachment[]) => {
    const currentClient = clientRef.current;
    if (!currentClient.isConfigured()) {
      toast.error("Hermes 运行时未就绪");
      return;
    }

    // Clarify answers must go through clarify.respond, never prompt.submit
    // (busy submit would interrupt and cancel the pending clarify).
    const clarify = pendingClarifyRef.current;
    if (clarify) {
      const answer = text.trim();
      if (!answer) {
        toast.error("请选择或输入回答");
        return;
      }
      if (localAttachments.length) {
        toast.error("回答澄清问题时暂不支持附件，请先发送文字选项");
        return;
      }
      const userMessage: HermesMessage = {
        id: makeLocalId("user"),
        role: "user",
        content: answer,
        status: "done",
        ts: Date.now(),
      };
      setMessages((current) => [...current, userMessage]);
      setPendingClarify(null);
      try {
        await currentClient.respondClarify(clarify.requestId, answer);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPendingClarify(clarify);
        toast.error(`提交回答失败：${message}`);
      }
      return;
    }

    if (localAttachments.some((attachment) => attachment.state !== "uploaded" || !attachment.uploaded)) {
      toast.error("请等待附件上传完成，或移除上传失败的附件");
      return;
    }

    const isContinuation = streaming;
    const optimisticAttachments: HermesAttachment[] = localAttachments.map((attachment, index) => ({
      id: attachment.uploaded?.id || `local-${Date.now()}-${index}`,
      name: attachment.file.name,
      mime: attachment.file.type,
      size: attachment.file.size,
      url: attachment.previewUrl,
      previewUrl: attachment.previewUrl,
      kind: attachment.kind,
      state: "uploaded",
    }));
    const userMessage: HermesMessage = {
      id: makeLocalId("user"),
      role: "user",
      content: text,
      status: "done",
      ts: Date.now(),
      attachments: optimisticAttachments,
    };
    const assistantMessage: HermesMessage = {
      id: makeLocalId("assistant"),
      role: "assistant",
      content: "",
      status: "streaming",
      ts: Date.now() + 1,
      toolCalls: [],
      model: settings.model,
    };

    if (isContinuation) {
      // Keep receiving events for the live turn until it ends, then switch.
      nextAssistantIdRef.current = assistantMessage.id;
    } else {
      activeAssistantIdRef.current = assistantMessage.id;
      nextAssistantIdRef.current = null;
    }
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setStreaming(true);
    setPendingClarify(null);

    try {
      const response = await currentClient.startChat({
        sessionId: activeSessionIdRef.current || undefined,
        message: text,
        model: settings.model,
        modelProvider: settings.modelProvider,
        workspace: settings.workspace,
        profile: settings.profile,
        uploadedAttachments: localAttachments.flatMap((attachment) => attachment.uploaded ? [attachment.uploaded] : []),
      });

      setMessages((current) => current.map((message) => message.id === userMessage.id
        ? { ...message, attachments: response.attachments || message.attachments }
        : message));

      if (response.sessionId) {
        activeSessionIdRef.current = response.sessionId;
        setActiveSessionId(response.sessionId);
        setSidebarSession("hermes", response.sessionId);
      }
      runtimeSessionIdRef.current = response.runtimeSessionId || response.streamId;
      openOrReuseStream(response.streamId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const assistantId = isContinuation ? assistantMessage.id : activeAssistantIdRef.current;
      if (isContinuation && nextAssistantIdRef.current === assistantMessage.id) {
        nextAssistantIdRef.current = null;
      }
      setMessages((current) => current.map((item) =>
        item.id === assistantId
          ? { ...item, status: "error", errorMessage: message }
          : item,
      ));
      if (!isContinuation) {
        setStreaming(false);
      }
      toast.error(`发送失败：${message}`);
    }
  }, [openOrReuseStream, setSidebarSession, settings, streaming]);

  const handleUploadAttachments = useCallback(async (
    files: File[],
    onProgress: (file: File, progress: number) => void,
  ): Promise<HermesAttachment[]> => {
    const currentClient = clientRef.current;
    if (!currentClient.isConfigured() || !connectionOk) {
      throw new Error("Hermes 网关未连接");
    }
    const response = await currentClient.prepareAttachments({
      sessionId: activeSessionIdRef.current || undefined,
      message: "",
      model: settings.model,
      modelProvider: settings.modelProvider,
      workspace: settings.workspace,
      profile: settings.profile,
      attachments: files,
      onAttachmentProgress: onProgress,
    });
    activeSessionIdRef.current = response.sessionId;
    runtimeSessionIdRef.current = response.runtimeSessionId;
    setActiveSessionId(response.sessionId);
    setSidebarSession("hermes", response.sessionId);
    return response.attachments;
  }, [connectionOk, setSidebarSession, settings]);

  useEffect(() => {
    if (!streaming) return;
    // A mid-turn follow-up is queued; keep the socket open for the next turn.
    if (nextAssistantIdRef.current) return;
    const activeId = activeAssistantIdRef.current;
    const assistant = activeId
      ? messages.find((message) => message.id === activeId)
      : messages[messages.length - 1];
    if (!assistant || assistant.role !== "assistant") return;
    if (!assistant.status || assistant.status === "streaming") return;

    setStreaming(false);
    setPendingClarify(null);
    streamRef.current?.close();
    streamRef.current = null;
    void loadSessions();

    const storedSessionId = activeSessionIdRef.current;
    if (storedSessionId) {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }
      const expectedMessageCount = messages.length;
      const refreshPersistedTurn = async (attempt: number) => {
        if (activeSessionIdRef.current !== storedSessionId) return;
        const persistedMessageCount = await loadMessages(storedSessionId);
        if (persistedMessageCount < expectedMessageCount && attempt < 8) {
          refreshTimerRef.current = window.setTimeout(() => {
            void refreshPersistedTurn(attempt + 1);
          }, Math.min(500 + attempt * 250, 2_000));
          return;
        }
        refreshTimerRef.current = null;
        void loadSessions();
      };
      refreshTimerRef.current = window.setTimeout(() => {
        void refreshPersistedTurn(0);
      }, 500);
    }
  }, [messages, streaming, loadMessages, loadSessions]);

  const handleCancel = useCallback(async () => {
    streamRef.current?.close();
    streamRef.current = null;
    nextAssistantIdRef.current = null;
    setPendingClarify(null);
    const runtimeSessionId = runtimeSessionIdRef.current;
    if (runtimeSessionId) {
      await clientRef.current.cancelChat(runtimeSessionId);
    }
    const assistantId = activeAssistantIdRef.current;
    setMessages((current) => current.map((message) =>
      message.id === assistantId || message.status === "streaming"
        ? { ...message, status: message.role === "assistant" ? "cancelled" : message.status }
        : message,
    ));
    setStreaming(false);
  }, []);

  const handleNewSession = useCallback(() => {
    if (streaming) {
      toast("请先完成或停止当前回复");
      return;
    }
    activeSessionIdRef.current = null;
    runtimeSessionIdRef.current = null;
    nextAssistantIdRef.current = null;
    setPendingClarify(null);
    setActiveSessionId(null);
    setSidebarSession("hermes", null);
    setMessages([]);
    setPendingText("");
  }, [setSidebarSession, streaming]);

  const handleSelectSession = useCallback((sessionId: string) => {
    if (!sessionId) {
      handleNewSession();
      return;
    }
    if (streaming) {
      toast("请先完成或停止当前回复");
      return;
    }
    activeSessionIdRef.current = sessionId;
    runtimeSessionIdRef.current = null;
    setActiveSessionId(sessionId);
    setSidebarSession("hermes", sessionId);
    setMessages([]);
    void loadMessages(sessionId);
  }, [handleNewSession, loadMessages, setSidebarSession, streaming]);

  const appendSystemMessage = useCallback((content: string) => {
    if (!content) return;
    setMessages((current) => [...current, {
      id: makeLocalId("system"),
      role: "system",
      content,
      status: "done",
      ts: Date.now(),
    }]);
  }, []);

  const handleClarifyChoice = useCallback(async (choice: string) => {
    if (!pendingClarifyRef.current) return;
    await submitPrompt(choice, []);
  }, [submitPrompt]);

  const handleSend = useCallback(async (text: string, localAttachments: HermesLocalAttachment[]) => {
    const slash = localAttachments.length === 0 ? parseHermesSlashCommand(text) : null;
    if (!slash) {
      await submitPrompt(text, localAttachments);
      return;
    }

    if (slash.name === "new" || slash.name === "reset") {
      handleNewSession();
      appendSystemMessage("已切换到新会话。");
      return;
    }

    try {
      const response = await clientRef.current.executeSlashCommand({
        sessionId: activeSessionIdRef.current || undefined,
        message: text,
        model: settings.model,
        modelProvider: settings.modelProvider,
        workspace: settings.workspace,
        profile: settings.profile,
      });
      activeSessionIdRef.current = response.sessionId;
      runtimeSessionIdRef.current = response.runtimeSessionId;
      setActiveSessionId(response.sessionId);
      setSidebarSession("hermes", response.sessionId);

      const result = response.result;
      if (result.notice) appendSystemMessage(result.notice);
      if ((result.type === "send" || result.type === "skill") && result.message) {
        await submitPrompt(result.message, []);
        return;
      }
      if (result.type === "prefill" && result.message) {
        setPendingText(result.message);
      }
      appendSystemMessage(result.output || (result.type === "prefill" ? "命令已完成，请编辑并发送预填内容。" : "命令已完成。"));
      void loadSessions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`命令执行失败：${message}`);
      appendSystemMessage(`命令执行失败：${message}`);
    }
  }, [appendSystemMessage, handleNewSession, loadSessions, setSidebarSession, settings, submitPrompt]);

  useEffect(() => {
    if (!running || streaming || sidebarSessionId === activeSessionIdRef.current) return;
    if (!sidebarSessionId) {
      handleNewSession();
      return;
    }
    handleSelectSession(sidebarSessionId);
  }, [handleNewSession, handleSelectSession, running, sidebarSessionId, streaming]);

  const handleRefresh = useCallback(() => {
    void loadSessions();
    const sessionId = activeSessionIdRef.current;
    if (sessionId && !streaming) void loadMessages(sessionId);
    onRefresh?.();
  }, [loadMessages, loadSessions, onRefresh, streaming]);

  useEffect(() => () => {
    streamRef.current?.close();
    if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
  }, []);

  const modelLabel = useMemo(() => {
    const model = settings.model?.split("/").pop();
    return model || "默认模型";
  }, [settings.model]);

  if (!running) {
    return (
      <div className="flex h-full flex-col" style={{ background: "var(--cx-bg)" }}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6" style={fontFamily}>
          <div
            className="flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: "var(--cx-accent-soft)", border: "1px solid var(--cx-border-soft)" }}
          >
            <CxIconCpu className="h-8 w-8" style={{ color: "var(--cx-accent)" }} />
          </div>
          <div className="max-w-[420px] text-center">
            <div className="mb-1 text-[16px] font-semibold" style={{ color: "var(--cx-text)" }}>
              Hermes 运行时已停止
            </div>
            <div className="text-[13px] leading-relaxed" style={{ color: "var(--cx-text-mute)" }}>
              启动后可以进入对话、查看历史会话、调用工具与多平台消息集成。
            </div>
          </div>
          {onToggle ? (
            <button
              type="button"
              onClick={onToggle}
              disabled={busy}
              className="h-9 rounded-md px-5 text-[13px] font-semibold disabled:opacity-50"
              style={{ background: "var(--cx-success)", color: "#fff" }}
            >
              {busy ? "启动中..." : "启动 Hermes"}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const showEmpty = messages.length === 0 && !messagesLoading;

  return (
    <div className="flex h-full min-h-0 flex-col" style={{ background: "var(--cx-bg)" }}>
      <div
        className="flex h-10 shrink-0 items-center justify-between gap-3 border-b px-3"
        style={{ borderColor: "var(--cx-border-soft)", background: "var(--cx-bg-soft)", ...fontFamily }}
      >
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: connectionOk ? "var(--cx-success)" : "var(--cx-warn)" }}
          />
          <span className="truncate text-[12px] font-medium" style={{ color: "var(--cx-text-soft)" }}>
            Hermes {version ? `v${version}` : ""}{port ? ` · ${port}` : ""}
          </span>
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <select
            aria-label="历史会话"
            title="历史会话"
            value={activeSessionId || ""}
            onChange={(event) => handleSelectSession(event.target.value)}
            disabled={streaming || sessionsLoading}
            className="h-7 max-w-[240px] rounded border px-2 text-[11px] outline-none disabled:opacity-60"
            style={{
              background: "var(--cx-bg)",
              borderColor: "var(--cx-border-soft)",
              color: "var(--cx-text-soft)",
            }}
          >
            <option value="">新对话</option>
            {sessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title || session.lastMessage || "未命名会话"}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleNewSession}
            disabled={streaming}
            className="flex h-7 w-7 items-center justify-center rounded disabled:opacity-50"
            style={{ color: "var(--cx-text-mute)" }}
            title="新建会话"
            aria-label="新建会话"
          >
            <CxIconPlus className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={sessionsLoading}
            className="flex h-7 w-7 items-center justify-center rounded disabled:opacity-50"
            style={{ color: "var(--cx-text-mute)" }}
            title="刷新会话"
            aria-label="刷新会话"
          >
            {sessionsLoading ? (
              <CxIconLoader className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CxIconRefresh className="h-3.5 w-3.5" />
            )}
          </button>
        </div>
      </div>

      <main className="flex min-h-0 flex-1 flex-col">
        {showEmpty ? (
          <HermesEmptyState
            hasSessions={sessions.length > 0}
            onSuggest={setPendingText}
            onNew={handleNewSession}
          />
        ) : (
          <HermesMessageList
            messages={messages}
            loading={messagesLoading && messages.length === 0}
            emptyState={(
              <HermesEmptyState
                hasSessions={sessions.length > 0}
                onSuggest={setPendingText}
                onNew={handleNewSession}
              />
            )}
          />
        )}
        {pendingClarify ? (
          <div
            className="shrink-0 border-t px-4 py-3"
            style={{ background: "var(--cx-bg-soft)", borderColor: "var(--cx-border-soft)" }}
          >
            <div
              className="mx-auto max-w-[780px] rounded-lg border px-3.5 py-3"
              style={{ background: "var(--cx-bg-elev)", borderColor: "var(--cx-accent)" }}
            >
              <div className="mb-1 text-[11px] font-medium" style={{ color: "var(--cx-accent)" }}>
                需要你的选择
              </div>
              <div className="mb-2 text-[13px] leading-relaxed" style={{ color: "var(--cx-text)" }}>
                {pendingClarify.question}
              </div>
              {pendingClarify.choices?.length ? (
                <div className="flex flex-wrap gap-2">
                  {pendingClarify.choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      onClick={() => void handleClarifyChoice(choice)}
                      className="rounded-md border px-2.5 py-1.5 text-left text-[12px] font-medium transition-opacity hover:opacity-90"
                      style={{
                        background: "var(--cx-accent-soft)",
                        borderColor: "var(--cx-border-soft)",
                        color: "var(--cx-text)",
                      }}
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[11px]" style={{ color: "var(--cx-text-mute)" }}>
                  请在下方输入框直接回答
                </div>
              )}
              {pendingClarify.choices?.length ? (
                <div className="mt-2 text-[10.5px]" style={{ color: "var(--cx-text-dim)" }}>
                  也可在下方输入自定义回答后发送
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <HermesComposer
          onSend={handleSend}
          onUpload={handleUploadAttachments}
          onCancel={handleCancel}
          busy={streaming}
          allowSendWhileBusy
          disabled={!connectionOk}
          modelLabel={modelLabel}
          initialText={pendingText}
          onTextConsumed={() => setPendingText("")}
          placeholder={
            pendingClarify
              ? (pendingClarify.choices?.length
                ? "点击上方选项，或输入自定义回答后发送"
                : "输入回答后发送")
              : streaming
                ? "任务进行中，可继续输入纠正/补充（发送后将打断并排队）"
                : undefined
          }
        />
      </main>
    </div>
  );
};

export default HermesPage;
