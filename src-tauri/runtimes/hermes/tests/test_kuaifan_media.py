import json
import os
import pathlib
import sys
import tempfile
import unittest


STAGE_ROOT = pathlib.Path(os.environ["HERMES_STAGE_ROOT"]).resolve()
sys.path.insert(0, str(STAGE_ROOT))
from gateway import run  # noqa: E402


class KuaifanMediaCollectorTests(unittest.TestCase):
    def _tool_messages(self, image_path):
        artifact = {
            "artifact": "kuaifan-image/v1",
            "image_path": str(image_path),
            "media_marker": f"MEDIA:{image_path}",
        }
        return [
            {
                "role": "assistant",
                "tool_calls": [
                    {"id": "call-1", "function": {"name": "terminal_tool"}}
                ],
            },
            {
                "role": "tool",
                "tool_call_id": "call-1",
                "content": json.dumps(artifact) + "\n" + artifact["media_marker"],
            },
        ]

    def test_collects_only_a_current_turn_managed_kuaifan_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            image_path = home / "image_cache" / "kuaifan-image" / "result.png"
            image_path.parent.mkdir(parents=True)
            image_path.write_bytes(b"png")
            previous_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                tags = run._collect_kuaifan_image_media_tags(self._tool_messages(image_path))
            finally:
                if previous_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = previous_home

        self.assertEqual(tags, [f"MEDIA:{image_path.resolve()}"])

    def test_rejects_unmanaged_or_previous_kuaifan_artifacts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            home = root / "hermes"
            outside = root / "outside.png"
            outside.write_bytes(b"png")
            current = home / "image_cache" / "kuaifan-image" / "current.png"
            current.parent.mkdir(parents=True)
            current.write_bytes(b"png")
            previous_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                self.assertEqual(run._collect_kuaifan_image_media_tags(self._tool_messages(outside)), [])
                messages = self._tool_messages(outside) + self._tool_messages(current)
                self.assertEqual(
                    run._collect_kuaifan_image_media_tags(
                        messages,
                        history_offset=2,
                        history_media_paths={str(current.resolve())},
                    ),
                    [],
                )
            finally:
                if previous_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = previous_home

    def test_collects_only_a_current_turn_managed_kuaifan_video_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            home = pathlib.Path(directory)
            video_path = home / "video_cache" / "kuaifan-video" / "result.mp4"
            video_path.parent.mkdir(parents=True)
            video_path.write_bytes(b"mp4")
            artifact = {"artifact": "kuaifan-video/v1", "video_path": str(video_path)}
            previous_home = os.environ.get("HERMES_HOME")
            os.environ["HERMES_HOME"] = str(home)
            try:
                tags = run._collect_kuaifan_video_media_tags(
                    [{"role": "tool", "content": json.dumps(artifact)}]
                )
            finally:
                if previous_home is None:
                    os.environ.pop("HERMES_HOME", None)
                else:
                    os.environ["HERMES_HOME"] = previous_home

        self.assertEqual(tags, [f"MEDIA:{video_path.resolve()}"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
