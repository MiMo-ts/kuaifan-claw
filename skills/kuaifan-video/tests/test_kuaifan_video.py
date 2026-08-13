"""Contract tests for the managed Kuaifan video skill."""

from __future__ import annotations

import importlib.util
import io
import json
import os
import pathlib
import sys
import tempfile
import unittest
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "kuaifan_video.py"
spec = importlib.util.spec_from_file_location("kuaifan_video", SCRIPT)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class RequestTests(unittest.TestCase):
    def test_create_request_uses_video_endpoint_and_requested_resolution(self):
        request = module.build_generation_request(
            "https://kuaifanio.cn/v1",
            "doubao-seedance-2-0-260128",
            "a paper boat sailing through a rainy city",
            "1080p",
            None,
        )
        self.assertEqual(request.full_url, "https://kuaifanio.cn/v1/video/generations")
        self.assertEqual(request.get_method(), "POST")
        self.assertEqual(
            json.loads(request.data.decode("utf-8")),
            {
                "model": "doubao-seedance-2-0-260128",
                "prompt": "a paper boat sailing through a rainy city",
                "n": 1,
                "resolution": "1080p",
            },
        )

    def test_image_to_video_request_includes_https_image_url(self):
        request = module.build_generation_request(
            "https://kuaifanio.cn/v1",
            "doubao-seedance-2-0-mini-260615",
            "bring the scene to life",
            "720p",
            "https://cdn.example.test/reference.jpeg",
        )
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["image_url"], "https://cdn.example.test/reference.jpeg")
        self.assertEqual(payload["resolution"], "720p")

    def test_local_source_encodes_data_url_for_image_to_video(self):
        with tempfile.TemporaryDirectory() as directory:
            image = pathlib.Path(directory) / "ref.png"
            image.write_bytes(b"\x89PNG\r\n\x1a\nlocal-reference")
            data_url = module.load_reference_image(str(image), timeout=5)
        self.assertTrue(data_url.startswith("data:image/png;base64,"))
        request = module.build_generation_request(
            "https://kuaifanio.cn/v1",
            "doubao-seedance-2-0-mini-260615",
            "animate gently",
            "480p",
            data_url,
        )
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["image_url"], data_url)

    def test_rejects_unknown_model_resolution_and_non_https_reference(self):
        with self.assertRaises(module.KuaifanVideoError):
            module.validate_options("other", "720p")
        with self.assertRaises(module.KuaifanVideoError):
            module.validate_options("doubao-seedance-2-0-260128", "4k")
        with self.assertRaises(module.KuaifanVideoError):
            module.load_reference_image("http://cdn.example.test/reference.png", timeout=5)
        with self.assertRaises(module.KuaifanVideoError):
            module.load_reference_image("file:///C:/reference.png", timeout=5)


