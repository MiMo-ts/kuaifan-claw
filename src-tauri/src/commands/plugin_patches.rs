// KuaiFanClaw Plugin Patch System
// Applies patches to plugins (e.g., openclaw-cn) during installation.
// Uses jiti(candidate.source) for JS bundling and Python scripts for patching.
// Called from install_plugin to prepare plugin environments.
use serde_json;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MARKER_PREFIX: &str = "PATCHED-BY-KUAIFANCLAW";

pub fn apply_plugin_patches(data_dir: &str, resources_dir: Option<&Path>) -> Vec<String> {
    let mut out = Vec::new();
    let plugins_root = PathBuf::from(data_dir).join("plugins");
    let extensions_root = PathBuf::from(data_dir).join("openclaw-cn").join("extensions");
    let resources_dir = resources_dir.map(|p| p.to_path_buf());

    for root in [&plugins_root, &extensions_root] {
        if !root.is_dir() {
            out.push(format!("[skip] root not found: {}", root.display()));
            continue;
        }
        out.push(format!("[scan] {}", root.display()));
        apply_dingtalk_patches(root, &mut out);
        apply_wechat_patches(root, resources_dir.as_deref(), &mut out);
    }
    ensure_wechat_account_index(&plugins_root.parent().unwrap_or(&plugins_root), &mut out);
    ensure_wechat_bearer_token(&plugins_root.parent().unwrap_or(&plugins_root), &mut out);
    apply_thinking_filter_patch(&PathBuf::from(data_dir).join("openclaw-cn").join("dist"), &mut out);
    apply_plugin_sdk_alias_patch(&PathBuf::from(data_dir).join("openclaw-cn").join("dist"), &mut out);
    ensure_plugin_deps(&plugins_root, &mut out);
    out
}

/// Apply only the WeChat repairs required before an OpenClaw gateway starts.
/// This avoids dependency installation or unrelated plugin rewrites on the
/// gateway startup path.
pub fn repair_wechat_runtime_state(data_dir: &str) -> Vec<String> {
    let data_dir = Path::new(data_dir);
    let mut out = Vec::new();
    ensure_wechat_account_index(data_dir, &mut out);
    ensure_wechat_bearer_token(data_dir, &mut out);

    for plugin_id in ["wechat_clawbot", "openclaw-weixin"] {
        let plugin_root = data_dir.join("plugins").join(plugin_id);
        patch_wechat_command_auth_imports(&plugin_root, &mut out);
        let dist = plugin_root.join("dist");
        if dist.is_dir() {
            patch_wechat_content_length(&dist, &mut out);
        }
    }
    out
}

/// Run npm install in plugin directories that have a package.json but no
/// node_modules (e.g. freshly extracted tgz without dependencies).
fn ensure_plugin_deps(plugins_root: &Path, out: &mut Vec<String>) {
    let entries = match std::fs::read_dir(plugins_root) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let pkg_json = path.join("package.json");
        let node_modules = path.join("node_modules");
        if pkg_json.is_file() && !node_modules.is_dir() {
            out.push(format!("[deps] npm install in {}", path.display()));
            match std::process::Command::new("npm")
                .arg("install")
                .arg("--production")
                .arg("--no-audit")
                .arg("--no-fund")
                .arg("--legacy-peer-deps")
                .current_dir(&path)
                .output()
            {
                Ok(o) if o.status.success() => {
                    out.push(format!("[deps] ok {}", path.display()));
                }
                Ok(o) => {
                    let stderr = String::from_utf8_lossy(&o.stderr);
                    out.push(format!(
                        "[deps] failed {}: {}",
                        path.display(),
                        stderr.lines().last().unwrap_or("unknown")
                    ));
                }
                Err(e) => {
                    out.push(format!("[deps] spawn failed {}: {}", path.display(), e));
                }
            }
        }
    }
}

