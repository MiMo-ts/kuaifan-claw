# Hermes Image Preview and Controlled Export

## Goal

让 Hermes 生成的图片在消息中可放大查看，并支持用户在对话后将已生成图片保存到确认过的本地目录；OpenClaw 继续使用受管媒体缓存和现有 `MEDIA:` 渠道回传协议。

## Scope

- Hermes 前端：缩略图点击打开应用内原图查看层；支持关闭、下载/保存和在资源管理器中定位。
- Hermes 后端：只允许复制当前 Hermes 受管图片缓存中的图片到用户选择的目录。
- Kuaifan Skill：继续先写受管缓存，不接受模型任意输出路径作为生成路径；可在工具结果中提供受控导出请求元数据。
- OpenClaw：不修改 `openclaw.tgz`、agent 逻辑或渠道插件；保留现有 `MEDIA:` 回传。

## Data Flow

```text
Kuaifan Skill -> HERMES_HOME/image_cache/kuaifan-image/result.jpg
              -> MEDIA:<managed-path>
              -> Hermes /api/media -> authenticated blob URL
              -> thumbnail -> in-app lightbox
              -> user confirmation -> Tauri copy command -> chosen directory
```

## Security

The Rust copy command canonicalizes the source and requires it to be an existing supported image beneath `data/modules/hermes/image_cache/kuaifan-image` (or the active `HERMES_HOME/image_cache/kuaifan-image`). The destination is selected by the user through the native save dialog; parent directories are created only after explicit confirmation. Existing files are never overwritten; a unique suffix is chosen for collisions.

The frontend must not expose a direct filesystem URL. It keeps using the authenticated `/api/media` data URL for preview and passes only the original managed source path to the copy command.

## UI Behavior

- Image thumbnails use a button-like accessible trigger instead of a bare anchor.
- Lightbox shows the full image with a stable viewport, `aria-modal`, an accessible close button, and `Escape`/backdrop close behavior.
- `保存到…` opens the native file save dialog with the generated filename. Cancel leaves the message unchanged.
- `在资源管理器中显示` uses the existing system open-folder path only after validating the image path.
- Save failures are surfaced through the existing toast/error channel and do not remove the preview.

## Tests

- Frontend protocol tests verify that local `MEDIA:` attachments remain previewable and that the export source is preserved.
- Component-level behavior is covered with a small DOM test for lightbox open/close and save callback invocation.
- Rust unit tests verify source-root enforcement, supported extensions, no-overwrite collision naming, and rejection of missing/outside-root sources.
- Existing web, Rust, Skill, and Hermes media tests remain green.
