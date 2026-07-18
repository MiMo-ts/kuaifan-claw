# Hermes Stream Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve Hermes real-time reasoning, tool steps, and final output without blank messages or a stuck composer.

**Architecture:** Treat the WebSocket event stream as authoritative while a turn is active, matching the native Hermes desktop. Convert persisted `role: "tool"` history rows into explicit completed tool-step view models during session reload, while never letting incomplete persisted history replace an optimistic streaming turn.

**Tech Stack:** React 18, TypeScript, Node `node:test`, Hermes JSON-RPC WebSocket API.

---

### Task 1: Lock down stream reconciliation

**Files:**
- Modify: `web/tests/hermesProtocol.test.mjs`
- Modify: `web/src/services/hermesProtocol.ts`

- [ ] **Step 1: Write failing tests**

```js
test("does not replace a live assistant turn with persisted tool history", () => {
  const current = [
    { id: "user", role: "user", content: "open x", status: "done" },
    { id: "assistant", role: "assistant", content: "", status: "streaming" },
  ];
  const persisted = [
    { id: "stored-user", role: "user", content: "open x", status: "done" },
    { id: "stored-tool", role: "tool", content: "", status: "done" },
  ];
  assert.deepEqual(reconcileHermesStreamingMessages(current, persisted), {
    messages: current,
    terminal: false,
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test web/tests/hermesProtocol.test.mjs`

Expected: the reconciliation test fails because the current implementation replaces the live turn and reports terminal.

- [ ] **Step 3: Implement minimal reconciliation guard**

```ts
const liveAssistant = [...current].reverse().find(
  (message) => message.role === "assistant" && message.status === "streaming",
);
if (liveAssistant) return { messages: current, terminal: false };
```

- [ ] **Step 4: Run the regression test and verify GREEN**

Run: `node --test web/tests/hermesProtocol.test.mjs`

Expected: test passes and existing protocol tests remain green.

### Task 2: Normalize persisted tool-history rows

**Files:**
- Modify: `web/src/services/hermesApi.ts`
- Modify: `web/tests/hermesProtocol.test.mjs`

- [ ] **Step 1: Write failing test for a persisted tool row**

```js
const message = normalizePersistedHermesMessage({
  role: "tool",
  name: "browser_navigate",
  context: "Browsing https://example.com",
});
assert.equal(message.role, "assistant");
assert.equal(message.content, "");
assert.equal(message.toolCalls[0].context, "Browsing https://example.com");
assert.equal(message.toolCalls[0].status, "done");
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test web/tests/hermesProtocol.test.mjs`

Expected: test fails because current normalization drops `context` and emits an empty `role: "tool"` bubble.

- [ ] **Step 3: Implement a typed persisted-message normalizer**

```ts
if (message.role === "tool") {
  return {
    id,
    role: "assistant",
    content: "",
    status: "done",
    ts,
    toolCalls: [{ id: `${id}-tool`, name, context, status: "done", startedAt: ts, finishedAt: ts }],
  };
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test web/tests/hermesProtocol.test.mjs`

Expected: persisted tool history renders as a completed tool step rather than an empty bubble.

### Task 3: Keep active WebSocket turns authoritative

**Files:**
- Modify: `web/src/pages/HermesPage.tsx`
- Test: `web/tests/hermesProtocol.test.mjs`

- [ ] **Step 1: Remove stream-time history replacement**

Delete the `useEffect` that calls `getSession()` every 1.5 seconds while `streaming` is true. Keep the existing post-terminal delayed refresh, because it happens only after the WebSocket `message.complete` has settled the active assistant message.

- [ ] **Step 2: Preserve terminal event data**

In the `final` event case, append the final text only when the live delta buffer is empty or differs from the final text, and preserve accumulated `toolCalls` and `reasoning`.

- [ ] **Step 3: Verify no blank/stuck state is possible**

Run: `node --test web/tests/hermesProtocol.test.mjs web/tests/hermesThinking.test.mjs`

Expected: live turn remains streaming until `message.complete`; persisted tools normalize into ToolStep data.

### Task 4: Build verification

**Files:**
- Verify: `web/src/components/hermes/HermesMessage.tsx`
- Verify: `web/src/pages/HermesPage.tsx`
- Verify: `web/src/services/hermesApi.ts`

- [ ] **Step 1: Compile protocol fixtures**

Run: `node web/scripts/build-test-fixtures.mjs`

Expected: generated protocol fixture includes the new normalizer exports.

- [ ] **Step 2: Run focused tests**

Run: `node --test web/tests/hermesProtocol.test.mjs web/tests/hermesThinking.test.mjs`

Expected: all focused Hermes tests pass.

- [ ] **Step 3: Run production web build**

Run: `npm --prefix web run build`

Expected: TypeScript compilation and Vite build succeed.
