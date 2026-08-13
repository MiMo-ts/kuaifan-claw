# Kuaifan Managed Image Skill Design

## Goal

Ship `kuaifan-image` in the NSIS installer so OpenClaw and Hermes discover it
without a network download, use the configured Kuaifan provider and default
Seedream model for image requests, and return generated images as native
channel attachments.

The user configures the Kuaifan provider URL and API key once. The ordinary
chat model remains a text/chat model; Seedream is selected only by the Skill's
image request client.

## Non-Goals

- Do not add the image model to the ordinary chat-model picker.
- Do not create per-channel image upload implementations for Feishu, QQ,
  WeChat, WeCom, or WXWork.
- Do not patch compiled files inside `bundled-openclaw/openclaw.tgz`.
- Do not bundle a Python virtual environment. The Skill uses only the Python
  standard library and the application already ships Python for Hermes.
- Do not overwrite user-managed Skill directories during an application update.

## Existing Runtime Contracts

### OpenClaw

OpenClaw discovers external Skills through `skills.load.extraDirs`. Its bundled
reply-payload implementation already parses `MEDIA:<path>` directives into
`mediaUrl` / `mediaUrls`, then its existing channel pipeline normalizes and
uploads the local file. No channel-specific adapter is needed.

### Hermes

Hermes discovers external Skills through `skills.external_dirs`. Its platform
base class already parses `MEDIA:<path>`, validates the path, and routes images
through `send_image_file`.

Hermes currently auto-appends media from only approved producer-tool results.
The Kuaifan Skill is executed through a shell/tool call, so it needs a narrow
Kuaifan-specific collector rather than broadening the generic shell-tool
allowlist.

## Architecture

```text
NSIS resources/bundled-skills/kuaifan-image
                    |
                    v
  idempotent bootstrap into <app-data>/bundled-skills/kuaifan-image
                    |
          +---------+---------+
          |                   |
          v                   v
OpenClaw extraDirs      Hermes external_dirs
          |                   |
          +---------+---------+
                    |
                    v
  kuaifan_image.py -> structured artifact result + MEDIA:<absolute path>
                    |
          +---------+---------+
          |                   |
          v                   v
OpenClaw reply payload   Hermes Kuaifan collector
          |                   |
          +---------+---------+
                    |
                    v
Existing channel media upload/send implementation
```

## Managed Skill Packaging

The canonical distributable Skill source lives at:

`src-tauri/resources/bundled-skills/kuaifan-image/`

It contains `SKILL.md`, the image client scripts, and a
`bundle-manifest.json` with the managed revision and content digest. Tests
remain in the source tree and are not copied into the runtime resource.
`tauri.conf.json` includes
`resources/bundled-skills` in `bundle.resources`.

At application startup and before either agent runtime starts, an idempotent
bootstrap service copies the bundled Skill to:

`<app-data>/bundled-skills/kuaifan-image/`

The bootstrap uses a package manifest containing a schema version and content
digest. It copies to a staging directory and atomically promotes the staged
directory only after validation. It only owns this managed destination; user
Skills continue to live in their existing directories and are never removed or
overwritten.

On an application update, the service replaces only the previous managed
Kuaifan Skill after validating the new manifest. It updates only its own
configuration entries, preserving every unrelated `extraDirs` entry.

## Runtime Discovery

### OpenClaw

The bootstrap adds the managed Skill root, not an individual Skill directory,
to the active OpenClaw configuration:

```json
{
  "skills": {
    "load": {
      "extraDirs": ["<app-data>/bundled-skills"]
    }
  }
}
```

This makes `kuaifan-image/SKILL.md` available globally and avoids the current
robot-store download path. Robot templates may recommend the Skill, but they
must not be required for its availability.

### Hermes

The bootstrap adds the same managed root to the Hermes configuration belonging
to the active `HERMES_HOME`:

```yaml
skills:
  external_dirs:
    - <app-data>/bundled-skills
```

The application must update the actual sidecar configuration through the
existing Hermes configuration projection path, rather than relying only on a
developer checkout or on a guessed `%LOCALAPPDATA%` location.

The provisioning test must start the real sidecar environment and assert that
both runtimes list `kuaifan-image` after a clean, offline install.

## Invocation and Model Configuration

