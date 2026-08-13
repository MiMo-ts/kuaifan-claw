# OpenClaw Session And Image Runtime Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent OpenClaw session initialization races, make generated images consistently previewable in the embedded chat, and preserve working text-to-image and image-to-image flows in both OpenClaw and Hermes.

**Architecture:** Keep the fixes in application-owned boundaries. Serialize Manager-initiated OpenClaw starts, make the Control UI proxy serve the enhanced SPA entry point for client-side routes, and constrain the managed image Skill to a shell-safe absolute-script invocation. Do not modify `openclaw.tgz`, channel plugins, or Hermes core routing.

**Tech Stack:** Rust/Tauri, JavaScript Control UI enhancer, Python managed Skill, Node test runner, Rust unit tests, Python unittest, Playwright browser verification.

---

### Task 1: Enhanced Control UI SPA Routing

**Files:**
- Modify: `src-tauri/src/commands/control_ui_proxy.rs`
- Test: `src-tauri/src/commands/control_ui_proxy.rs`

- [ ] Add a failing Rust test that requests `/chat?session=agent:main:main` and asserts the returned HTML contains exactly one `/__kuaifan__/control-ui-enhancer.js` tag.
- [ ] Run `cargo test control_ui_proxy::tests::serves_enhanced_index_for_spa_chat_route --manifest-path src-tauri/Cargo.toml` and confirm the enhancer assertion fails.
- [ ] Add a focused SPA fallback helper: extensionless navigation paths use `index.html`; real assets and application-owned endpoints retain their current behavior.
- [ ] Re-run the focused test and the existing `control_ui_proxy::tests` suite.

### Task 2: OpenClaw Gateway Start Serialization

**Files:**
- Modify: `src-tauri/src/commands/gateway.rs`
- Test: `src-tauri/src/commands/gateway.rs`

- [ ] Add failing unit tests for an application-owned start gate that permits one start owner and reports an existing in-flight start to subsequent callers.
- [ ] Run the focused gateway tests and confirm the new expectations fail before implementation.
- [ ] Add a process-local asynchronous mutex around `start_gateway_with_data_dir_path`, then re-check the status file and listening port after acquiring it so a queued caller cannot spawn a second gateway.
- [ ] Preserve all existing start, stop, model synchronization, and plugin preparation behavior.
- [ ] Re-run the focused gateway tests.

### Task 3: Shell-Safe Managed Image Skill

**Files:**
- Modify: `skills/kuaifan-image/SKILL.md`
- Modify: `src-tauri/resources/bundled-skills/kuaifan-image/SKILL.md`
- Modify: `skills/kuaifan-image/tests/test_kuaifan_image.py`
- Modify: `src-tauri/resources/bundled-skills/kuaifan-image/bundle-manifest.json`

- [ ] Add a failing contract test requiring the Skill to forbid `cd /d` and `&&`, and to require invoking the resolved absolute `scripts/kuaifan_image.py` path directly.
- [ ] Run `python -m unittest discover -s skills/kuaifan-image/tests -p "test_*.py"` and confirm only the new contract assertion fails.
- [ ] Update the Skill instructions and examples with direct absolute-script invocation for Windows PowerShell 5.1.
- [ ] Synchronize the bundled copy and manifest SHA/revision.
- [ ] Re-run all Skill tests.

### Task 4: Presentation Regression Coverage

**Files:**
- Modify: `web/tests/controlUiPresentation.test.mjs` only if a missing enhancer behavior is exposed.
- Verify: `src-tauri/resources/control-ui-enhancer.js`

- [ ] Run `node --test web/tests/controlUiPresentation.test.mjs`.
- [ ] Verify the proxy-served `/chat` page loads the enhancer, sets `data-kuaifan-preview-bound=true` on `.chat-message-image`, opens one lightbox on click, and exposes one download action.
- [ ] Keep the existing deduplication and image normalization behavior unchanged unless the live DOM test demonstrates a separate defect.

### Task 5: Dual Runtime Image Verification

**Files:**
- Verify: `skills/kuaifan-image/scripts/kuaifan_image.py`
- Verify: `src-tauri/src/commands/hermes_media.rs`
- Verify: `web/src/services/hermesAttachments.ts`

- [ ] Run OpenClaw text-to-image and image-to-image through the managed Skill; assert exit code 0, one artifact JSON object, one `MEDIA:` line, and valid image bytes.
- [ ] Run Hermes text-to-image and image-to-image; assert exit code 0, one artifact JSON object, no duplicate `MEDIA:` line, and valid image bytes.
- [ ] Verify OpenClaw renders exactly one native image with working preview/download and Hermes produces one native attachment in its chat protocol.
- [ ] Do not print or persist API keys in commands, logs, fixtures, or reports.

### Task 6: Build And Package

**Files:**
- Verify: `web/package.json`
- Verify: `src-tauri/Cargo.toml`
- Output: `src-tauri/target/release/bundle/nsis/*.exe`

- [ ] Run all focused Python, Node, and Rust tests.
- [ ] Run `npm --prefix web run build`.
- [ ] Run the release Tauri/NSIS build with the repository's existing build command.
- [ ] Record the installer path, size, and SHA-256.
- [ ] Confirm the temporary test gateways are stopped and no unrelated files were reverted or cleaned.
