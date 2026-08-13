use serde::Serialize;
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::time::{SystemTime, UNIX_EPOCH};

const MODULE_ID: &str = "infinite_canvas";
const DEFAULT_PORT: u16 = 18300;
const BUNDLE_NAME: &str = "infinite-canvas.zip";
const SHARED_PYTHON_ZIP: &str = "python.zip";
#[cfg(windows)]
const NO_WINDOW: u32 = 0x08000000;
#[cfg(windows)]
const DETACHED_PROCESS: u32 = 0x00000008;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfiniteCanvasStatus {
    pub installed: bool,
    pub running: bool,
    pub version: String,
    pub port: u16,
    pub gui_url: String,
    pub runtime_dir: String,
    pub data_dir: String,
    pub python_shared_from: String,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn bundled_dir_candidates() -> [PathBuf; 3] {
    [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("bundled-infinite-canvas"),
        std::env::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|parent| parent.join("bundled-infinite-canvas")))
            .unwrap_or_default(),
        std::env::current_exe()
            .ok()
            .and_then(|exe| {
                exe.parent()
                    .map(|parent| parent.join("resources").join("bundled-infinite-canvas"))
            })
            .unwrap_or_default(),
    ]
}

fn hermes_python_zip_candidates() -> [PathBuf; 3] {
    [
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("bundled-hermes")
            .join(SHARED_PYTHON_ZIP),
        std::env::current_exe()
            .ok()
            .and_then(|exe| {
                exe.parent()
                    .map(|parent| parent.join("bundled-hermes").join(SHARED_PYTHON_ZIP))
            })
            .unwrap_or_default(),
        std::env::current_exe()
            .ok()
            .and_then(|exe| {
                exe.parent().map(|parent| {
                    parent
                        .join("resources")
                        .join("bundled-hermes")
                        .join(SHARED_PYTHON_ZIP)
                })
            })
            .unwrap_or_default(),
    ]
}

fn resolve_bundle_zip() -> Result<PathBuf, String> {
    bundled_dir_candidates()
        .into_iter()
        .map(|dir| dir.join(BUNDLE_NAME))
        .find(|path| path.is_file())
        .ok_or_else(|| "未找到无限画布内置包 bundled-infinite-canvas/infinite-canvas.zip".to_string())
}

fn resolve_packages_zip() -> Result<PathBuf, String> {
    bundled_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("packages.zip"))
        .find(|path| path.is_file())
        .ok_or_else(|| "未找到无限画布依赖包 bundled-infinite-canvas/packages.zip".to_string())
}

fn resolve_shared_python_zip() -> Result<PathBuf, String> {
    hermes_python_zip_candidates()
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "未找到共用 Python 包 bundled-hermes/python.zip（无限画布与 Hermes 共用）".to_string()
        })
}

pub fn runtime_dir(data_base: &str) -> PathBuf {
    PathBuf::from(data_base).join("runtimes").join(MODULE_ID)
}

pub fn module_data_dir(data_base: &str) -> PathBuf {
    PathBuf::from(data_base).join("modules").join(MODULE_ID)
}

fn extract_zip(zip_path: &Path, target_dir: &Path) -> Result<(), String> {
    let data = std::fs::read(zip_path)
        .map_err(|error| format!("读取 {} 失败: {}", zip_path.display(), error))?;
    let cursor = std::io::Cursor::new(data);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|error| format!("打开 {} 失败: {}", zip_path.display(), error))?;
    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|error| format!("读取压缩条目 {} 失败: {}", index, error))?;
        let out_path = target_dir.join(file.mangled_name());
        if file.is_dir() {
            std::fs::create_dir_all(&out_path)
                .map_err(|error| format!("创建目录 {} 失败: {}", out_path.display(), error))?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("创建目录 {} 失败: {}", parent.display(), error))?;
        }
        let mut output = std::fs::File::create(&out_path)
            .map_err(|error| format!("创建文件 {} 失败: {}", out_path.display(), error))?;
        std::io::copy(&mut file, &mut output)
            .map_err(|error| format!("解压文件 {} 失败: {}", out_path.display(), error))?;
    }
    Ok(())
}


