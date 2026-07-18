# Hermes Multimodal Attachments Design

## Scope

Add an attachment workflow to the Hermes desktop chat only. The workflow accepts
text files, documents, images, audio, and video; preserves attachment metadata
with the session message; previews media in the chat; and delivers input to the
real Hermes Agent through a capability-aware path.

This design does not modify OpenClaw, OpenClaw-CN, module switching, or bundled
OpenClaw packages.

## Existing Behavior

The desktop chat opens a WebSocket JSON-RPC connection to the Hermes gateway.
`prompt.submit` runs the real `AIAgent`, including its skills, tools, session
history, and model provider adapter. The gateway already supports remote image
uploads through `image.attach_bytes`, PDF-to-image conversion through
`pdf.attach`, and capability-aware native image input through `image_routing`.
The web client currently sends only `text`, so its existing `attachments` type
is unused.

## Chosen Architecture

Use a gateway-controlled attachment store, scoped to the active Hermes session.
The browser uploads a file before `prompt.submit`; the gateway validates and
stores it below the Hermes home directory and returns an attachment descriptor.
The descriptor is included in the displayed user message and in the persisted
Hermes session metadata. The prompt handler resolves stored descriptors and
builds the model input based on file type and the selected model's capabilities.

The browser never submits arbitrary local paths. The gateway only serves files
inside its attachment root after validating the session token and ownership.

## Data Flow

1. The composer accepts files through an attachment button, a hidden file input,
   drag-and-drop, and clipboard paste. All entry points share one validation,
   upload, preview, retry, and removal pipeline. It shows upload progress,
   media previews, size, and remove controls.
2. The client uploads each selected file through an authenticated multipart
   endpoint. It receives a stable attachment id, MIME type, size, filename,
   content URL, and optional media metadata.
3. On send, the client submits text plus attachment ids to `prompt.submit`.
   It immediately renders the local user message with those attachment cards.
4. The gateway validates that every id belongs to the target session, persists
   the message attachment metadata, and transforms inputs for the real agent.
5. Hermes streams its regular tool, reasoning, and answer events. The client
   preserves the attachment cards while applying streamed response updates.
6. Assistant text is parsed only for gateway-owned generated assets. Matching
   images, audio, video, and files render as attachment cards; ordinary URLs
   remain normal message text.

## Input Rules

### Images

Images are stored in the attachment root. Vision-capable models receive
OpenAI-style image content parts through Hermes's existing native image routing.
Non-vision models use the existing analysis fallback and receive its text
summary. The UI indicates that a fallback was used rather than claiming that
the selected model saw the pixels.

### PDFs and Documents

PDFs are converted to page images through the existing Hermes PDF attachment
pipeline, within its page and size limits. Plain text and source documents are
extracted with a bounded text reader and supplied as an explicitly labelled
untrusted file excerpt plus a gateway-local file reference. Unsupported binary
documents are passed only as a file reference; no unsupported format is claimed
to be understood.

### Audio and Video

Audio and video are stored and previewed. Their original bytes are delivered
only when the active provider/model explicitly advertises a compatible input
capability. Otherwise the agent receives a labelled local file reference and,
where available, bounded extracted metadata or a transcription. The UI states
the fallback state. It never fabricates audio/video analysis.

### Limits and Validation

The initial limits are 50 MB per image/document/audio file and 200 MB per
video, with a bounded number of attachments per prompt. The gateway validates
MIME type, extension, file signature for high-risk media, normalized filename,
total size, and session ownership. Uploads write to a temporary sibling path
and atomically rename only after validation succeeds.

## UI Behavior

The composer has one attachment icon and supports multi-select. Dropping files
onto the composer or pasting files from the clipboard uses the same attachment
queue; pasted plain text continues to populate the text editor rather than
becoming a file. Before sending:

- Images show a thumbnail; videos show a frame/thumbnail, duration when known,
  and a play affordance; audio shows a compact player; documents show a typed
  file row with filename and size.
- Every pending item exposes upload state and a remove control. Sending is
  disabled only while selected files are still uploading or fail validation.
- Text-only sending continues to work unchanged.

Message cards render the same attachment types for both user and assistant
messages. Images open at a safe constrained size, videos and audio use native
controls, and documents download through the authenticated gateway URL. Missing
or deleted assets render a compact unavailable state without breaking message
history.

## Errors and Recovery

Upload errors retain the selected item and show a retryable error. A failed
upload is never attached to `prompt.submit`. The gateway returns explicit
errors for type, size, signature, session, and ownership failures. A model
capability fallback is a non-fatal visible status, not an error. Interrupted
uploads clean their temporary files. Deleting a session removes its attachment
directory after session deletion succeeds.

## Components and Boundaries

- Hermes gateway attachment service: storage, validation, descriptor creation,
  authorized serving, cleanup, and model-input adaptation.
- Hermes JSON-RPC methods: upload/session attachment references and extended
  `prompt.submit` validation.
- Web `HermesApiClient`: authenticated multipart upload, descriptor transport,
  and response normalization.
- `HermesComposer`: selection, pending state, preview, removal, and send state.
- `HermesMessageView`: stable user and assistant attachment cards.

No OpenClaw code is a dependency of this feature.

## Verification

Add focused tests before implementation for gateway validation, session
ownership, atomic cleanup, image routing, document fallback, and generated
asset extraction. Add web tests for selection, upload failure/retry, preview
rendering, removal, prompt payloads, streamed answers retaining attachments,
and unavailable assets. Run the focused Python and web tests, then build the
web frontend and package the Hermes runtime. Desktop verification covers an
image, PDF, text file, video fallback, session reload, session deletion, and a
model that lacks vision/video capability.
