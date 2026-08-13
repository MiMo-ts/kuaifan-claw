"""Kuaifan Seedance video API client for managed OpenClaw and Hermes Skills."""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import mimetypes
import os
import pathlib
import sys
import time
import uuid
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


MODELS = {
    "doubao-seedance-2-0-260128",
    "doubao-seedance-2-0-mini-260615",
}
RESOLUTIONS = {"480p", "720p", "1080p"}
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
MAX_LOCAL_IMAGE_BYTES = 12 * 1024 * 1024


class KuaifanVideoError(RuntimeError):
    """A safe error that does not expose a provider key."""


def _load_image_helpers():
    sibling = (
        pathlib.Path(__file__).resolve().parents[2]
        / "kuaifan-image"
        / "scripts"
        / "kuaifan_image.py"
    )
    spec = importlib.util.spec_from_file_location("kuaifan_image_helpers", sibling)
    if spec is None or spec.loader is None:
        raise KuaifanVideoError("快泛图片基础 Skill 缺失，无法读取 Provider 配置。")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_options(model: str, resolution: str) -> None:
    if model not in MODELS:
        raise KuaifanVideoError("仅支持 Seedance 标准版或轻量版。")
    if resolution not in RESOLUTIONS:
        raise KuaifanVideoError("清晰度仅支持 480p、720p 或 1080p。")


def load_reference_image(source: str | None, timeout: int) -> str | None:
    """Resolve a local path or public URL into an API image_url value.

    Local files are encoded as data URLs (same pattern as kuaifan-image).
    Remote references must be HTTPS.
    """
    if not source:
        return None
    source = source.strip()
    if not source:
        return None

    if source.startswith("data:image/"):
        return source

    parsed = urlparse(source)
    if parsed.scheme in {"http", "https"}:
        if parsed.scheme != "https" or not parsed.netloc:
            raise KuaifanVideoError("图生视频需要一条可公开访问的 HTTPS 图片 URL。")
        return source

    path = pathlib.Path(source).expanduser()
    try:
        path = path.resolve(strict=True)
    except OSError as exc:
        raise KuaifanVideoError("无法读取本地参考图。") from exc
    if not path.is_file():
        raise KuaifanVideoError("本地参考图不存在。")
    if path.suffix.lower() not in IMAGE_EXTENSIONS:
        raise KuaifanVideoError("本地参考图仅支持 PNG、JPG、JPEG、WEBP、GIF 或 BMP。")
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise KuaifanVideoError("无法读取本地参考图。") from exc
    if not data:
        raise KuaifanVideoError("本地参考图为空。")
    if len(data) > MAX_LOCAL_IMAGE_BYTES:
        raise KuaifanVideoError("本地参考图过大，请使用不超过 12MB 的图片。")
    media_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    if not media_type.startswith("image/"):
        media_type = "image/png"
    encoded = base64.b64encode(data).decode("ascii")
    return f"data:{media_type};base64,{encoded}"


def build_generation_request(
    base_url: str,
    model: str,
    prompt: str,
    resolution: str,
    image_url: str | None,
) -> Request:
    validate_options(model, resolution)
    payload: dict[str, Any] = {
        "model": model,
        "prompt": prompt,
        "n": 1,
        "resolution": resolution,
    }
    if image_url:
        payload["image_url"] = image_url
    return Request(
        f"{base_url.rstrip('/')}/video/generations",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )


def build_status_request(base_url: str, task_id: str) -> Request:
    return Request(f"{base_url.rstrip('/')}/video/generations/{task_id}", method="GET")


def _request(request: Request, api_key: str, timeout: int) -> tuple[bytes, str | None]:
    request.add_header("Authorization", f"Bearer {api_key}")
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read(), response.headers.get("x-request-id")
    except HTTPError as exc:
        raise KuaifanVideoError(f"快泛视频请求失败（HTTP {exc.code}）。") from exc
    except (URLError, OSError) as exc:
        raise KuaifanVideoError("快泛视频服务暂时不可达。") from exc


def task_id_from_submission(payload: bytes) -> str:
    try:
        body = json.loads(payload.decode("utf-8"))
        task_id = body.get("task_id") or body.get("id")
    except (UnicodeDecodeError, ValueError, AttributeError) as exc:
        raise KuaifanVideoError("快泛视频提交响应格式无效。") from exc
    if not isinstance(task_id, str) or not task_id.strip():
        raise KuaifanVideoError("快泛未返回视频任务 ID。")
    return task_id


def task_status(payload: bytes) -> tuple[str, dict[str, Any]]:
    try:
        body = json.loads(payload.decode("utf-8"))
        data = body.get("data", body)
        status = data.get("status", "")
    except (UnicodeDecodeError, ValueError, AttributeError) as exc:
        raise KuaifanVideoError("快泛视频查询响应格式无效。") from exc
    if not isinstance(status, str):
        raise KuaifanVideoError("快泛视频任务状态无效。")
    return status.upper(), body


def video_url_from_task(body: dict[str, Any]) -> str | None:
    data = body.get("data", body) if isinstance(body, dict) else {}
    if not isinstance(data, dict):
        return None
    nested = data.get("data")
    nested_url = nested.get("content", {}).get("video_url") if isinstance(nested, dict) else None
    candidates = [data.get("result_url"), data.get("video_url"), nested_url]
    return next((value for value in candidates if isinstance(value, str) and value), None)


