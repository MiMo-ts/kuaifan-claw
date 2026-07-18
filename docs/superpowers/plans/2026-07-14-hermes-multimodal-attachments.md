# Hermes Multimodal Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Hermes desktop chat accept files by picker, drag-and-drop, and paste; safely pass supported media to the real Hermes Agent; and retain previewable attachments in session history.

**Architecture:** The Hermes dashboard owns multipart uploads and delegates storage, session ownership, and capability-aware prompt transformation to a focused gateway attachment service. Attachment metadata is persisted in a SQLite association table linked to Hermes message rows, then injected only into `session.history` responses for the desktop UI. The agent's model history receives image content parts, extracted document text, or explicit fallbacks without frontend-only metadata.

**Tech Stack:** React 18, TypeScript, Vite, Node test runner, FastAPI, Python 3, SQLite, Hermes JSON-RPC gateway.

---

## File Structure

- Create: `src-tauri/runtimes/hermes/tui_gateway/attachments.py` - safe storage and capability-aware input conversion.
- Create: `src-tauri/runtimes/hermes/tests/test_chat_attachments.py` - storage, ownership, persistence, and endpoint tests.
- Modify: `src-tauri/runtimes/hermes/hermes_state.py` - message/attachment SQLite relation.
- Modify: `src-tauri/runtimes/hermes/tui_gateway/server.py` - prompt, history, and deletion integration.
- Modify: `src-tauri/runtimes/hermes/hermes_cli/web_server.py` - authenticated multipart upload and attachment serving.
- Modify: `web/src/types/hermes.ts` - attachment descriptor and state types.
- Modify: `web/src/services/hermesApi.ts` - upload and `prompt.submit` transport.
- Modify: `web/src/pages/HermesPage.tsx` - optimistic attachment messages through streaming.
- Create: `web/src/components/hermes/HermesAttachmentPreview.tsx` - shared media/file card.
- Modify: `web/src/components/hermes/HermesComposer.tsx` - picker, drop, paste, progress, and removal.
- Modify: `web/src/components/hermes/HermesMessage.tsx` - persistent attachment rendering.
- Modify: `web/scripts/build-test-fixtures.mjs` and `web/tests/hermesProtocol.test.mjs` - frontend protocol tests.

### Task 1: Create Safe Attachment Storage

**Files:**
- Create: `src-tauri/runtimes/hermes/tui_gateway/attachments.py`
- Create: `src-tauri/runtimes/hermes/tests/test_chat_attachments.py`

- [ ] **Step 1: Write failing service tests**

```python
def test_store_rejects_a_video_larger_than_200_mb(tmp_path):
    store = AttachmentStore(tmp_path)
    with pytest.raises(AttachmentError, match="video too large"):
        store.validate_upload("clip.mp4", "video/mp4", 200 * 1024 * 1024 + 1)

def test_store_writes_inside_the_session_root(tmp_path):
    item = AttachmentStore(tmp_path).store_bytes("stored-session", "photo.png", "image/png", PNG_BYTES)
    assert item.session_id == "stored-session"
    assert item.path.parent.parent.name == "stored-session"
    assert item.kind == "image"

def test_resolve_rejects_an_attachment_owned_by_another_session(tmp_path):
    store = AttachmentStore(tmp_path)
    item = store.store_bytes("one", "note.txt", "text/plain", b"hello")
    with pytest.raises(AttachmentError, match="does not belong to session"):
        store.resolve_for_session("two", [item.id])
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: FAIL because `tui_gateway.attachments` does not exist.

- [ ] **Step 3: Implement the attachment service**

```python
@dataclass(frozen=True)
class AttachmentDescriptor:
    id: str
    session_id: str
    name: str
    mime: str
    size: int
    kind: Literal["image", "video", "audio", "document", "file"]
    path: Path
    fallback: str | None = None

class AttachmentStore:
    def validate_upload(self, name: str, mime: str, size: int) -> None: ...
    def store_stream(self, session_id: str, name: str, mime: str, chunks: Iterable[bytes]) -> AttachmentDescriptor: ...
    def resolve_for_session(self, session_id: str, attachment_ids: list[str]) -> list[AttachmentDescriptor]: ...
    def delete_session(self, session_id: str) -> None: ...
