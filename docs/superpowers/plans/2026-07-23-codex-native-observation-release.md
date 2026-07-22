# Codex Native Observation Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Kuaifan Claw 1.0.74 with a native Codex module that installs and detects ChatGPT, configures Kuaifan API, loads authenticated models, writes Codex configuration, and exposes the complete Codex++ feature map for iterative migration.

**Architecture:** Add a focused Rust `codex` command module owning Windows application discovery, bundled-installer execution, Kuaifan provider state, authenticated model discovery, and Codex configuration generation. Add a native React Codex page that uses Kuaifan's shell and semantic tokens, with an overview and structured feature areas. Reuse the existing Wizard and module-card patterns for installation routing.

**Tech Stack:** Tauri 2, Rust, React, TypeScript, Vite, Zustand, existing Kuaifan Claw UI tokens, Node test runner, Cargo tests, NSIS.

---

## Non-Regression Constraint

The implementation is additive. Do not alter OpenClaw or Hermes command behavior, runtime manifests, persistence locations, session logic, installation UI, or default selection. Every new backend command starts with `codex_`; every new managed data path is under `modules/codex`; and every new frontend route or state branch activates only for `activeModule === 'codex'`.

### Task 1: Establish isolated baseline

**Files:**
- Modify: `.gitignore` only if the selected worktree directory is not ignored
- Test: existing `web/tests/*.test.mjs` and `cargo test --manifest-path src-tauri/Cargo.toml`

- [ ] **Step 1: Create or select an isolated worktree**

Run:

```powershell
git rev-parse --git-dir
git rev-parse --git-common-dir
git rev-parse --show-superproject-working-tree
```

Expected: determine whether the active directory is already a linked worktree. If it is a normal checkout, create an ignored `.worktrees/codex-native-observation` worktree on branch `codex/native-observation`.

- [ ] **Step 2: Install existing frontend dependencies without changing lockfiles**

Run:

```powershell
npm --prefix web ci
```

Expected: exit code 0; `web/node_modules` is restored from `package-lock.json`.

- [ ] **Step 3: Run the existing frontend test baseline**

Run:

```powershell
npm --prefix web test -- --runInBand
```

Expected: existing tests pass before Codex edits. If the repository's test script rejects `--runInBand`, run the script exactly as declared in `web/package.json` and record the result.

- [ ] **Step 4: Run the existing Rust test baseline**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: exit code 0 before Codex edits.

### Task 2: Add testable desktop discovery and installer lifecycle

**Files:**
- Create: `src-tauri/src/commands/codex.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/main.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src-tauri/bundled-codex/ChatGPT Installer.exe`
- Test: inline Rust tests in `src-tauri/src/commands/codex.rs`

- [ ] **Step 1: Write failing Rust tests for installer and app probing**

Add test helpers that use a temporary directory and inject executable and registry candidate paths. Cover the following API:

```rust
#[test]
fn finds_chatgpt_executable_from_candidate_paths() {
    let root = tempfile::tempdir().unwrap();
    let app = root.path().join("ChatGPT.exe");
    std::fs::write(&app, b"test").unwrap();
    assert_eq!(first_existing_file(&[app.clone()]), Some(app));
}

#[test]
fn bundled_installer_resolution_prefers_development_resource() {
    let root = tempfile::tempdir().unwrap();
    let installer = root.path().join("bundled-codex").join("ChatGPT Installer.exe");
    std::fs::create_dir_all(installer.parent().unwrap()).unwrap();
    std::fs::write(&installer, b"test").unwrap();
    assert_eq!(resolve_chatgpt_installer(&[root.path().to_path_buf()]), Some(installer));
}
```

- [ ] **Step 2: Run the new tests and verify they fail because the module is absent**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: compile failure stating that `commands::codex` does not exist.

- [ ] **Step 3: Implement the minimal command module**

