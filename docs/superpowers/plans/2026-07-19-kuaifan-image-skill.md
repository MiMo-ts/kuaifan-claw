# Kuaifan Image Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a portable Hermes and OpenClaw Skill for Kuaifan text-to-image and image-to-image generation using the key stored in local model configuration.

**Architecture:** A dependency-free Python client reads a Kuaifan provider record from the local OpenClaw config, invokes OpenAI-compatible image endpoints, and emits a JSON result that both runtimes can consume. The Skill document defines deterministic invocation, trigger, security, and channel-delivery behavior.

**Tech Stack:** Python standard library, `unittest`, Markdown Skill metadata.

---

### Task 1: Define Credential Resolution Tests

**Files:**
- Create: `skills/kuaifan-image/tests/test_kuaifan_image.py`
- Create: `skills/kuaifan-image/scripts/kuaifan_image.py`

- [ ] **Step 1: Write failing provider-resolution tests**

```python
def test_resolve_provider_uses_the_only_kuaifan_base_url(self):
    config = {"models": {"providers": {"openai": {"apiKey": "key", "baseUrl": "https://kuaifanio.cn/v1"}}}}
    provider = module.resolve_provider(config, None)
    self.assertEqual(provider["api_key"], "key")

def test_resolve_provider_prefers_environment_key(self):
    provider = module.resolve_provider({"models": {"providers": {"kuaifan": {"apiKey": "file-key", "baseUrl": "https://kuaifanio.cn/v1"}}}}, "env-key")
    self.assertEqual(provider["api_key"], "env-key")
```

- [ ] **Step 2: Run the test to verify failure**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v`

Expected: FAIL because `kuaifan_image.py` does not exist.

- [ ] **Step 3: Implement provider resolution**

Implement `load_openclaw_config`, `resolve_provider`, and secret-reference resolution. Restrict automatic provider discovery to `kuaifanio.cn`; never serialize an API key into an exception or response.

- [ ] **Step 4: Run the provider tests to verify success**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v`

Expected: PASS.

### Task 2: Define Image Request Tests

**Files:**
- Modify: `skills/kuaifan-image/tests/test_kuaifan_image.py`
- Modify: `skills/kuaifan-image/scripts/kuaifan_image.py`

- [ ] **Step 1: Write failing endpoint and payload tests**

```python
def test_text_request_uses_generations_with_n_one(self):
    request = module.build_text_request("https://kuaifanio.cn/v1", "model", "poster", "1024x1024")
    self.assertEqual(request.url, "https://kuaifanio.cn/v1/images/generations")
    self.assertEqual(json.loads(request.data.decode())["n"], 1)

def test_edit_request_uses_multipart_edits_endpoint(self):
    request = module.build_edit_request("https://kuaifanio.cn/v1", "model", "edit", "1024x1024", [("source.png", b"png")])
    self.assertEqual(request.url, "https://kuaifanio.cn/v1/images/edits")
    self.assertIn("multipart/form-data", request.get_header("Content-type"))
```

- [ ] **Step 2: Run the test to verify failure**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v`

Expected: FAIL because request builders do not exist.

- [ ] **Step 3: Implement request builders and response download**

Build JSON generation requests with `n=1`; build multipart edit requests from local or downloaded source images; parse `data[0].url` or `data[0].b64_json`; write a verified output file and emit redacted JSON.

- [ ] **Step 4: Run request tests to verify success**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v`

Expected: PASS.

### Task 3: Package The Skill

**Files:**
- Create: `skills/kuaifan-image/SKILL.md`
- Modify: `skills/kuaifan-image/scripts/kuaifan_image.py`

- [ ] **Step 1: Write a failing static contract test**

```python
def test_skill_document_never_contains_a_key_literal(self):
    text = (ROOT / "SKILL.md").read_text(encoding="utf-8")
    self.assertIn("KUAIFAN_API_KEY", text)
    self.assertNotIn("sk-", text)
```

- [ ] **Step 2: Run the test to verify failure**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v`

Expected: FAIL because `SKILL.md` does not exist.

- [ ] **Step 3: Write the portable Skill instructions**

Describe strict visual-intent triggering, command invocation for text-to-image and image-to-image, attachment normalization, JSON result handling, and no-secret rules. Include `/生图`, `/image`, and `/draw` as explicit triggers.

- [ ] **Step 4: Run all Skill tests and syntax checks**

Run: `python skills/kuaifan-image/tests/test_kuaifan_image.py -v; python -m py_compile skills/kuaifan-image/scripts/kuaifan_image.py`

Expected: PASS with no syntax errors.

### Task 4: Validate And Integrate

**Files:**
- Modify: `skills/kuaifan-image/SKILL.md`
- Modify: `skills/kuaifan-image/scripts/kuaifan_image.py`

- [ ] **Step 1: Validate metadata and security**

Run: `rg -n "sk-[A-Za-z0-9]" skills/kuaifan-image; git diff --check`

Expected: no Key match and no whitespace errors.

- [ ] **Step 2: Perform a dry-run configuration test**

Run: `python skills/kuaifan-image/scripts/kuaifan_image.py --prompt "test" --output .tmp/test.png --dry-run`

Expected: JSON with a redacted base URL, model, endpoint, and `n: 1`; no network request.

- [ ] **Step 3: Commit the packaged Skill**

Run: `git add skills/kuaifan-image docs/superpowers/specs/2026-07-19-kuaifan-image-skill-design.md docs/superpowers/plans/2026-07-19-kuaifan-image-skill.md && git commit -m "feat: add Kuaifan image generation skill"`

Expected: one commit containing only the new Skill and its design records.