fn write_bootstrap_launcher(runtime_dir: &Path) -> Result<(), String> {
    // Bootstrap launcher for Infinite Canvas.
    // Keep the embedded Python source free of nested raw-string quote conflicts.
    let q = "\"";
    let lines = [
        "# -*- coding: utf-8 -*-",
        "import json, os, sys",
        "from pathlib import Path",
        "BASE = Path(__file__).resolve().parent",
        "HOME = Path(os.environ.get('INFINITE_CANVAS_HOME', BASE / 'module-home')).resolve()",
        "DATA = Path(os.environ.get('INFINITE_CANVAS_DATA', HOME / 'data')).resolve()",
        "ASSETS = Path(os.environ.get('INFINITE_CANVAS_ASSETS', HOME / 'assets')).resolve()",
        "API_ENV = Path(os.environ.get('INFINITE_CANVAS_API_ENV', HOME / 'API' / '.env')).resolve()",
        "PROVIDERS = Path(os.environ.get('API_PROVIDERS_FILE', HOME / 'config' / 'api_providers.json')).resolve()",
        "ROUTES = Path(os.environ.get('INFINITE_CANVAS_ROUTES_FILE', HOME / 'config' / 'model_routes.json')).resolve()",
        "PORT = int(os.environ.get('INFINITE_CANVAS_PORT') or os.environ.get('PORT') or '18300')",
        "for path in [HOME, DATA, DATA/'canvases', DATA/'conversations', DATA/'media_previews', ASSETS, ASSETS/'input', ASSETS/'output', ASSETS/'library', ASSETS/'uploads', HOME/'config', HOME/'API', HOME/'logs']:",
        "    path.mkdir(parents=True, exist_ok=True)",
        "if API_ENV.is_file():",
        "    for raw in API_ENV.read_text(encoding='utf-8', errors='ignore').splitlines():",
        "        line = raw.strip()",
        "        if not line or line.startswith('#') or '=' not in line:",
        "            continue",
        "        key, val = line.split('=', 1)",
        "        key = key.strip()",
        "        val = val.strip().strip(chr(34)).strip(chr(39))",
        "        if key and key not in os.environ:",
        "            os.environ[key] = val",
        "os.environ['API_PROVIDERS_FILE'] = str(PROVIDERS)",
        "os.environ['INFINITE_CANVAS_HOME'] = str(HOME)",
        "os.environ['INFINITE_CANVAS_DATA'] = str(DATA)",
        "os.environ['INFINITE_CANVAS_ASSETS'] = str(ASSETS)",
        "os.environ['INFINITE_CANVAS_ROUTES_FILE'] = str(ROUTES)",
        "os.environ['INFINITE_CANVAS_PORT'] = str(PORT)",
        "os.environ['PORT'] = str(PORT)",
        "os.chdir(BASE)",
        "sys.path.insert(0, str(BASE))",
        "import main as app_main",
        "app_main.BASE_DIR = str(BASE)",
        "app_main.DATA_DIR = str(DATA)",
        "app_main.CONVERSATION_DIR = str(DATA / 'conversations')",
        "app_main.CANVAS_DIR = str(DATA / 'canvases')",
        "app_main.MEDIA_PREVIEW_DIR = str(DATA / 'media_previews')",
        "app_main.ASSET_LIBRARY_PATH = str(DATA / 'asset_library.json')",
        "app_main.PROMPT_LIBRARY_PATH = str(DATA / 'prompt_libraries.json')",
        "app_main.API_PROVIDERS_FILE = str(PROVIDERS)",
        "app_main.RUNNINGHUB_WORKFLOW_STORE_FILE = str(DATA / 'runninghub_workflows.json')",
        "app_main.SHARED_FOLDERS_FILE = str(DATA / 'shared_folders.json')",
        "app_main.STORAGE_SETTINGS_FILE = str(DATA / 'storage_settings.json')",
        "app_main.PROJECTS_PATH = str(DATA / 'projects.json')",
        "app_main.API_ENV_FILE = str(API_ENV)",
        "app_main.GLOBAL_CONFIG_FILE = str(HOME / 'config' / 'global_config.json')",
        "app_main.ASSETS_DIR = str(ASSETS)",
        "app_main.OUTPUT_INPUT_DIR = str(ASSETS / 'input')",
        "app_main.OUTPUT_OUTPUT_DIR = str(ASSETS / 'output')",
        "app_main.ASSET_LIBRARY_DIR = str(ASSETS / 'library')",
        "app_main.LOCAL_UPLOAD_DIR = str(ASSETS / 'uploads')",
        "app_main.OUTPUT_DIR = str(ASSETS / 'output')",
        "",
        "# StaticFiles 在 main 导入时已挂到 runtime 默认目录；这里 ASSETS/DATA 已切到 modules 目录，",
        "# 必须重新挂载，否则 /assets/* /output/* 预览放大会空白。",
        "def remount_static_dirs():",
        "    try:",
        "        from fastapi.staticfiles import StaticFiles",
        "        routes = getattr(app_main.app, 'routes', None)",
        "        if routes is not None:",
        "            keep = []",
        "            for route in list(routes):",
        "                path = getattr(route, 'path', None)",
        "                if path in ('/static', '/output', '/assets'):",
        "                    continue",
        "                keep.append(route)",
        "            app_main.app.router.routes = keep",
        "        app_main.app.mount('/static', StaticFiles(directory=str(Path(app_main.STATIC_DIR))), name='static')",
        "        app_main.app.mount('/output', StaticFiles(directory=str(ASSETS / 'output')), name='output')",
        "        app_main.app.mount('/assets', StaticFiles(directory=str(ASSETS)), name='assets')",
        "        print('[kuaifanclaw] remounted /assets ->', ASSETS)",
        "        print('[kuaifanclaw] remounted /output ->', ASSETS / 'output')",
        "    except Exception as exc:",
        "        print('[kuaifanclaw] remount static failed:', exc)",
        "remount_static_dirs()",
        "def _load_json(path, default):",
        "    try:",
        "        if path.is_file():",
        "            return json.loads(path.read_text(encoding='utf-8'))",
        "    except Exception as exc:",
        "        print('[kuaifanclaw] load failed', path, exc)",
        "    return default",
        "def _providers():",
        "    raw = _load_json(PROVIDERS, [])",
        "    return raw if isinstance(raw, list) else []",
        "def _routes():",
        "    raw = _load_json(ROUTES, {})",
        "    return raw if isinstance(raw, dict) else {}",
        "def _provider_by_id(provider_id):",
        "    pid = str(provider_id or '').strip()",
        "    for item in _providers():",
        "        if str(item.get('id') or '') == pid:",
        "            return item",
        "    primary = next((p for p in _providers() if p.get('primary')), None)",
        "    return primary or (_providers()[0] if _providers() else {})",
        "def resolve_model_route(capability='chat', provider_id='', model=''):",
        "    capability = str(capability or 'chat').strip().lower()",
        "    routes = _routes()",
        "    default_route = dict(routes.get(capability) or {})",
        "    provider = _provider_by_id(provider_id or default_route.get('provider') or '')",
        "    pid = str(provider.get('id') or default_route.get('provider') or '')",
        "    model_name = str(model or default_route.get('model') or '').strip()",
        "    if not model_name:",
        "        key = {'chat':'chat_models','image':'image_models','video':'video_models'}.get(capability, 'chat_models')",
        "        models = provider.get(key) or []",
        "        model_name = str((models or [''])[0] or '')",
        "    protocols = provider.get('model_protocols') or {}",
        "    request_modes = provider.get('model_request_modes') or {}",
        "    protocol = str(protocols.get(model_name) or provider.get('protocol') or default_route.get('protocol') or 'openai')",
        "    if capability == 'image':",
        "        request_mode = str(request_modes.get(model_name) or provider.get('image_request_mode') or default_route.get('request_mode') or 'openai')",
        "    elif capability == 'video':",
        "        request_mode = str(request_modes.get(model_name) or provider.get('video_request_mode') or default_route.get('request_mode') or 'openai-video-proxy')",
        "    else:",
        "        request_mode = 'chat_completions'",
        "    return {",
        "        'capability': capability,",
        "        'provider': pid,",
        "        'model': model_name,",
        "        'protocol': protocol,",
        "        'request_mode': request_mode,",
        "        'base_url': str(provider.get('base_url') or default_route.get('base_url') or ''),",
        "        'api_key': str(provider.get('api_key') or ''),",
        "        'route': default_route,",
        "        'video_models': (provider.get('video_models') or default_route.get('models') or [])[:],",
        "        'image_models': provider.get('image_models') or [],",
        "        'chat_models': provider.get('chat_models') or [],",
        "    }",
        "app_main.resolve_model_route = resolve_model_route",
        "_orig_get_api_provider = getattr(app_main, 'get_api_provider', None)",
        "def get_api_provider_shared(provider_id='comfly'):",
        "    provider = _provider_by_id(provider_id)",
        "    if provider:",
        "        return provider",
        "    if callable(_orig_get_api_provider):",
        "        return _orig_get_api_provider(provider_id)",
        "    return {'id': provider_id or 'kuaifan', 'protocol': 'openai', 'base_url': '', 'api_key': '', 'chat_models': [], 'image_models': [], 'video_models': []}",
        "app_main.get_api_provider = get_api_provider_shared",
        "from fastapi import HTTPException",
        "@app_main.app.get('/api/kuaifan/model-routes')",
        "async def kuaifan_model_routes():",
        "    providers = []",
        "    for item in _providers():",
        "        providers.append({",
        "            'id': item.get('id'),",
        "            'name': item.get('name'),",
        "            'protocol': item.get('protocol'),",
        "            'enabled': item.get('enabled', True),",
        "            'primary': item.get('primary', False),",
        "            'chat_models': item.get('chat_models') or [],",
        "            'image_models': item.get('image_models') or [],",
        "            'video_models': item.get('video_models') or [],",
        "            'image_size_options': item.get('image_size_options') or ['auto','1k','2k','4k'],",
        "            'image_ratio_options': item.get('image_ratio_options') or ['square','portrait','landscape','wide','story'],",
        "            'video_resolution_options': item.get('video_resolution_options') or ['','480p','720p','1080p'],",
        "            'video_aspect_options': item.get('video_aspect_options') or ['16:9','9:16','1:1'],",
        "            'has_key': bool(item.get('api_key')),",
        "        })",
        "    return {'routes': _routes(), 'providers': providers, 'defaults': {'chat': resolve_model_route('chat'), 'image': resolve_model_route('image'), 'video': resolve_model_route('video')}}",
        "@app_main.app.post('/api/kuaifan/resolve-route')",
        "async def kuaifan_resolve_route(payload: dict):",
        "    capability = str((payload or {}).get('capability') or 'chat')",
        "    provider_id = str((payload or {}).get('provider_id') or (payload or {}).get('provider') or '')",
        "    model = str((payload or {}).get('model') or '')",
        "    route = resolve_model_route(capability, provider_id, model)",
        "    key = route.get('api_key') or ''",
        "    route['has_key'] = bool(key)",
        "    route['api_key_preview'] = (('*' * max(0, len(key)-4)) + key[-4:]) if key else ''",
        "    route.pop('api_key', None)",
        "    return route",
        "_orig_generate_ai_image = getattr(app_main, 'generate_ai_image', None)",
        "if callable(_orig_generate_ai_image):",
        "    async def generate_ai_image_shared(*args, **kwargs):",
        "        # Compat wrapper: main.py may pass 6-9 positionals including watermark=False.",
        "        prompt = kwargs.get('prompt', args[0] if len(args) > 0 else '')",
        "        size = kwargs.get('size', args[1] if len(args) > 1 else '')",
        "        quality = kwargs.get('quality', args[2] if len(args) > 2 else '')",
        "        model = kwargs.get('model', args[3] if len(args) > 3 else '')",
        "        reference_images = kwargs.get('reference_images', args[4] if len(args) > 4 else None)",
        "        provider_id = kwargs.get('provider_id', args[5] if len(args) > 5 else 'comfly')",
        "        aspect_ratio = kwargs.get('aspect_ratio', args[6] if len(args) > 6 else '')",
        "        resolution = kwargs.get('resolution', args[7] if len(args) > 7 else '')",
        "        watermark = kwargs.get('watermark', args[8] if len(args) > 8 else False)",
        "        route = resolve_model_route('image', provider_id, model)",
        "        provider_id = route.get('provider') or provider_id",
        "        model = route.get('model') or model",
        "        if not route.get('api_key'):",
        "            raise HTTPException(status_code=400, detail='Missing image API key. Save provider key in KuaiFan model settings first.')",
        "        call_kwargs = dict(kwargs)",
        "        call_kwargs.update({'prompt': prompt, 'size': size, 'quality': quality, 'model': model, 'reference_images': reference_images, 'provider_id': provider_id, 'aspect_ratio': aspect_ratio, 'resolution': resolution, 'watermark': watermark})",
        "        try:",
        "            return await _orig_generate_ai_image(**call_kwargs)",
        "        except TypeError:",
        "            pass",
        "        try:",
        "            return await _orig_generate_ai_image(prompt, size, quality, model, reference_images, provider_id, aspect_ratio, resolution, watermark)",
        "        except TypeError:",
        "            pass",
        "        try:",
        "            return await _orig_generate_ai_image(prompt, size, quality, model, reference_images, provider_id, aspect_ratio, resolution)",
        "        except TypeError:",
        "            return await _orig_generate_ai_image(prompt, size, quality, model, reference_images, provider_id)",
        "    app_main.generate_ai_image = generate_ai_image_shared",
        "if hasattr(app_main, 'canvas_video'):",
        "    _orig_canvas_video = app_main.canvas_video",
        "    async def canvas_video_shared(payload):",
        "        route = resolve_model_route('video', getattr(payload, 'provider_id', ''), getattr(payload, 'model', ''))",
        "        if not route.get('api_key'):",
        "            raise HTTPException(status_code=400, detail='Missing video API key. Save provider key in KuaiFan model settings first.')",
        "        if not getattr(payload, 'provider_id', None):",
        "            payload.provider_id = route.get('provider')",
        "        if not getattr(payload, 'model', None):",
        "            payload.model = route.get('model')",
        "        return await _orig_canvas_video(payload)",
        "    app_main.canvas_video = canvas_video_shared",
        "try:",
        "    import re as _re",
        "    def _provider_key_env(provider_id):",
        "        pid = str(provider_id or '').strip().lower()",
        "        if pid == 'comfly':",
        "            return 'COMFLY_API_KEY'",
        "        if pid == 'modelscope':",
        "            return 'MODELSCOPE_API_KEY'",
        "        if pid == 'runninghub':",
        "            return 'RUNNINGHUB_API_KEY'",
        "        if pid == 'volcengine':",
        "            return 'ARK_API_KEY'",
        "        return 'API_PROVIDER_' + _re.sub(r'[^A-Za-z0-9]', '_', pid).upper() + '_KEY'",
        "    def _provider_api_key(provider):",
        "        if not isinstance(provider, dict):",
        "            return ''",
        "        key = str(provider.get('api_key') or '').strip()",
        "        if key:",
        "            return key",
        "        pid = str(provider.get('id') or '').strip()",
        "        env_name = _provider_key_env(pid)",
        "        return str(os.environ.get(env_name) or os.environ.get('API_KEY') or os.environ.get('OPENAI_API_KEY') or '').strip()",
        "    providers = _providers()",
        "    for item in providers:",
        "        key = _provider_api_key(item)",
        "        pid = str(item.get('id') or '').strip()",
        "        if key and pid:",
        "            os.environ[_provider_key_env(pid)] = key",
        "            item['api_key'] = key",
        "    primary = next((p for p in providers if p.get('primary')), None) or (providers[0] if providers else {})",
        "    if primary:",
        "        primary_key = _provider_api_key(primary)",
        "        if primary_key:",
        "            app_main.AI_API_KEY = primary_key",
        "            os.environ['API_KEY'] = primary_key",
        "            os.environ['OPENAI_API_KEY'] = primary_key",
        "            os.environ[_provider_key_env(primary.get('id'))] = primary_key",
        "        if primary.get('base_url'):",
        "            app_main.AI_BASE_URL = primary.get('base_url')",
        "            os.environ['OPENAI_BASE_URL'] = str(primary.get('base_url'))",
        "        if primary.get('chat_models'):",
        "            app_main.CHAT_MODELS = list(primary.get('chat_models') or [])",
        "            app_main.CHAT_MODEL = app_main.CHAT_MODELS[0]",
        "        if primary.get('image_models'):",
        "            app_main.IMAGE_MODELS = list(primary.get('image_models') or [])",
        "            if app_main.IMAGE_MODELS:",
        "                app_main.IMAGE_MODEL = app_main.IMAGE_MODELS[0]",
        "        if primary.get('video_models'):",
        "            app_main.VIDEO_MODELS = list(primary.get('video_models') or [])",
        "    _orig_provider_env_key_value = getattr(app_main, 'provider_env_key_value', None)",
        "    def provider_env_key_value_shared(provider_id):",
        "        pid = str(provider_id or '').strip().lower()",
        "        for item in _providers():",
        "            if str(item.get('id') or '').strip().lower() == pid:",
        "                key = _provider_api_key(item)",
        "                if key:",
        "                    return key",
        "        if callable(_orig_provider_env_key_value):",
        "            return _orig_provider_env_key_value(provider_id)",
        "        return str(os.environ.get(_provider_key_env(pid)) or '').strip()",
        "    app_main.provider_env_key_value = provider_env_key_value_shared",
        "    _orig_public_provider = getattr(app_main, 'public_provider', None)",
        "    if callable(_orig_public_provider):",
        "        def public_provider_shared(provider):",
        "            item = dict(provider or {})",
        "            key = _provider_api_key(item)",
        "            if key:",
        "                item['api_key'] = key",
        "            public = _orig_public_provider(item)",
        "            if isinstance(public, dict):",
        "                public['has_key'] = bool(key or public.get('has_key'))",
        "                if key and not public.get('key_preview'):",
        "                    public['key_preview'] = ('*' * max(0, len(key)-4)) + key[-4:]",
        "            return public",
        "        app_main.public_provider = public_provider_shared",
        "except Exception as exc:",
        "    print('[kuaifanclaw] hydrate shared models failed', exc)",
        "import uvicorn",
        "uvicorn.run(app_main.app, host='127.0.0.1', port=PORT, ws_ping_interval=None, ws_ping_timeout=None)",
    ];
    let _ = q;
    let script = lines.join("\n") + "\n";
    std::fs::write(runtime_dir.join("kuaifan_bootstrap.py"), script)
        .map_err(|error| format!("write infinite canvas bootstrap failed: {}", error))?;
    Ok(())
}

