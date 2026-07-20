# Hermes Image Preview and Controlled Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an in-app image lightbox and a safe user-confirmed export path for Hermes-generated images without changing OpenClaw or channel plugins.

**Architecture:** Keep generated files in the existing Hermes managed image cache and materialize them through the authenticated `/api/media` endpoint. The React attachment component owns lightbox state and invokes a narrow Rust command for a native save dialog and validated copy; OpenClaw remains on the existing `MEDIA:` path.

**Tech Stack:** React/TypeScript, Tauri 2 Rust commands, `@tauri-apps/plugin-dialog`, existing Hermes API client, Node test runner, Rust unit tests.

---

### Task 1: Define the export contract with failing tests

**Files:**
- Modify: `web/tests/hermesProtocol.test.mjs`
- Modify: `web/src/types/hermes.ts`
- Modify: `web/src/services/hermesAttachments.ts`

- [ ] Add a test asserting an assistant local-image attachment retains its absolute `localPath`, image kind, and generated filename after `MEDIA:` extraction.
- [ ] Run `npm.cmd test` and verify the new assertion fails because the export metadata/callback contract is not present.
- [ ] Add the minimal optional `localPath` field to `HermesAttachment` and export helper types/constants without changing existing URL behavior.
- [ ] Run the focused Node test and verify it passes.

### Task 2: Implement the lightbox and save controls

**Files:**
- Modify: `web/src/components/hermes/HermesAttachmentPreview.tsx`
- Modify: `web/src/components/hermes/HermesMessage.tsx`
- Test: `web/tests/hermesProtocol.test.mjs`

- [ ] Add a failing DOM-level assertion for opening an image attachment, closing with Escape, and invoking a save callback.
- [ ] Run the focused test and confirm it fails for the missing lightbox interaction.
- [ ] Implement a single attachment lightbox with an accessible trigger, full-size `img`, `aria-modal`, close button, Escape/backdrop handling, and `保存到…` / `在资源管理器中显示` icon actions. Keep compact thumbnail dimensions stable and preserve video/audio/document behavior.
- [ ] Pass the attachment source and callbacks from `HermesMessageView`; composer attachments remain preview-only and do not gain filesystem export actions.
- [ ] Run the focused test and then the complete web test suite.

### Task 3: Add validated Tauri export commands

**Files:**
- Create: `src-tauri/src/commands/hermes_media.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `web/src/components/hermes/HermesAttachmentPreview.tsx`

- [ ] Add failing Rust tests for accepted managed PNG/JPG sources, rejected outside-root sources, rejected missing files, and collision-safe destination naming.
- [ ] Run `cargo test hermes_media` and confirm the tests fail before the command exists.
- [ ] Implement `export_hermes_image(source_path: String) -> Result<String, String>` using `AppState::get_data_dir()`, canonicalized paths, `data/modules/hermes/image_cache/kuaifan-image` as the source root, supported image extensions, native `FileDialogBuilder::save_file`, and non-overwriting suffix allocation. Copy only after the user confirms the native dialog.
- [ ] Register the command in `main.rs`; call it from the preview `保存到…` action and display its returned path through the existing toast mechanism.
- [ ] Run the Rust unit tests and complete `cargo test --quiet`.

### Task 4: Verify packaging and preserve runtime boundaries

**Files:**
- Verify: `src-tauri/bundled-hermes/hermes-agent.zip`
- Verify: `src-tauri/resources/bundled-skills/kuaifan-image/`
- Verify: `src-tauri/bundled-openclaw/openclaw.tgz`

- [ ] Run the Skill, Hermes attachment, web, and Rust test suites.
- [ ] Confirm the OpenClaw archive hash is unchanged and no channel plugin files were modified.
- [ ] Run `npm.cmd run build` and `cargo tauri build --bundles nsis`.
- [ ] Inspect the generated installer manifest and report its path and SHA-256 for installation testing.