`kuaifan_image.py` reads the Kuaifan provider's `baseUrl` and API key from the
active runtime configuration and appends `/images/generations` or
`/images/edits`. Its default model remains:

`doubao-seedream-5-0-pro-260628`

The command supports `--model` only as an explicit override. Runtime detection
must prefer the actual process environment (`HERMES_HOME` for Hermes and the
OpenClaw configuration/state environment for OpenClaw), rather than trying an
unrelated local configuration first.

The client must allocate its own image output path under a runtime-managed
media directory. In Hermes this is an allowlisted cache image directory under
`HERMES_HOME`; OpenClaw uses its configured state/media root. The model must
not choose arbitrary output paths.

If no Kuaifan provider or API key is configured, the Skill remains visible but
returns a concise configuration error. It must not fall back to a chat
completion endpoint or attempt to use the selected chat model.

## Artifact and Media Contract

On success the client emits one JSON object with this minimum contract:

```json
{
  "artifact": "kuaifan-image/v1",
  "mode": "text_to_image",
  "image_path": "C:/managed/media/kuaifan-image/result.png",
  "image_url": null,
  "media_marker": "MEDIA:C:/managed/media/kuaifan-image/result.png",
  "request_id": "upstream-request-id"
}
```

The `image_path` is absolute, exists, has a supported image extension, and is
inside the managed output root. The client also emits the `MEDIA:` directive
as an unquoted standalone result line so OpenClaw's existing media parser can
turn it into an outbound media payload.

Hermes adds a dedicated collector beside its existing media auto-append logic.
It scans only current-turn tool results and accepts only JSON values where:

- `artifact` equals `kuaifan-image/v1`;
- the path exists and has an allowed image extension;
- the resolved path is within the Kuaifan managed media root; and
- the path was not delivered in a prior turn.

The collector appends the `media_marker` to the final response when the model
did not emit one itself. This gives deterministic native media delivery without
trusting arbitrary shell output or requiring the model to repeat a local path.

## Security and Failure Behavior

- Never expose API keys in Skill output, logs, prompts, or command arguments.
- Continue to validate all media paths at the existing runtime boundary.
- Do not accept an artifact marker from a non-tool conversation message.
- Permit only the Kuaifan managed media root in the new Hermes collector.
- Retry only an upstream HTTP 429 once, with the current bounded retry policy.
- If local upload fails and an upstream `image_url` exists, use the runtime's
  existing URL/media fallback; otherwise send a clear failure message without
  exposing the local path.
- Use a content digest and staging promotion to avoid partial updates.

## Test Matrix

1. Package test: the NSIS resource manifest contains the bundled Skill source.
2. Bootstrap test: a clean, offline data directory receives the managed Skill
   and preserves an unrelated user Skill and configuration entry.
3. Discovery test: a clean OpenClaw configuration resolves the Skill from
   `skills.load.extraDirs`; a Hermes sidecar configuration resolves it from
   `skills.external_dirs`.
4. Client test: configured Kuaifan provider uses `/images/generations` for
   text-to-image and `/images/edits` for image-to-image, with the default
   Seedream model and no key leakage.
5. Contract test: a successful client result contains a valid managed absolute
   path and `MEDIA:` marker; malformed, nonexistent, or outside-root paths are
   rejected.
6. Hermes integration test: a current-turn Kuaifan tool result produces one
   `MEDIA:` directive, duplicates are suppressed, and unrelated terminal output
   cannot create an attachment.
7. OpenClaw contract test against the packaged runtime: a `MEDIA:` directive
   becomes an outbound `mediaUrls` payload without modifying a channel plugin.
8. Channel smoke tests: one local PNG reaches the Feishu, QQ, and WeChat
   adapter boundary as native media, not as a text URL.
9. Upgrade test: a new managed revision replaces only the managed Skill and
   keeps user Skill roots and user configuration intact.

## Delivery Order

1. Land the canonical Kuaifan Skill and its artifact contract tests.
2. Add packaging and managed bootstrap with discovery tests.
3. Add the Hermes collector, rebuild `bundled-hermes/hermes-agent.zip`, and
   test native media delivery.
4. Verify the packaged OpenClaw media contract without patching its tarball.
5. Run offline install, upgrade, and channel smoke tests before release.