fn write_runtime_manifest(runtime_dir: &Path, version: &str) -> Result<(), String> {
    // 字段名必须与 runtime.rs 中 RuntimeManifest 的 serde 约定一致，
    // 否则 start_runtime 解析 runtime.json 会失败，顶部启动按钮无法拉起。
    let manifest = json!({
        "id": MODULE_ID,
        "name": "画布与视频",
        "description": "画布与视频：LLM / 生图 / 生视频一体化画布",
        "version": version,
        "category": "creative",
        "icon": "canvas",
        "capabilities": ["canvas", "image", "video", "chat"],
        "launch": {
            "command": "{runtimeDir}/python/pythonw.exe",
            "args": ["kuaifan_bootstrap.py"],
            "cwd": ".",
            "env": {
                "INFINITE_CANVAS_PORT": "{guiPort}",
                "PORT": "{guiPort}",
                "PYTHONUTF8": "1",
                "PYTHONIOENCODING": "utf-8"
            },
            "healthUrl": "http://127.0.0.1:{guiPort}/",
            "readyTimeoutMs": 90000
        },
        "gui": {
            "type": "web",
            "urlTemplate": "http://127.0.0.1:{guiPort}/static/index.html?page=canvas",
            "defaultGuiPort": DEFAULT_PORT
        },
        "ports": {
            "gui": { "default": DEFAULT_PORT, "env": "INFINITE_CANVAS_PORT" },
            "gateway": { "default": 0, "env": "INFINITE_CANVAS_GATEWAY_PORT" }
        },
        "requires": {
            "python": {
                "bundled": SHARED_PYTHON_ZIP,
                "min_version": "3.11.0",
                "check": "import fastapi, uvicorn, httpx, PIL"
            }
        }
    });
    let path = runtime_dir.join("runtime.json");
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|error| format!("写入 runtime.json 失败: {}", error))?;
    Ok(())
}

