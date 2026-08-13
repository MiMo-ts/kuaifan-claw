"""Output adapter for the Kuaifan image skill.

Closes the auto-handoff to channel plugin gap. The kuaifan_image.py client
emits a structured JSON result:

    {
        "mode": "text_to_image" or "image_to_image",
        "image_path": ".../image.png",
        "absolute_path": "C:/.../image.png",
        "image_url": "https://...",
        "media_marker": "MEDIA:C:/.../image.png",
        "request_id": "..."
    }

Hermes gateway auto-append path and OpenClaw outbound media payload both
need that result. Each runtime reads it slightly differently.

Hermes (gateway/run.py)
    Scans tool results for MEDIA:<path> text or known JSON fields
    (host_image, image, agent_visible_image) and routes the channel
    adapter send_image_file. to_hermes_media_tags produces the exact shape
    that path expects and collect_kuaifan_media_tags wraps
    _collect_auto_append_media_tags so the kuaifan-image shell tool
    (e.g. terminal_tool) is treated as a producer tool without touching
    the gateway allowlist.

OpenClaw
    Wraps the same result as an outbound media payload. to_openclaw_payload
    and to_channel_payload give the Feishu / QQ / WeChat channel plugins
    the send_image_file(chat_id, image_path, metadata) shape they already
    understand.

The adapter is deliberately pure: no I/O, no provider calls. The skill
script owns all secrets and HTTP; this module only reshapes its output.
"""

from __future__ import annotations

import json
import pathlib
import re
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


# Mirrors gateway/run.py _TOOL_MEDIA_RE. Kept local so the adapter
# can validate paths without importing the gateway package.
_MEDIA_PATH_RE = re.compile(
    r"^(?:[A-Za-z]:[/\\]|/|~/)"
    r"[^\s<>]+?"
    r"\.(?:png|jpe?g|gif|webp|mp4|mov|avi|mkv|webm|ogg|opus|mp3|wav|m4a|"
    r"flac|epub|pdf|zip|rar|7z|docx?|xlsx?|pptx?|txt|csv|apk|ipa)"
    r"(?:[?#][^\s<>]*)?$",
    re.IGNORECASE,
)


# Channels currently wired into OpenClaw outbound media path. Each
# to_<channel>_payload produces the metadata shape that plugin
# send_image_file already accepts.
SUPPORTED_CHANNELS = ("feishu", "qq", "wechat", "wecom", "wxwork")


def to_absolute_path(image_path):
    """Resolve image_path to an absolute filesystem path.

    Returns None when the input is empty so callers can omit the field
    rather than emit a half-built string.
    """
    if not isinstance(image_path, str) or not image_path.strip():
        return None
    try:
        return str(pathlib.Path(image_path).expanduser().resolve())
    except (OSError, ValueError):
        return None


def to_hermes_media_marker(image_path):
    """Return the MEDIA:/abs/path directive the agent gateway auto-appends.

    The shape matches gateway/run.py _TOOL_MEDIA_RE: anchored, absolute,
    deliverable-extension. Anything else (relative, missing extension,
    unresolvable) is rejected so a malformed result never silently fails
    the platform send.
    """
    absolute = to_absolute_path(image_path)
    if not absolute or not _MEDIA_PATH_RE.match(absolute):
        return None
    return f"MEDIA:{absolute}"


def to_hermes_media_tags(result):
    """Return every MEDIA:<path> directive a kuaifan-image result yields.

    Today the skill returns one image per call. We still emit a list so the
    Hermes auto-append path can iterate the same way it does for
    image_generate and text_to_speech; future batch outputs plug in here.
    """
    if not isinstance(result, dict):
        return []
    marker = result.get("media_marker")
    if isinstance(marker, str) and marker.startswith("MEDIA:"):
        candidate = marker[len("MEDIA:"):]
        if _MEDIA_PATH_RE.match(candidate):
            return [marker]
    absolute = result.get("absolute_path") or result.get("image_path")
    derived = to_hermes_media_marker(absolute)
    return [derived] if derived else []


def to_openclaw_payload(result):
    """Wrap the skill result as OpenClaw outbound media payload.

    OpenClaw channel plugins all expose send_image_file(chat_id, image_path, metadata).
    The shape below feeds that signature directly and also carries the
    optional remote URL (used as fallback when a plugin cannot upload the
    local file -- mirrors the SKILL.md guidance).
    """
    if not isinstance(result, dict):
        raise ValueError("result must be a dict")
    image_path = to_absolute_path(result.get("absolute_path") or result.get("image_path"))
    image_url = result.get("image_url") if isinstance(result.get("image_url"), str) else None
    return {
        "type": "image",
        "image_path": image_path,
        "image_url": image_url,
        "media_marker": to_hermes_media_marker(image_path),
        "metadata": {
            "source": "kuaifan-image-skill",
            "mode": result.get("mode"),
            "request_id": result.get("request_id"),
        },
    }


def to_feishu_payload(result):
    """Feishu-specific metadata. msg_type matches the bot image card.
    """
    payload = to_openclaw_payload(result)
    payload["metadata"]["msg_type"] = "image"
    return payload


def to_qq_payload(result):
    """QQ bot uses file_image content type for native image sends.
    """
    payload = to_openclaw_payload(result)
    payload["metadata"]["content_type"] = "file_image"
    return payload