/// Repair the openclaw-weixin plugin account index so the gateway can start
/// the channel. The official plugin reads registered account IDs from
/// `<state_dir>/openclaw-weixin/accounts.json`. Kuaifanclaw writes per-account
/// files to `accounts/<accountId>.json` (one per QR login), so when only the
/// per-account file is present the index file must be (re)generated.
///
/// Also strips a leading UTF-8 BOM from any JSON file in the directory:
/// Node `JSON.parse` rejects BOMs silently inside the plugin, which makes
/// `loadWeixinAccount()` return null and the gateway skips channel startup.
fn ensure_wechat_account_index(data_dir: &Path, out: &mut Vec<String>) {
    let weixin_dir = data_dir.join("openclaw").join("openclaw-weixin");
    if !weixin_dir.is_dir() {
        return;
    }
    let accounts_dir = weixin_dir.join("accounts");
    let index_path = weixin_dir.join("accounts.json");
    if !accounts_dir.is_dir() {
        return;
    }
    // 1) Scan accounts/*.json for valid account IDs.
    let mut ids: Vec<String> = Vec::new();
    let entries = match fs::read_dir(&accounts_dir) {
        Ok(e) => e,
        Err(err) => {
            out.push(format!("[wechat-index] read_dir failed {}: {}", accounts_dir.display(), err));
            return;
        }
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        // Strip leading BOM in-place if present.
        if let Err(err) = strip_utf8_bom(&path) {
            out.push(format!("[wechat-index] strip BOM failed {}: {}", path.display(), err));
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else { continue };
        let raw = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        match serde_json::from_str::<serde_json::Value>(&raw) {
            Ok(value) => {
                let obj = value.as_object();
                let has_token = obj
                    .and_then(|o| o.get("token"))
                    .and_then(|v| v.as_str())
                    .map(|s| !s.trim().is_empty())
                    .unwrap_or(false);
                if has_token && !ids.iter().any(|id| id == stem) {
                    ids.push(stem.to_string());
                }
            }
            Err(_) => {
                out.push(format!("[wechat-index] skip {} (invalid JSON)", path.display()));
            }
        }
    }
    if ids.is_empty() {
        return;
    }
    // 2) Read existing index (after BOM strip) and merge with discovered IDs.
    let existing: Vec<String> = match fs::read_to_string(&index_path) {
        Ok(txt) => serde_json::from_str(&txt).unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let mut merged = existing;
    for id in &ids {
        if !merged.iter().any(|x| x == id) {
            merged.push(id.clone());
        }
    }
    if merged.is_empty() {
        return;
    }
    let bytes = match serde_json::to_vec_pretty(&merged) {
        Ok(b) => b,
        Err(err) => {
            out.push(format!("[wechat-index] serialize failed: {}", err));
            return;
        }
    };
    match fs::write(&index_path, &bytes) {
        Ok(_) => out.push(format!("[wechat-index] wrote {} ({:?})", index_path.display(), merged)),
        Err(err) => out.push(format!("[wechat-index] write failed: {}", err)),
    }
}

/// Remove a leading UTF-8 BOM (EF BB BF) from a JSON file so Node
/// `JSON.parse` does not silently reject it. Idempotent.
fn strip_utf8_bom(path: &Path) -> std::io::Result<()> {
    let bytes = fs::read(path)?;
    if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        fs::write(path, &bytes[3..])?;
    }
    Ok(())
}

/// Repair legacy per-account files where only the bot_token half was saved.
///
/// The official @tencent-weixin/openclaw-weixin plugin reads the entire `token`
/// field of `accounts/<accountId>.json` and uses it verbatim as the
/// `Authorization: Bearer <token>` header. Earlier kuaifanclaw versions split the
/// `userId:bot_token` authCode and stored only the bot_token half, which the WeChat
/// server then rejected with errcode -14 (session expired).
///
/// This pass detects such half-tokens (no `:` present) and rewrites them as the full
/// `userId:bot_token` string using the sibling `userId` field. Idempotent.
fn ensure_wechat_bearer_token(data_dir: &Path, out: &mut Vec<String>) {
    let accounts_dir = data_dir.join("openclaw").join("openclaw-weixin").join("accounts");
    if !accounts_dir.is_dir() {
        return;
    }
    let entries = match fs::read_dir(&accounts_dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        if let Err(err) = strip_utf8_bom(&path) {
            out.push(format!("[wechat-bearer] strip BOM failed {}: {}", path.display(), err));
            continue;
        }
        let raw = match fs::read_to_string(&path) {
            Ok(t) => t,
            Err(_) => continue,
        };
        let mut value: serde_json::Value = match serde_json::from_str(&raw) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let Some(obj) = value.as_object_mut() else { continue };
        let Some(token) = obj.get("token").and_then(|v| v.as_str()).map(|s| s.to_string()) else { continue };
        if token.contains(":") {
            continue;
        }
        let Some(user_id) = obj.get("userId").and_then(|v| v.as_str()).map(|s| s.trim().to_string()) else { continue };
        if user_id.is_empty() {
            continue;
        }
        let new_token = format!("{}:{}", user_id, token);
        obj.insert("token".to_string(), serde_json::Value::String(new_token.clone()));
        let now = chrono::Utc::now().to_rfc3339();
        obj.insert("savedAt".to_string(), serde_json::Value::String(now));
        match serde_json::to_vec_pretty(&value) {
            Ok(bytes) => {
                if let Err(err) = fs::write(&path, &bytes) {
                    out.push(format!("[wechat-bearer] write failed {}: {}", path.display(), err));
                } else {
                    out.push(format!("[wechat-bearer] upgraded {} -> bearer token len={}", path.display(), new_token.len()));
                }
            }
            Err(err) => out.push(format!("[wechat-bearer] serialize failed {}: {}", path.display(), err)),
        }
    }
}



/// KUAIFANCLAW-PATCH: strip `<think>...</think>` reasoning blocks from channel-plugin
/// output. Models proxied through new-api (e.g. kuaifan/MiniMax-M2.7) emit thinking
/// content either as a separate `reasoning_content` field (handled by the agent
/// upstream) or as inline `<think>...</think>` tags inside the assistant text. The
/// in-app CodexChatArea uses `cli_agent_chat` (a separate Rust command) so it is
/// intentionally NOT affected. Feishu, DingTalk, WeChat (openclaw-weixin) and the
/// other channels pass through `buildReplyPayloads` in the gateway and would
/// otherwise dump the entire reasoning chain into the chat.
///
/// Idempotent: skips files that already contain the helper. The marker is a
/// comment line that does not change runtime behavior.
fn apply_thinking_filter_patch(openclaw_dist: &Path, out: &mut Vec<String>) {
    let target = openclaw_dist
        .join("auto-reply")
        .join("reply")
        .join("agent-runner-payloads.js");
    if !target.is_file() {
        return;
    }
    let raw = match fs::read_to_string(&target) {
        Ok(t) => t,
        Err(err) => {
            out.push(format!("[thinking-filter] read failed {}: {}", target.display(), err));
            return;
        }
    };
    if raw.contains("function stripThinkingBlocks") {
        out.push(format!("[thinking-filter] skip (already patched) {}", target.display()));
        return;
    }
    let helper: String = [
        "\n// KUAIFANCLAW-PATCH: strip <think>...</think> (and <think>...</think>) reasoning\n",
        "// blocks from channel-plugin output.\n",
        "function stripThinkingBlocks(text) {\n",
        "    if (!text || typeof text !== \"string\") return text;\n",
        "    let out = text.replace(/<think>[\\s\\S]*?<think>/g, \"\");\n",
        "    out = out.replace(/<think>[\\s\\S]*?<think>/g, \"\");\n",
        "    out = out.replace(/\\n{3,}/g, \"\\n\\n\").trim();\n",
        "    return out;\n",
        "}\n",
    ].concat();
    let anchor = "export function buildReplyPayloads(params) {";
    let mut new_txt = match raw.find(anchor) {
        Some(i) => {
            let mut s = String::with_capacity(raw.len() + helper.len() + 64);
            s.push_str(&raw[..i]);
            s.push_str(&helper);
            s.push_str("\n");
            s.push_str(&raw[i..]);
            s
        }
        None => {
            out.push(format!("[thinking-filter] anchor not found in {}", target.display()));
            return;
        }
    };
    let old_loop: String = [
        "        : params.payloads.flatMap((payload) => {\n",
        "            let text = payload.text;\n",
    ].concat();
    let new_loop: String = [
        "        : params.payloads.flatMap((payload) => {\n",
        "            let text = payload.text;\n",
        "            // KUAIFANCLAW-PATCH: strip <think>...</think> before downstream routing.\n",
        "            if (text && typeof text === \"string\") {\n",
        "                const stripped = stripThinkingBlocks(text);\n",
        "                if (stripped !== text) {\n",
        "                    text = stripped;\n",
        "                }\n",
        "            }\n",
    ].concat();
    if !new_txt.contains(&old_loop) {
        out.push(format!("[thinking-filter] payload loop anchor not found in {}", target.display()));
        return;
    }
    new_txt = new_txt.replacen(&old_loop, &new_loop, 1);
    match fs::write(&target, new_txt.as_bytes()) {
        Ok(()) => out.push(format!("[thinking-filter] patched {}", target.display())),
        Err(err) => out.push(format!("[thinking-filter] write failed {}: {}", target.display(), err)),
    }
}

/// KUAIFANCLAW-PATCH: fix plugin SDK alias resolution in loader.js.
///
/// resolvePluginSdkAlias() in dist/plugins/loader.js returns the FILE path to
/// dist/plugin-sdk/index.js. jiti then resolves imports like
/// openclaw/plugin-sdk/channel-config-schema by appending the subpath to the
/// aliased FILE path, producing a broken path:
///   .../plugin-sdk/index.js/channel-config-schema
///
/// The fix changes the two candidate paths to point to the plugin-sdk directory
/// instead, so jiti can resolve subpath imports correctly:
///   .../plugin-sdk/channel-config-schema  ->  channel-config-schema.js
///
/// Idempotent: skips files that already contain the PATCHED-BY marker.
fn apply_plugin_sdk_alias_patch(openclaw_dist: &Path, out: &mut Vec<String>) {
    let target = openclaw_dist.join("plugins").join("loader.js");
    if !target.is_file() {
        return;
    }
    let raw = match fs::read_to_string(&target) {
        Ok(t) => t,
        Err(err) => {
            out.push(format!(
                "[plugin-sdk-alias] read failed {}: {}",
                target.display(), err
            ));
            return;
        }
    };
    let marker =
        "// PATCHED-BY-KUAIFANCLAW: plugin-sdk alias dir instead of index file";
    if raw.contains(marker) {
        out.push(format!("[plugin-sdk-alias] skip (already patched) {}", target.display()));
        return;
    }
    // 匹配时忽略前导空格（不同 openclaw-cn 版本缩进可能不同）
    let old_candidates = concat!(
        "srcCandidate = path.join(cursor, \"src\", \"plugin-sdk\", \"index.ts\");\n",
        "distCandidate = path.join(cursor, \"dist\", \"plugin-sdk\", \"index.js\");",
    );
    let new_candidates = concat!(
        "srcCandidate = path.join(cursor, \"src\", \"plugin-sdk\");\n",
        "distCandidate = path.join(cursor, \"dist\", \"plugin-sdk\");\n",
        "// PATCHED-BY-KUAIFANCLAW: plugin-sdk alias dir instead of index file",
    );
    if !raw.contains(old_candidates) {
        out.push(format!("[plugin-sdk-alias] anchor not found in {}", target.display()));
        return;
    }
    let new_txt = raw.replace(old_candidates, new_candidates);
    match fs::write(&target, new_txt.as_bytes()) {
        Ok(()) => out.push(format!("[plugin-sdk-alias] patched {}", target.display())),
        Err(err) => out.push(format!(
            "[plugin-sdk-alias] write failed {}: {}", target.display(), err
        )),
    }
}


fn apply_dingtalk_patches(root: &Path, out: &mut Vec<String>) {
    for sub in &["dingtalk", "dingtalk-connector"] {
        let dist = root.join(sub).join("dist");
        if !dist.is_dir() {
            continue;
        }
        out.push(format!("[dingtalk] {}", dist.display()));
        restore_dingtalk_index_mjs_if_needed(&dist, out);
        remove_dingtalk_index_js_stub_if_present(&dist, out);
        patch_dingtalk_index_mjs(&dist, out);
        patch_dingtalk_runtime_mjs(&dist, out);
        patch_dingtalk_media_mjs(&dist, out);
    }
}

fn apply_wechat_patches(root: &Path, resources_dir: Option<&Path>, out: &mut Vec<String>) {
    for sub in &["wechat_clawbot", "openclaw-weixin"] {
        let dist = root.join(sub).join("dist");
        if !dist.is_dir() {
            continue;
        }
        out.push(format!("[wechat] {}", dist.display()));
        remove_wechat_index_js_tmp_if_present(&dist, out);
        // If dist/index.js looks like the kuaifanclaw stub (no ./src/ import),
        // replace the dist/ with the bundled resources/plugins/wechat_clawbot.tgz
        // which contains the real @tencent-weixin/openclaw-weixin plugin code.
        let mut needs_official = true;
        if let Ok(txt) = fs::read_to_string(dist.join("index.js")) {
            if txt.contains("./src/") || txt.contains("wechat replaced with official plugin") {
                needs_official = false;
            }
        }
        if let Some(rd) = resources_dir {
            if needs_official {
                let tgz = rd.join("plugins").join("wechat_clawbot.tgz");
                replace_wechat_dist_with_official_tgz(&dist, &tgz, out);
            }
        } else if needs_official {
            out.push("  [skip] resources_dir not provided; cannot replace stub".to_string());
        }
        patch_wechat_compat_js(&dist, out);
        patch_wechat_index_js(&dist, out);
        patch_wechat_content_length(&dist, out);
        patch_wechat_command_auth_imports(&root.join(sub), out);
    }
}

fn patch_wechat_command_auth_imports(plugin_root: &Path, out: &mut Vec<String>) -> bool {
    let candidates = [
        plugin_root
            .join("dist")
            .join("src")
            .join("messaging")
            .join("process-message.js"),
        plugin_root
            .join("src")
            .join("messaging")
            .join("process-message.ts"),
    ];
    let mut changed_any = false;
    for path in candidates {
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let Some(patched) = rewrite_wechat_command_auth_import(&text) else {
            continue;
        };
        match fs::write(&path, patched) {
            Ok(()) => {
                changed_any = true;
                out.push(format!("[wechat-command-auth] patched {}", path.display()));
            }
            Err(error) => out.push(format!(
                "[wechat-command-auth] write failed {}: {}",
                path.display(),
                error
            )),
        }
    }
    let scoped_imports = [
        (
            plugin_root
                .join("dist")
                .join("src")
                .join("messaging")
                .join("send.js"),
            "stripMarkdown",
            "text-runtime",
        ),
        (
            plugin_root
                .join("src")
                .join("messaging")
                .join("send.ts"),
            "stripMarkdown",
            "text-runtime",
        ),
        (
            plugin_root
                .join("dist")
                .join("src")
                .join("auth")
                .join("pairing.js"),
            "withFileLock",
            "file-lock",
        ),
        (
            plugin_root
                .join("src")
                .join("auth")
                .join("pairing.ts"),
            "withFileLock",
            "file-lock",
        ),
    ];
    for (path, symbol, subpath) in scoped_imports {
        let text = match fs::read_to_string(&path) {
            Ok(text) => text,
            Err(_) => continue,
        };
        let Some(patched) = rewrite_single_wechat_sdk_import(&text, symbol, subpath) else {
            continue;
        };
        match fs::write(&path, patched) {
            Ok(()) => {
                changed_any = true;
                out.push(format!("[wechat-sdk-subpath] patched {}", path.display()));
            }
            Err(error) => out.push(format!(
                "[wechat-sdk-subpath] write failed {}: {}",
                path.display(),
                error
            )),
        }
    }
    changed_any
}

fn rewrite_single_wechat_sdk_import(text: &str, symbol: &str, subpath: &str) -> Option<String> {
    for quote in ['\"', '\''] {
        let old = format!(
            "import {{ {symbol} }} from {quote}openclaw/plugin-sdk{quote};"
        );
        let new = format!(
            "import {{ {symbol} }} from {quote}openclaw/plugin-sdk/{subpath}{quote};"
        );
        if text.contains(&new) {
            return None;
        }
        if text.contains(&old) {
            return Some(text.replacen(&old, &new, 1));
        }
    }
    None
}

fn rewrite_wechat_command_auth_import(text: &str) -> Option<String> {
    const COMMAND_AUTH_SYMBOLS: [&str; 2] = [
        "resolveSenderCommandAuthorizationWithRuntime",
        "resolveDirectDmAuthorizationOutcome",
    ];
    if text.contains("openclaw/plugin-sdk/command-auth") {
        return None;
    }

    for quote in ['\"', '\''] {
        let suffix = format!("from {quote}openclaw/plugin-sdk{quote};");
        let Some(from_start) = text.find(&suffix) else {
            continue;
        };
        let import_start = text[..from_start].rfind("import {")?;
        let import_end = from_start + suffix.len();
        let import_block = &text[import_start..import_end];
        if !COMMAND_AUTH_SYMBOLS
            .iter()
            .all(|symbol| import_block.contains(symbol))
        {
            continue;
        }

        let open_brace = import_block.find('{')?;
        let close_brace = import_block.rfind('}')?;
        let retained = import_block[open_brace + 1..close_brace]
            .split(',')
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .filter(|name| !COMMAND_AUTH_SYMBOLS.contains(name))
            .collect::<Vec<_>>();
        let root_import = format!(
            "import {{ {}, }} from {quote}openclaw/plugin-sdk{quote};",
            retained.join(", ")
        );
        let command_auth_import = format!(
            "import {{ {}, }} from {quote}openclaw/plugin-sdk/command-auth{quote};",
            COMMAND_AUTH_SYMBOLS.join(", ")
        );
        let mut patched = text.to_string();
        patched.replace_range(
            import_start..import_end,
            &format!("{root_import}\n{command_auth_import}"),
        );
        return Some(patched);
    }
    None
}

/// Node's Undici rejects a user-supplied Content-Length header after OpenClaw
/// wraps fetch. Let fetch calculate it from the request body instead.
fn patch_wechat_content_length(dist: &Path, out: &mut Vec<String>) -> bool {
    let path = dist.join("src").join("api").join("api.js");
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(_) => return false,
    };
    let mut changed = false;
    let patched = text
        .lines()
        .filter(|line| {
            let remove = line.contains("Content-Length") && line.contains("byteLength(opts.body");
            changed |= remove;
            !remove
        })
        .collect::<Vec<_>>()
        .join("\n");
    if !changed {
        return false;
    }
    match fs::write(&path, format!("{}\n", patched)) {
        Ok(_) => {
            out.push(format!("  [ok] removed manual Content-Length from {}", path.display()));
            true
        }
        Err(error) => {
            out.push(format!("  [err] write {}: {}", path.display(), error));
            false
        }
    }
}