fn ensure_module_dirs(data_base: &str) -> Result<PathBuf, String> {
    let root = module_data_dir(data_base);
    for rel in [
        "config",
        "API",
        "data/canvases",
        "data/conversations",
        "data/media_previews",
        "assets/input",
        "assets/output",
        "assets/library",
        "assets/uploads",
        "logs",
        "state",
    ] {
        std::fs::create_dir_all(root.join(rel))
            .map_err(|error| format!("创建无限画布目录 {} 失败: {}", rel, error))?;
    }
    Ok(root)
}

fn read_bundle_version() -> String {
    bundled_dir_candidates()
        .into_iter()
        .map(|dir| dir.join("manifest.json"))
        .find_map(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|value| {
            value
                .get("version")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "0.0.0".to_string())
}

fn yaml_string(value: Option<&serde_yaml::Value>) -> String {
    value
        .and_then(serde_yaml::Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn default_base_url(provider_id: &str) -> &'static str {
    match provider_id {
        "kuaifan" => "https://kuaifanio.cn/v1",
        "openai" => "https://api.openai.com/v1",
        "anthropic" => "https://api.anthropic.com/v1",
        "deepseek" => "https://api.deepseek.com/v1",
        "minimax" => "https://api.minimax.chat/v1",
        "volc_ark" | "volcengine" => "https://ark.cn-beijing.volces.com/api/v3",
        "nvidia" => "https://integrate.api.nvidia.com/v1",
        "aliyun" => "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "zhipu" => "https://open.bigmodel.cn/api/paas/v4",
        "moonshot" => "https://api.moonshot.cn/v1",
        "baidu" => "https://qianfan.baidubce.com/v2",
        "xiaomi" => "https://api.xiaomi.com/v1",
        "google" => "https://generativelanguage.googleapis.com/v1beta/openai",
        "grok" => "https://api.x.ai/v1",
        _ => "",
    }
}

fn map_provider_id(provider_id: &str) -> String {
    match provider_id {
        "volc_ark" => "volcengine".to_string(),
        other => other.to_string(),
    }
}

fn map_protocol(provider_id: &str) -> &'static str {
    match provider_id {
        "google" => "gemini",
        "grok" => "grok",
        "volc_ark" | "volcengine" => "volcengine",
        _ => "openai",
    }
}

fn decrypt_api_key(value: &str, data_dir: &str) -> String {
    if !value.starts_with(crate::services::cipher::CIPHER_PREFIX) {
        return value.to_string();
    }
    let Ok(key) = crate::services::cipher::get_or_create_cipher_key_sync(data_dir) else {
        return value.to_string();
    };
    crate::services::cipher::decrypt_credential(value, &key).unwrap_or_else(|| value.to_string())
}

fn load_existing_providers(path: &Path) -> BTreeMap<String, serde_json::Value> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return BTreeMap::new();
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return BTreeMap::new();
    };
    let mut map = BTreeMap::new();
    if let Some(list) = value.as_array() {
        for item in list {
            if let Some(id) = item.get("id").and_then(|v| v.as_str()) {
                map.insert(id.to_string(), item.clone());
            }
        }
    }
    map
}


fn provider_display_name(provider_id: &str) -> String {
    match provider_id {
        "kuaifan" => "快泛API".into(),
        "openai" => "OpenAI".into(),
        "google" => "Google Gemini".into(),
        "deepseek" => "DeepSeek".into(),
        "minimax" => "MiniMax".into(),
        "volc_ark" | "volcengine" => "火山引擎".into(),
        "aliyun" => "阿里云百炼".into(),
        "zhipu" => "智谱".into(),
        "moonshot" => "Kimi".into(),
        "grok" => "xAI Grok".into(),
        other => other.to_string(),
    }
}

fn default_media_models(_provider_id: &str) -> (Vec<String>, Vec<String>) {
    // 不再写死本地/Comfy 默认模型；快泛等在线模型从目录动态投影。
    (Vec::new(), Vec::new())
}

fn infer_model_kind(model_name: &str, explicit: &str) -> String {
    let explicit = explicit.trim().to_ascii_lowercase();
    if matches!(explicit.as_str(), "chat" | "image" | "video") {
        return explicit;
    }
    let m = model_name.to_ascii_lowercase();
    if m.contains("image")
        || m.contains("dall")
        || m.contains("flux")
        || m.contains("seedream")
        || m.contains("imagen")
        || m.contains("sdxl")
        || m.contains("wanx")
        || m.contains("gpt-image")
        || m.contains("cogview")
    {
        return "image".into();
    }
    if m.contains("video")
        || m.contains("veo")
        || m.contains("sora")
        || m.contains("seedance")
        || m.contains("kling")
        || m.contains("wan2.")
        || m.contains("t2v")
        || m.contains("i2v")
        || m.contains("runway")
        || m.contains("luma")
    {
        return "video".into();
    }
    "chat".into()
}

fn prefer_media_model(a: &str, b: &str, kind: &str) -> std::cmp::Ordering {
    let score = |name: &str| -> i32 {
        let m = name.to_ascii_lowercase();
        let mut s = 0;
        if kind == "image" {
            if m.contains("seedream") { s += 100; }
            if m.contains("doubao") { s += 40; }
            if m.contains("flux") || m.contains("gpt-image") { s += 20; }
        } else if kind == "video" {
            if m.contains("seedance") { s += 100; }
            if m.contains("doubao") { s += 40; }
            if m.contains("veo") || m.contains("kling") { s += 20; }
        }
        if m.contains("pro") { s += 5; }
        -s // higher score first via reverse later
    };
    score(a).cmp(&score(b)).then_with(|| a.cmp(b))
}

fn sort_media_models(models: &mut Vec<String>, kind: &str) {
    models.sort_by(|a, b| prefer_media_model(a, b, kind));
}

async fn fill_models_from_provider_catalog(
    source_id: &str,
    api_key: &str,
    chat_models: &mut Vec<String>,
    image_models: &mut Vec<String>,
    video_models: &mut Vec<String>,
) {
    // 快泛 API：models.yaml 通常只保存 default chat，不持久化 media 模型列表。
    // 从模型目录补齐豆包 Seedream/Seedance 等生图/生视频模型。
    if source_id != "kuaifan" || api_key.trim().is_empty() {
        return;
    }
    if !image_models.is_empty() && !video_models.is_empty() && !chat_models.is_empty() {
        return;
    }
    let Ok(entries) =
        crate::commands::model::list_models("kuaifan".into(), Some(api_key.to_string())).await
    else {
        return;
    };
    for entry in entries {
        let name = entry.id.trim();
        if name.is_empty() {
            continue;
        }
        match infer_model_kind(name, "").as_str() {
            "image" => {
                if !image_models.iter().any(|m| m == name) {
                    image_models.push(name.to_string());
                }
            }
            "video" => {
                if !video_models.iter().any(|m| m == name) {
                    video_models.push(name.to_string());
                }
            }
            _ => {
                if !chat_models.iter().any(|m| m == name) {
                    chat_models.push(name.to_string());
                }
            }
        }
    }
    sort_media_models(image_models, "image");
    sort_media_models(video_models, "video");
}

fn default_image_request_mode(provider_id: &str) -> &'static str {
    match provider_id {
        "kuaifan" | "openai" => "openai",
        "google" => "openai",
        _ => "openai",
    }
}

fn default_video_request_mode(provider_id: &str) -> &'static str {
    match provider_id {
        "kuaifan" | "openai" | "google" | "aliyun" | "volc_ark" | "volcengine" | "minimax" => {
            "openai-video-proxy"
        }
        _ => "openai-video-proxy",
    }
}

