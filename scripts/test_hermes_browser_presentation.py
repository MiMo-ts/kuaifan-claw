from pathlib import Path
import sys
from unittest.mock import patch
import zipfile
import json
import re


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
HERMES_TOOLS = REPOSITORY_ROOT / "src-tauri" / "runtimes" / "hermes" / "tools"
HERMES_RUNTIME = HERMES_TOOLS.parent
sys.path.insert(0, str(HERMES_RUNTIME))
sys.path.insert(0, str(HERMES_TOOLS))

import browser_presentation as presentation
from tools import browser_tool
from tools import terminal_tool
from tools.registry import registry


def test_presentation_helpers() -> None:
    assert presentation.normalize_mode(None) == presentation.BACKGROUND_MODE
    assert presentation.normalize_mode("background") == presentation.BACKGROUND_MODE
    assert presentation.normalize_mode("interactive") == presentation.INTERACTIVE_MODE
    assert presentation.background_session_key("task-1") == "task-1::background"
    assert presentation.interactive_session_key("task-1") == "task-1::interactive"
    assert presentation.owner_task_id("task-1::background") == "task-1"
    assert presentation.owner_task_id("task-1::interactive") == "task-1"


def _run_navigation(mode: str) -> tuple[dict, list[tuple[str, list[str]]]]:
    calls: list[tuple[str, list[str]]] = []

    def fake_command(session_key: str, command: str, args: list[str], **_: object) -> dict:
        calls.append((session_key, [command, *args]))
        if command == "open":
            return {"success": True, "data": {"url": args[0], "title": "Example"}}
        return {"success": True, "data": {"snapshot": "", "refs": []}}

    def fake_session(session_key: str) -> dict:
        return {"session_key": session_key, "features": {"local": True}, "_first_nav": False}

    with (
        patch.object(browser_tool, "_get_session_info", side_effect=fake_session),
        patch.object(browser_tool, "_run_browser_command", side_effect=fake_command),
        patch.object(browser_tool, "_is_local_backend", return_value=True),
        patch.object(browser_tool, "_is_always_blocked_url", return_value=False),
        patch.object(browser_tool, "_is_camofox_mode", return_value=False),
        patch.object(browser_tool, "check_website_access", return_value=None),
    ):
        result = browser_tool.browser_navigate(
            "https://example.com",
            task_id="task-1",
            mode=mode,
        )
    return browser_tool.json.loads(result), calls


def test_navigation_modes_use_separate_sessions() -> None:
    interactive, interactive_calls = _run_navigation("interactive")
    background, background_calls = _run_navigation("background")

    assert interactive["browser_mode"] == presentation.INTERACTIVE_MODE
    assert interactive_calls[0][0] == "task-1::interactive"
    assert background["browser_mode"] == presentation.BACKGROUND_MODE
    assert background_calls[0][0] == "task-1"


def test_interactive_session_builds_headed_cli_args() -> None:
    interactive_args = browser_tool._local_browser_backend_args(
        {"session_name": "interactive-session", "browser_mode": "interactive"}
    )
    background_args = browser_tool._local_browser_backend_args(
        {"session_name": "background-session"}
    )

    assert interactive_args == ["--session", "interactive-session", "--headed"]
    assert background_args == ["--session", "background-session"]


def test_registered_navigation_forwards_interactive_mode() -> None:
    entry = registry.get_entry("browser_navigate")
    assert entry is not None
    received: dict[str, object] = {}

    def fake_navigate(**kwargs: object) -> str:
        received.update(kwargs)
        return "{}"

    with patch.object(browser_tool, "browser_navigate", side_effect=fake_navigate):
        entry.handler(
            {"url": "https://example.com", "mode": "interactive"},
            task_id="task-1",
        )

    assert received == {
        "url": "https://example.com",
        "task_id": "task-1",
        "mode": "interactive",
    }


def test_invalid_navigation_mode_returns_error() -> None:
    result = browser_tool.json.loads(
        browser_tool.browser_navigate("https://example.com", mode="visible")
    )

    assert result["success"] is False
    assert "background" in result["error"]
    assert "interactive" in result["error"]