def wait_for_video(
    base_url: str,
    api_key: str,
    task_id: str,
    timeout: int,
    poll_interval: float,
    poll_timeout: int,
) -> tuple[str, dict[str, Any]]:
    deadline = time.monotonic() + poll_timeout
    while time.monotonic() <= deadline:
        payload, _request_id = _request(build_status_request(base_url, task_id), api_key, timeout)
        status, body = task_status(payload)
        video_url = video_url_from_task(body)
        if status in {"SUCCESS", "SUCCEEDED", "COMPLETED"} and video_url:
            return video_url, body
        if status in {"FAILED", "ERROR", "CANCELLED", "CANCELED"}:
            raise KuaifanVideoError("快泛视频任务失败。")
        time.sleep(max(poll_interval, 0))
    raise KuaifanVideoError("快泛视频任务超时。")


def managed_output_root(runtime: str, config_path: str | None) -> pathlib.Path:
    hermes_home = os.environ.get("HERMES_HOME")
    if runtime == "hermes" or (runtime == "auto" and hermes_home):
        home = pathlib.Path(hermes_home) if hermes_home else pathlib.Path.home() / ".hermes"
        return home / "video_cache" / "kuaifan-video"
    state_dir = os.environ.get("OPENCLAW_STATE_DIR")
    if state_dir:
        return pathlib.Path(state_dir) / "media" / "kuaifan-video"
    if config_path:
        return pathlib.Path(config_path).expanduser().resolve().parent / "media" / "kuaifan-video"
    return pathlib.Path.home() / ".openclaw" / "media" / "kuaifan-video"


def allocate_output_path(requested_path: str | None, runtime: str, config_path: str | None) -> pathlib.Path:
    root = managed_output_root(runtime, config_path).expanduser().resolve()
    if not requested_path:
        return root / f"kuaifan-video-{uuid.uuid4().hex}.mp4"
    candidate = pathlib.Path(requested_path).expanduser().resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise KuaifanVideoError("输出文件必须位于当前运行时的受管视频目录。") from exc
    if candidate.suffix.lower() != ".mp4":
        raise KuaifanVideoError("视频输出文件必须使用 .mp4 扩展名。")
    return candidate


def download_video(video_url: str, destination: pathlib.Path, timeout: int) -> str:
    parsed = urlparse(video_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise KuaifanVideoError("快泛返回的视频地址无效。")
    try:
        with urlopen(video_url, timeout=timeout) as response:
            content = response.read()
    except (HTTPError, URLError, OSError) as exc:
        raise KuaifanVideoError("无法下载快泛生成的视频。") from exc
    if len(content) < 12 or b"ftyp" not in content[:64]:
        raise KuaifanVideoError("快泛返回的视频文件不是有效 MP4。")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(content)
    return str(destination.resolve())


def parser() -> argparse.ArgumentParser:
    command = argparse.ArgumentParser(description="Generate a Seedance video through Kuaifan.")
    command.add_argument("--prompt", required=True)
    command.add_argument(
        "--image-url",
        help="Public HTTPS image URL for image-to-video (legacy alias of --source).",
    )
    command.add_argument(
        "--source",
        help="Local image path or public HTTPS URL for image-to-video (same as kuaifan-image --source).",
    )
    command.add_argument("--model", required=True, choices=sorted(MODELS))
    command.add_argument("--resolution", required=True, choices=sorted(RESOLUTIONS))
    command.add_argument("--output")
    command.add_argument("--config")
    command.add_argument("--provider-id")
    command.add_argument("--runtime", choices=["auto", "openclaw", "hermes"], default="auto")
    command.add_argument("--timeout", type=int, default=120)
    command.add_argument("--poll-interval", type=float, default=5)
    command.add_argument("--poll-timeout", type=int, default=600)
    command.add_argument("--dry-run", action="store_true")
    return command


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    try:
        validate_options(args.model, args.resolution)
        helpers = _load_image_helpers()
        provider = helpers.resolve_provider(
            helpers.load_model_config(args.config, runtime=args.runtime),
            os.environ.get("KUAIFAN_API_KEY"),
            args.provider_id or os.environ.get("KUAIFAN_PROVIDER_ID"),
        )
        reference = args.source or args.image_url
        image_url = load_reference_image(reference, args.timeout)
        mode = "image_to_video" if image_url else "text_to_video"
        endpoint = f"{provider['base_url']}/video/generations"
        if args.dry_run:
            print(
                json.dumps(
                    {
                        "mode": mode,
                        "endpoint": endpoint,
                        "model": args.model,
                        "resolution": args.resolution,
                        "has_reference_image": bool(image_url),
                        "reference_kind": (
                            "data_url"
                            if image_url and image_url.startswith("data:")
                            else ("https_url" if image_url else None)
                        ),
                    },
                    ensure_ascii=False,
                )
            )
            return 0

        request = build_generation_request(
            provider["base_url"], args.model, args.prompt, args.resolution, image_url
        )
        submitted, request_id = _request(request, provider["api_key"], args.timeout)
        task_id = task_id_from_submission(submitted)
        video_url, _task = wait_for_video(
            provider["base_url"],
            provider["api_key"],
            task_id,
            args.timeout,
            args.poll_interval,
            args.poll_timeout,
        )
        video_path = download_video(
            video_url,
            allocate_output_path(args.output, args.runtime, args.config),
            args.timeout,
        )
        result = {
            "artifact": "kuaifan-video/v1",
            "mode": mode,
            "video_path": video_path,
            "absolute_path": str(pathlib.Path(video_path).resolve()),
            "video_url": video_url,
            "task_id": task_id,
            "model": args.model,
            "resolution": args.resolution,
            "request_id": request_id,
        }
        print(json.dumps(result, ensure_ascii=False))
        if args.runtime != "hermes":
            print(f"MEDIA:{video_path}")
        return 0
    except KuaifanVideoError as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 1
    except Exception:
        print(json.dumps({"error": "快泛视频 Skill 执行失败。"}, ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
