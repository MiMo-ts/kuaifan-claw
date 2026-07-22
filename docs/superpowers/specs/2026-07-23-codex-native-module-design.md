# Codex Native Module Design

**Status:** Approved for implementation planning

## Goal

Add Codex as a first-class Kuaifan Claw module. It must provide the functional scope of Codex++, install the ChatGPT desktop application when absent, and ship in Kuaifan Claw version 1.0.74.

## Scope

The target platform is Windows because the bundled `ChatGPT Installer.exe` is a Windows installer. The Codex module is rendered inside Kuaifan Claw and does not launch the Codex++ Manager window.

## Module Boundary

Kuaifan Claw owns the module entry, routing, UI, application installation, bundled resources, diagnostics, and release packaging. Codex++ supplies the implementation reference and reusable behavior for Codex discovery, launcher configuration, provider configuration, protocol translation, extensions, session operations, enhancements, and diagnostics.

The integration introduces a Codex adapter layer in `src-tauri`. The adapter exposes focused Tauri commands to the React module rather than importing Codex++'s monolithic manager UI or registering its existing command surface directly. It stores Codex module state under Kuaifan Claw's application data directory and keeps the real Codex runtime configuration in the user Codex home, matching Codex++'s established behavior.

## User Flow

1. The user opens the module center and selects Codex.
2. The desktop backend probes the installed ChatGPT application by known Windows installation locations and uninstall registry records.
3. If absent, the user is routed to `/wizard?module=codex`.
4. The Codex wizard displays the bundled `ChatGPT Installer.exe`, starts it interactively, and polls the application probe until installation completes or the installer exits unsuccessfully.
5. A successful probe returns the user to `/home` with Codex active.
6. The Codex overview shows application status, Kuaifan API readiness, launch state, and actionable setup items.
7. The user configures the Kuaifan API key, validates it, and loads the actual model list from `https://kuaifanio.cn/v1/models`.
8. The user selects a model and launches Codex with the saved configuration.

## Kuaifan API

The two JOJO Code presets are removed from the Codex++-derived preset catalog and replaced by one `kuaifan` provider preset:

- Display name: `Kuaifan API`
- Website and API key URL: `https://kuaifanio.cn`
- Base URL: `https://kuaifanio.cn/v1`
- Protocol: OpenAI Responses
- Default model: none until the authenticated model discovery completes

The API key is never committed, logged, or embedded in the installer. Model discovery is an authenticated request to `/v1/models`; its result is persisted only as non-secret selection metadata. Existing Kuaifan stream normalization remains the single upstream-specific transport adapter.

## Native Console Information Architecture

The module has a stable left navigation and route-level lazy loading. It uses Kuaifan Claw's existing shell tokens, compact operational density, existing icon library, and semantic status patterns.

| Area | Preserved Codex++ capabilities |
| --- | --- |
| Overview | Codex application detection, version and path, launch status, quick repair, configuration readiness |
| Providers and models | Provider CRUD and presets, protocol selection, model catalog, per-model context window and compaction limits, connection testing, applying config and auth |
| Tools and automation | MCP, Skills, Plugins, user scripts, script market, watcher, upstream worktree, Zed remote projects |
| Sessions and workspaces | Local session discovery, selection, deletion, Markdown export, project assignment maintenance |
| Enhancements | Dream Skin library and market, image overlay, Stepwise, Computer Use compatibility, launch options |
| Maintenance | Entry point repair, update checks, environment conflict checks, relay status and repair |
| Diagnostics | Logs, port status, config inspection, copyable diagnostics |

No control is removed merely because it is an advanced Codex++ feature. Advanced controls are grouped in their corresponding native pages with progressive disclosure instead of being placed on the overview.

## UI Requirements

The Codex module is a dense desktop operations console:

- One primary action per page, with secondary actions visibly subordinate.
- Semantic theme tokens rather than per-component raw colors.
- Visible loading, success, error, retry, and empty states for every backend operation.
- Keyboard-accessible navigation and controls, focus indicators, labels for icon-only controls, and color-independent state indicators.
- Responsive layouts that collapse overview metrics and form columns without horizontal clipping.
- Motion is limited to 150-300 ms opacity and transform transitions and honors `prefers-reduced-motion`.

## Packaging

`src-tauri/bundled-codex/ChatGPT Installer.exe` is added to the Tauri resource bundle. The installer command resolves the resource from both the development tree and installed application resources. Version 1.0.74 includes the Codex module frontend chunks, Rust commands, and bundled Windows installer in the NSIS artifact.

## Error Handling

- Missing bundled installer: present a blocking error with the resolved resource path and no install action.
- Installer launch failure: retain the wizard page, show the OS error, and allow retry.
- Installer process exits without a successful application probe: show the installer exit outcome and a new probe action.
- API key rejected or model request fails: keep the key field editable, display the server status and a retry action, and do not select a model.
- Codex configuration write or launch failure: preserve the current form, identify the failed action, and offer diagnostics.

## Testing and Acceptance

Tests cover application path detection, resource resolution, installer state transitions, Codex module routing, Kuaifan preset replacement, authenticated model discovery behavior, and configuration serialization. Existing OpenClaw and Hermes module tests continue to pass.

The release verification runs the applicable frontend tests, Rust tests, production frontend build, and Tauri NSIS build. The artifact is checked for the ChatGPT installer resource before it is presented for observation.
