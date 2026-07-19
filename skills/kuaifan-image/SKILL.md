---
name: kuaifan-image
description: Use when the user explicitly asks to create, draw, generate, edit, restyle, or transform an image through Kuaifan. Supports text-to-image and image-to-image from local attachments or public URLs.
---

# Kuaifan Image

Use this Skill only when the user explicitly asks for a visual result. Triggers
include `生图`, `画图`, `绘图`, `海报`, `插画`, `配图`, `人物三视图`, `角色设定图`,
`改图`, `修图`, `图生图`, `/生图`, `/image`, and `/draw`.

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

```powershell
python scripts/kuaifan_image.py --runtime openclaw --prompt "product advertisement poster, commercial photography" --size "1024x1024"
```

The client calls `<baseUrl>/images/generations` with `n=1`.

## Edit Or Image-To-Image

Pass each normalized local attachment or public image URL as one `--source`
argument. The client calls `<baseUrl>/images/edits` with multipart form data
and `n=1`.

```powershell
python scripts/kuaifan_image.py --runtime hermes --prompt "keep the product shape and make an ecommerce hero image on white" --source "C:\temp\reference.png"
```

## Output Contract

On success, the client prints one JSON object followed by one standalone
`MEDIA:<absolute-path>` line:

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

OpenClaw consumes the `MEDIA:` line through its existing outbound media
pipeline. Hermes validates only this versioned artifact from current-turn tool
results, then sends the resulting image through its existing channel media
implementation. Do not manually upload to individual channel plugins.

On error, the client writes one safe JSON error object to stderr. It retries a
429 response once and never falls back to `/chat/completions`.
