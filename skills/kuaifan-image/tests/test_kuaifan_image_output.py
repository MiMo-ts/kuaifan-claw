"""Tests for the kuaifan_image_output adapter module.

Covers the contract the rest of the runtime depends on:
  * Hermes MEDIA:<path> directive shape (must match gateway/run.py _TOOL_MEDIA_RE).
  * OpenClaw outbound media payload shape (feishu / qq / wechat / wecom / wxwork).
  * parse_skill_stdout() tolerates log noise around the success JSON line.
  * is_kuaifan_image_result() and collect_history_paths() dedup prior sends.
  * collect_kuaifan_media_tags() respects history_offset for current-turn isolation.
"""

import importlib.util
import json
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "scripts" / "kuaifan_image_output.py"


def _load_adapter():
    spec = importlib.util.spec_from_file_location("kuaifan_image_output", ADAPTER)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


adapter = _load_adapter()


class HermesMarkerTests(unittest.TestCase):
    def test_windows_path_with_png_extension_is_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            image = pathlib.Path(directory) / "out.png"
            image.write_text("png")
            marker = adapter.to_hermes_media_marker(str(image))
        self.assertTrue(marker.startswith("MEDIA:"))
        self.assertTrue(marker.endswith(".png"))

    def test_posix_path_is_accepted(self):
        marker = adapter.to_hermes_media_marker("/tmp/out.jpg")
        self.assertIsNotNone(marker)
        self.assertRegex(marker, r"^MEDIA:.+?\.jpg$")

    def test_missing_extension_is_rejected(self):
        self.assertIsNone(adapter.to_hermes_media_marker("/tmp/out"))
        self.assertIsNone(adapter.to_hermes_media_marker("/tmp/out.unknown"))

    def test_empty_input_returns_none(self):
        self.assertIsNone(adapter.to_hermes_media_marker(""))
        self.assertIsNone(adapter.to_hermes_media_marker(None))
        self.assertIsNone(adapter.to_hermes_media_marker("   "))

    def test_result_with_existing_media_marker_is_returned_verbatim(self):
        result = {"image_path": "ignored", "media_marker": "MEDIA:/tmp/x.png"}
        self.assertEqual(adapter.to_hermes_media_tags(result), ["MEDIA:/tmp/x.png"])

    def test_result_without_marker_derives_from_image_path(self):
        with tempfile.TemporaryDirectory() as directory:
            image = pathlib.Path(directory) / "derived.png"
            image.write_text("")
            result = {"image_path": str(image), "image_url": None}
            tags = adapter.to_hermes_media_tags(result)
        self.assertEqual(len(tags), 1)
        self.assertTrue(tags[0].endswith("derived.png"))

    def test_result_with_bad_marker_falls_back_to_image_path(self):
        result = {"image_path": "/tmp/out.png", "media_marker": "not-a-marker"}
        tags = adapter.to_hermes_media_tags(result)
        self.assertEqual(len(tags), 1)
        self.assertTrue(tags[0].endswith(".png"))


class OpenClawPayloadTests(unittest.TestCase):
    def _result(self, path, url=None):
        return {
            "image_path": path,
            "image_url": url,
            "mode": "text_to_image",
            "request_id": "req-abc",
        }

    def test_openclaw_payload_carries_path_and_url(self):
        payload = adapter.to_openclaw_payload(self._result("/tmp/a.png", "https://x"))
        self.assertEqual(payload["type"], "image")
        self.assertTrue(payload["image_path"].endswith("a.png"))
        self.assertEqual(payload["image_url"], "https://x")
        self.assertTrue(payload["media_marker"].startswith("MEDIA:"))
        self.assertEqual(payload["metadata"]["source"], "kuaifan-image-skill")
        self.assertEqual(payload["metadata"]["request_id"], "req-abc")

    def test_feishu_sets_msg_type(self):
        payload = adapter.to_feishu_payload(self._result("/tmp/a.png"))
        self.assertEqual(payload["metadata"]["msg_type"], "image")

    def test_qq_sets_content_type(self):
        payload = adapter.to_qq_payload(self._result("/tmp/a.png"))
        self.assertEqual(payload["metadata"]["content_type"], "file_image")

    def test_wechat_sets_attachment_type(self):
        payload = adapter.to_wechat_payload(self._result("/tmp/a.png"))
        self.assertEqual(payload["metadata"]["attachment_type"], "image")

    def test_wecom_and_wxwork_share_wechat_shape(self):
        wecom = adapter.to_wecom_payload(self._result("/tmp/a.png"))
        wxwork = adapter.to_wxwork_payload(self._result("/tmp/a.png"))
        self.assertEqual(wecom["metadata"], wxwork["metadata"])

    def test_dispatcher_falls_back_to_openclaw_for_unknown_channel(self):
        result = self._result("/tmp/a.png")
        openclaw = adapter.to_openclaw_payload(result)
        self.assertEqual(adapter.to_channel_payload(result, "discord"), openclaw)
        self.assertEqual(adapter.to_channel_payload(result, "FEISHU"), adapter.to_feishu_payload(result))

    def test_dispatcher_rejects_empty_channel(self):
        with self.assertRaises(ValueError):
            adapter.to_channel_payload(self._result("/tmp/a.png"), "")