fn parse_env_file(content: &str) -> BTreeMap<String, String> {
    let mut values = BTreeMap::new();
    for raw in content.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || !line.contains('=') {
            continue;
        }
        let mut parts = line.splitn(2, '=');
        let key = parts.next().unwrap_or("").trim();
        if key.is_empty() {
            continue;
        }
        let mut value = parts.next().unwrap_or("").trim().to_string();
        if value.len() >= 2 {
            let bytes = value.as_bytes();
            let first = bytes[0] as char;
            let last = bytes[value.len() - 1] as char;
            if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
                value = value[1..value.len() - 1].to_string();
            }
        }
        values.insert(key.to_string(), value);
    }
    values
}

fn quote_env_value(value: &str) -> String {
    if value.is_empty()
        || value
            .chars()
            .any(|ch| ch.is_whitespace() || ch == '#' || ch == '"' || ch == '\'')
    {
        let escaped = value.replace("\\", "\\\\").replace("\"", "\\\"");
        format!("\"{}\"", escaped)
    } else {
        value.to_string()
    }
}

/// 合并写入 API/.env：更新共享模型相关键，保留画布内配置（如 COMFYUI_INSTANCES）。
fn merge_infinite_canvas_env_file(
    path: &Path,
    managed: &BTreeMap<String, String>,
) -> Result<(), String> {
    let existing_raw = std::fs::read_to_string(path).unwrap_or_default();
    let existing = parse_env_file(&existing_raw);
    let mut merged = existing;
    for (key, value) in managed {
        if value.is_empty() {
            merged.remove(key);
        } else {
            merged.insert(key.clone(), value.clone());
        }
    }
    // 确保至少有默认 Comfy 地址，避免用户尚未配置时为空
    merged
        .entry("COMFYUI_INSTANCES".to_string())
        .or_insert_with(|| "127.0.0.1:8188".to_string());

    let mut lines = vec![
        format!("# generated by kuaifanclaw at {}", now_secs()),
        "# managed keys come from data/config/models.yaml".to_string(),
        "# preserved keys include canvas-local settings such as COMFYUI_INSTANCES".to_string(),
    ];
    for (key, value) in &merged {
        lines.push(format!("{}={}", key, quote_env_value(value)));
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("创建无限画布 API 目录失败: {}", error))?;
    }
    std::fs::write(path, lines.join("\n") + "\n")
        .map_err(|error| format!("写入无限画布 API/.env 失败: {}", error))?;
    Ok(())
}

