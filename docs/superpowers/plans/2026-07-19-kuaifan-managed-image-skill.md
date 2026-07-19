# Kuaifan Managed Image Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bundle `kuaifan-image` into the NSIS application, register it for OpenClaw and Hermes after a clean install, and deliver generated files through the existing `MEDIA:` channel-media path.

**Architecture:** A Tauri-managed resource is copied idempotently into `<data-dir>/bundled-skills/kuaifan-image`. The configuration projection registers the parent directory in OpenClaw's `skills.load.extraDirs` and Hermes's `skills.external_dirs` while preserving unrelated entries. The Skill emits an authenticated image result plus a standalone `MEDIA:` marker; a narrowly scoped Hermes collector promotes only valid Kuaifan artifact files from current-turn tool results.

**Tech Stack:** Rust/Tauri, Python standard library, YAML/JSON configuration, PowerShell archive build, NSIS.

---

### Task 1: Lock the Skill output contract

**Files:**
- Modify: `skills/kuaifan-image/tests/test_kuaifan_image.py`
- Modify: `skills/kuaifan-image/scripts/kuaifan_image.py`
- Modify: `skills/kuaifan-image/SKILL.md`

- [ ] **Step 1: Write failing output tests**

```python
assert payload["artifact"] == "kuaifan-image/v1"
assert stdout_lines[-1] == payload["media_marker"]
assert pathlib.Path(payload["image_path"]).is_absolute()
```

- [ ] **Step 2: Run the focused tests and observe failure**

Run: `python -m unittest skills.kuaifan-image.tests.test_kuaifan_image -v`

Expected: the assertion for `artifact` or standalone `MEDIA:` fails before the client implementation changes.

- [ ] **Step 3: Implement the minimal contract**

```python
result["artifact"] = "kuaifan-image/v1"
print(json.dumps(result, ensure_ascii=False))
print(result["media_marker"])
```

Use a runtime-owned default output root when `--output` is absent, reject a relative output path, and keep credentials out of stdout and stderr.

- [ ] **Step 4: Re-run the focused Python tests**

Run: `python -m unittest discover -s skills/kuaifan-image/tests -v`

Expected: all Skill tests pass.

### Task 2: Bundle and provision the managed Skill

**Files:**
- Create: `src-tauri/resources/bundled-skills/kuaifan-image/SKILL.md`
- Create: `src-tauri/resources/bundled-skills/kuaifan-image/scripts/kuaifan_image.py`
- Create: `src-tauri/resources/bundled-skills/kuaifan-image/bundle-manifest.json`
- Create: `src-tauri/src/services/bundled_skills.rs`
- Modify: `src-tauri/src/services/mod.rs`
- Modify: `src-tauri/tauri.conf.json`
- Test: `src-tauri/src/services/bundled_skills.rs`

- [ ] **Step 1: Write failing Rust tests for a clean provisioning directory**

```rust
assert!(data_dir.join("bundled-skills/kuaifan-image/SKILL.md").is_file());
assert!(data_dir.join("bundled-skills/user-skill/SKILL.md").is_file());
assert_eq!(extra_dirs, vec!["D:/data/bundled-skills", "D:/custom"]);
```

- [ ] **Step 2: Run the exact test and observe failure**

Run: `cargo test -p kuaifan-claw bundled_skills -- --nocapture`

Expected: a missing module or missing managed resource failure.

- [ ] **Step 3: Implement idempotent copy and configuration helpers**

```rust
pub fn ensure_managed_skill(resource_root: &Path, data_dir: &Path) -> Result<PathBuf, String>;
pub fn register_openclaw_skill_root(config: &mut serde_json::Value, root: &Path);
pub fn register_hermes_skill_root(config: &mut serde_yaml::Mapping, root: &Path);
```

Copy only `kuaifan-image` from the bundled resource and mutate only the managed parent-directory entries.

- [ ] **Step 4: Add the resource entry and run the exact Rust tests**

Run: `cargo test -p kuaifan-claw bundled_skills -- --nocapture`