fn patch_dingtalk_index_mjs(dist: &Path, out: &mut Vec<String>) {
    let path = dist.join("index.mjs");
    if !path.is_file() {
        return;
    }
    let marker = "// PATCHED-BY-KUAIFANCLAW: import.meta.url disabled";
    let search = r##"const here = typeof import.meta !== "undefined" && import.meta?.url ? String(import.meta.url) : "<unknown>";"##;
    let replace = "// PATCHED-BY-KUAIFANCLAW: import.meta.url disabled (jiti CJS wrapper has no import.meta)
	const here = \"<unknown>\";";
    match ensure_once(&path, marker, search, replace) {
        Ok(true) => out.push(format!("  [ok] {}", path.display())),
        Ok(false) => out.push(format!("  [skip] {} already patched", path.display())),
        Err(e) => out.push(format!("  [err] {}: {}", path.display(), e)),
    }
}

fn patch_dingtalk_media_mjs(dist: &Path, out: &mut Vec<String>) {
    let path = dist.join("media-BViJQGgb.mjs");
    if !path.is_file() {
        return;
    }
    let marker = "// PATCHED-BY-KUAIFANCLAW: import.meta.url -> __filename";
    let search = r##"var __require = /* @__PURE__ */ createRequire(import.meta.url);"##;
    let replace = "// PATCHED-BY-KUAIFANCLAW: import.meta.url -> __filename (jiti CJS wrapper)
var __require = /* @__PURE__ */ createRequire(__filename);";
    match ensure_once(&path, marker, search, replace) {
        Ok(true) => out.push(format!("  [ok] {}", path.display())),
        Ok(false) => out.push(format!("  [skip] {} already patched", path.display())),
        Err(e) => out.push(format!("  [err] {}: {}", path.display(), e)),
    }
}

