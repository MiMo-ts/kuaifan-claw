# OpenClaw Image Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a Kuaifan image result render once in the embedded OpenClaw UI, with repeat-text suppression, fullscreen preview, and a download command without altering `openclaw.tgz`.

**Architecture:** The managed Skill exposes one local `MEDIA:` result and never exposes the upstream image URL in its public JSON. The application-owned Control UI proxy injects a versioned browser enhancer into the served `index.html`; the enhancer only operates on assistant message groups and does not alter gateway or channel traffic.

**Tech Stack:** Python `unittest`, Node `node:test` with `vm`, Rust/Tauri proxy tests, browser DOM APIs.

---

### Task 1: Keep the Skill public result single-source

**Files:**
- Modify: `skills/kuaifan-image/tests/test_kuaifan_image.py`
- Modify: `skills/kuaifan-image/scripts/kuaifan_image.py`
- Modify: `src-tauri/resources/bundled-skills/kuaifan-image/scripts/kuaifan_image.py`
- Modify: `src-tauri/resources/bundled-skills/kuaifan-image/bundle-manifest.json`

- [ ] **Step 1: Write the failing contract test**

```python
self.assertIsNone(result["image_url"])
self.assertEqual(result["media_marker"], f"MEDIA:{result['absolute_path']}")
```

- [ ] **Step 2: Verify RED**

Run: `python -m unittest discover -s skills/kuaifan-image/tests -v`

Expected: the success-result test fails because it exposes the provider URL.

- [ ] **Step 3: Implement the one-media contract**

```python
image_data, _upstream_image_url = image_bytes_from_response(payload, args.timeout)
result["image_url"] = None
```

Copy the canonical script into the managed resource and update the manifest digest.

- [ ] **Step 4: Verify GREEN**

Run: `python -m unittest discover -s skills/kuaifan-image/tests -v`

Expected: all Skill and output-adapter tests pass.

### Task 2: Add a tested presentation enhancer

**Files:**
- Create: `src-tauri/resources/control-ui-enhancer.js`
- Create: `web/tests/controlUiPresentation.test.mjs`

- [ ] **Step 1: Write failing browser-independent tests**

```js
assert.equal(api.collapseExactDuplicateText(`${text}\n${text}`), text);
assert.equal(api.collapseExactDuplicateText(`${text}\nother`), `${text}\nother`);
assert.deepEqual(api.uniqueImageSources(["a.png", "a.png", "b.png"]), ["a.png", "b.png"]);
```

- [ ] **Step 2: Verify RED**

Run: `node --test web/tests/controlUiPresentation.test.mjs`

Expected: FAIL because the injected enhancer resource does not exist.

- [ ] **Step 3: Implement the enhancer**

Expose pure `collapseExactDuplicateText` and `uniqueImageSources` for the test harness. On a live DOM, use a `MutationObserver` to collapse only exact consecutive assistant text blocks and hide only duplicate image sources inside one assistant group. Capture assistant-image clicks to open one accessible modal with a close control and a download link.

- [ ] **Step 4: Verify GREEN**

Run: `node --test web/tests/controlUiPresentation.test.mjs`

Expected: all presentation helper assertions pass.

### Task 3: Serve the enhancer through the app proxy

**Files:**
- Modify: `src-tauri/src/commands/control_ui_proxy.rs`
- Test: `src-tauri/src/commands/control_ui_proxy.rs`

- [ ] **Step 1: Write failing proxy tests**

```rust
assert!(String::from_utf8(body).unwrap().contains("/__kuaifan__/control-ui-enhancer.js"));
assert!(headers.contains("Content-Type: application/javascript"));
```

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control_ui_proxy -- --nocapture`

Expected: the new injection and asset-serving assertions fail.

- [ ] **Step 3: Implement static augmentation**

Inject exactly one external script tag while serving the Control UI HTML. Serve only `/__kuaifan__/control-ui-enhancer.js` from `include_str!`; retain all upstream static assets and WebSocket transport unchanged.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml control_ui_proxy -- --nocapture`

Expected: proxy tests pass, including path-traversal and idempotency coverage.

### Task 4: Verify the package

**Files:**
- Verify: `src-tauri/target/release/bundle/nsis/*.exe`

- [ ] **Step 1: Run focused tests**

Run: `python -m unittest discover -s skills/kuaifan-image/tests -v; node --test web/tests/controlUiPresentation.test.mjs; cargo test --manifest-path src-tauri/Cargo.toml control_ui_proxy bundled_skills -- --nocapture`

Expected: no test failures.

- [ ] **Step 2: Build the frontend and NSIS installer**

Run: `npm --prefix web run build; npm --prefix web run tauri:build -- --bundles nsis`

Expected: an installer containing the Skill and presentation enhancer is written below `src-tauri/target/release/bundle/nsis/`.