class StdoutParserTests(unittest.TestCase):
    def test_parses_single_json_line(self):
        stdout = "{\"image_path\": \"/tmp/a.png\", \"media_marker\": \"MEDIA:/tmp/a.png\"}"
        self.assertEqual(adapter.parse_skill_stdout(stdout)["image_path"], "/tmp/a.png")

    def test_ignores_surrounding_log_lines(self):
        stdout = "\n".join([
            "[INFO] warming up",
            "[DEBUG] calling Kuaifan",
            "{\"mode\": \"text_to_image\", \"image_path\": \"/tmp/a.png\", \"image_url\": null, \"media_marker\": \"MEDIA:/tmp/a.png\"}",
        ])
        parsed = adapter.parse_skill_stdout(stdout)
        self.assertEqual(parsed["mode"], "text_to_image")
        self.assertEqual(parsed["image_path"], "/tmp/a.png")

    def test_returns_none_for_non_json_stdout(self):
        self.assertIsNone(adapter.parse_skill_stdout("Traceback... no JSON here"))
        self.assertIsNone(adapter.parse_skill_stdout(""))
        self.assertIsNone(adapter.parse_skill_stdout(None))


class DetectionAndHistoryTests(unittest.TestCase):
    def test_is_kuaifan_image_result_for_dict(self):
        self.assertTrue(adapter.is_kuaifan_image_result({"image_path": "/tmp/a.png"}))
        self.assertTrue(adapter.is_kuaifan_image_result({"media_marker": "MEDIA:/tmp/a.png"}))
        self.assertFalse(adapter.is_kuaifan_image_result({"unrelated": 1}))

    def test_is_kuaifan_image_result_for_string(self):
        self.assertTrue(adapter.is_kuaifan_image_result("{\"image_path\":\"/tmp/a.png\"}"))
        self.assertFalse(adapter.is_kuaifan_image_result("not json"))

    def test_collect_history_paths_dedups_text_and_json_shapes(self):
        history = [
            {
                "role": "tool",
                "content": "see MEDIA:/tmp/a.png attached",
            },
            {
                "role": "tool",
                "content": json.dumps({"image_path": str(pathlib.Path("/tmp/b.png").expanduser().resolve())}),
            },
            {
                "role": "user",
                "content": "MEDIA:/tmp/never-attached.png",
            },
        ]
        paths = adapter.collect_history_paths(history)
        self.assertIn("/tmp/a.png", paths)
        # /tmp/b.png gets resolved to an absolute platform-native path
        # before being added to the dedup set; the test must compare the
        # same resolved form.
        self.assertIn(str(pathlib.Path("/tmp/b.png").expanduser().resolve()), paths)
        self.assertNotIn("/tmp/never-attached.png", paths)


class CollectKuaifanMediaTagsTests(unittest.TestCase):
    def test_returns_empty_for_turn_without_kuaifan_result(self):
        messages = [
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "hi"},
        ]
        tags, voice = adapter.collect_kuaifan_media_tags(messages)
        self.assertEqual(tags, [])
        self.assertFalse(voice)

    def test_collects_marker_from_tool_result_stdout(self):
        stdout = json.dumps({"image_path": "/tmp/c.png", "image_url": None, "media_marker": "MEDIA:/tmp/c.png"})
        messages = [
            {"role": "assistant", "tool_calls": [{"id": "1", "function": {"name": "terminal_tool"}}]},
            {"role": "tool", "tool_call_id": "1", "content": stdout},
        ]
        tags, _ = adapter.collect_kuaifan_media_tags(messages)
        self.assertEqual(tags, ["MEDIA:/tmp/c.png"])

    def test_respects_history_offset_for_current_turn(self):
        stdout_old = json.dumps({"image_path": "/tmp/old.png", "image_url": None, "media_marker": "MEDIA:/tmp/old.png"})
        stdout_new = json.dumps({"image_path": "/tmp/new.png", "image_url": None, "media_marker": "MEDIA:/tmp/new.png"})
        messages = [
            {"role": "tool", "content": stdout_old},
            {"role": "user", "content": "now"},
            {"role": "tool", "content": stdout_new},
        ]
        tags, _ = adapter.collect_kuaifan_media_tags(messages, history_offset=2)
        self.assertEqual(tags, ["MEDIA:/tmp/new.png"])

    def test_dedups_against_history_media_paths(self):
        stdout = json.dumps({"image_path": "/tmp/c.png", "image_url": None, "media_marker": "MEDIA:/tmp/c.png"})
        messages = [
            {"role": "tool", "content": stdout},
        ]
        tags, _ = adapter.collect_kuaifan_media_tags(messages, history_media_paths={"/tmp/c.png"})
        self.assertEqual(tags, [])


if __name__ == "__main__":
    unittest.main(verbosity=2)