fn patch_dingtalk_runtime_mjs(dist: &Path, out: &mut Vec<String>) {
    let path = dist.join("runtime-BCFW2-1B.mjs");
    if !path.is_file() {
        return;
    }
    let v3_marker = "// PATCHED-BY-KUAIFANCLAW: resolve plugin-sdk via path walk + scoped createRequire (v3 anchor)";
    let v2_marker = "// PATCHED-BY-KUAIFANCLAW: resolve plugin-sdk via path walk + scoped createRequire";
    let v1_marker = "// PATCHED-BY-KUAIFANCLAW: import.meta.url -> __filename";

    let txt = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            out.push(format!("  [err] read {}: {}", path.display(), e));
            return;
        }
    };

    if txt.contains(v3_marker) {
        out.push(format!("  [skip] {} already v3", path.display()));
        return;
    }

    // v3 anchor body: walk up from __filename to find <data>/openclaw-cn/dist/plugin-sdk,
    // then createRequire from a virtual file path inside it so "./core" resolves correctly.
    // createRequire() requires a FILE path (not a directory); the virtual anchor trick
    // bypasses that limitation.
    let v3_full: &str = r##"// PATCHED-BY-KUAIFANCLAW: resolve plugin-sdk via path walk + scoped createRequire (v3 anchor)
