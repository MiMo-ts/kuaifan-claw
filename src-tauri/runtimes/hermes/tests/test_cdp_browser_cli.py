import io
import json
import unittest
from unittest.mock import patch

from tools import browser_tool
from tools import cdp_browser_cli


class CdpBrowserCliTests(unittest.TestCase):
    def test_emit_writes_utf8_json_when_console_uses_gbk(self):
        stdout = io.TextIOWrapper(io.BytesIO(), encoding="gbk")

        with patch.object(cdp_browser_cli.sys, "stdout", stdout):
            exit_code = cdp_browser_cli._emit(
                {"success": True, "data": {"snapshot": "\U0001f4a5 抖音"}}
            )

        self.assertEqual(exit_code, 0)
        self.assertEqual(
            json.loads(stdout.buffer.getvalue().decode("utf-8")),
            {"success": True, "data": {"snapshot": "\U0001f4a5 抖音"}},
        )

class BrowserSessionCleanupTests(unittest.TestCase):
    def setUp(self):
        self._active_sessions = browser_tool._active_sessions.copy()
        self._last_active_session_key = browser_tool._last_active_session_key.copy()
        browser_tool._active_sessions.clear()
        browser_tool._last_active_session_key.clear()

    def tearDown(self):
        browser_tool._active_sessions.clear()
        browser_tool._active_sessions.update(self._active_sessions)
        browser_tool._last_active_session_key.clear()
        browser_tool._last_active_session_key.update(self._last_active_session_key)

    def test_per_turn_cleanup_keeps_interactive_browser_session(self):
        task_id = "desktop-chat"
        interactive_key = f"{task_id}::interactive"
        browser_tool._active_sessions.update({
            task_id: {"session_name": "headless"},
            interactive_key: {"session_name": "visible", "browser_mode": "interactive"},
        })
        browser_tool._last_active_session_key[task_id] = interactive_key

        with patch.object(browser_tool, "_cleanup_single_browser_session") as cleanup:
            browser_tool.cleanup_browser(task_id, preserve_interactive=True)

        cleanup.assert_called_once_with(task_id)
        self.assertIn(interactive_key, browser_tool._active_sessions)
        self.assertEqual(browser_tool._last_active_session_key[task_id], interactive_key)

    def test_explicit_cleanup_still_closes_interactive_browser_session(self):
        task_id = "desktop-chat"
        interactive_key = f"{task_id}::interactive"
        browser_tool._active_sessions[interactive_key] = {
            "session_name": "visible",
            "browser_mode": "interactive",
        }

        with patch.object(browser_tool, "_cleanup_single_browser_session") as cleanup:
            browser_tool.cleanup_browser(task_id)

        self.assertIn(((interactive_key,), {}), cleanup.call_args_list)


if __name__ == "__main__":
    unittest.main()