/// 将共享 models.yaml 投影到无限画布：
/// - Key / base_url 来自共享模型配置
/// - chat/image/video 模型目录写入 api_providers.json
/// - 请求路由写入 model_routes.json（含尺寸/分辨率选项）
pub async fn sync_infinite_canvas_configuration(data_dir: &str) -> Result<(), String> {
    let module_root = ensure_module_dirs(data_dir)?;
    let models_path = PathBuf::from(data_dir).join("config").join("models.yaml");
    let models_raw = crate::commands::gateway::read_models_yaml_raw_utf8_or_utf16(&models_path)
        .unwrap_or_default();
    let models: serde_yaml::Value = serde_yaml::from_str(
        models_raw.strip_prefix('\u{feff}').unwrap_or(&models_raw),
    )
    .unwrap_or(serde_yaml::Value::Mapping(Default::default()));

    let default_model = models.get("default_model");
    let default_provider = yaml_string(default_model.and_then(|value| value.get("provider")));
    let default_model_name = yaml_string(default_model.and_then(|value| value.get("model_name")));

    let providers_path = module_root.join("config").join("api_providers.json");
    let existing = load_existing_providers(&providers_path);

    let mut projected = Vec::new();
    let mut route_chat = serde_json::Map::new();
    let mut route_image = serde_json::Map::new();
    let mut route_video = serde_json::Map::new();

    if let Some(providers) = models.get("providers").and_then(serde_yaml::Value::as_mapping) {
        for (provider_key, provider_value) in providers {
            let source_id = yaml_string(Some(provider_key));
            if source_id.is_empty() {
                continue;
            }
            let enabled = provider_value
                .get("enabled")
                .and_then(serde_yaml::Value::as_bool)
                .unwrap_or(true);
            // 无 key 的 provider 不投影，避免空壳污染节点下拉
            let api_key = decrypt_api_key(&yaml_string(provider_value.get("api_key")), data_dir);
            if !enabled || api_key.is_empty() {
                continue;
            }

            let target_id = map_provider_id(&source_id);
            let mut base_url = yaml_string(provider_value.get("base_url"));
            if base_url.is_empty() {
                base_url = default_base_url(&source_id).to_string();
            }
            if base_url.is_empty() {
                continue;
            }

            let mut chat_models = Vec::new();
            let mut image_models = Vec::new();
            let mut video_models = Vec::new();
            let mut model_protocols = serde_json::Map::new();
            let mut model_request_modes = serde_json::Map::new();

            if let Some(models_map) = provider_value
                .get("models")
                .and_then(serde_yaml::Value::as_mapping)
            {
                for (model_key, model_val) in models_map {
                    let name = yaml_string(Some(model_key));
                    if name.is_empty() {
                        continue;
                    }
                    let explicit_kind = yaml_string(model_val.get("kind"));
                    let kind = infer_model_kind(&name, &explicit_kind);
                    let protocol = {
                        let p = yaml_string(model_val.get("protocol"));
                        if p.is_empty() {
                            map_protocol(&source_id).to_string()
                        } else {
                            p
                        }
                    };
                    let request_mode = yaml_string(model_val.get("request_mode"));
                    match kind.as_str() {
                        "image" => {
                            if !image_models.iter().any(|m| m == &name) {
                                image_models.push(name.clone());
                            }
                            model_protocols.insert(name.clone(), json!(protocol));
                            model_request_modes.insert(
                                name.clone(),
                                json!(if request_mode.is_empty() {
                                    default_image_request_mode(&source_id).to_string()
                                } else {
                                    request_mode
                                }),
                            );
                        }
                        "video" => {
                            if !video_models.iter().any(|m| m == &name) {
                                video_models.push(name.clone());
                            }
                            model_protocols.insert(name.clone(), json!(protocol));
                            model_request_modes.insert(
                                name.clone(),
                                json!(if request_mode.is_empty() {
                                    default_video_request_mode(&source_id).to_string()
                                } else {
                                    request_mode
                                }),
                            );
                        }
                        _ => {
                            if !chat_models.iter().any(|m| m == &name) {
                                chat_models.push(name.clone());
                            }
                        }
                    }
                }
            }

            if source_id == default_provider && !default_model_name.is_empty() {
                if !chat_models.iter().any(|m| m == &default_model_name) {
                    chat_models.insert(0, default_model_name.clone());
                }
            }

            // 快泛等共享供应商：从模型目录补齐豆包生图/生视频，避免节点回退到 Comfy/ModelScope。
            fill_models_from_provider_catalog(
                &source_id,
                &api_key,
                &mut chat_models,
                &mut image_models,
                &mut video_models,
            )
            .await;
            if source_id == default_provider && !default_model_name.is_empty() {
                if let Some(pos) = chat_models.iter().position(|m| m == &default_model_name) {
                    let model = chat_models.remove(pos);
                    chat_models.insert(0, model);
                }
            }

            for model in &image_models {
                model_protocols
                    .entry(model.clone())
                    .or_insert_with(|| json!(map_protocol(&source_id)));
                model_request_modes
                    .entry(model.clone())
                    .or_insert_with(|| json!(default_image_request_mode(&source_id)));
            }
            for model in &video_models {
                model_protocols
                    .entry(model.clone())
                    .or_insert_with(|| json!(map_protocol(&source_id)));
                model_request_modes
                    .entry(model.clone())
                    .or_insert_with(|| json!(default_video_request_mode(&source_id)));
            }

            let is_primary = source_id == default_provider
                || (default_provider.is_empty() && projected.is_empty());

            let mut entry = existing
                .get(&target_id)
                .cloned()
                .unwrap_or_else(|| json!({ "id": target_id }));
            if let Some(obj) = entry.as_object_mut() {
                obj.insert("id".into(), json!(target_id));
                obj.insert("name".into(), json!(provider_display_name(&source_id)));
                obj.insert("base_url".into(), json!(base_url.clone()));
                obj.insert("protocol".into(), json!(map_protocol(&source_id)));
                obj.insert(
                    "image_request_mode".into(),
                    json!(default_image_request_mode(&source_id)),
                );
                obj.insert(
                    "video_request_mode".into(),
                    json!(default_video_request_mode(&source_id)),
                );
                obj.insert("enabled".into(), json!(true));
                obj.insert("primary".into(), json!(is_primary));
                obj.insert("api_key".into(), json!(api_key.clone()));
                obj.insert("chat_models".into(), json!(chat_models.clone()));
                obj.insert("image_models".into(), json!(image_models.clone()));
                obj.insert("video_models".into(), json!(video_models.clone()));
                obj.insert("model_names".into(), json!({}));
                obj.insert("model_protocols".into(), json!(model_protocols.clone()));
                obj.insert(
                    "model_request_modes".into(),
                    json!(model_request_modes.clone()),
                );
                // 尺寸目录（节点 UI 读取后端 config 时可扩展；前端已有内置尺寸）
                obj.insert(
                    "image_size_options".into(),
                    json!(["auto", "1k", "2k", "4k"]),
                );
                obj.insert(
                    "image_ratio_options".into(),
                    json!([
                        "square", "portrait", "landscape", "portrait43", "landscape43", "story",
                        "wide", "ultrawide", "ultratall", "source", "custom"
                    ]),
                );
                obj.insert(
                    "video_resolution_options".into(),
                    json!(["", "480p", "720p", "1080p"]),
                );
                obj.insert(
                    "video_aspect_options".into(),
                    json!(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "9:21", "keep_ratio", "adaptive"]),
                );
            }
            projected.push(entry);

            if is_primary || route_chat.is_empty() {
                if let Some(model) = chat_models.first() {
                    route_chat = json!({
                        "provider": target_id,
                        "model": model,
                        "protocol": map_protocol(&source_id),
                        "base_url": base_url,
                        "api_key_ref": format!("providers.{}.api_key", target_id)
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                }
                if let Some(model) = image_models.first() {
                    route_image = json!({
                        "provider": target_id,
                        "model": model,
                        "protocol": map_protocol(&source_id),
                        "request_mode": default_image_request_mode(&source_id),
                        "base_url": base_url,
                        "endpoint": "/images/generations",
                        "default_resolution": "1k",
                        "default_ratio": "square",
                        "size_options": ["auto", "1k", "2k", "4k"],
                        "ratio_options": ["square","portrait","landscape","story","wide","source","custom"],
                        "api_key_ref": format!("providers.{}.api_key", target_id)
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                }
                // 默认视频路由指向前两个模型中的第一个，并暴露 dual_models
                if !video_models.is_empty() {
                    let dual: Vec<String> = video_models.iter().take(2).cloned().collect();
                    route_video = json!({
                        "provider": target_id,
                        "model": dual.first().cloned().unwrap_or_default(),
                        "models": dual,
                        "protocol": map_protocol(&source_id),
                        "request_mode": default_video_request_mode(&source_id),
                        "base_url": base_url,
                        "submit_endpoint": "/videos/generations",
                        "query_endpoint": "/videos/tasks/{task_id}",
                        "default_resolution": "720p",
                        "default_aspect_ratio": "16:9",
                        "default_duration": 5,
                        "resolution_options": ["", "480p", "720p", "1080p"],
                        "aspect_options": ["16:9","9:16","1:1","4:3","3:4"],
                        "api_key_ref": format!("providers.{}.api_key", target_id)
                    })
                    .as_object()
                    .cloned()
                    .unwrap_or_default();
                }
            }
        }
    }

    if projected.is_empty() {
        // 无可用共享 Key 时，仍写一个空壳 primary，节点会提示去模型配置页
        projected.push(json!({
            "id": "kuaifan",
            "name": "快泛API",
            "base_url": default_base_url("kuaifan"),
            "protocol": "openai",
            "image_request_mode": "openai",
            "video_request_mode": "openai-video-proxy",
            "enabled": true,
            "primary": true,
            "chat_models": if default_model_name.is_empty() { Vec::<String>::new() } else { vec![default_model_name.clone()] },
            "image_models": [],
            "video_models": [],
            "model_names": {},
            "model_protocols": {},
            "model_request_modes": {},
            "image_size_options": ["auto", "1k", "2k", "4k"],
            "video_resolution_options": ["", "480p", "720p", "1080p"]
        }));
    } else {
        let has_primary = projected
            .iter()
            .any(|item| item.get("primary").and_then(|v| v.as_bool()).unwrap_or(false));
        if !has_primary {
            if let Some(first) = projected.first_mut().and_then(|item| item.as_object_mut()) {
                first.insert("primary".into(), json!(true));
            }
        }
    }

    std::fs::write(
        &providers_path,
        serde_json::to_string_pretty(&projected).map_err(|e| e.to_string())?,
    )
    .map_err(|error| format!("写入无限画布 api_providers.json 失败: {}", error))?;

    let routes = json!({
        "version": 1,
        "source": "data/config/models.yaml",
        "updatedAt": now_secs(),
        "chat": route_chat,
        "image": route_image,
        "video": route_video,
        "ui": {
            "generatorNode": {
                "showModels": true,
                "showResolution": true,
                "showRatio": true
            },
            "videoNode": {
                "showModels": true,
                "preferredModelCount": 2,
                "showResolution": true,
                "showAspectRatio": true,
                "showDuration": true
            }
        }
    });
    std::fs::write(
        module_root.join("config").join("model_routes.json"),
        serde_json::to_string_pretty(&routes).map_err(|e| e.to_string())?,
    )
    .map_err(|error| format!("写入 model_routes.json 失败: {}", error))?;

    // 同步共享模型 Key/BaseURL/模型列表到 API/.env，并保留画布本地配置（如 COMFYUI_INSTANCES）
    let mut managed_env: BTreeMap<String, String> = BTreeMap::new();
    managed_env.insert("INFINITE_CANVAS_USE_SHARED_MODELS".into(), "1".into());
    managed_env.insert(
        "INFINITE_CANVAS_ROUTES_FILE".into(),
        module_root
            .join("config")
            .join("model_routes.json")
            .to_string_lossy()
            .to_string(),
    );
    managed_env.insert(
        "API_PROVIDERS_FILE".into(),
        providers_path.to_string_lossy().to_string(),
    );
    // 无限画布运行时通过 provider_env_key_value() 读取 API_PROVIDER_<ID>_KEY，
    // 不能只写通用 API_KEY / OPENAI_API_KEY，否则 LLM/生图/生视频会报“未配置 API Key”。
    for item in &projected {
        let provider_id = item
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let api_key = item
            .get("api_key")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if provider_id.is_empty() || api_key.is_empty() {
            continue;
        }
        let env_name = match provider_id.as_str() {
            "comfly" => "COMFLY_API_KEY".to_string(),
            "modelscope" => "MODELSCOPE_API_KEY".to_string(),
            "runninghub" => "RUNNINGHUB_API_KEY".to_string(),
            "volcengine" => "ARK_API_KEY".to_string(),
            other => {
                let safe = other
                    .chars()
                    .map(|ch| if ch.is_ascii_alphanumeric() { ch.to_ascii_uppercase() } else { '_' })
                    .collect::<String>();
                format!("API_PROVIDER_{}_KEY", safe)
            }
        };
        managed_env.insert(env_name, api_key.to_string());
    }
    if let Some(primary) = projected
        .iter()
        .find(|item| item.get("primary").and_then(|v| v.as_bool()).unwrap_or(false))
        .or_else(|| projected.first())
    {
        if let Some(key) = primary.get("api_key").and_then(|v| v.as_str()) {
            if !key.is_empty() {
                managed_env.insert("API_KEY".into(), key.to_string());
                managed_env.insert("OPENAI_API_KEY".into(), key.to_string());
            }
        }
        if let Some(base) = primary.get("base_url").and_then(|v| v.as_str()) {
            if !base.is_empty() {
                managed_env.insert("OPENAI_BASE_URL".into(), base.to_string());
                managed_env.insert("COMFLY_BASE_URL".into(), base.to_string());
                managed_env.insert("AI_BASE_URL".into(), base.to_string());
            }
        }
        if let Some(models) = primary
            .get("chat_models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            })
        {
            if !models.is_empty() {
                managed_env.insert("CHAT_MODELS".into(), models.clone());
                if let Some(first) = models.split(',').next() {
                    managed_env.insert("CHAT_MODEL".into(), first.to_string());
                }
            }
        }
        if let Some(models) = primary
            .get("image_models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            })
        {
            if !models.is_empty() {
                managed_env.insert("IMAGE_MODELS".into(), models.clone());
                if let Some(first) = models.split(',').next() {
                    managed_env.insert("IMAGE_MODEL".into(), first.to_string());
                }
            }
        }
        if let Some(models) = primary
            .get("video_models")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            })
        {
            if !models.is_empty() {
                managed_env.insert("VIDEO_MODELS".into(), models);
            }
        }
    }
    merge_infinite_canvas_env_file(&module_root.join("API").join(".env"), &managed_env)?;

    let meta = json!({
        "id": MODULE_ID,
        "name": "画布与视频",
        "updatedAt": now_secs(),
        "sharedModelSource": "data/config/models.yaml",
        "routesFile": "config/model_routes.json",
        "discardBuiltinApiConfig": true,
        "pythonSharedFrom": "bundled-hermes/python.zip"
    });
    let config_modules = PathBuf::from(data_dir)
        .join("config")
        .join("modules")
        .join(MODULE_ID);
    std::fs::create_dir_all(&config_modules)
        .map_err(|error| format!("创建模块配置目录失败: {}", error))?;
    std::fs::write(
        config_modules.join("module.yaml"),
        format!(
            "id: {}\nname: 画布与视频\nport: {}\nshared_python: bundled-hermes/python.zip\nshared_models: data/config/models.yaml\nroutes: data/modules/infinite_canvas/config/model_routes.json\n",
            MODULE_ID, DEFAULT_PORT
        ),
    )
    .map_err(|error| format!("写入 module.yaml 失败: {}", error))?;
    std::fs::write(
        module_root.join("state").join("last_sync.json"),
        serde_json::to_string_pretty(&meta).map_err(|e| e.to_string())?,
    )
    .map_err(|error| format!("写入同步状态失败: {}", error))?;

    Ok(())
}

pub fn ensure_infinite_canvas_runtime(data_base: &str) -> Result<PathBuf, String> {
    let runtime = runtime_dir(data_base);
    let main_py = runtime.join("main.py");
    let python_exe = runtime.join("python").join("python.exe");
    let version = read_bundle_version();
    let marker = runtime.join(".bundle_version");
    let installed_version = std::fs::read_to_string(&marker).unwrap_or_default();
    let needs_app = !main_py.is_file() || installed_version.trim() != version;
    let needs_python = !python_exe.is_file();

    if needs_app {
        let bundle = resolve_bundle_zip()?;
        std::fs::create_dir_all(&runtime)
            .map_err(|error| format!("创建无限画布运行目录失败: {}", error))?;
        extract_zip(&bundle, &runtime)?;
        std::fs::write(&marker, format!("{}\n", version))
            .map_err(|error| format!("写入无限画布版本标记失败: {}", error))?;
    }

    let python_dir = runtime.join("python");
    if needs_python {
        let python_zip = resolve_shared_python_zip()?;
        std::fs::create_dir_all(&python_dir)
            .map_err(|error| format!("create infinite canvas python dir failed: {}", error))?;
        extract_zip(&python_zip, &python_dir)?;
    }

    // Hermes 业务依赖（含 cp311 的 Pillow 原生扩展）在 hermes 运行时根目录，不在 python/ 下。
    // 先尝试从已安装 Hermes 复制兼容包，再由 packages.zip 补齐/覆盖。
    let hermes_root = PathBuf::from(data_base).join("runtimes").join("hermes");
    let hermes_python = hermes_root.join("python");
    if hermes_root.is_dir() {
        // 复制到 runtime 根目录（与 Hermes sys.path 布局一致）
        copy_missing_python_packages(&hermes_root, &runtime)?;
    }
    if hermes_python.is_dir() {
        copy_missing_python_packages(&hermes_python, &python_dir)?;
    }
    ensure_python_deps_from_packages_zip(&runtime, &python_dir)?;

    write_bootstrap_launcher(&runtime)?;
    write_runtime_manifest(&runtime, &version)?;
    ensure_module_dirs(data_base)?;
    Ok(runtime)
}


fn python_tag(python_dir: &Path) -> String {
    // 优先根据内置 python 目录中的 dll 推断 ABI；默认 cp311。
    for (dll, tag) in [
        ("python311.dll", "cp311"),
        ("python312.dll", "cp312"),
        ("python313.dll", "cp313"),
        ("python310.dll", "cp310"),
    ] {
        if python_dir.join(dll).is_file() {
            return tag.to_string();
        }
    }
    "cp311".to_string()
}


fn purge_incompatible_native_modules(root: &Path, tag: &str) -> Result<(), String> {
    if !root.is_dir() {
        return Ok(());
    }
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let entries = match std::fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
                continue;
            }
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if !(name.ends_with(".pyd") || name.ends_with(".dll")) {
                continue;
            }
            // 仅清理带 abi 标签且不匹配当前 python 的扩展
            let has_cp_tag = name.contains("cp3");
            if has_cp_tag && !name.contains(tag) {
                let _ = std::fs::remove_file(&path);
            }
        }
    }
    Ok(())
}

