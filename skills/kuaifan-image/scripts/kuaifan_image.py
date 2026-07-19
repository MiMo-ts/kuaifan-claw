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


def encode_multipart(fields: dict[str, str], images: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    """Return a multipart body compatible with OpenAI-style image edit APIs."""
    boundary = f"----KuaifanImage{uuid.uuid4().hex}"
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode("utf-8"),
                value.encode("utf-8"),
                b"\r\n",
            ]
        )
    for filename, data in images:
        chunks.extend(
            [
                f"--{boundary}\r\n".encode("ascii"),
                f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'.encode("utf-8"),
                b"Content-Type: application/octet-stream\r\n\r\n",
                data,
                b"\r\n",
            ]
        )
    chunks.append(f"--{boundary}--\r\n".encode("ascii"))
    return b"".join(chunks), boundary


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
    body, boundary = encode_multipart(
        {"model": model, "prompt": prompt, "n": "1", "size": size}, images
    )
    return Request(
        f"{base_url.rstrip('/')}/images/edits",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
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
    """Send an image request, retrying only the upstream rate-limit response."""
    for attempt in range(retries + 1):
        try:
            with urlopen(request, timeout=timeout) as response:
                return response.read(), response.headers.get("x-request-id")
        except HTTPError as exc:
            if exc.code != 429 or attempt == retries:
                raise KuaifanImageError(f"快泛图片请求失败（HTTP {exc.code}）。") from exc
            retry_after = exc.headers.get("Retry-After", "")
            try:
                delay = max(1, min(60, int(retry_after)))
            except ValueError:
                delay = min(30, 2 ** (attempt + 1))
            time.sleep(delay)
        except (URLError, OSError) as exc:
            raise KuaifanImageError("快泛图片服务暂时不可达。") from exc
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


def save_image(path_value: str, data: bytes) -> str:
    path = pathlib.Path(path_value).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return str(path)


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Generate or edit an image through Kuaifan.")
    command.add_argument("--prompt", required=True)
    command.add_argument("--output", required=True)
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

        payload, request_id = send_request(
            apply_authorization(request, provider["api_key"]), args.timeout, max(0, args.retries)
        )
        image_data, image_url = image_bytes_from_response(payload, args.timeout)
        image_path = save_image(args.output, image_data)
        print(json.dumps({
            "mode": mode,
            "image_path": image_path,
            "image_url": image_url,
            "request_id": request_id,
        }, ensure_ascii=False))
        return 0
    except KuaifanImageError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