```

Normalize names with `Path(name).name`; allow image, audio, video, text, PDF, and office-document MIME groups; cap non-video files at 50 MB and video at 200 MB. Stream to a temporary sibling in 1 MB chunks, atomically rename only after validation, and resolve all paths under `<HERMES_HOME>/attachments/<stored-session-id>`.

- [ ] **Step 4: Run focused storage tests**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: PASS with validation, ownership, path-containment, and atomic-write coverage.

### Task 2: Persist Message Associations and Build Real Agent Input

**Files:**
- Modify: `src-tauri/runtimes/hermes/hermes_state.py`
- Modify: `src-tauri/runtimes/hermes/tui_gateway/server.py`
- Modify: `src-tauri/runtimes/hermes/tests/test_chat_attachments.py`

- [ ] **Step 1: Write failing persistence and prompt tests**

```python
def test_message_attachments_round_trip_without_mutating_model_content(state_db, descriptor):
    message_id = state_db.append_message("session", "user", "inspect this")
    state_db.replace_message_attachments(message_id, [descriptor.to_public_dict()])
    assert state_db.get_message_attachments([message_id])[message_id][0]["id"] == descriptor.id

def test_image_prompt_uses_native_content_parts_when_model_supports_vision(store):
    image = store.store_bytes("session", "photo.png", "image/png", PNG_BYTES)
    assert build_attachment_prompt("look", [image], vision=True)[1]["type"] == "image_url"

def test_video_prompt_exposes_visible_fallback_when_capability_is_missing(store):
    video = store.store_bytes("session", "clip.mp4", "video/mp4", b"video")
    assert "cannot directly inspect this video" in build_attachment_prompt("summarize", [video], vision=False, video=False)
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: FAIL because message attachment APIs and `build_attachment_prompt` do not exist.

- [ ] **Step 3: Add SQLite association and gateway hooks**

```sql
CREATE TABLE IF NOT EXISTS message_attachments (
    message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    attachment_id TEXT NOT NULL,
    descriptor_json TEXT NOT NULL,
    PRIMARY KEY (message_id, attachment_id)
);
```

Implement `replace_message_attachments(message_id, descriptors)` and `get_message_attachments(message_ids)` in `HermesState`. Extend `prompt.submit` with validated `attachment_ids`; resolve them for the current stored-session id and retain descriptors only in the live turn. Pass the agent one of these explicit inputs:

```python
if descriptor.kind == "image" and supports_vision:
    parts.append({"type": "image_url", "image_url": {"url": descriptor.data_url()}})
elif descriptor.kind in {"document", "file"}:
    parts.append({"type": "text", "text": descriptor.bounded_text_fallback()})
else:
    parts.append({"type": "text", "text": descriptor.capability_fallback()})
```

After the agent persists the turn, associate descriptors with its new user message row. Extend `session.history` to merge public descriptors into response messages only. On a successful `session.delete`, delete the corresponding attachment directory.

- [ ] **Step 4: Run persistence and prompt tests**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: PASS; model history has no UI metadata while returned session history retains attachment descriptors.

### Task 3: Add Authenticated Multipart Upload and Serving

**Files:**
- Modify: `src-tauri/runtimes/hermes/hermes_cli/web_server.py`
- Modify: `src-tauri/runtimes/hermes/tests/test_chat_attachments.py`

- [ ] **Step 1: Write failing route tests**

```python
def test_upload_requires_dashboard_auth(client):
    response = client.post("/api/chat/attachments", files={"file": ("x.txt", b"x", "text/plain")})
    assert response.status_code in {401, 403}

def test_upload_returns_no_gateway_path(client, auth_headers):
    response = client.post(
        "/api/chat/attachments", headers=auth_headers, data={"session_id": "runtime-session"},
        files={"file": ("photo.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 200
    assert "path" not in response.json()
    assert response.json()["url"].startswith("/api/chat/attachments/")
```

- [ ] **Step 2: Run tests and verify failure**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: FAIL with `404` because chat attachment routes do not exist.

- [ ] **Step 3: Implement endpoints through the existing dashboard auth layer**

```python
@app.post("/api/chat/attachments")
async def upload_chat_attachment(request: Request, file: UploadFile = File(...), session_id: str = Form(...)):
    descriptor = await asyncio.to_thread(store_runtime_attachment, session_id, file)
    return descriptor.to_public_dict(url=f"/api/chat/attachments/{descriptor.id}")

@app.get("/api/chat/attachments/{attachment_id}")
async def get_chat_attachment(attachment_id: str, session_id: str):
    descriptor = resolve_runtime_attachment(session_id, attachment_id)
    return FileResponse(descriptor.path, media_type=descriptor.mime, filename=descriptor.name)
```