// (Node standard require does not honor jiti alias mapping; walk up from __filename to
//  locate <data>/openclaw-cn/dist/plugin-sdk and createRequire from a virtual anchor
//  inside it so ./core resolves correctly.)
	const __kfclawPath = require("node:path");
	const __kfclawFs = require("node:fs");
	let __kfclawSdkDir = null;
	{
		let __cursor = __kfclawPath.dirname(__filename);
		for (let __i = 0; __i < 10; __i++) {
			const __candidate = __kfclawPath.join(__cursor, "openclaw-cn", "dist", "plugin-sdk");
			if (__kfclawFs.existsSync(__kfclawPath.join(__candidate, "core.js"))) {
				__kfclawSdkDir = __candidate;
				break;
			}
			const __parent = __kfclawPath.dirname(__cursor);
			if (__parent === __cursor) break;
			__cursor = __parent;
		}
	}
	const __kfclawRequire = __kfclawSdkDir
		? createRequire(__kfclawPath.join(__kfclawSdkDir, "__kfclaw_anchor.js"))
		: createRequire(__filename);
	const { buildChannelConfigSchema } = __kfclawRequire("./core");"##;

    let v3_inline: &str = r##"// PATCHED-BY-KUAIFANCLAW: resolve plugin-sdk via path walk + scoped createRequire (v3 anchor)