Implement `CodexInstallStatus`, `ChatGptInstallStatus`, `get_codex_install_status`, and `start_chatgpt_install`. The installer must use `Command::new(installer).spawn()` with Windows `CREATE_NO_WINDOW` disabled because the vendor installer requires its own UI. The status command must expose only safe metadata:

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatGptInstallStatus {
    pub installed: bool,
    pub executable_path: Option<String>,
    pub installer_available: bool,
    pub installer_path: Option<String>,
    pub installer_running: bool,
    pub installer_exit_code: Option<i32>,
}
```

Register `codex` in `commands/mod.rs`, register both commands in `main.rs`, list `bundled-codex/*` in Tauri bundle resources, and copy the supplied installer into `src-tauri/bundled-codex/ChatGPT Installer.exe`.

- [ ] **Step 4: Re-run the focused Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: focused tests pass.

- [ ] **Step 5: Commit the lifecycle slice**

Run:

```powershell
git add src-tauri/src/commands/codex.rs src-tauri/src/commands/mod.rs src-tauri/src/main.rs src-tauri/tauri.conf.json src-tauri/bundled-codex/ChatGPT\ Installer.exe
git commit -m "feat: add codex installer lifecycle"
```

### Task 3: Add Kuaifan provider state and authenticated model discovery

**Files:**
- Modify: `src-tauri/src/commands/codex.rs`
- Create: `web/src/services/codexApi.ts`
- Create: `web/tests/codexApi.test.mjs`
- Test: `web/tests/codexApi.test.mjs`, inline Rust tests

- [ ] **Step 1: Write a failing frontend test for Kuaifan model discovery**

Create a test that stubs `fetch` and asserts the request uses the fixed URL and bearer token:

```javascript
test('loads models from the Kuaifan OpenAI endpoint', async () => {
  global.fetch = async (url, init) => ({ ok: true, json: async () => ({ data: [{ id: 'model-a' }] }) });
  const models = await fetchCodexModels('sk-test');
  assert.deepEqual(models, [{ id: 'model-a' }]);
  assert.equal(captured.url, 'https://kuaifanio.cn/v1/models');
  assert.equal(captured.init.headers.Authorization, 'Bearer sk-test');
});
```

- [ ] **Step 2: Run the test and verify it fails because `codexApi.ts` is missing**

Run:

```powershell
node --test web/tests/codexApi.test.mjs
```

Expected: module-not-found failure for `../src/services/codexApi.ts`.

- [ ] **Step 3: Implement minimal model discovery and settings serialization**

Add a typed frontend client that sends the key only to `https://kuaifanio.cn/v1/models`, normalizes `{ data }`, `{ models }`, and array responses, and returns a clear non-secret error for non-2xx responses. Add Rust commands to load and save a `CodexProviderSettings` value under `modules/codex/settings.json`; the serialized shape contains `base_url`, `protocol`, `default_model`, and the API key only in the module settings file. Never return the stored API key to overview commands.

```ts
export const KUAIFAN_CODEX_BASE_URL = 'https://kuaifanio.cn/v1';

export async function fetchCodexModels(apiKey: string): Promise<CodexModel[]> {
  const response = await fetch(`${KUAIFAN_CODEX_BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new Error(`Model discovery failed (${response.status})`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : payload.data ?? payload.models ?? [];
}
```

- [ ] **Step 4: Run focused frontend and Rust tests**

Run:

```powershell
node --test web/tests/codexApi.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: both commands exit 0.

- [ ] **Step 5: Commit the provider slice**

Run:

```powershell
git add src-tauri/src/commands/codex.rs web/src/services/codexApi.ts web/tests/codexApi.test.mjs
git commit -m "feat: configure codex through Kuaifan API"
```

### Task 4: Integrate Codex module entry and installation wizard

**Files:**
- Modify: `web/src/components/ModuleCardsModal.tsx`
- Modify: `web/src/modules/registry.ts`
- Modify: `web/src/pages/WizardPage.tsx`
- Create: `web/src/components/wizard/CodexInstall.tsx`
- Create: `web/tests/codexModuleRouting.test.mjs`
- Modify: `web/tests/openclawQuickBind.test.mjs` only to add a non-regression assertion if its existing contract covers module routing
- Modify: `web/tests/hermesProtocol.test.mjs` only to add a non-regression assertion if its existing contract covers module routing
- Test: `web/tests/codexModuleRouting.test.mjs`

- [ ] **Step 1: Write a failing routing test**

Assert that Codex is available and that its card routes to the wizard only when the returned `installed` value is false:

```javascript
test('makes Codex available and routes an uninstalled machine to its wizard', async () => {
  const source = await readFile(new URL('../src/components/ModuleCardsModal.tsx', import.meta.url), 'utf8');
  assert.match(source, /key:\s*"codex"[\s\S]*available:\s*true/);
  assert.match(source, /get_codex_install_status/);
  assert.match(source, /\/wizard\?module=\$\{module\.key\}/);
});
```

Add immutable-module assertions that the existing OpenClaw and Hermes IDs remain available and their original installer command strings remain present:

```javascript
assert.match(registrySource, /openclaw:\s*\{[^}]*available:\s*true/);
assert.match(registrySource, /hermes:\s*\{[^}]*available:\s*true/);
assert.match(installerSource, /install_openclaw/);
assert.match(runtimeSource, /install_hermes_runtime/);
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test web/tests/codexModuleRouting.test.mjs
```

Expected: assertion failure because Codex is currently unavailable.

- [ ] **Step 3: Implement Codex card and wizard**

Make Codex available in both module registries. Implement `CodexInstall` with three rendered states: ready-to-install, installer-running, and installed. Poll `get_codex_install_status` every two seconds while the installer is running, stop the timer on unmount, display the resolved bundled package name, and invoke `onNext()` only after a fresh `installed` probe succeeds. Add the Codex wizard entry without a generic environment-check step because ChatGPT installation is the only required dependency for this release.

- [ ] **Step 4: Run the routing test**

Run:

```powershell
node --test web/tests/codexModuleRouting.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit the wizard slice**

Run:

```powershell
git add web/src/components/ModuleCardsModal.tsx web/src/modules/registry.ts web/src/pages/WizardPage.tsx web/src/components/wizard/CodexInstall.tsx web/tests/codexModuleRouting.test.mjs
git commit -m "feat: add Codex installation wizard"
```

### Task 5: Build the native Codex observation console

**Files:**
- Create: `web/src/pages/CodexPage.tsx`
- Create: `web/src/components/codex/CodexModuleNav.tsx`
- Create: `web/src/components/codex/CodexOverview.tsx`
- Create: `web/src/components/codex/CodexProviderPanel.tsx`
- Modify: `web/src/pages/HomePage.tsx`
- Modify: `web/src/components/icons.tsx`
- Create: `web/tests/codexPage.test.mjs`
- Test: `web/tests/codexPage.test.mjs`

- [ ] **Step 1: Write a failing page contract test**

Assert that the page includes every preserved functional domain and uses the Kuaifan provider client:

```javascript
test('Codex console exposes the preserved Codex++ functional domains', async () => {
  const source = await readFile(new URL('../src/pages/CodexPage.tsx', import.meta.url), 'utf8');
  for (const label of ['供应商与模型', 'MCP、Skills 与插件', '会话与工作区', '增强与外观', '启动与维护', '诊断与日志']) {
    assert.ok(source.includes(label));
  }
  assert.match(source, /fetchCodexModels/);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
node --test web/tests/codexPage.test.mjs
```

Expected: module-not-found failure for `CodexPage.tsx`.

- [ ] **Step 3: Implement native console components**

Render Codex inside `HomePage` when `activeModule === 'codex'`. Use existing `--cx-*` tokens, existing SVG icon components, a stable 208 px module navigation column, a responsive two-column overview grid, disabled primary controls during async work, and `aria-live="polite"` status feedback. The provider panel must show the fixed Kuaifan endpoint, a password input, a model selector only after model discovery, explicit save and launch actions, plus retryable inline errors.

All original Codex++ areas appear in navigation with capability cards identifying the command-family migration boundary. Each page must be routable inside `CodexPage` state and preserve the user's selected section when the overview refreshes.

- [ ] **Step 4: Run the page contract test**

Run:

```powershell
node --test web/tests/codexPage.test.mjs
```

Expected: pass.

- [ ] **Step 5: Commit the native console slice**

Run:

```powershell
git add web/src/pages/CodexPage.tsx web/src/components/codex web/src/pages/HomePage.tsx web/src/components/icons.tsx web/tests/codexPage.test.mjs
git commit -m "feat: add native Codex observation console"
```

### Task 6: Write Codex configuration and launch application

**Files:**
- Modify: `src-tauri/src/commands/codex.rs`
- Modify: `web/src/services/codexApi.ts`
- Modify: `web/src/components/codex/CodexProviderPanel.tsx`
- Test: inline Rust tests in `src-tauri/src/commands/codex.rs`

- [ ] **Step 1: Write failing config serialization tests**

```rust
#[test]
fn renders_kuaifan_responses_provider_config() {
    let config = render_codex_config(&CodexProviderSettings {
        base_url: "https://kuaifanio.cn/v1".into(),
        protocol: "responses".into(),
        default_model: Some("model-a".into()),
        api_key: "sk-test".into(),
    });
    assert!(config.contains("https://kuaifanio.cn/v1"));
    assert!(config.contains("model-a"));
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml codex::tests::renders_kuaifan_responses_provider_config -- --nocapture
```

Expected: failure because `render_codex_config` does not exist.

- [ ] **Step 3: Implement configuration and launcher commands**

Write the provider configuration to the Codex user configuration location using an atomic temporary-file rename. Preserve unrelated TOML entries. Add a launch command that first requires a successful application probe, writes configuration, launches the discovered executable with no hidden secrets in command-line arguments, and returns safe launch metadata.

- [ ] **Step 4: Run the focused Rust tests**

Run:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml codex::tests -- --nocapture
```

Expected: pass.

- [ ] **Step 5: Commit launch behavior**

Run:

```powershell
git add src-tauri/src/commands/codex.rs web/src/services/codexApi.ts web/src/components/codex/CodexProviderPanel.tsx
git commit -m "feat: configure and launch Codex"
```

### Task 7: Version, quality gates, and NSIS observation package

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/Cargo.toml` only if its package version must match Tauri configuration
- Modify: `web/package.json` only if its published version must match release version
- Test: all relevant frontend and Rust tests; production build; NSIS artifact inspection

- [ ] **Step 1: Write a failing release metadata test**

Create `web/tests/codexReleaseMetadata.test.mjs` asserting `tauri.conf.json` carries `1.0.74` and its resource list includes `bundled-codex/*`.

- [ ] **Step 2: Run the metadata test and verify it fails**

Run:

```powershell
node --test web/tests/codexReleaseMetadata.test.mjs
```

Expected: failure while the version is `1.0.73`.

- [ ] **Step 3: Set the release version and build**

Set all release version locations to `1.0.74`, then run:

```powershell
npm --prefix web test
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix web run build
cargo tauri build --manifest-path src-tauri/Cargo.toml --bundles nsis
```

Expected: each command exits 0 and the NSIS installer is emitted beneath `src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 4: Verify the artifact contains the installer resource**

Run:

```powershell
Get-ChildItem 'src-tauri\target\release\bundle\nsis' -Filter '*.exe' | Select-Object FullName,Length
Test-Path 'src-tauri\bundled-codex\ChatGPT Installer.exe'
```

Expected: one or more release installers and `True` for the bundled ChatGPT installer source resource.

- [ ] **Step 5: Commit the release**

Run:

```powershell
git add src-tauri/tauri.conf.json src-tauri/Cargo.toml web/package.json web/tests/codexReleaseMetadata.test.mjs
git commit -m "release: build Kuaifan Claw 1.0.74"
```
