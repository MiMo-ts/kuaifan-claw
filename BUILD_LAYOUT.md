# Build Layout

The repository has three independent work areas.

| Area | Source and command | Output | Purpose |
| --- | --- | --- | --- |
| Development | `web/src`, `src-tauri/src`, `dev.bat` | `web/dist`, `src-tauri/target/debug` | Local Tauri development and hot reload. |
| Testing | `web/tests`, `src-tauri/tests`, `scripts/test-project.ps1` | `artifacts/test` | Unit and integration-style checks. Test output is never packaged. |
| Release | `src-tauri/build-all.ps1`, `build-win.bat` | `artifacts/release/<version>` | Distributable NSIS installers plus SHA-256 manifest. |

## Commands

```powershell
# Development
.\dev.bat

# Tests only
.\scripts\test-project.ps1

# Release: runs tests first, then builds and stages installers
.\src-tauri\build-all.ps1
```

`src-tauri/target` and `web/dist` are compiler work directories. Do not distribute files directly from them. Distribute only the installers in `artifacts/release/<version>` after checking `manifest.json`.

The release build consumes the official `src-tauri/bundled-openclaw/openclaw.tgz` package. No `openclaw-cn` package is substituted by this workflow.
