import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const compiledModule = new URL("../../artifacts/test/web/hermesProtocol.mjs", import.meta.url);
const gatewayClientModule = new URL("../../artifacts/test/web/gatewayClient.mjs", import.meta.url);
const hermesApiModule = new URL("../../artifacts/test/web/hermesApi.mjs", import.meta.url);
const attachmentModule = new URL("../../artifacts/test/web/hermesAttachments.mjs", import.meta.url);
const moduleSessionProtocol = new URL("../../artifacts/test/web/moduleSessionProtocol.mjs", import.meta.url);
const moduleExists = existsSync(compiledModule);
const gatewayClientModuleExists = existsSync(gatewayClientModule);
const hermesApiModuleExists = existsSync(hermesApiModule);
const attachmentModuleExists = existsSync(attachmentModule);
const moduleSessionProtocolExists = existsSync(moduleSessionProtocol);

test("Hermes protocol state module is available", () => {
  assert.equal(moduleExists, true);
});

test("module session protocol is available", () => {
  assert.equal(moduleSessionProtocolExists, true);
});

test("gateway client module is available", () => {
  assert.equal(gatewayClientModuleExists, true);
});

test("Hermes attachment helper module is available", () => {
  assert.equal(attachmentModuleExists, true);
});

if (attachmentModuleExists) {
  const {
    attachmentSendState,
    classifyAttachment,
    extractAssistantAttachments,
    normalizeAttachmentFallback,
    resolveAttachmentUrl,
    toPromptAttachmentIds,
  } = await import(attachmentModule);

  test("classifies previewable attachment kinds", () => {
    assert.equal(classifyAttachment("image/png"), "image");
    assert.equal(classifyAttachment("video/mp4"), "video");
    assert.equal(classifyAttachment("text/plain"), "document");
    assert.equal(classifyAttachment("application/json", "meta.json"), "document");
    assert.equal(classifyAttachment("application/octet-stream", "main.py"), "document");
  });

  test("submits only uploaded attachment ids", () => {
    assert.deepEqual(toPromptAttachmentIds([
      { id: "ready", state: "uploaded" },
      { id: "failed", state: "error" },
      { id: "pending", state: "pending" },
    ]), ["ready"]);
  });

  test("blocks sending until every selected attachment is uploaded or removed", () => {
    assert.equal(attachmentSendState([{ state: "uploading" }]), "uploading");
    assert.equal(attachmentSendState([{ state: "error" }]), "error");
    assert.equal(attachmentSendState([{ state: "uploaded" }]), "ready");
    assert.equal(attachmentSendState([]), "ready");
  });

  test("extracts remote MEDIA directives into previewable assistant attachments", () => {
    const result = extractAssistantAttachments("Done\nMEDIA:https://cdn.example.test/render.mp4");
    assert.equal(result.text, "Done");
    assert.deepEqual(result.attachments.map((attachment) => attachment.kind), ["video"]);
  });

  test("normalizes object attachment fallbacks before they reach React", () => {
    assert.equal(normalizeAttachmentFallback({}), undefined);
    assert.equal(
      normalizeAttachmentFallback({ mode: "text", reason: "The model cannot inspect this image." }),
      "The model cannot inspect this image.",
    );
  });

  test("builds an authenticated preview URL for a persisted attachment", () => {
    assert.equal(
      resolveAttachmentUrl({
        baseUrl: "http://127.0.0.1:5174",
        attachmentId: "image-1",
        runtimeSessionId: "runtime-1",
      }),
      "http://127.0.0.1:5174/api/chat/attachments/image-1?session_id=runtime-1",
    );
  });
}

if (gatewayClientModuleExists) {
  const { MANAGER_OPERATOR_SCOPES } = await import(gatewayClientModule);

  test("manager requests only the session scopes", () => {
    assert.deepEqual(MANAGER_OPERATOR_SCOPES, ["operator.read", "operator.write"]);
  });
}

if (hermesApiModuleExists) {
  const { HermesApiClient } = await import(hermesApiModule);

  test("keeps duration metadata from a completed tool event", () => {
    const client = new HermesApiClient({ baseUrl: "http://127.0.0.1:5174" });
    assert.deepEqual(
      client.normalizeStreamEvent("tool.complete", {
        tool_id: "tool-1",
        result: { success: true },
        duration_s: 1.25,
      }),
      {
        type: "tool_result",
        toolCallId: "tool-1",
        result: "{\n  \"success\": true\n}",
        status: "done",
        durationS: 1.25,
      },
    );
  });

  test("turns a failed tool event into an error timeline step", () => {
    const client = new HermesApiClient({ baseUrl: "http://127.0.0.1:5174" });
    assert.deepEqual(
      client.normalizeStreamEvent("tool.failed", {
        tool_id: "tool-2",
        error: "navigation blocked",
        duration_s: 0.5,
      }),
      {
        type: "tool_result",
        toolCallId: "tool-2",
        result: "navigation blocked",
        status: "error",
        durationS: 0.5,
      },
    );
  });
}

