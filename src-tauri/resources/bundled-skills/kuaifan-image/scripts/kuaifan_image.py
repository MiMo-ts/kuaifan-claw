"""Kuaifan image API client shared by Hermes and OpenClaw Skills."""

from __future__ import annotations

import os
import re
import json
import uuid
import argparse
import base64
import mimetypes
import pathlib
import sys
import time
from typing import Any
from urllib.parse import urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class KuaifanImageError(RuntimeError):
    """A user-safe error raised before an image request is made."""

    def __init__(
        self,
        message: str,
        error_code: str | None = None,
        retryable: bool = False,
    ) -> None:
        super().__init__(message)
        self.error_code = error_code
        self.retryable = retryable


def resolve_secret(value: Any) -> str | None:
    """Resolve an API key literal or a full environment-variable reference."""
    if not isinstance(value, str) or not value.strip():
        return None
    candidate = value.strip()
    match = re.fullmatch(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}", candidate)
    if match:
        return os.environ.get(match.group(1))
    if candidate.startswith("env:"):
        return os.environ.get(candidate[4:].strip())
    return candidate


def is_kuaifan_provider(provider_id: str, provider: Any) -> bool:
    if provider_id.lower() == "kuaifan":
        return True
    if not isinstance(provider, dict):
        return False
    base_url = provider.get("baseUrl") or provider.get("base_url")
    if not isinstance(base_url, str):
        return False
    return urlparse(base_url).hostname == "kuaifanio.cn"


def resolve_provider(
    config: dict[str, Any],
    environment_api_key: str | None = None,
    provider_id: str | None = None,
) -> dict[str, str]:
    """Return the configured Kuaifan API key and normalized base URL."""
    providers = config.get("models", {}).get("providers", {})
    if not isinstance(providers, dict):
        raise KuaifanImageError("OpenClaw 模型配置中缺少 models.providers。")

    if provider_id:
        provider = providers.get(provider_id)
        if not isinstance(provider, dict):
            raise KuaifanImageError("未找到指定的快泛 Provider。")
        selected_id = provider_id
    else:
        matches = [
            (candidate_id, candidate)
            for candidate_id, candidate in providers.items()
            if is_kuaifan_provider(str(candidate_id), candidate)
        ]
        if len(matches) != 1:
            raise KuaifanImageError("无法唯一识别快泛 Provider；请设置 KUAIFAN_PROVIDER_ID。")
        selected_id, provider = matches[0]

    base_url = provider.get("baseUrl") or provider.get("base_url")
    if not isinstance(base_url, str) or not base_url.strip():
        raise KuaifanImageError("快泛 Provider 缺少 baseUrl。")

    api_key = environment_api_key or resolve_secret(provider.get("apiKey") or provider.get("api_key"))
    if not api_key:
        raise KuaifanImageError("快泛 Provider 缺少 API Key。")

    return {
        "provider_id": str(selected_id),
        "api_key": api_key,
        "base_url": base_url.rstrip("/"),
    }


def build_text_request(base_url: str, model: str, prompt: str, size: str) -> Request:
    """Build the OpenAI-compatible text-to-image request with one output."""
    payload = json.dumps(
        {"model": model, "prompt": prompt, "n": 1, "size": size},
        ensure_ascii=False,
    ).encode("utf-8")
    return Request(
        f"{base_url.rstrip('/')}/images/generations",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )


def image_data_url(filename: str, data: bytes) -> str:
    """Encode one reference image for Kuaifan's JSON image-edit contract."""
    media_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def build_edit_request(
    base_url: str,
    model: str,
    prompt: str,
    size: str,
    images: list[tuple[str, bytes]],
) -> Request:
    """Build the OpenAI-compatible image-to-image request with one output."""
    if not images:
        raise KuaifanImageError("图生图至少需要一张参考图。")
    payload = json.dumps(
        {
            "model": model,
            "prompt": prompt,
            "image": [image_data_url(filename, data) for filename, data in images],
            "n": 1,
            "size": size,
        },
        ensure_ascii=False,
    ).encode("utf-8")
    return Request(
        f"{base_url.rstrip('/')}/images/edits",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )


def config_paths(config_path: str | None) -> list[pathlib.Path]:
    """Return config locations without placing secrets in command arguments."""
    if config_path:
        return [pathlib.Path(config_path).expanduser()]
    configured_path = os.environ.get("OPENCLAW_CONFIG_PATH")
    if configured_path:
        return [pathlib.Path(configured_path).expanduser()]
    openclaw_dir = pathlib.Path.home() / ".openclaw"
    return [openclaw_dir / "openclaw.json", openclaw_dir / "openclaw.json.last-good"]


def load_openclaw_config(config_path: str | None) -> dict[str, Any]:
    """Load the first valid local OpenClaw config, with last-good fallback."""
    failures: list[str] = []
    for path in config_paths(config_path):
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            failures.append(f"{path.name} 不存在")
        except json.JSONDecodeError:
            failures.append(f"{path.name} 不是有效 JSON")
        except OSError:
            failures.append(f"无法读取 {path.name}")
    raise KuaifanImageError("无法读取 OpenClaw 模型配置：" + "；".join(failures))


def hermes_config_paths(config_path: str | None) -> list[pathlib.Path]:
    if config_path:
        return [pathlib.Path(config_path).expanduser()]
    paths: list[pathlib.Path] = []
    hermes_home = os.environ.get("HERMES_HOME")
    if hermes_home:
        paths.append(pathlib.Path(hermes_home).expanduser() / "config.yaml")
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        paths.append(pathlib.Path(local_app_data) / "hermes" / "config.yaml")
    paths.append(pathlib.Path.home() / ".hermes" / "config.yaml")
    return paths


def load_hermes_config(config_path: str | None) -> dict[str, Any]:
    """Read only Hermes provider fields needed for the Kuaifan image request."""
    for path in hermes_config_paths(config_path):
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue

        providers: dict[str, dict[str, str]] = {}
        in_providers = False
        current_provider: str | None = None
        for line in lines:
            if re.match(r"^providers:\s*$", line):
                in_providers = True
                current_provider = None
                continue
            if not in_providers:
                continue
            provider_match = re.match(r"^  ([A-Za-z0-9_-]+):\s*$", line)
            if provider_match:
                current_provider = provider_match.group(1)
                providers[current_provider] = {}
                continue
            field_match = re.match(r"^    (api|api_key):\s*(.*?)\s*$", line)
            if current_provider and field_match:
                value = field_match.group(2).strip().strip('"\'')
                providers[current_provider][field_match.group(1)] = value
                continue
            if line and not line.startswith(" "):
                break

        mapped = {
            provider_id: {
                "baseUrl": values.get("api", ""),
                "apiKey": values.get("api_key", ""),
            }
            for provider_id, values in providers.items()
            if values.get("api") and values.get("api_key")
        }
        if mapped:
            return {"models": {"providers": mapped}}
    raise KuaifanImageError("无法读取 Hermes 模型配置。")


def load_model_config(
    openclaw_config_path: str | None = None,
    hermes_config_path: str | None = None,
    runtime: str = "auto",
) -> dict[str, Any]:
    """Load model configuration for one runtime, with a safe auto fallback."""
    if runtime == "hermes":
        return load_hermes_config(hermes_config_path)
    if runtime == "openclaw":
        return load_openclaw_config(openclaw_config_path)
    if runtime != "auto":
        raise KuaifanImageError("runtime 只能是 auto、openclaw 或 hermes。")
    try:
        return load_openclaw_config(openclaw_config_path)
    except KuaifanImageError:
        return load_hermes_config(hermes_config_path)


def source_image(source: str, timeout: int) -> tuple[str, bytes]:
    """Read a trusted local attachment or download a public HTTP(S) image."""
    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        try:
            with urlopen(source, timeout=timeout) as response:
                data = response.read()
        except (HTTPError, URLError, OSError) as exc:
            raise KuaifanImageError("无法下载参考图。") from exc
        filename = pathlib.PurePosixPath(parsed.path).name or "reference-image"
    else:
        path = pathlib.Path(source).expanduser()
        try:
            data = path.read_bytes()
        except OSError as exc:
            raise KuaifanImageError("无法读取参考图。") from exc
        filename = path.name
    if not data:
        raise KuaifanImageError("参考图为空。")
    return filename, data


def apply_authorization(request: Request, api_key: str) -> Request:
    request.add_header("Authorization", f"Bearer {api_key}")
    return request