// (v2 used createRequire(sdkDir) directly which silently failed because createRequire
//  needs a file path; v3 anchors on <sdkDir>/__kfclaw_anchor.js so ./core resolves correctly.)
	const __kfclawRequire = __kfclawSdkDir
		? createRequire(__kfclawPath.join(__kfclawSdkDir, "__kfclaw_anchor.js"))
		: createRequire(__filename);"##;

    let v1_search = r##"// PATCHED-BY-KUAIFANCLAW: import.meta.url -> __filename (jiti CJS wrapper)
	const { buildChannelConfigSchema } = createRequire(__filename)("openclaw/plugin-sdk/core");"##;
    let v2_search = "	const __kfclawRequire = __kfclawSdkDir ? createRequire(__kfclawSdkDir) : createRequire(__filename);";
    let fresh_search = r##"const { buildChannelConfigSchema } = createRequire(import.meta.url)("openclaw/plugin-sdk/core");"##;

    let new_txt = if txt.contains(v2_marker) {
        txt.replace(v2_search, v3_inline)
    } else if txt.contains(v1_marker) {
        txt.replace(v1_search, v3_full)
    } else if txt.contains(fresh_search) {
        txt.replace(fresh_search, v3_full)
    } else {
        out.push(format!("  [skip] {} no matching runtime snippet", path.display()));
        return;
    };

    if let Err(e) = fs::write(&path, new_txt) {
        out.push(format!("  [err] write {}: {}", path.display(), e));
        return;
    }
    out.push(format!("  [ok] {}", path.display()));
}

fn remove_wechat_index_js_tmp_if_present(dist: &Path, out: &mut Vec<String>) {
    // Remove index.js.tmp leftover from interrupted extraction.
let path = dist.join("index.js.tmp");
    if !path.is_file() {
        return;
    }
    match fs::remove_file(&path) {
        Ok(_) => out.push(format!("  [remove-tmp] {}", path.display())),
        Err(e) => out.push(format!("  [err] remove {}: {}", path.display(), e)),
    }
}

fn replace_wechat_dist_with_official_tgz(dist: &Path, tgz_path: &Path, out: &mut Vec<String>) {
    let index_path = dist.join("index.js");
    let marker = "PATCHED-BY-KUAIFANCLAW: wechat replaced with official plugin";
    if index_path.is_file() {
        if let Ok(txt) = fs::read_to_string(&index_path) {
            if txt.contains(marker) {
                out.push(format!("  [skip] {} already official", index_path.display()));
                return;
            }
        }
    }
    if !tgz_path.is_file() {
        out.push(format!("  [err] tgz not found: {}", tgz_path.display()));
        return;
    }
    let tmp = std::env::temp_dir().join(format!("kuaifan_wechat_official_{}", std::process::id()));
    let _ = fs::remove_dir_all(&tmp);
    if let Err(e) = fs::create_dir_all(&tmp) {
        out.push(format!("  [err] create temp dir: {}", e));
        return;
    }
    let extract_status = std::process::Command::new("tar")
        .arg("-xzf").arg(tgz_path).arg("-C").arg(&tmp).status();
    match extract_status {
        Ok(s) if s.success() => {}
        Ok(s) => { out.push(format!("  [err] tar extract failed: exit={}", s)); return; }
        Err(e) => { out.push(format!("  [err] tar spawn failed: {}", e)); return; }
    }
    let src = tmp.join("wechat_clawbot");
    if !src.join("dist").is_dir() {
        out.push(format!("  [err] tgz layout unexpected: missing dist/ under {}", src.display()));
        return;
    }
    let _ = fs::remove_dir_all(dist);
    if let Err(e) = fs::create_dir_all(dist) {
        out.push(format!("  [err] recreate dist: {}", e));
        return;
    }
    copy_dir_recursive(&src.join("dist"), dist);
    if src.join("index.ts").is_file() {
        let _ = fs::copy(src.join("index.ts"), dist.parent().unwrap().join("index.ts"));
    }
    if src.join("openclaw.plugin.json").is_file() {
        let _ = fs::copy(
            src.join("openclaw.plugin.json"),
            dist.parent().unwrap().join("openclaw.plugin.json"),
        );
    }
    out.push(format!("  [replace] {} populated from tgz", dist.display()));
    let _ = fs::remove_dir_all(&tmp);
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    if let Ok(entries) = fs::read_dir(src) {
        for entry in entries.flatten() {
            let s = entry.path();
            let d = dst.join(entry.file_name());
            if s.is_dir() {
                let _ = fs::create_dir_all(&d);
                copy_dir_recursive(&s, &d);
            } else {
                let _ = fs::copy(&s, &d);
            }
        }
    }
}

