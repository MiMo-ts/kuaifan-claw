# Hermes Dual Browser Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run Hermes research in a headless bundled Chromium session while creating a separate, visible bundled Chromium session for login, publishing, and web-app editing in the same agent task.

**Architecture:** Add pure presentation-mode helpers and use a derived `task_id::interactive` key in the existing Hermes browser registry. `browser_navigate(mode="background")` retains the upstream route, while `browser_navigate(mode="interactive")` uses the dedicated visible local session. Non-navigation commands continue to use the established last-active-session binding.

**Tech Stack:** Python 3.11, Hermes browser tool, agent-browser compatibility shim, bundled Playwright Chromium, Rust/Tauri runtime launcher, NSIS packaging.

---

### Task 1: Define And Test Presentation Helpers

**Files:**
- Create: `src-tauri/runtimes/hermes/tools/browser_presentation.py`
- Create: `scripts/test_hermes_browser_presentation.py`

- [ ] **Step 1: Write the failing helper test**

```python
assert presentation.normalize_mode(None) == presentation.BACKGROUND_MODE
assert presentation.normalize_mode("interactive") == presentation.INTERACTIVE_MODE
assert presentation.interactive_session_key("task-1") == "task-1::interactive"
assert presentation.background_session_key("task-1") == "task-1::background"
assert presentation.owner_task_id("task-1::interactive") == "task-1"
assert presentation.owner_task_id("task-1::background") == "task-1"
```

- [ ] **Step 2: Run the test and verify it fails because the helper module is absent**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: `ModuleNotFoundError` for `browser_presentation`.

- [ ] **Step 3: Implement the pure helper module**

```python
BACKGROUND_MODE = "background"
INTERACTIVE_MODE = "interactive"

def normalize_mode(value: str | None) -> str:
    if value in (None, BACKGROUND_MODE):
        return BACKGROUND_MODE
    if value == INTERACTIVE_MODE:
        return INTERACTIVE_MODE
    raise ValueError("browser mode must be 'background' or 'interactive'")
```

Implement `background_session_key`, `interactive_session_key`, `is_derived_session_key`, and `owner_task_id` using the same two suffixes.

- [ ] **Step 4: Run the helper test and verify it passes**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: exit code `0` and `presentation helper tests passed`.

### Task 2: Route Navigation Into Two Local Sessions

**Files:**
- Modify: `src-tauri/runtimes/hermes/tools/browser_tool.py:1265-1348`
- Modify: `src-tauri/runtimes/hermes/tools/browser_tool.py:2010-2098`
- Modify: `src-tauri/runtimes/hermes/tools/browser_tool.py:2769-2920`
- Test: `scripts/test_hermes_browser_presentation.py`

- [ ] **Step 1: Extend the failing test with browser-tool routing assertions**

```python
interactive = run_navigation(mode="interactive")
background = run_navigation(mode="background")
assert interactive["session_key"] == "task-1::interactive"
assert interactive["command_prefix"][-1] == "--headed"
assert background["session_key"] == "task-1"
assert "--headed" not in background["command_prefix"]
```

`run_navigation` patches only network/provider calls and captures `_run_browser_command` arguments. It must exercise the real `browser_navigate` routing logic.

- [ ] **Step 2: Run the test and verify it fails because `browser_navigate` has no `mode` argument**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: `TypeError` stating that `browser_navigate` does not accept `mode`.

- [ ] **Step 3: Add presentation mode to the tool schema and navigation function**

```python
def browser_navigate(
    url: str,
    task_id: Optional[str] = None,
    mode: str = "background",
) -> str:
```

Validate `mode` with `normalize_mode`. Document that `interactive` is required for login, typing, clicking, editing, submitting, online documents, online tables, and an explicit user request to open a browser. Document that `background` is for research, search, extraction, crawling, screenshots, and summaries.

Use `task_id::interactive` as the concrete local session key for visible work. Extend the existing local-sidecar predicate into a forced-local predicate so the interactive key bypasses cloud-provider and external-CDP creation. Preserve the current background route and the existing `::local` key behavior for upstream cloud/private-URL routing.

- [ ] **Step 4: Pass `--headed` only for interactive local sessions**

```python
if session_info.get("browser_mode") == "interactive" and not session_info.get("cdp_url"):
    backend_args.append("--headed")
```

Set `browser_mode` when creating each forced local session. Add `browser_mode` to the successful navigation response. Do not add a headed flag to cloud, Camofox, or externally supplied CDP sessions.

- [ ] **Step 5: Run the routing test and verify it passes**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: exit code `0`, with the interactive and background session assertions passing.