fn wheel_matches_python(wheel_name: &str, tag: &str) -> bool {
    let lower = wheel_name.to_ascii_lowercase();
    if !lower.ends_with(".whl") {
        return false;
    }
    // pure python wheels
    if lower.contains("py3-none-any") || lower.contains("py2.py3-none-any") {
        return true;
    }
    // native wheels must match abi/python tag, e.g. cp311-win_amd64
    lower.contains(tag) && lower.contains("win_amd64")
}

fn install_wheel_into_python(wheel_path: &Path, python_dir: &Path) -> Result<(), String> {
    // wheel 是 zip；解到 python 根目录，让 embeddable 的 sys.path（. 与 ..）都能找到。
    extract_zip(wheel_path, python_dir)?;
    // 同时解到 python 父目录（runtime 根），兼容部分包以 runtime 根为 cwd 的导入。
    if let Some(runtime_root) = python_dir.parent() {
        extract_zip(wheel_path, runtime_root)?;
    }
    Ok(())
}

fn ensure_python_deps_from_packages_zip(runtime_dir: &Path, python_dir: &Path) -> Result<(), String> {
    let python_exe = python_dir.join("python.exe");
    if !python_exe.is_file() {
        return Err("无限画布 Python 可执行文件不存在".to_string());
    }
    // 快速检查关键依赖（含 Pillow 原生扩展）
    let mut check_cmd = std::process::Command::new(&python_exe);
    check_cmd
        .args(["-c", "from PIL import Image; import fastapi, uvicorn, httpx, multipart"])
        .current_dir(runtime_dir)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        check_cmd.creation_flags(NO_WINDOW | DETACHED_PROCESS);
    }
    let check = check_cmd.status();
    if matches!(check, Ok(status) if status.success()) {
        return Ok(());
    }

    let packages_zip = resolve_packages_zip()?;
    let wheels_dir = runtime_dir.join(".wheels");
    let _ = std::fs::remove_dir_all(&wheels_dir);
    std::fs::create_dir_all(&wheels_dir)
        .map_err(|error| format!("创建 wheels 目录失败: {}", error))?;
    extract_zip(&packages_zip, &wheels_dir)?;

    let tag = python_tag(python_dir);
    // 清理历史错误 abi 的原生扩展（例如误装的 cp314），避免 import 到不兼容 .pyd。
    purge_incompatible_native_modules(python_dir, &tag)?;
    if let Some(runtime_root) = python_dir.parent() {
        purge_incompatible_native_modules(runtime_root, &tag)?;
    }
    let mut installed = 0usize;
    let mut skipped = Vec::new();
    for entry in std::fs::read_dir(&wheels_dir)
        .map_err(|error| format!("读取 wheels 失败: {}", error))?
        .flatten()
    {
        let path = entry.path();
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or_default()
            .to_string();
        if path.extension().and_then(|e| e.to_str()) != Some("whl") {
            continue;
        }
        if !wheel_matches_python(&name, &tag) {
            skipped.push(name);
            continue;
        }
        install_wheel_into_python(&path, python_dir)?;
        installed += 1;
    }
    let _ = std::fs::remove_dir_all(&wheels_dir);

    if installed == 0 {
        return Err(format!(
            "未找到匹配 {} 的无限画布依赖 wheel（packages.zip 可能打错 Python 版本）。跳过: {}",
            tag,
            skipped.join(", ")
        ));
    }

    // 安装后复检；失败则给出明确错误，避免健康检查 90s 空转
    let mut verify_cmd = std::process::Command::new(&python_exe);
    verify_cmd
        .args(["-c", "from PIL import Image; import fastapi, uvicorn, httpx, multipart"])
        .current_dir(runtime_dir)
        .stdin(std::process::Stdio::null());
    #[cfg(windows)]
    {
        verify_cmd.creation_flags(NO_WINDOW | DETACHED_PROCESS);
    }
    let verify = verify_cmd.output()
        .map_err(|error| format!("校验无限画布 Python 依赖失败: {}", error))?;
    if !verify.status.success() {
        let stderr = String::from_utf8_lossy(&verify.stderr);
        let stdout = String::from_utf8_lossy(&verify.stdout);
        return Err(format!(
            "无限画布 Python 依赖安装后仍不可用。stdout={} stderr={}",
            stdout.trim(),
            stderr.trim()
        ));
    }
    Ok(())
}
fn copy_missing_python_packages(src: &Path, dst: &Path) -> Result<(), String> {
    // Hermes 的依赖直接落在 python/ 根目录（非 site-packages）。
    let skip = [
        "python.exe",
        "pythonw.exe",
        "python3.dll",
        "python311.dll",
        "python311.zip",
        "python311._pth",
        "python.cat",
        "LICENSE.txt",
    ];
    let entries = std::fs::read_dir(src)
        .map_err(|error| format!("读取 Hermes python 目录失败: {}", error))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if skip.iter().any(|item| *item == name_str) {
            continue;
        }
        if name_str.ends_with(".pyd")
            || name_str.ends_with(".dll")
            || name_str.starts_with('_')
                && (name_str.ends_with(".pyd") || name_str.ends_with(".dll"))
        {
            // 解释器核心扩展已由 python.zip 提供。
            if entry.path().extension().and_then(|e| e.to_str()) == Some("pyd")
                || entry.path().extension().and_then(|e| e.to_str()) == Some("dll")
            {
                // 继续复制业务包，但跳过纯运行时 pyd/dll 重名冲突由下方 exists 处理。
            }
        }
        let target = dst.join(&name);
        if target.exists() {
            continue;
        }
        let source = entry.path();
        if source.is_dir() {
            copy_dir_recursive(&source, &target)?;
        } else {
            std::fs::copy(&source, &target).map_err(|error| {
                format!(
                    "复制 Python 依赖 {} -> {} 失败: {}",
                    source.display(),
                    target.display(),
                    error
                )
            })?;
        }
    }
    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dst)
        .map_err(|error| format!("创建目录 {} 失败: {}", dst.display(), error))?;
    for entry in std::fs::read_dir(src)
        .map_err(|error| format!("读取目录 {} 失败: {}", src.display(), error))?
        .flatten()
    {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if from.is_dir() {
            copy_dir_recursive(&from, &to)?;
        } else if !to.exists() {
            std::fs::copy(&from, &to).map_err(|error| {
                format!("复制 {} -> {} 失败: {}", from.display(), to.display(), error)
            })?;
        }
    }
    Ok(())
}

