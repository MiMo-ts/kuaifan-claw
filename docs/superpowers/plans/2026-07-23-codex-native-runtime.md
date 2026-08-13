# Codex Native Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-only fastclaw console that retrieves the complete fastfan catalog, writes a selected fastfan profile for Codex++, and launches `codex-plus-plus.exe`.

**Architecture:** `CodexPage` uses the existing Kuaifan catalog command and adds a separate UI state for catalog, configuration, and launch status. `commands/codex_runtime.rs` owns all external Codex++ settings/configuration/launch behavior, while the central command module and handler only expose that new isolated command surface.

**Tech Stack:** React 18, TypeScript, Tauri 2, Rust, `toml_edit`, serde_json, Node test runner, Cargo test.

---

### Task 1: Codex++ Configuration Adapter

**Files:**
- Create: `src-tauri/src/commands/codex_runtime.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/commands/codex_runtime.rs`

- [ ] **Step 1: Write failing unit tests for isolated configuration helpers**

```rust
#[test]
fn merge_codex_config_preserves_unmanaged_sections() {
    let merged = merge_codex_config("model = \"old\"\n[plugins]\n", "gpt-5.6-sol").unwrap();
    assert!(merged.contains("model = \"gpt-5.6-sol\""));
    assert!(merged.contains("[plugins]"));
    assert!(merged.contains("base_url = \"http://127.0.0.1:57321/v1\""));
}

#[test]
fn upsert_profile_only_replaces_kuaifan() {
    let updated = upsert_kuaifan_profile(json!({"relayProfiles":[{"id":"other","apiKey":"keep"}]}), "new", "gpt-5.6-sol").unwrap();
    assert_eq!(updated["relayProfiles"][0]["apiKey"], "keep");
    assert_eq!(updated["activeRelayId"], "kuaifan");
}
```

- [ ] **Step 2: Run the tests and confirm they fail because helpers do not exist**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_runtime -- --nocapture`

Expected: compile failure mentioning `merge_codex_config` and `upsert_kuaifan_profile`.

- [ ] **Step 3: Implement the minimal adapter**

```rust
pub const KUAIFAN_UPSTREAM: &str = "https://kuaifanio.cn/v1";
pub const CODEX_PROXY_BASE: &str = "http://127.0.0.1:57321/v1";

#[tauri::command]
pub fn get_codex_runtime_status() -> CodexRuntimeStatus {
    codex_runtime_status(&CodexRuntimePaths::discover())
}

#[tauri::command]
pub fn save_and_launch_codex_kuaifan(request: CodexKuaifanRequest) -> Result<CodexRuntimeStatus, String> {
    let paths = CodexRuntimePaths::discover();
    request.validate()?;
    let backup = backup_live_codex_files(&paths)?;
    let config = merge_codex_config(&read_required_or_empty(&paths.config_path)?, &request.model)?;
    let auth = merge_codex_auth(&read_required_or_empty(&paths.auth_path)?, &request.api_key)?;
    let settings = upsert_kuaifan_profile(read_settings_json(&paths.settings_path)?, &request.api_key, &request.model)?;
    atomic_write(&paths.config_path, config.as_bytes())?;
    atomic_write(&paths.auth_path, auth.as_bytes())?;
    atomic_write(&paths.settings_path, serde_json::to_vec_pretty(&settings)?.as_slice())?;
    launch_runtime(&paths.runtime_path)?;
    Ok(codex_runtime_status_with_backup(&paths, backup))
}
```

Use `toml_edit::DocumentMut` to update `model`, `model_provider`, and `[model_providers.custom]` while retaining every other TOML item. Use serde_json `Value` to update only `launchMode`, `relayProfilesEnabled`, `activeRelayId`, and the profile whose `id` is `kuaifan`. The profile must use `protocol: "chatCompletions"`, `relayMode: "pureApi"`, and `upstreamBaseUrl: KUAIFAN_UPSTREAM` so Codex++ starts its existing protocol adapter. Add `toml_edit = "0.22"` to Cargo dependencies; register `pub mod codex_runtime;` and only the two new commands.

- [ ] **Step 4: Run the focused Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml codex_runtime -- --nocapture`

Expected: all new Codex runtime tests pass.

### Task 2: Codex Control Console

**Files:**
- Modify: `web/src/pages/CodexPage.tsx`
- Modify: `web/tests/codexPage.test.mjs`

- [ ] **Step 1: Write failing frontend contract tests**

```js
assert.match(source, /invoke<Model\[\]>\("list_models", \{ providerId: "kuaifan"/);
assert.match(source, /共 \{models\.length\} 个模型/);
assert.match(source, /placeholder="搜索模型"/);
assert.match(source, /save_and_launch_codex_kuaifan/);
assert.doesNotMatch(source, /fetch\(`\$\{KUAIFAN_BASE_URL\}\/models/);
```

- [ ] **Step 2: Run the test and confirm the current direct `/v1/models` implementation fails**

Run: `npm test -- --test-name-pattern="Codex page"`

Expected: assertion failure for `list_models`, model count, search, and save/launch command.

- [ ] **Step 3: Implement the control console**

```tsx
const result = await invoke<Model[]>("list_models", { providerId: "kuaifan", apiKey: apiKey.trim() || null });
const visibleModels = models.filter(({ id }) => id.toLocaleLowerCase().includes(modelQuery.toLocaleLowerCase()));
const runtime = await invoke<CodexRuntimeStatus>("save_and_launch_codex_kuaifan", { apiKey: apiKey.trim(), model });
```

Load the existing Kuaifan key on page entry, persist edits through the existing `saveApiKey`, display the server-returned catalog count and a searchable model list, and disable save/start until the key and model are both present. Add a compact runtime status row and a clear error state. Keep advanced capability areas as disabled future pages; do not route into OpenClaw or Hermes.

- [ ] **Step 4: Run the focused frontend test**

Run: `npm test -- --test-name-pattern="Codex page"`

Expected: Codex page test passes.

### Task 3: Full Regression and Packaging

**Files:**
- Modify: only Task 1 and Task 2 files if verification reveals a defect

- [ ] **Step 1: Run all frontend tests**

Run: `npm test`

Expected: all test files pass with no skipped Codex assertions.

- [ ] **Step 2: Run all Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: process exits 0 with all existing and new tests passing.

- [ ] **Step 3: Build frontend and Tauri release package**

Run: `npm run build; npm run tauri:build`

Expected: TypeScript build and NSIS package generation exit 0.

- [ ] **Step 4: Manually verify the packaged Codex panel**

Run: launch the produced executable, open the Codex module, confirm the catalog count is visible, select a model, save/start with a valid key, and verify the status reports the actual `codex-plus-plus.exe` path without opening OpenClaw/Hermes.

- [ ] **Step 5: Do not create a Git commit**

The user explicitly requested no Git commit. Leave the verified worktree changes and report the package path and test evidence.
