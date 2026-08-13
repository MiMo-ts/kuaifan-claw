# Codex Native Runtime Design

## Goal

Make the Codex module a self-contained fastclaw surface that lists the full fastfan model catalog, saves a selected fastfan configuration, and starts `codex-plus-plus.exe` without changing OpenClaw or Hermes behavior.

## Boundaries

- The new frontend is `web/src/pages/CodexPage.tsx` and is rendered only when the active module is `codex`.
- New backend behavior lives in `src-tauri/src/commands/codex_runtime.rs`.
- `commands/mod.rs` and `main.rs` change only to declare and register those Codex-specific commands.
- No OpenClaw/Hermes gateway, instance, provider, session, installer, or UI source is changed.

## Runtime Flow

1. The page calls the existing `list_models(providerId: "kuaifan")` command, which reads the public `https://kuaifanio.cn/api/pricing` catalog. The UI displays the returned count and filters the in-memory results locally.
2. The user selects a model and supplies a fastfan key. The existing `kuaifan` browser key is reused so other fastclaw Kuaifan entry points remain consistent.
3. `save_and_launch_codex_kuaifan` validates the request, creates a timestamped backup under `~/.codex/backups/kuaifanclaw-*`, and atomically updates only the required Codex provider fields in `config.toml` and `auth.json`.
4. The command also upserts only the `kuaifan` Codex++ relay profile in `~/.codex-session-delete/settings.json`, selects it, and sets relay mode so `codex-plus-plus.exe` starts its Chat Completions protocol adapter for `https://kuaifanio.cn/v1`.
5. The command starts `codex-plus-plus.exe`; its status response reports runtime availability, start request status, configuration status, paths, and selected model without returning the API key.

## Error Handling

- The full catalog can load without an API key; save/start requires a nonempty key and selected model.
- A malformed existing `config.toml`, `auth.json`, or Codex++ settings file fails before any write; files are not replaced with generated defaults.
- All configuration writes are preceded by a timestamped backup. Any failure after the backup returns a localized error and the backend leaves the original files intact.
- Missing `codex-plus-plus.exe` returns a status/error with the resolved candidate path. It never tries to start OpenClaw or Hermes as a fallback.
- API keys are never returned in command payloads or added to diagnostics.

## Tests

- Rust unit tests cover config merging, backup creation, Codex++ profile upsert, launcher candidate resolution, and no-secret status serialization.
- Frontend source tests prove the Codex page uses `list_models` instead of direct `/v1/models` fetching, exposes model count/search, and calls the save-and-launch command.
- Full existing frontend and Rust test suites, build, and a manual packaged-app launch exercise are run before packaging.