class TaskAndOutputTests(unittest.TestCase):
    def test_task_result_reads_result_url_and_nested_video_url(self):
        self.assertEqual(
            module.video_url_from_task(
                {"code": "success", "data": {"status": "SUCCESS", "result_url": "https://cdn.example.test/a.mp4"}}
            ),
            "https://cdn.example.test/a.mp4",
        )
        self.assertEqual(
            module.video_url_from_task(
                {"data": {"status": "SUCCESS", "data": {"content": {"video_url": "https://cdn.example.test/b.mp4"}}}}
            ),
            "https://cdn.example.test/b.mp4",
        )

    def test_hermes_video_cache_is_managed(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"HERMES_HOME": directory}, clear=False):
                output = module.allocate_output_path(None, "hermes", None)
            root = pathlib.Path(directory, "video_cache", "kuaifan-video").resolve()
        self.assertTrue(output.is_relative_to(root))
        self.assertEqual(output.suffix, ".mp4")

    def test_main_polls_downloads_and_emits_exactly_one_openclaw_media_tag(self):
        class Response:
            def __init__(self, payload, request_id=None):
                self.payload = payload
                self.headers = {"x-request-id": request_id} if request_id else {}

            def read(self):
                return self.payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        submitted = Response(json.dumps({"task_id": "task-1"}).encode("utf-8"), "submit-1")
        complete = Response(
            json.dumps(
                {
                    "code": "success",
                    "data": {
                        "status": "SUCCESS",
                        "result_url": "https://cdn.example.test/out.mp4",
                    },
                }
            ).encode("utf-8")
        )
        video = Response(b"\x00\x00\x00\x18ftypmp42video")

        with tempfile.TemporaryDirectory() as directory:
            config_path = pathlib.Path(directory) / "openclaw.json"
            config_path.write_text(
                json.dumps(
                    {
                        "models": {
                            "providers": {
                                "kuaifan": {
                                    "apiKey": "test-key",
                                    "baseUrl": "https://kuaifanio.cn/v1",
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            argv = [
                "kuaifan_video.py",
                "--config",
                str(config_path),
                "--runtime",
                "openclaw",
                "--prompt",
                "a small robot dancing",
                "--model",
                "doubao-seedance-2-0-mini-260615",
                "--resolution",
                "720p",
                "--poll-interval",
                "0",
            ]
            with mock.patch.object(module, "urlopen", side_effect=[submitted, complete, video]) as opener, mock.patch.object(
                sys, "argv", argv
            ), mock.patch.object(sys.stdout, "write", stdout.write):
                rc = module.main()

        self.assertEqual(rc, 0)
        lines = stdout.getvalue().splitlines()
        result = json.loads(lines[0])
        self.assertEqual(result["artifact"], "kuaifan-video/v1")
        self.assertEqual(result["task_id"], "task-1")
        self.assertEqual(result["resolution"], "720p")
        self.assertEqual(result["mode"], "text_to_video")
        self.assertEqual(sum(line.startswith("MEDIA:") for line in lines), 1)
        self.assertTrue(lines[-1].endswith(".mp4"))
        self.assertEqual(opener.call_count, 3)

    def test_main_local_source_uses_image_to_video_mode(self):
        class Response:
            def __init__(self, payload, request_id=None):
                self.payload = payload
                self.headers = {"x-request-id": request_id} if request_id else {}

            def read(self):
                return self.payload

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

        captured = {}

        def fake_urlopen(request, timeout=0):
            if isinstance(request, str):
                return Response(b"\x00\x00\x00\x18ftypmp42video")
            method = request.get_method()
            if method == "POST":
                captured["payload"] = json.loads(request.data.decode("utf-8"))
                return Response(json.dumps({"task_id": "task-local"}).encode("utf-8"))
            if method == "GET" and "task-local" in request.full_url:
                return Response(
                    json.dumps(
                        {
                            "code": "success",
                            "data": {
                                "status": "SUCCESS",
                                "result_url": "https://cdn.example.test/local.mp4",
                            },
                        }
                    ).encode("utf-8")
                )
            return Response(b"\x00\x00\x00\x18ftypmp42video")

        with tempfile.TemporaryDirectory() as directory:
            image = pathlib.Path(directory) / "local.png"
            image.write_bytes(b"\x89PNG\r\n\x1a\nframe")
            config_path = pathlib.Path(directory) / "openclaw.json"
            config_path.write_text(
                json.dumps(
                    {
                        "models": {
                            "providers": {
                                "kuaifan": {
                                    "apiKey": "test-key",
                                    "baseUrl": "https://kuaifanio.cn/v1",
                                }
                            }
                        }
                    }
                ),
                encoding="utf-8",
            )
            stdout = io.StringIO()
            argv = [
                "kuaifan_video.py",
                "--config",
                str(config_path),
                "--runtime",
                "openclaw",
                "--prompt",
                "animate this photo",
                "--source",
                str(image),
                "--model",
                "doubao-seedance-2-0-mini-260615",
                "--resolution",
                "480p",
                "--poll-interval",
                "0",
            ]
            with mock.patch.object(module, "urlopen", side_effect=fake_urlopen), mock.patch.object(
                sys, "argv", argv
            ), mock.patch.object(sys.stdout, "write", stdout.write):
                rc = module.main()

        self.assertEqual(rc, 0)
        result = json.loads(stdout.getvalue().splitlines()[0])
        self.assertEqual(result["mode"], "image_to_video")
        self.assertTrue(captured["payload"]["image_url"].startswith("data:image/png;base64,"))


if __name__ == "__main__":
    unittest.main(verbosity=2)