pub fn is_infinite_canvas_installed(data_base: &str) -> bool {
    let runtime = runtime_dir(data_base);
    runtime.join("main.py").is_file() && runtime.join("python").join("python.exe").is_file()
}

#[tauri::command]
pub fn check_infinite_canvas_bundled(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<serde_json::Value, String> {
    let data_base = data_dir.inner().get_data_dir();
    let installed = is_infinite_canvas_installed(&data_base);
    let bundle_present = resolve_bundle_zip().is_ok();
    let python_shared = resolve_shared_python_zip().is_ok();
    Ok(json!({
        "installed": installed,
        "bundlePresent": bundle_present,
        "pythonSharedFromHermes": python_shared,
        "moduleId": MODULE_ID,
        "name": "画布与视频"
    }))
}

#[tauri::command]
pub async fn install_infinite_canvas_runtime(
    app: tauri::AppHandle,
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<String, String> {
    use tauri::Emitter;
    let data_base = data_dir.inner().get_data_dir();
    let emit = |status: &str, percent: Option<f64>, message: &str| {
        let _ = app.emit(
            "install-progress",
            crate::mirror::InstallProgressEvent {
                stage: "infinite_canvas".to_string(),
                status: status.to_string(),
                percent,
                message: message.to_string(),
            },
        );
    };

    emit("started", Some(5.0), "开始安装无限画布...");
    emit("running", Some(20.0), "解压无限画布应用包...");
    let runtime = ensure_infinite_canvas_runtime(&data_base)?;
    emit("running", Some(70.0), "同步共享模型配置...");
    sync_infinite_canvas_configuration(&data_base).await?;
    emit("finished", Some(100.0), "无限画布安装完成");
    Ok(format!("无限画布已安装到 {}", runtime.display()))
}

#[tauri::command]
pub async fn get_infinite_canvas_status(
    data_dir: tauri::State<'_, crate::AppState>,
) -> Result<InfiniteCanvasStatus, String> {
    let data_base = data_dir.inner().get_data_dir();
    let runtime = runtime_dir(&data_base);
    let installed = is_infinite_canvas_installed(&data_base);
    let version = std::fs::read_to_string(runtime.join(".bundle_version"))
        .unwrap_or_else(|_| read_bundle_version())
        .trim()
        .to_string();

    // 优先使用 runtime 状态中的真实分配端口，避免状态页永远只看 18300。
    let mut port = DEFAULT_PORT;
    let mut running = false;
    let mut gui_url = format!("http://127.0.0.1:{}/static/index.html?page=canvas", port);
    let mut has_runtime_record = false;
    if let Ok(inst) = crate::commands::runtime::get_runtime_status_by_id(MODULE_ID) {
        has_runtime_record = true;
        if inst.gui_port > 0 {
            port = inst.gui_port;
            // 兼容旧版本 runtime 仍指向 canvas-list 的情况，统一回到完整 studio 壳
            let raw = inst.gui_url.clone();
            if raw.contains("canvas-list.html") || raw.trim().is_empty() {
                gui_url = format!("http://127.0.0.1:{}/static/index.html?page=canvas", port);
            } else {
                gui_url = raw;
            }
        }
        running = inst.running;
    }
    // 仅在没有 runtime 托管记录时，才用端口探测兜底。
    // 已托管且标记未启动时，即使端口残留（孤儿进程）也不能显示为“运行中”，
    // 否则前端会继续挂载上次画布 iframe，出现“未启动却仍显示画布”的错觉。
    if !has_runtime_record && !running {
        running = std::net::TcpStream::connect(format!("127.0.0.1:{}", port)).is_ok();
    }

    Ok(InfiniteCanvasStatus {
        installed,
        running,
        version,
        port,
        gui_url,
        runtime_dir: runtime.display().to_string(),
        data_dir: module_data_dir(&data_base).display().to_string(),
        python_shared_from: "bundled-hermes/python.zip".to_string(),
    })
}
