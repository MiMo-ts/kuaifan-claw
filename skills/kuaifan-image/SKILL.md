---
name: kuaifan-image
description: Use when the user explicitly asks to create, draw, generate, edit, restyle, or transform an image through Kuaifan, including Chinese requests such as 生图, 图纸, 画图, 绘图, 使用豆包生图, or 请使用豆包帮我生成一张图片.
---

# Kuaifan Image

Use this Skill only when the user explicitly asks for a visual result. Triggers
include `生图`, `生成图片`, `图纸`, `生成图纸`, `画图`, `绘图`, `海报`, `插画`,
`配图`, `人物三视图`, `角色设定图`, `改图`, `修图`, `图生图`, `/生图`, `/image`,
and `/draw`.

Treat an explicit Doubao request as an image request when it asks for a visual
result. Invoke this Skill for `使用豆包生图`, `请使用豆包帮我生成一张...`,
`请用豆包画一张...`, and `使用豆包生成图纸...`. The normal chat model remains
responsible for requests that merely mention Doubao without asking to generate,
draw, edit, or transform an image.

Do not use it for text-only requests, image analysis, or ambiguous requests.

## Configuration

The user configures the Kuaifan Provider URL and API Key once in the
application's model settings. The normal chat model remains a text model;
this Skill uses the image endpoint directly and defaults to
`doubao-seedream-5-0-pro-260628`. Use `--model` only when an explicit image
model override is requested.

The client reads the active runtime configuration. `KUAIFAN_API_KEY` and
`KUAIFAN_PROVIDER_ID` are deployment-only overrides. Never put API keys in a
prompt, command argument, tool result, or response.

## Generate

Run the bundled client without choosing an output filename. It allocates a
path under the active runtime's managed media directory.

Resolve `<SKILL_DIR>` to the absolute directory containing the `SKILL.md` path
from the current `<available_skills>` entry. Invoke the script by its absolute
path exactly as shown below. Do not change directories or chain shell commands;
Windows PowerShell 5.1 does not support command patterns copied from `cmd.exe`.

```powershell
python "<SKILL_DIR>\scripts\kuaifan_image.py" --runtime openclaw --prompt "product advertisement poster, commercial photography" --size "1024x1024"
```

The client calls `<baseUrl>/images/generations` with `n=1`.

When a Hermes desktop user explicitly asks to save the generated image to a
local directory, pass that directory with `--export-dir`. The image still
generates into the runtime-managed cache; the tool result carries only an
export suggestion and the desktop application asks the user to confirm the
final file location. Never use `--output` to target an arbitrary directory.

```powershell
python "<SKILL_DIR>\scripts\kuaifan_image.py" --runtime hermes --prompt "product advertisement poster" --export-dir "D:\designs"
```

## Edit Or Image-To-Image

Pass each normalized local attachment or public image URL as one `--source`
argument. The client calls `<baseUrl>/images/edits` with JSON, `n=1`, and an
`image` array of Base64 data URLs.

```powershell
python "<SKILL_DIR>\scripts\kuaifan_image.py" --runtime hermes --prompt "keep the product shape and make an ecommerce hero image on white" --source "C:\temp\reference.png"
```

## Output Contract

On success, the client prints one versioned JSON artifact. For OpenClaw it
then prints one standalone `MEDIA:<absolute-path>` line. Hermes receives only
the JSON artifact; its managed gateway adapter converts `image_path` into one
native image attachment.

```json
{
  "artifact": "kuaifan-image/v1",
  "mode": "text_to_image",
  "image_path": "C:/managed/media/kuaifan-image/result.png",
  "image_url": null,
  "export_dir": "D:/designs",
  "request_id": "upstream-request-id"
}
```

OpenClaw consumes its single `MEDIA:` line through the existing outbound media
pipeline. Hermes validates only this versioned artifact from current-turn tool
results, then sends the resulting image through its existing channel media
implementation. The JSON artifact never embeds a second `MEDIA:` value. Do
not manually upload to individual channel plugins.

On error, the client writes one safe JSON error object to stderr. It retries a
429 response once and never falls back to `/chat/completions`.