def test_terminal_rejects_gui_browser_launches_but_allows_http_fetches() -> None:
    blocked_commands = (
        'cmd.exe /c start "" "https://www.douyin.com"',
        'powershell.exe -NoProfile -Command "Start-Process https://www.douyin.com"',
        'explorer.exe https://www.douyin.com',
        'chrome.exe https://www.douyin.com',
    )

    for command in blocked_commands:
        assert terminal_tool._is_graphical_browser_launch_command(command), command

    for command in (
        'curl -L https://www.douyin.com',
        'python scrape.py --url https://www.douyin.com',
        'echo "start https://www.douyin.com"',
    ):
        assert not terminal_tool._is_graphical_browser_launch_command(command), command


def test_cleanup_reaps_primary_and_interactive_sessions() -> None:
    task_id = "task-1"
    interactive_key = presentation.interactive_session_key(task_id)
    old_sessions = dict(browser_tool._active_sessions)
    old_last_active = dict(browser_tool._last_active_session_key)
    cleaned: list[str] = []
    try:
        browser_tool._active_sessions.clear()
        browser_tool._last_active_session_key.clear()
        browser_tool._active_sessions[task_id] = {"session_name": "background"}
        browser_tool._active_sessions[interactive_key] = {"session_name": "interactive"}
        browser_tool._last_active_session_key[task_id] = interactive_key

        with patch.object(
            browser_tool,
            "_cleanup_single_browser_session",
            side_effect=cleaned.append,
        ):
            browser_tool.cleanup_browser(task_id)

        assert cleaned == [task_id, interactive_key]
        assert task_id not in browser_tool._last_active_session_key
    finally:
        browser_tool._active_sessions.clear()
        browser_tool._active_sessions.update(old_sessions)
        browser_tool._last_active_session_key.clear()
        browser_tool._last_active_session_key.update(old_last_active)


def test_runtime_does_not_force_all_browser_sessions_headed() -> None:
    runtime_source = (
        REPOSITORY_ROOT / "src-tauri" / "src" / "commands" / "runtime.rs"
    ).read_text(encoding="utf-8")

    assert 'cmd.env("KFC_BROWSER_HEADED", "1")' not in runtime_source


def test_bundled_archive_contains_current_browser_tool() -> None:
    source_path = HERMES_TOOLS / "browser_tool.py"
    terminal_path = HERMES_TOOLS / "terminal_tool.py"
    presentation_path = HERMES_TOOLS / "browser_presentation.py"
    cdp_driver_path = HERMES_TOOLS / "cdp_browser.py"
    cdp_cli_path = HERMES_TOOLS / "cdp_browser_cli.py"
    archive_path = REPOSITORY_ROOT / "src-tauri" / "bundled-hermes" / "hermes-agent.zip"

    with zipfile.ZipFile(archive_path) as archive:
        assert archive.read("tools/browser_tool.py") == source_path.read_bytes()
        assert archive.read("tools/terminal_tool.py") == terminal_path.read_bytes()
        assert archive.read("tools/browser_presentation.py") == presentation_path.read_bytes()
        assert archive.read("tools/cdp_browser.py") == cdp_driver_path.read_bytes()
        assert archive.read("tools/cdp_browser_cli.py") == cdp_cli_path.read_bytes()


def test_release_versions_are_consistent() -> None:
    expected_version = "1.0.69"
    cargo_toml = (REPOSITORY_ROOT / "src-tauri" / "Cargo.toml").read_text(encoding="utf-8")
    tauri_config = json.loads(
        (REPOSITORY_ROOT / "src-tauri" / "tauri.conf.json").read_text(encoding="utf-8")
    )
    web_package = json.loads((REPOSITORY_ROOT / "web" / "package.json").read_text(encoding="utf-8"))
    cargo_version = re.search(r'^version\s*=\s*"([^"]+)"', cargo_toml, re.MULTILINE)

    assert cargo_version is not None
    assert cargo_version.group(1) == expected_version
    assert tauri_config["version"] == expected_version
    assert web_package["version"] == expected_version


if __name__ == "__main__":
    test_presentation_helpers()
    test_navigation_modes_use_separate_sessions()
    test_interactive_session_builds_headed_cli_args()
    test_registered_navigation_forwards_interactive_mode()
    test_invalid_navigation_mode_returns_error()
    test_terminal_rejects_gui_browser_launches_but_allows_http_fetches()
    test_cleanup_reaps_primary_and_interactive_sessions()
    test_runtime_does_not_force_all_browser_sessions_headed()
    test_bundled_archive_contains_current_browser_tool()
    test_release_versions_are_consistent()
    print("presentation helper tests passed")