Expected: tests pass and user-provided paths remain in both configuration shapes.

### Task 3: Connect provisioning to both runtime projections

**Files:**
- Modify: `src-tauri/src/commands/gateway.rs`
- Modify: `src-tauri/src/commands/module.rs`
- Modify: `src-tauri/src/main.rs`
- Test: `src-tauri/src/commands/gateway_tests.rs`
- Test: `src-tauri/src/commands/module.rs`

- [ ] **Step 1: Write failing projection tests**

```rust
assert!(openclaw_extra_dirs.iter().any(|path| path.ends_with("bundled-skills")));
assert!(hermes_external_dirs.iter().any(|path| path.ends_with("bundled-skills")));
```

- [ ] **Step 2: Run each test and observe the missing managed root**

Run: `cargo test -p kuaifan-claw managed_skill -- --nocapture`

Expected: OpenClaw and Hermes configuration assertions fail before projection code is added.

- [ ] **Step 3: Project the same managed root into active configuration**

Call the bundled-skill service at startup and immediately before OpenClaw and Hermes start. Register the root in `openclaw.json` and in both Hermes configuration locations used by the sidecar without replacing providers, models, or user Skill entries.

- [ ] **Step 4: Re-run the Rust test group**

Run: `cargo test -p kuaifan-claw managed_skill -- --nocapture`

Expected: all projection tests pass.

### Task 4: Add the restricted Hermes Kuaifan collector

**Files:**
- Modify: extracted `gateway/run.py` from `src-tauri/bundled-hermes/hermes-agent.zip`
- Test: extracted `gateway/tests/test_kuaifan_media.py`
- Modify: `src-tauri/bundled-hermes/hermes-agent.zip` (generated archive)

- [ ] **Step 1: Write a failing unit test inside the Hermes runtime staging tree**

```python
assert collect_kuaifan_media_tags(current_turn, managed_root, history) == ["MEDIA:/managed/result.png"]
assert not collect_kuaifan_media_tags(unrelated_shell_stdout, managed_root, history)
```

- [ ] **Step 2: Run it with the bundled runtime Python and observe failure**

Run: `src-tauri/runtimes/hermes/python/python.exe -m pytest gateway/tests/test_kuaifan_media.py -q`

Expected: collector import or behavior fails before the code is added.

- [ ] **Step 3: Implement and integrate the collector**

Only parse current-turn tool-result JSON with `artifact == "kuaifan-image/v1"`, require an existing `.png`, `.jpg`, `.jpeg`, `.webp`, or `.gif` file under `<HERMES_HOME>/image_cache/kuaifan-image`, suppress historical duplicates, and append one marker before the platform send path.

- [ ] **Step 4: Rebuild and inspect the runtime archive**

Run: `./src-tauri/download-bundles.ps1 -RuntimeOnly`

Expected: `bundled-hermes/hermes-agent.zip` contains the collector and its test, without downloading or changing `bundled-openclaw/openclaw.tgz`.

### Task 5: Verify and produce the installer

**Files:**
- Verify: `src-tauri/target/release/bundle/nsis/*.exe`

- [ ] **Step 1: Run focused Skill and Rust tests**

Run: `python -m unittest discover -s skills/kuaifan-image/tests -v` and `cargo test -p kuaifan-claw managed_skill -- --nocapture`

Expected: zero failures.

- [ ] **Step 2: Validate packaged resources before installation**

Run: `7z l src-tauri/target/release/bundle/nsis/*.exe` and inspect Tauri build outputs for `bundled-skills/kuaifan-image/SKILL.md`.

Expected: Skill resource is present.

- [ ] **Step 3: Build NSIS**

Run: `cargo tauri build --bundles nsis`

Expected: a single NSIS installer under `src-tauri/target/release/bundle/nsis/`.

- [ ] **Step 4: Report installation and smoke-test procedure**

Provide the generated installer path, then instruct the tester to configure the Kuaifan URL and Key, start OpenClaw/Hermes, request a picture, and confirm the result arrives as a native attachment.
