# Kuaifan Image Skill Design

## Goal

Provide one portable Skill that lets Hermes, OpenClaw desktop chat, and OpenClaw channel agents generate or edit images through Kuaifan's OpenAI-compatible image API.

## Architecture

The Skill package contains one dependency-free Python command-line client and one `SKILL.md`. The client reads the Kuaifan provider's API key and base URL from the local OpenClaw model configuration, sends text-to-image work to `/images/generations`, and sends image-to-image work to `/images/edits` using multipart form data. Both runtimes invoke the same command and receive a JSON result with a local image path and source URL.

## Credential Boundary

The command resolves credentials in this order: explicit `KUAIFAN_API_KEY` environment variable, the selected runtime's model configuration, then the runtime's safe fallback configuration. OpenClaw reads `openclaw.json` then `openclaw.json.last-good`; Hermes reads its `config.yaml` provider entry. It never prints the key or writes it to output, logs, arguments, or the Skill instructions. Provider selection prefers `KUAIFAN_PROVIDER_ID`; otherwise it selects the only provider whose base URL belongs to `kuaifanio.cn`.

## Inputs And Outputs

The command accepts a required prompt, model ID, size, output path, and zero or more image sources. Image sources may be local paths, HTTP(S) URLs, or channel attachments already normalized to local files by Hermes or OpenClaw. Zero sources means text-to-image; one or more sources means image-to-image. Successful calls write the first returned image to the requested output path and emit JSON containing `image_path`, `image_url`, and a redacted provider request ID.

## Trigger Policy

The Skill triggers only for explicit visual requests such as `生图`, `画图`, `海报`, `插画`, `人物三视图`, `改图`, and `以图生图`. It must not trigger for textual requests such as `生成文案` or `生成方案`; ambiguous requests require clarification. `/生图`, `/image`, and `/draw` always force the Skill.

## Reliability

The client keeps image count at one, serializes process-local requests with a lock file, and retries only HTTP 429 responses using `Retry-After` when supplied. It returns a structured error for invalid provider configuration, unsupported image response formats, download failure, or upstream errors.

## Runtime Delivery

Hermes displays the returned local file. OpenClaw desktop and channel adapters send that file as an image attachment; when a channel adapter cannot upload it, they send the returned URL. Channel-specific attachment retrieval stays outside the Skill: the adapter passes the already-downloaded attachment path into the shared command.
