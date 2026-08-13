# OpenClaw Control UI and Stream Normalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore OpenClaw image preview actions and prevent Kuaifan terminal SSE frames from being appended as duplicate assistant text.

**Architecture:** The application keeps OpenClaw unmodified. An application-owned localhost proxy is placed only in front of the configured Kuaifan OpenAI-compatible chat endpoint. It forwards every request and SSE frame unchanged except a terminal `choices[].message.content` field, because the same content was already emitted in `choices[].delta.content` and OpenClaw otherwise appends both. The existing Control UI proxy is used for every manager-opened console so its application-owned enhancer can bind images in assistant and tool messages.

**Tech Stack:** Rust 2021, Tokio, Reqwest SSE streaming, Node `node:test`, browser-side JavaScript.

---

### Task 1: Specify the stream compatibility contract

**Files:**
- Create: `src-tauri/src/commands/kuaifan_stream_proxy.rs`
- Modify: `src-tauri/src/commands/mod.rs`

- [ ] **Step 1: Write the failing unit tests**

```rust
#[test]
fn removes_terminal_message_content_without_changing_delta_content() {
    let input = r#"data: {\"choices\":[{\"delta\":{\"content\":\"done\"},\"message\":{\"content\":\"done\"},\"finish_reason\":\"stop\"}]}\n\n"#;
    let output = normalize_sse_event(input);
    assert!(output.contains(r#"\"delta\":{\"content\":\"done\"}"#));
    assert!(!output.contains(r#"\"message\""#));
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml kuaifan_stream_proxy --lib`

Expected: compilation failure because `kuaifan_stream_proxy` and `normalize_sse_event` do not exist.

- [ ] **Step 3: Implement the smallest proxy module**

Implement `normalize_sse_event` for individual complete SSE events. It must parse only `data: {json}` lines, remove `choices[*].message.content` only when `choices[*].delta.content` is a non-empty string, and preserve every other field and every non-JSON event. Bind the proxy to `127.0.0.1` and forward the original request to the configured Kuaifan base URL with response streaming.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml kuaifan_stream_proxy --lib`

Expected: all stream-proxy tests pass.

### Task 2: Use the normalizer only for Kuaifan chat

**Files:**
- Modify: `src-tauri/src/commands/gateway.rs`
- Test: `src-tauri/src/commands/gateway.rs`

- [ ] **Step 1: Write the failing configuration test**

```rust
#[test]
fn routes_kuaifan_chat_to_the_managed_normalizer_but_keeps_other_providers_unchanged() {
    let mut config = json!({"models":{"providers":{"kuaifan":{"baseUrl":"https://kuaifanio.cn/v1"},"other":{"baseUrl":"https://example.test/v1"}}}});
    apply_kuaifan_stream_normalizer(&mut config, "http://127.0.0.1:45678/v1");
    assert_eq!(config["models"]["providers"]["kuaifan"]["baseUrl"], "http://127.0.0.1:45678/v1");
    assert_eq!(config["models"]["providers"]["other"]["baseUrl"], "https://example.test/v1");
}
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml kuaifan_stream_normalizer --lib`

Expected: compilation failure because the configuration hook is missing.

- [ ] **Step 3: Implement gateway startup ordering**

Start the managed normalizer before spawning OpenClaw, retain the original Kuaifan base URL inside the proxy, and replace only `models.providers.kuaifan.baseUrl` in the generated OpenClaw configuration. Do not alter `models.yaml`; the managed image Skill continues to use its configured direct image endpoint.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml kuaifan_stream_normalizer --lib`

Expected: the Kuaifan provider is redirected locally and all other provider URLs remain unchanged.

### Task 3: Bind the presentation enhancer to actual console media

**Files:**
- Modify: `web/tests/controlUiPresentation.test.mjs`
- Modify: `src-tauri/resources/control-ui-enhancer.js`
- Modify: `src-tauri/src/commands/gateway.rs`

- [ ] **Step 1: Write failing browser-script tests**

```js
test("finds chat groups from both assistant and tool messages", () => {
  const api = loadPresentationApi();
  const groups = api.findChatGroups(documentRoot);
  assert.deepEqual(Array.from(groups), [assistantGroup, toolGroup]);
});

test("collapses a short exact status repeat", () => {
  const api = loadPresentationApi();
  assert.equal(api.collapseExactDuplicateText("还在跑，再等等。还在跑，再等等。"), "还在跑，再等等。");
});
```

- [ ] **Step 2: Verify RED**

Run: `node --test web/tests/controlUiPresentation.test.mjs`

Expected: the tool-group API is missing and short duplicated status text is not collapsed.

- [ ] **Step 3: Implement the presentation and routing changes**

Replace assistant-only group discovery with chat-group discovery covering `assistant` and `tool` roles. Bind preview, lightbox, and image source de-duplication to both roles; collapse only exact repetitions, including short execution-status text. Make `open_openclaw_console` open the existing `control_ui_proxy` URL so the enhancer is always injected for both external and embedded console sessions.

- [ ] **Step 4: Verify GREEN**

Run: `node --test web/tests/controlUiPresentation.test.mjs`

Expected: all presentation tests pass.

### Task 4: Verify boundaries and live protocol behavior

**Files:**
- Test only: managed OpenClaw configuration and Kuaifan upstream endpoint

- [ ] **Step 1: Run focused Rust and JavaScript tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml kuaifan_stream_proxy --lib
node --test web/tests/controlUiPresentation.test.mjs
```

Expected: both commands pass.

- [ ] **Step 2: Run a live Kuaifan SSE probe**

Send a short exact-response prompt through the managed proxy and assert that the upstream terminal `message.content` is absent downstream while the earlier `delta.content` remains once.

- [ ] **Step 3: Verify console routing**

Open the manager console URL and verify the served document references `/__kuaifan__/control-ui-enhancer.js`; then click a generated image from a Tool message to verify the lightbox and download action appear.