fn patch_wechat_compat_js(dist: &Path, out: &mut Vec<String>) {
    let noop_body = concat!(
        "// PATCHED-BY-KUAIFANCLAW: host version check disabled (kuaifanclaw build may report older openclaw-cn versions)\n",
        "export function assertHostCompatibility(_hostVersion) { /* no-op */ }\n",
        "export function isHostVersionSupported(_hostVersion) { return true; }\n",
    );

    // Search both dist/src/ (compiled) and {plugin_root}/src/ (jiti loads .ts directly).
    let plugin_root = dist.parent().map(|p| p.to_path_buf());
    let mut dirs: Vec<PathBuf> = vec![dist.to_path_buf()];
    if let Some(ref root) = plugin_root {
        dirs.push(root.clone());
    }

    for dir in &dirs {
        for filename in &["compat.js", "compat.ts"] {
            let path = dir.join("src").join(filename);
            if !path.is_file() {
                continue;
            }
            let marker = "PATCHED-BY-KUAIFANCLAW: host version check disabled";
            if let Ok(txt) = fs::read_to_string(&path) {
                if txt.contains(marker) {
                    out.push(format!("  [skip] {} already patched", path.display()));
                    continue;
                }
            }
            if fs::write(&path, noop_body).is_ok() {
                out.push(format!("  [ok] {} replaced with no-op", path.display()));
            } else {
                out.push(format!("  [err] failed to write {}", path.display()));
            }
        }
    }
}

fn patch_wechat_index_js(dist: &Path, out: &mut Vec<String>) {
    let path = dist.join("index.js");
    if !path.is_file() {
        return;
    }
    let marker = "// PATCHED-BY-KUAIFANCLAW: register envelope";
    let txt = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(e) => {
            out.push(format!("  [err] read {}: {}", path.display(), e));
            return;
        }
    };
    if txt.contains(marker) {
        out.push(format!("  [skip] {} already patched", path.display()));
        return;
    }
    let original = r##"export { openclawWeixinPlugin } from "./src/channel.js";
//# sourceMappingURL=index.js.map"##;
    if !txt.contains(original) {
        out.push(format!("  [skip] {} no matching original", path.display()));
        return;
    }
    let patched = r##"import { openclawWeixinPlugin } from "./src/channel.js";

// PATCHED-BY-KUAIFANCLAW: register envelope (gateway loader expects register/activate)
const plugin = {
    id: "openclaw-weixin",
    register(api) {
        api.registerChannel({ plugin: openclawWeixinPlugin });
    },
};

export default plugin;
//# sourceMappingURL=index.js.map"##;
    let new_txt = txt.replace(original, patched);
    if let Err(e) = fs::write(&path, new_txt) {
        out.push(format!("  [err] write {}: {}", path.display(), e));
        return;
    }
    out.push(format!("  [ok] {}", path.display()));
}

fn ensure_once(path: &Path, marker: &str, search: &str, replace: &str) -> Result<bool, String> {
    let txt = fs::read_to_string(path).map_err(|e| format!("read failed: {}", e))?;
    if txt.contains(marker) {
        return Ok(false);
    }
    if !txt.contains(search) {
        return Err(format!("search not found ({} marker not present); plugin may have been updated upstream", MARKER_PREFIX));
    }
    let new_txt = txt.replacen(search, replace, 1);
    fs::write(path, new_txt).map_err(|e| format!("write failed: {}", e))?;
    Ok(true)
}

