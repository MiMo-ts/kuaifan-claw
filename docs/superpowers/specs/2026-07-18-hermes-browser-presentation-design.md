# Hermes Browser Presentation Design

**Goal:** Hermes uses a visible bundled Chromium only for interactive browser tasks, while background research continues to use headless Chromium.

## Scope

This change affects only the local Hermes browser path:

`browser_tool.py -> agent-browser compatibility shim -> cdp_browser_cli.py -> cdp_browser.py -> bundled Chromium`

It does not change OpenClaw, platform connectors, model configuration, GUI chat transport, cloud browser providers, or an externally supplied `BROWSER_CDP_URL` browser.

## Mode Selection

The browser navigation tool exposes a mode enum:

- `interactive`: Use a visible desktop Chromium window.
- `background`: Use a headless Chromium process.

The tool description instructs the agent to use `interactive` when the task requires login, typing, clicking, editing, submitting, an online document or table, or when the user explicitly asks to open a browser. It instructs the agent to use `background` for research, reading, searching, extraction, crawling, screenshots, and summaries.

`background` remains the default when the agent does not specify a mode. This prevents unrelated data gathering tasks from creating desktop windows.

## Session Behavior

Hermes maintains a separate headed browser session when one agent task needs interactive work:

- The existing task session (`task_id`, or upstream `task_id::local` for a cloud-provider private URL) remains the background route for research and extraction.
- `task_id::interactive` is a new headed local session used for login, editing, publishing, and other user-visible actions.

The implementation follows Hermes upstream's existing derived-session-key pattern used for cloud-plus-local routing. A successful navigation records its concrete session key as the task's most recently active browser. Later click, fill, snapshot, vision, and close commands reuse that recorded key.

Changing from background research to an interactive publishing task creates or reuses `task_id::interactive`; it does not close the existing background session. Changing back to background work reuses the upstream-selected background route. The two profiles do not share cookies or storage. Login must occur in the interactive session.

`background` preserves the upstream backend choice: local Chromium remains headless, a configured cloud provider remains cloud-hosted, and an external CDP endpoint remains attached. Only `interactive` forces the bundled local headed Chromium session. This avoids changing existing cloud-browser and external-CDP behavior.

## Launch Behavior

The Tauri launcher must not set `KFC_BROWSER_HEADED` globally. Global configuration cannot express the required per-task policy and would make background research visible.

For a local interactive session, `browser_tool.py` appends `--headed` to the already existing `agent-browser` compatibility command. `cdp_browser_cli.py` converts that option into the process-local headed setting. The CDP driver starts Chromium without `--headless` and includes `--start-maximized` plus a fixed initial window size.

For a background session, the tool passes no headed argument. The driver adds `--headless=new`.

Environment boolean parsing accepts only `1`, `true`, `yes`, or `on` as enabled values. In particular, `KFC_BROWSER_HEADED=0` must remain headless.

## Observability And Errors

Every local browser navigation response includes `browser_mode` with either `interactive` or `background`. On the first command that creates a local Chromium process, the response also includes the browser process ID when it is available.

Hermes logs the selected mode, task session key, browser session name, and Chromium PID. Logs never include page content, credentials, cookies, URLs containing secrets, or tool input text.

If interactive launch fails, the command returns an error. It must not fall back silently to headless mode because that would falsely claim that a visible browser was opened.

## Testing And Acceptance

Add focused unit tests for mode normalization, session-mode latching, invalid mode changes, strict environment parsing, and command construction. Add a Windows integration script that uses the installed compatibility shim and verifies:

1. An interactive navigation starts bundled Chromium without `--headless`, with a non-zero main window handle, and returns `browser_mode: "interactive"`.
2. A background navigation starts bundled Chromium with `--headless=new`, has no visible main window, and returns `browser_mode: "background"`.
3. A follow-up `browser_type` or `browser_click` uses the original interactive session.
4. The existing background session remains alive after creating an interactive session, and a subsequent background navigation reuses it.
5. Closing a bare task ID reaps both derived sessions without touching any other task.
6. Existing Hermes protocol and GUI tests continue to pass.

## Rollback

The change is isolated to Hermes runtime files and the generated offline browser bundle. Reverting the corresponding Hermes files and browser bundle version restores the previous behavior without touching user configuration, OpenClaw data, or installed platform instances.
