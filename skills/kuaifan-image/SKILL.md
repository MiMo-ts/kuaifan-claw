---
name: kuaifan-image
description: Use when the user explicitly asks to create, draw, generate, edit, restyle, or transform an image, poster, illustration, cover, product image, character turnaround, or three-view through Kuaifan. Supports text-to-image and image-to-image from attachments, public URLs, and local paths in Hermes and OpenClaw.
---

# Kuaifan Image

Use this Skill only for visual output. Explicit triggers include `生图`, `画图`, `绘图`, `海报`, `插画`, `配图`, `人物三视图`, `角色设定图`, `改图`, `修图`, `图生图`, `/生图`, `/image`, and `/draw`.

Do not use it for text-only requests such as 文案、文章、方案、代码、表格、提示词、图片分析，or for an ambiguous request. Ask whether the user wants an image when the desired artifact is unclear.

## Generate

Run the bundled client. It reads the Kuaifan Key from the active runtime's model configuration: OpenClaw uses its configured provider and Hermes uses `config.yaml` provider settings. `KUAIFAN_API_KEY` may override this only for service deployments. Never put a Key in this file, a prompt, a command argument, or a response.

```powershell
python scripts/kuaifan_image.py --runtime openclaw --prompt "包包广告海报，商业摄影" --size "1024x1024" --output "$env:TEMP\kuaifan-image.png"
```

The client uses `/images/generations` with `n=1`. Read its JSON output and return the `image_path` as an image attachment. Also return `image_url` when present.

## Edit Or Image-To-Image

For each normalized chat attachment, public image URL, or user-supplied local image path, pass one `--source` argument. The client sends a multipart `/images/edits` request with `n=1`.

```powershell
python scripts/kuaifan_image.py --runtime hermes --prompt "保留包型，改为白底电商主图" --source "C:\temp\reference.png" --output "$env:TEMP\kuaifan-edit.png"
```

Hermes and OpenClaw channel adapters must download channel attachments before invoking this command. On success, upload `image_path` to the originating chat. If a channel cannot upload the file, send `image_url` instead.

## Failure Handling

The client retries only HTTP 429 once, then returns a structured error. Do not submit parallel retries. For a rate-limit error, tell the user that the Kuaifan image-model quota is busy and retry only after the reported wait window.