def send_request(request: Request, timeout: int, retries: int) -> tuple[bytes, str | None]:
    """Send an image request, retrying transient upstream responses once."""
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read(), response.headers.get("x-request-id")
        except HTTPError as exc:
            retryable = exc.code in {429, 502, 503, 504}
            if not retryable or attempt == retries:
                message = f"快泛图片请求失败（HTTP {exc.code}）。"
                if retryable:
                    message = f"快泛图片上游服务暂不可用（HTTP {exc.code}），请稍后重试。"
                raise KuaifanImageError(
                    message,
                    error_code=f"upstream_http_{exc.code}",
                    retryable=retryable,
                ) from exc
            retry_after = exc.headers.get("Retry-After", "") if exc.headers else ""
            try:
                delay = max(1, min(60, int(retry_after)))
            except ValueError:
                delay = min(30, 2 ** (attempt + 1))
            time.sleep(delay)
        except (URLError, OSError) as exc:
            raise KuaifanImageError(
                "快泛图片服务暂时不可达。",
                error_code="upstream_unreachable",
                retryable=True,
            ) from exc
    raise KuaifanImageError("快泛图片请求未完成。")


def image_bytes_from_response(payload: bytes, timeout: int) -> tuple[bytes, str | None]:
    """Extract the first OpenAI-compatible image result without exposing secrets."""
    try:
        body = json.loads(payload.decode("utf-8"))
        image = body["data"][0]
    except (UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError) as exc:
        raise KuaifanImageError("快泛图片响应格式无效。") from exc

    encoded = image.get("b64_json") if isinstance(image, dict) else None
    if isinstance(encoded, str) and encoded:
        try:
            return base64.b64decode(encoded, validate=True), None
        except ValueError as exc:
            raise KuaifanImageError("快泛返回的图片数据无效。") from exc

    image_url = image.get("url") if isinstance(image, dict) else None
    if not isinstance(image_url, str) or not image_url:
        raise KuaifanImageError("快泛响应未包含图片 URL 或图片数据。")
    try:
        with urlopen(image_url, timeout=timeout) as response:
            return response.read(), image_url
    except (HTTPError, URLError, OSError) as exc:
        raise KuaifanImageError("无法下载快泛生成的图片。") from exc


def image_file_extension(data: bytes) -> str | None:
    """Return the media extension implied by a supported image signature."""
    if data.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if data.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(data) >= 12 and data.startswith(b"RIFF") and data[8:12] == b"WEBP":
        return ".webp"
    return None


def save_image(path_value: str, data: bytes) -> str:
    path = pathlib.Path(path_value).expanduser().resolve()
    detected_extension = image_file_extension(data)
    if detected_extension:
        path = path.with_suffix(detected_extension)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


def managed_output_root(runtime: str, config_path: str | None) -> pathlib.Path:
    """Return the local media directory owned by the active agent runtime."""
    hermes_home = os.environ.get("HERMES_HOME")
    if runtime == "hermes" or (runtime == "auto" and hermes_home):
        home = pathlib.Path(hermes_home) if hermes_home else pathlib.Path.home() / ".hermes"
        return home / "image_cache" / "kuaifan-image"

    state_dir = os.environ.get("OPENCLAW_STATE_DIR")
    if state_dir:
        return pathlib.Path(state_dir) / "media" / "kuaifan-image"
    if config_path:
        return pathlib.Path(config_path).expanduser().resolve().parent / "media" / "kuaifan-image"
    return pathlib.Path.home() / ".openclaw" / "media" / "kuaifan-image"


def allocate_output_path(
    requested_path: str | None,
    runtime: str,
    config_path: str | None,
) -> pathlib.Path:
    """Allocate an image path without allowing the model to choose arbitrary files."""
    root = managed_output_root(runtime, config_path).expanduser().resolve()
    if not requested_path:
        return root / f"kuaifan-{uuid.uuid4().hex}.png"

    candidate = pathlib.Path(requested_path).expanduser().resolve()
    if candidate.suffix.lower() not in _IMAGE_EXTENSIONS:
        raise KuaifanImageError("输出文件必须是受支持的图片格式。")
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise KuaifanImageError("输出文件必须位于当前运行时的受管图片目录。") from exc
    return candidate


def normalize_export_dir(value: str | None) -> str | None:
    """Return a suggested user export directory without writing to it."""
    if not value:
        return None
    candidate = pathlib.Path(value).expanduser()
    if not candidate.is_absolute():
        raise KuaifanImageError("保存目录必须使用绝对路径。")
    return str(candidate.resolve())