def to_wechat_payload(result):
    """WeChat / WeCom / WXWork expect an image attachment payload.
    """
    payload = to_openclaw_payload(result)
    payload["metadata"]["attachment_type"] = "image"
    return payload


def to_wecom_payload(result):
    return to_wechat_payload(result)


def to_wxwork_payload(result):
    return to_wechat_payload(result)


_CHANNEL_DISPATCH = {
    "feishu": to_feishu_payload,
    "qq": to_qq_payload,
    "wechat": to_wechat_payload,
    "wecom": to_wecom_payload,
    "wxwork": to_wxwork_payload,
}


def to_channel_payload(result, channel):
    """Return the channel-specific outbound media payload.

    Unknown channels fall back to the generic OpenClaw shape so a new plugin
    still receives a well-formed payload while the team adds an explicit
    mapping.
    """
    if not isinstance(channel, str) or not channel:
        raise ValueError("channel must be a non-empty string")
    builder = _CHANNEL_DISPATCH.get(channel.lower(), to_openclaw_payload)
    return builder(result)


def parse_skill_stdout(stdout):
    """Parse a kuaifan_image.py success line into a normalised dict.

    The script writes a single JSON object on success. Anything else
    (traceback, log line) is treated as a non-result so the adapter does
    not propagate half-built payloads.
    """
    if not isinstance(stdout, str):
        return None
    for line in reversed(stdout.splitlines()):
        candidate = line.strip()
        if not candidate or not candidate.startswith("{"):
            continue
        try:
            payload = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict) and (payload.get("image_path") or payload.get("media_marker")):
            return payload
    return None


def is_kuaifan_image_result(result):
    """Return True when a tool/function result looks like a kuaifan-image success.

    Used by Hermes to decide whether a generic shell-tool result (e.g. a
    terminal_tool invocation) should be promoted into a media path even
    though the gateway allowlist does not list kuaifan_image by name.
    """
    if isinstance(result, dict):
        return bool(result.get("image_path") or result.get("media_marker"))
    if isinstance(result, str):
        return parse_skill_stdout(result) is not None
    return False


def collect_history_paths(agent_history):
    """Return every image path the agent has already delivered.

    Mirrors gateway/run.py _collect_history_media_paths but specialised
    for the kuaifan-image shape. Used by the auto-append path so a fresh
    turn does not re-send an image from an earlier turn.
    """
    paths = set()
    if not agent_history:
        return paths
    for msg in agent_history:
        if not isinstance(msg, dict):
            continue
        if msg.get("role") not in {"tool", "function"}:
            continue
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        if "MEDIA:" in content:
            for match in re.finditer(r"MEDIA:(\S+)", content):
                candidate = match.group(1).rstrip(",\"}")
                if candidate:
                    paths.add(candidate)
            continue
        parsed = parse_skill_stdout(content)
        if not parsed:
            continue
        marker = parsed.get("media_marker")
        if isinstance(marker, str) and marker.startswith("MEDIA:"):
            paths.add(marker[len("MEDIA:"):])
        absolute = parsed.get("absolute_path") or parsed.get("image_path")
        if absolute:
            resolved = to_absolute_path(absolute)
            paths.add(resolved or absolute)
    return paths


def collect_kuaifan_media_tags(messages, history_offset=0, history_media_paths=None):
    """Hermes-side hook: collect MEDIA tags from kuaifan-image tool results.

    This is the glue that turns the skill shell-tool result into the
    same shape _collect_auto_append_media_tags would produce if
    kuaifan_image were on the gateway allowlist. Wire it in by adding
    the returned list to the existing media_tags accumulator:

        media_tags, voice = _collect_auto_append_media_tags(messages, ...)
        media_tags.extend(collect_kuaifan_media_tags(messages, ...)[0])

    Current-turn isolation and history dedup use the same history_offset/
    history_media_paths semantics as the gateway helper. history_offset
    zero means scan everything (used on the compression fallback); a real
    offset only inspects the slice produced by the current turn.
    """
    history_media_paths = history_media_paths or set()
    if history_offset and len(messages) >= history_offset:
        scoped = messages[history_offset:]
    else:
        scoped = messages
    media_tags = []
    for msg in scoped:
        if not isinstance(msg, dict):
            continue
        if msg.get("role") not in {"tool", "function"}:
            continue
        content = msg.get("content")
        if not isinstance(content, str):
            continue
        parsed = parse_skill_stdout(content)
        if not parsed:
            continue
        for tag in to_hermes_media_tags(parsed):
            path = tag[len("MEDIA:"):]
            if path not in history_media_paths:
                media_tags.append(tag)
    return media_tags, False


__all__ = [
    "SUPPORTED_CHANNELS",
    "to_absolute_path",
    "to_hermes_media_marker",
    "to_hermes_media_tags",
    "to_openclaw_payload",
    "to_feishu_payload",
    "to_qq_payload",
    "to_wechat_payload",
    "to_wecom_payload",
    "to_wxwork_payload",
    "to_channel_payload",
    "parse_skill_stdout",
    "is_kuaifan_image_result",
    "collect_history_paths",
    "collect_kuaifan_media_tags",
]