#[tauri::command]
pub async fn apply_plugin_patches_cmd(
    app: AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<Vec<String>, String> {
    let data_dir = data_dir.inner().get_data_dir();
    let resources = crate::bundled_env::resolve_bundled_plugin_tgz(&app, "wechat_clawbot")
        .and_then(|p| p.parent().and_then(|pp| pp.parent()).map(|p| p.to_path_buf()));
    let results = apply_plugin_patches(&data_dir, resources.as_deref());
    for line in &results {
        tracing::info!("[plugin_patch] {}", line);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ensure_once_replaces_and_idempotent() {
        let dir = std::env::temp_dir().join("kuaifan_patch_test");
        let _ = fs::create_dir_all(&dir);
        let p = dir.join("sample.txt");
        let _ = fs::remove_file(&p);
        fs::write(&p, "hello world
").unwrap();

        let first = ensure_once(&p, "// MARKER", "world", "// MARKER\nrust").unwrap();
        assert!(first);
        assert!(fs::read_to_string(&p).unwrap().contains("// MARKER"));

        let second = ensure_once(&p, "// MARKER", "world", "rust").unwrap();
        assert!(!second);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn ensure_wechat_account_index_uses_the_active_openclaw_state_dir() {
        let temp = tempfile::tempdir().unwrap();
        let account_dir = temp
            .path()
            .join("openclaw")
            .join("openclaw-weixin")
            .join("accounts");
        fs::create_dir_all(&account_dir).unwrap();
        fs::write(account_dir.join("default.json"), r#"{"token":"valid-token"}"#).unwrap();

        let mut output = Vec::new();
        ensure_wechat_account_index(temp.path(), &mut output);

        let index_path = temp
            .path()
            .join("openclaw")
            .join("openclaw-weixin")
            .join("accounts.json");
        let ids: Vec<String> = serde_json::from_str(&fs::read_to_string(index_path).unwrap()).unwrap();
        assert_eq!(ids, vec!["default"]);
    }

    #[test]
    fn patch_wechat_content_length_removes_the_manually_set_header() {
        let temp = tempfile::tempdir().unwrap();
        let api_dir = temp.path().join("dist").join("src").join("api");
        fs::create_dir_all(&api_dir).unwrap();
        let api_path = api_dir.join("api.js");
        fs::write(
            &api_path,
            "const headers = {\n  \"Content-Type\": \"application/json\",\n  AuthorizationType: \"ilink_bot_token\",\n  \"Content-Length\": String(Buffer.byteLength(opts.body, \"utf-8\")),\n};\n",
        )
        .unwrap();

        assert!(patch_wechat_content_length(&temp.path().join("dist"), &mut Vec::new()));
        let patched = fs::read_to_string(api_path).unwrap();
        assert!(!patched.contains("Content-Length"));
    }

    #[test]
    fn repair_wechat_runtime_moves_command_auth_imports_to_the_supported_subpath() {
        let temp = tempfile::tempdir().unwrap();
        let messaging_dir = temp
            .path()
            .join("plugins")
            .join("wechat_clawbot")
            .join("dist")
            .join("src")
            .join("messaging");
        fs::create_dir_all(&messaging_dir).unwrap();
        let process_message = messaging_dir.join("process-message.js");
        fs::write(
            &process_message,
            "import { createTypingCallbacks, resolveSenderCommandAuthorizationWithRuntime, resolveDirectDmAuthorizationOutcome, resolvePreferredOpenClawTmpDir, } from \"openclaw/plugin-sdk\";\n",
        )
        .unwrap();
        let send_message = messaging_dir.join("send.js");
        fs::write(
            &send_message,
            "import { stripMarkdown } from \"openclaw/plugin-sdk\";\n",
        )
        .unwrap();
        let auth_dir = temp
            .path()
            .join("plugins")
            .join("wechat_clawbot")
            .join("dist")
            .join("src")
            .join("auth");
        fs::create_dir_all(&auth_dir).unwrap();
        let pairing = auth_dir.join("pairing.js");
        fs::write(
            &pairing,
            "import { withFileLock } from \"openclaw/plugin-sdk\";\n",
        )
        .unwrap();

        repair_wechat_runtime_state(temp.path().to_str().unwrap());

        let patched = fs::read_to_string(&process_message).unwrap();
        assert!(patched.contains(
            "from \"openclaw/plugin-sdk/command-auth\""
        ));
        assert!(patched.contains("createTypingCallbacks"));
        assert!(patched.contains("resolvePreferredOpenClawTmpDir"));
        assert!(!patched.contains(
            "createTypingCallbacks, resolveSenderCommandAuthorizationWithRuntime"
        ));
        assert!(fs::read_to_string(&send_message)
            .unwrap()
            .contains("from \"openclaw/plugin-sdk/text-runtime\""));
        assert!(fs::read_to_string(&pairing)
            .unwrap()
            .contains("from \"openclaw/plugin-sdk/file-lock\""));

        let second = repair_wechat_runtime_state(temp.path().to_str().unwrap());
        assert_eq!(fs::read_to_string(&process_message).unwrap(), patched);
        assert!(!second
            .iter()
            .any(|line| line.contains("[wechat-command-auth] patched")));
    }
}

/// Restore dingtalk index.mjs from a .bak backup if the stub is still present.
fn restore_dingtalk_index_mjs_if_needed(dist: &Path, out: &mut Vec<String>) {
    let mjs = dist.join("index.mjs");
    if mjs.is_file() {
        return;
    }
    let bak = dist.join("index.mjs.bak");
    if !bak.is_file() {
        return;
    }
    match fs::copy(&bak, &mjs) {
        Ok(_) => out.push(format!("  [restore] {} <- {}", mjs.display(), bak.display())),
        Err(e) => out.push(format!("  [err] restore {}: {}", mjs.display(), e)),
    }
    let _ = fs::remove_file(&bak);
}

fn remove_dingtalk_index_js_stub_if_present(dist: &Path, out: &mut Vec<String>) {
    let path = dist.join("index.js");
    if !path.is_file() {
        return;
    }
    let txt = match fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return,
    };
    // Remove stub index.js that just imports index.mjs dynamically.
if !txt.contains("import('./index.mjs')") {
        return;
    }
    match fs::remove_file(&path) {
        Ok(_) => out.push(format!("  [remove-stub] {}", path.display())),
        Err(e) => out.push(format!("  [err] remove {}: {}", path.display(), e)),
    }
}
