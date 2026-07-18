import json
import os
from pathlib import Path
import re
import sys
import tempfile
import time
from unittest.mock import patch
import ctypes
from ctypes import wintypes

import psutil


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
HERMES_RUNTIME = REPOSITORY_ROOT / "src-tauri" / "runtimes" / "hermes"
sys.path.insert(0, str(HERMES_RUNTIME))

from tools import browser_tool


def _session_name(session_key: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_-]", "-", session_key)
    return f"kfc-presentation-{normalized}"


def _create_local_session(session_key: str) -> dict:
    return {
        "session_name": _session_name(session_key),
        "bb_session_id": None,
        "cdp_url": None,
        "features": {"local": True},
    }


def _source_agent_browser_shim() -> tempfile.TemporaryDirectory:
    temporary_directory = tempfile.TemporaryDirectory()
    shim_path = Path(temporary_directory.name) / "agent-browser.cmd"
    cli_path = HERMES_RUNTIME / "tools" / "cdp_browser_cli.py"
    shim_path.write_text(
        f'@ECHO off\r\n"{sys.executable}" "{cli_path}" %*\r\nexit /b %ERRORLEVEL%\r\n',
        encoding="ascii",
    )
    return temporary_directory


def _find_chromium_parent(session_name: str, headed: bool) -> psutil.Process:
    marker = f"kfc-cdp-{session_name}-"
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        for process in psutil.process_iter(["name", "cmdline"]):
            try:
                command_line = " ".join(process.info["cmdline"] or [])
                if marker not in command_line or "--type=" in command_line:
                    continue
                if headed == ("--headless=new" not in command_line):
                    return process
            except (psutil.AccessDenied, psutil.NoSuchProcess):
                continue
        time.sleep(0.25)
    raise AssertionError(f"Chromium parent was not found for {session_name}")


def _has_visible_window(process_id: int) -> bool:
    visible = False
    user32 = ctypes.WinDLL("user32", use_last_error=True)
    process_id_out = wintypes.DWORD()

    @ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    def inspect_window(window_handle: int, _: int) -> bool:
        nonlocal visible
        user32.GetWindowThreadProcessId(window_handle, ctypes.byref(process_id_out))
        if process_id_out.value == process_id and user32.IsWindowVisible(window_handle):
            visible = True
            return False
        return True

    user32.EnumWindows(inspect_window, 0)
    return visible


def _terminate_created_chromium(processes: list[psutil.Process]) -> None:
    roots: dict[int, psutil.Process] = {process.pid: process for process in processes}
    descendants: list[psutil.Process] = []
    for process in roots.values():
        try:
            descendants.extend(process.children(recursive=True))
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass
    for process in descendants + list(roots.values()):
        try:
            process.terminate()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass
    _, alive = psutil.wait_procs(descendants + list(roots.values()), timeout=5)
    for process in alive:
        try:
            process.kill()
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            pass


def main() -> None:
    task_id = "presentation-integration"
    created: list[psutil.Process] = []
    old_sessions = dict(browser_tool._active_sessions)
    old_last_active = dict(browser_tool._last_active_session_key)
    browser_tool._active_sessions.clear()
    browser_tool._last_active_session_key.clear()

    try:
        shim_directory = _source_agent_browser_shim()
        source_shim = str(Path(shim_directory.name) / "agent-browser.cmd")
        with (
            patch.object(browser_tool, "_create_local_session", side_effect=_create_local_session),
            patch.object(browser_tool, "_find_agent_browser", return_value=source_shim),
            patch.object(browser_tool, "_get_cloud_provider", return_value=None),
            patch.object(browser_tool, "_get_cdp_override", return_value=""),
            patch.object(browser_tool, "_is_camofox_mode", return_value=False),
            patch.object(browser_tool, "_start_browser_cleanup_thread"),
        ):
            background = json.loads(
                browser_tool.browser_navigate(
                    "https://example.com",
                    task_id=task_id,
                    mode="background",
                )
            )
            assert background["success"] is True, background
            assert background["browser_mode"] == "background", background
            background_process = _find_chromium_parent(_session_name(task_id), headed=False)
            created.append(background_process)
            assert "--headless=new" in " ".join(background_process.cmdline())

            interactive = json.loads(
                browser_tool.browser_navigate(
                    "https://example.com",
                    task_id=task_id,
                    mode="interactive",
                )
            )
            assert interactive["success"] is True, interactive
            assert interactive["browser_mode"] == "interactive", interactive
            interactive_process = _find_chromium_parent(
                _session_name(f"{task_id}::interactive"),
                headed=True,
            )
            created.append(interactive_process)
            assert "--headless=new" not in " ".join(interactive_process.cmdline())

            visible_deadline = time.monotonic() + 10
            while time.monotonic() < visible_deadline and not _has_visible_window(interactive_process.pid):
                time.sleep(0.25)
            assert _has_visible_window(interactive_process.pid), "interactive Chromium has no visible window"

            browser_tool.cleanup_browser(task_id)
            closed_deadline = time.monotonic() + 10
            while time.monotonic() < closed_deadline:
                if not background_process.is_running() and not interactive_process.is_running():
                    break
                time.sleep(0.25)
            assert not background_process.is_running(), "background Chromium survived cleanup_browser"
            assert not interactive_process.is_running(), "interactive Chromium survived cleanup_browser"
            created.clear()

            print(json.dumps({
                "background_pid": background_process.pid,
                "interactive_pid": interactive_process.pid,
                "background_mode": background["browser_mode"],
                "interactive_mode": interactive["browser_mode"],
            }))
    finally:
        if "shim_directory" in locals():
            shim_directory.cleanup()
        _terminate_created_chromium(created)
        browser_tool._active_sessions.clear()
        browser_tool._active_sessions.update(old_sessions)
        browser_tool._last_active_session_key.clear()
        browser_tool._last_active_session_key.update(old_last_active)


if __name__ == "__main__":
    main()