### Task 3: Preserve Two Sessions And Clean Them Up Safely

**Files:**
- Modify: `src-tauri/runtimes/hermes/tools/browser_tool.py:1315-1348`
- Modify: `src-tauri/runtimes/hermes/tools/browser_tool.py:4262-4388`
- Test: `scripts/test_hermes_browser_presentation.py`

- [ ] **Step 1: Add failing coexistence and cleanup tests**

```python
assert active_sessions["task-1"] is background_session
assert active_sessions["task-1::interactive"] is interactive_session
assert last_active_session_key["task-1"] == "task-1::interactive"

cleanup_browser("task-1")
assert "task-1" not in active_sessions
assert "task-1::interactive" not in active_sessions
```

- [ ] **Step 2: Run the test and verify it fails because bare-task cleanup only handles the legacy `::local` sidecar**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: assertion failure showing an interactive or background session remains tracked.

- [ ] **Step 3: Extend ownership and cleanup over both presentation suffixes**

Use the presentation helper for session ownership. When `cleanup_browser` receives a bare task ID, enumerate the bare key, legacy `::local`, and `::interactive` keys that are active. When it receives a derived interactive key, clean only that key and clear the last-active binding only when it points to that key.

- [ ] **Step 4: Run the full presentation test script and verify it passes**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: exit code `0` and all helper, routing, coexistence, and cleanup assertions pass.

### Task 4: Remove The Global Headed Override And Package The Runtime

**Files:**
- Modify: `src-tauri/src/commands/runtime.rs:929-959`
- Modify: `src-tauri/bundled-hermes/hermes-agent.zip`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `web/package.json`

- [ ] **Step 1: Add a failing launcher source assertion**

Add to `scripts/test_hermes_browser_presentation.py`:

```python
runtime_source = Path("src-tauri/src/commands/runtime.rs").read_text(encoding="utf-8")
assert 'cmd.env("KFC_BROWSER_HEADED", "1")' not in runtime_source
```

- [ ] **Step 2: Run the test and verify it fails on the global headed override**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: assertion failure containing `KFC_BROWSER_HEADED`.

- [ ] **Step 3: Remove the global browser-mode injection**

Keep `HERMES_HOME`, `PATH`, `PLAYWRIGHT_BROWSERS_PATH`, `AGENT_BROWSER_EXECUTABLE_PATH`, `HERMES_OFFLINE_BROWSER`, and the dashboard token unchanged. Remove only the unconditional `KFC_BROWSER_HEADED=1` block so presentation is selected per browser command.

- [ ] **Step 4: Update the Hermes archive and application version**

Replace `tools/browser_tool.py` inside `src-tauri/bundled-hermes/hermes-agent.zip` with the tested source version and confirm that `tools/cdp_browser_cli.py` remains present. Increment the application version consistently in `Cargo.toml`, `tauri.conf.json`, and `web/package.json` so the installer re-extracts the updated Hermes archive.

- [ ] **Step 5: Run archive and launcher assertions**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Expected: exit code `0`; the archive contains `tools/browser_tool.py`, `tools/cdp_browser.py`, and `tools/cdp_browser_cli.py`.

### Task 5: Verify The Packaged Windows Behavior

**Files:**
- Modify: `scripts/test_hermes_browser_presentation.py`
- Generated: `artifacts/release/<new-version>/...-setup.exe`

- [ ] **Step 1: Add the installed-runtime integration checks**

The script starts a temporary Hermes dashboard with a test-only provider stub, invokes one background and one interactive navigation, and reads only the Chromium parent command lines. It asserts that the background process contains `--headless=new`, the interactive process lacks that flag, and the interactive process has a non-zero `MainWindowHandle`. It closes only processes whose command line contains the test session user-data directory.

- [ ] **Step 2: Build the web bundle and NSIS installer**

Run: `npm.cmd --prefix web run build`

Run: `cmd.exe /d /c build-win.bat`

Expected: both commands exit with code `0`, and the release installer is written under `artifacts/release/<new-version>/`.

- [ ] **Step 3: Run all focused verification**

Run: `src-tauri/runtimes/hermes/python/python.exe scripts/test_hermes_browser_presentation.py`

Run: `node web/tests/hermesProtocol.test.mjs`

Run: `node web/tests/hermesThinking.test.mjs`

Expected: all commands exit with code `0`.

- [ ] **Step 4: Report the installer path, SHA-256, and scenario-test sequence**

Do not commit because the working tree contains unrelated existing changes and the user did not request a commit.