def build_media_marker(image_path):
    """Return the ``MEDIA:/absolute/path`` directive the agent gateway expects.

    Downstream auto-append paths (Hermes `_collect_auto_append_media_tags`)
    match an absolute path that starts with `/`, `~/` or a Windows drive
    letter and ends in a known deliverable extension. The Skill result must
    surface that exact shape so the channel adapters' `send_image_file`
    fires without depending on the model re-emitting the path in prose.

    Returns `None` for empty / unrecognised inputs so callers can omit the
    marker from the result payload instead of leaking a half-built string.
    """
    if not isinstance(image_path, str) or not image_path.strip():
        return None
    resolved = str(pathlib.Path(image_path).expanduser().resolve())
    if not resolved:
        return None
    if not _DELIVERABLE_EXTENSIONS_RE.search(resolved):
        return None
    return f"MEDIA:{resolved}"


# Mirrors `kuaifan_image_output._MEDIA_PATH_RE` so the script can guard
# the success payload without importing the adapter module. Kept in sync
# with `gateway/run.py` _TOOL_MEDIA_RE so the auto-append path matches.
_DELIVERABLE_EXTENSIONS_RE = re.compile(
    r"\.(?:png|jpe?g|gif|webp|mp4|mov|avi|mkv|webm|ogg|opus|mp3|wav|m4a|"
    r"flac|epub|pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|apk|ipa)$",
    re.IGNORECASE,
)



def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Generate or edit an image through Kuaifan.")
    command.add_argument("--prompt", required=True)
    command.add_argument("--output")
    command.add_argument("--export-dir")
    command.add_argument("--source", action="append", default=[])
    command.add_argument("--model", default="doubao-seedream-5-0-pro-260628")
    command.add_argument("--size", default="1024x1024")
    command.add_argument("--config")
    command.add_argument("--provider-id")
    command.add_argument("--runtime", choices=["auto", "openclaw", "hermes"], default="auto")
    command.add_argument("--timeout", type=int, default=120)
    command.add_argument("--retries", type=int, default=1)
    command.add_argument("--dry-run", action="store_true")
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        provider = resolve_provider(
            load_model_config(args.config, runtime=args.runtime),
            os.environ.get("KUAIFAN_API_KEY"),
            args.provider_id or os.environ.get("KUAIFAN_PROVIDER_ID"),
        )
        sources = [source_image(source, args.timeout) for source in args.source]
        if sources:
            request = build_edit_request(provider["base_url"], args.model, args.prompt, args.size, sources)
            endpoint = f"{provider['base_url']}/images/edits"
            mode = "image_to_image"
        else:
            request = build_text_request(provider["base_url"], args.model, args.prompt, args.size)
            endpoint = f"{provider['base_url']}/images/generations"
            mode = "text_to_image"

        if args.dry_run:
            print(json.dumps({
                "mode": mode,
                "provider_id": provider["provider_id"],
                "endpoint": endpoint,
                "model": args.model,
                "size": args.size,
                "n": 1,
                "source_count": len(sources),
            }, ensure_ascii=False))
            return 0

        output_path = allocate_output_path(args.output, args.runtime, args.config)
        export_dir = normalize_export_dir(args.export_dir)
        payload, request_id = send_request(
            apply_authorization(request, provider["api_key"]), args.timeout, max(0, args.retries)
        )
        image_data, _upstream_image_url = image_bytes_from_response(payload, args.timeout)
        image_path = save_image(str(output_path), image_data)
        emit_openclaw_media = args.runtime != "hermes"
        media_marker = build_media_marker(image_path) if emit_openclaw_media else None
        absolute_path = str(pathlib.Path(image_path).expanduser().resolve())
        result = {
            "artifact": "kuaifan-image/v1",
            "mode": mode,
            "image_path": image_path,
            "absolute_path": absolute_path,
            "image_url": None,
            "export_dir": export_dir,
            "request_id": request_id,
        }
        print(json.dumps(result, ensure_ascii=False))
        if emit_openclaw_media and media_marker:
            print(media_marker)
        return 0
    except KuaifanImageError as exc:
        error = {"error": str(exc)}
        if exc.error_code:
            error["error_code"] = exc.error_code
        if exc.retryable:
            error["retryable"] = True
        print(json.dumps(error, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
