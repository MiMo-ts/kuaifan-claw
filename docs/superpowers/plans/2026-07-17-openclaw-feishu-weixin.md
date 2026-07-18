# OpenClaw Feishu and Weixin Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the Feishu scanner's user allowlist when creating an OpenClaw instance and make the bundled Tencent Weixin plugin compatible with the installed OpenClaw SDK.

**Architecture:** Carry the Feishu `user_open_id` through the existing quick-bind result into `channel_config.allowFrom`, so the module-scoped instance remains the single source of truth. Patch only the Tencent plugin's incompatible command-auth imports at install/startup time, leaving the OpenClaw core SDK and Hermes untouched.

**Tech Stack:** Rust/Tauri commands, React/TypeScript, Node test runner, OpenClaw plugin SDK.

---

### Task 1: Preserve Feishu scanner allowlist

**Files:**
- Modify: `src-tauri/src/commands/plugin_framework.rs`
- Modify: `web/src/components/wizard/QuickBindModal.tsx`
- Modify: `web/src/components/wizard/CreateInstance.tsx`
- Test: `web/tests/openclawQuickBind.test.mjs`

- [ ] Add a failing test proving `user_open_id` is absent from the quick-bind completion data and instance form.
- [ ] Add `user_open_id` to the serialized poll result.
- [ ] Map the value to `QuickBindCompleteData.allowFrom`.
- [ ] Merge `allowFrom` into the new Feishu instance form state.
- [ ] Run the focused Node test and TypeScript compiler.

### Task 2: Repair Tencent Weixin SDK imports

**Files:**
- Modify: `src-tauri/src/commands/plugin_patches.rs`
- Test: `src-tauri/src/commands/plugin_patches.rs`

- [ ] Add a failing test with the official plugin's root SDK import.
- [ ] Rewrite only command-auth symbols to `openclaw/plugin-sdk/command-auth`.
- [ ] Apply the rewrite during plugin installation and gateway startup repair.
- [ ] Verify the rewrite is idempotent and leaves unrelated imports unchanged.
- [ ] Run focused Rust plugin patch tests.

### Task 3: Verify and package

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `web/package.json`
- Modify: `web/package-lock.json`

- [ ] Run OpenClaw gateway and plugin framework tests.
- [ ] Run all frontend tests and production build.
- [ ] Bump the release version consistently.
- [ ] Build the NSIS installer.
- [ ] Verify installer SHA-256 and bundled ZIP CRCs.
