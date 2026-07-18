import base64
import json
import os
from pathlib import Path

import yaml


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(content, encoding="utf-8")
    os.replace(temporary, path)


def update_instances(path: Path, app_id: str, app_secret: str, open_id: str) -> None:
    document = yaml.safe_load(path.read_text(encoding="utf-8-sig")) or {}
    instances = document.get("instances") or []
    candidates = [
        instance
        for instance in instances
        if instance.get("channel_type") == "feishu" and instance.get("enabled") is True
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"expected one enabled Hermes Feishu instance, found {len(candidates)}")
    channel_config = candidates[0].setdefault("channel_config", {})
    channel_config["appId"] = app_id
    channel_config["appSecret"] = app_secret
    channel_config["allowFrom"] = [open_id] if open_id else []
    content = yaml.safe_dump(document, allow_unicode=True, sort_keys=False)
    atomic_write(path, content)


def set_env_values(path: Path, updates: dict[str, str]) -> None:
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    positions = {}
    for index, line in enumerate(lines):
        if line and not line.startswith("#") and "=" in line:
            positions[line.split("=", 1)[0].strip()] = index
    for key, value in updates.items():
        line = f"{key}={value}"
        if key in positions:
            lines[positions[key]] = line
        else:
            positions[key] = len(lines)
            lines.append(line)
    atomic_write(path, "\n".join(lines) + "\n")


payload = json.loads(
    base64.b64decode(os.environ["HERMES_TEST_BIND_PAYLOAD_BASE64"]).decode("utf-8")
)
data_dir = Path(payload["data_dir"])
app_id = payload["app_id"]
app_secret = payload["app_secret"]
open_id = payload.get("open_id") or ""

instance_paths = [
    data_dir / "config" / "modules" / "hermes" / "instances.yaml",
    data_dir / "modules" / "hermes" / "instances.yaml",
]
for instance_path in instance_paths:
    update_instances(instance_path, app_id, app_secret, open_id)

updates = {
    "FEISHU_APP_ID": app_id,
    "FEISHU_APP_SECRET": app_secret,
    "FEISHU_ALLOWED_USERS": open_id,
    "FEISHU_ALLOW_ALL_USERS": "false" if open_id else "true",
    "FEISHU_CONNECTION_MODE": "websocket",
}
set_env_values(data_dir / "modules" / "hermes" / ".env", updates)
local_appdata = payload.get("local_appdata")
if local_appdata:
    set_env_values(Path(local_appdata) / "hermes" / ".env", updates)
