import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const compiledModule = new URL("../../artifacts/test/web/hermesProtocol.mjs", import.meta.url);
const gatewayClientModule = new URL("../../artifacts/test/web/gatewayClient.mjs", import.meta.url);
const attachmentModule = new URL("../../artifacts/test/web/hermesAttachments.mjs", import.meta.url);
const moduleSessionProtocol = new URL("../../artifacts/test/web/moduleSessionProtocol.mjs", import.meta.url);
const moduleExists = existsSync(compiledModule);
const gatewayClientModuleExists = existsSync(gatewayClientModule);
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

if (moduleSessionProtocolExists) {
  const {
    DEFAULT_OPENCLAW_MAIN_SESSION,
    buildNativeGuiUrl,
    resolveActiveModuleSession,
    sortModuleSessions,
  } = await import(moduleSessionProtocol);

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
    normalizeCreatedSession,
    normalizeRuntimeProvider,
    parseHermesSlashCommand,
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