Resolve the runtime id to its stored session id using `tui_gateway.server`, reject unauthenticated/unknown/foreign ids, use 1 MB multipart chunks, and return `X-Content-Type-Options: nosniff` with a safe content disposition.

- [ ] **Step 4: Run HTTP tests**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: PASS with authentication, session ownership, and no path disclosure coverage.

### Task 4: Add Web Transport and Optimistic State

**Files:**
- Modify: `web/src/types/hermes.ts`
- Modify: `web/src/services/hermesApi.ts`
- Modify: `web/src/pages/HermesPage.tsx`
- Modify: `web/scripts/build-test-fixtures.mjs`
- Modify: `web/tests/hermesProtocol.test.mjs`

- [ ] **Step 1: Write failing frontend protocol tests**

```javascript
test("serializes only uploaded attachment ids", () => {
  assert.deepEqual(toPromptAttachmentIds([
    { id: "img-1", state: "uploaded" }, { id: "bad-1", state: "error" },
  ]), ["img-1"]);
});

test("normalizes a public descriptor without server paths", () => {
  assert.equal(normalizeAttachment({ id: "a", name: "p.png", mime: "image/png", size: 4, url: "/x" }).kind, "image");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:hermes`

Expected: FAIL because attachment helper exports are absent.

- [ ] **Step 3: Implement types and upload sequencing**

```ts
export interface HermesAttachment {
  id: string; name: string; mime: string; size: number;
  kind: "image" | "video" | "audio" | "document" | "file";
  url: string; state: "pending" | "uploading" | "uploaded" | "error";
  previewUrl?: string; errorMessage?: string; fallback?: string;
}
```

In `startChat`, create/resume the runtime session, upload selected `File`s by `XMLHttpRequest` for progress, then submit only uploaded ids in `prompt.submit`. Retain local object URLs for unsent previews, revoke them on removal/unmount/server replacement, and append optimistic user attachments before streaming begins.

- [ ] **Step 4: Run frontend protocol tests**

Run: `npm run test:hermes`

Expected: PASS; failed files do not enter the prompt and server paths cannot enter UI state.

### Task 5: Implement Picker, Drag, Paste, and Preview Cards

**Files:**
- Create: `web/src/components/hermes/HermesAttachmentPreview.tsx`
- Modify: `web/src/components/hermes/HermesComposer.tsx`
- Modify: `web/src/components/hermes/HermesMessage.tsx`
- Modify: `web/src/pages/HermesPage.tsx`

- [ ] **Step 1: Write failing intake tests**

```javascript
test("collects files from clipboard but ignores text-only paste", () => {
  assert.equal(collectAttachmentFiles({ clipboardData: { files: [new File(["x"], "n.txt")] } }).length, 1);
  assert.equal(collectAttachmentFiles({ clipboardData: { files: [] } }).length, 0);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npm run test:hermes`

Expected: FAIL because `collectAttachmentFiles` does not exist.

- [ ] **Step 3: Implement shared, constrained previews**

```tsx
<input ref={fileInputRef} type="file" multiple className="sr-only" onChange={onPickFiles} />
<div onDragOver={preventFileNavigation} onDrop={onDropFiles} onPaste={onPasteFiles}>
  <HermesAttachmentPreview attachment={attachment} onRemove={removeAttachment} compact />
</div>
```

Use the existing paperclip icon. Render images as constrained thumbnails, videos/audio with native controls, and documents as filename/size rows. Reuse the preview in `HermesMessageView` without composer actions. Disable sending while an attachment is pending, uploading, or errored; expose a retry control for errors; preserve text-only Enter behavior.

- [ ] **Step 4: Run web validation**

Run: `npm run test && npm run build`

Expected: PASS and a successful Vite build.

### Task 6: Run Runtime and Desktop Acceptance Checks

**Files:**
- Modify: `src-tauri/runtimes/hermes/tests/test_chat_attachments.py` only for reproducible packaging regressions.

- [ ] **Step 1: Run focused Hermes tests**

Run: `python -m pytest src-tauri/runtimes/hermes/tests/test_desktop_webview_origin.py src-tauri/runtimes/hermes/tests/test_chat_attachments.py -q`

Expected: PASS.

- [ ] **Step 2: Build the application**

Run: `npm run build; cargo tauri build --no-bundle`

Expected: both commands exit `0`; only Hermes runtime files change.

- [ ] **Step 3: Verify release-app behavior**

In the release application verify image picker preview, pasted image, dropped document, video preview with unsupported-capability fallback, session reload, session deletion, and gateway-owned assistant media cards. Fix only Hermes regressions found during this check.