if (moduleSessionProtocolExists) {
  const {
    DEFAULT_OPENCLAW_MAIN_SESSION,
    buildNativeGuiUrl,
    resolveActiveModuleSession,
    sortModuleSessions,
  } = await import(moduleSessionProtocol);
  test("preserves the existing OpenClaw session list when the first refresh returns empty", () => {
    const merged = resolveActiveModuleSession("openclaw", "agent:main:main", []);
    assert.equal(merged, "agent:main:main");
    assert.deepEqual(sortModuleSessions([]), []);
  });



  test("uses the persisted main key before the sidebar session refresh completes", () => {
    assert.equal(DEFAULT_OPENCLAW_MAIN_SESSION, "agent:main:main");
  });

  test("opens an OpenClaw session in its native chat route", () => {
    assert.equal(
      buildNativeGuiUrl("openclaw", "http://127.0.0.1:41000/?token=abc", "agent:main:demo"),
      "http://127.0.0.1:41000/chat?token=abc&session=agent%3Amain%3Ademo",
    );
  });

  test("opens a Hermes stored session through its native resume route", () => {
    assert.equal(
      buildNativeGuiUrl("hermes", "http://127.0.0.1:42000/", "20260713_demo"),
      "http://127.0.0.1:42000/chat?resume=20260713_demo",
    );
  });

  test("keeps the newest real module sessions first", () => {
    const sessions = sortModuleSessions([
      { id: "old", moduleId: "openclaw", title: "old", updatedAt: 1 },
      { id: "new", moduleId: "openclaw", title: "new", updatedAt: 2 },
    ]);
    assert.deepEqual(sessions.map((session) => session.id), ["new", "old"]);
  });

  test("keeps an explicit Hermes new-chat selection empty during sidebar refresh", () => {
    assert.equal(
      resolveActiveModuleSession("hermes", null, [{ id: "previous" }]),
      null,
    );
  });
}

if (moduleExists) {
  const {
    mergeAuthoritativeMessages,
    formatHermesToolArgs,
    normalizeCreatedSession,
    normalizePersistedToolHistoryMessage,
    normalizeRuntimeProvider,
    parseHermesSlashCommand,
    reconcileHermesStreamingMessages,
    terminalEventStatus,
  } = await import(compiledModule);

  test("keeps stored and runtime session identifiers separate", () => {
    assert.deepEqual(
      normalizeCreatedSession({
        session_id: "48768504",
        stored_session_id: "20260713_021519_3e53da",
      }),
      {
        runtimeSessionId: "48768504",
        storedSessionId: "20260713_021519_3e53da",
      },
    );
  });

  test("retains the stored id when resuming an existing session", () => {
    assert.deepEqual(
      normalizeCreatedSession(
        { session_id: "new-live-id" },
        "20260713_021519_3e53da",
      ),
      {
        runtimeSessionId: "new-live-id",
        storedSessionId: "20260713_021519_3e53da",
      },
    );
  });

  test("does not erase optimistic messages with an empty refresh", () => {
    const current = [{ id: "user-1", content: "你好" }];
    assert.equal(mergeAuthoritativeMessages(current, []), current);
  });

  test("does not replace a completed turn with partial persisted history", () => {
    const current = [
      { id: "user-1", content: "你好" },
      { id: "assistant-1", content: "你好，我是 Hermes" },
    ];
    const partial = [{ id: "stored-user", content: "你好" }];
    assert.equal(mergeAuthoritativeMessages(current, partial), current);
  });

  test("replaces optimistic messages with persisted history", () => {
    const current = [{ id: "local", content: "你好" }];
    const persisted = [{ id: "stored", content: "你好" }];
    assert.equal(mergeAuthoritativeMessages(current, persisted), persisted);
  });

  test("does not replace a live assistant turn with persisted tool history", () => {
    const current = [
      { id: "user", role: "user", content: "open xiaohongshu", status: "done" },
      { id: "assistant", role: "assistant", content: "", status: "streaming" },
    ];
    const persisted = [
      { id: "stored-user", role: "user", content: "open xiaohongshu", status: "done" },
      { id: "stored-tool", role: "tool", content: "", status: "done" },
    ];

    assert.deepEqual(
      reconcileHermesStreamingMessages(current, persisted),
      { messages: current, terminal: false },
    );
  });

  test("normalizes persisted tool history into a completed ToolStep", () => {
    assert.deepEqual(
      normalizePersistedToolHistoryMessage(
        { role: "tool", name: "browser_navigate", context: "Browsing https://www.xiaohongshu.com" },
        "history-tool-1",
        1_000,
      ),
      {
        id: "history-tool-1",
        role: "assistant",
        content: "",
        status: "done",
        ts: 1_000,
        toolCalls: [{
          id: "history-tool-1-tool",
          name: "browser_navigate",
          context: "Browsing https://www.xiaohongshu.com",
          status: "done",
          startedAt: 1_000,
          finishedAt: 1_000,
        }],
      },
    );
  });

  test("formats tool arguments for the timeline while redacting secrets", () => {
    assert.equal(
      formatHermesToolArgs({ url: "https://www.example.com", full: true, api_key: "secret-value" }),
      "url: https://www.example.com · full: true · api_key: [redacted]",
    );
  });

  test("only turn completion and errors are terminal events", () => {
    assert.equal(terminalEventStatus("session.title"), null);
    assert.equal(terminalEventStatus("session.created"), null);
    assert.equal(terminalEventStatus("message.complete"), "done");
    assert.equal(terminalEventStatus("error"), "error");
  });

  test("recovers a routable named custom provider from runtime source", () => {
    assert.equal(
      normalizeRuntimeProvider("custom", "custom_provider:kuaifan"),
      "custom:kuaifan",
    );
  });

  test("keeps a regular runtime provider unchanged", () => {
    assert.equal(normalizeRuntimeProvider("openrouter", "env"), "openrouter");
  });

  test("parses a composer slash command without treating regular text as a command", () => {
    assert.deepEqual(parseHermesSlashCommand("/skills search browser"), {
      name: "skills",
      arg: "search browser",
    });
    assert.equal(parseHermesSlashCommand("please run /skills"), null);
  });
}
