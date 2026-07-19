import importlib.util
import inspect
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from urllib.error import HTTPError
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "kuaifan_image.py"


def load_module():
    if not SCRIPT.is_file():
        return None
    spec = importlib.util.spec_from_file_location("kuaifan_image", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


module = load_module()


class ProviderResolutionTests(unittest.TestCase):
    def test_resolve_provider_uses_the_only_kuaifan_base_url(self):
        self.assertIsNotNone(module, "the Kuaifan image client must exist")
        config = {
            "models": {
                "providers": {
                    "openai": {
                        "apiKey": "file-key",
                        "baseUrl": "https://kuaifanio.cn/v1",
                    }
                }
            }
        }
        provider = module.resolve_provider(config, None)
        self.assertEqual(provider["api_key"], "file-key")
        self.assertEqual(provider["base_url"], "https://kuaifanio.cn/v1")

    def test_resolve_provider_prefers_environment_key(self):
        self.assertIsNotNone(module, "the Kuaifan image client must exist")
        config = {
            "models": {
                "providers": {
                    "kuaifan": {
                        "apiKey": "file-key",
                        "baseUrl": "https://kuaifanio.cn/v1",
                    }
                }
            }
        }
        provider = module.resolve_provider(config, "environment-key")
        self.assertEqual(provider["api_key"], "environment-key")

    def test_load_model_config_reads_hermes_kuaifan_provider(self):
        self.assertTrue(hasattr(module, "load_model_config"), "model config loader must exist")
        with tempfile.TemporaryDirectory() as directory:
            hermes_path = pathlib.Path(directory) / "config.yaml"
            hermes_path.write_text(
                "providers:\n"
                "  kuaifan:\n"
                "    api: https://kuaifanio.cn/v1\n"
                "    api_key: hermes-key\n",
                encoding="utf-8",
            )
            config = module.load_model_config(
                openclaw_config_path=str(pathlib.Path(directory) / "missing.json"),
                hermes_config_path=str(hermes_path),
            )
        provider = module.resolve_provider(config, None)
        self.assertEqual(provider["api_key"], "hermes-key")

    def test_load_model_config_can_select_hermes_explicitly(self):
        self.assertIn("runtime", inspect.signature(module.load_model_config).parameters)
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            openclaw_path = root / "openclaw.json"
            hermes_path = root / "config.yaml"
            openclaw_path.write_text(
                json.dumps({"models": {"providers": {"openai": {"apiKey": "openclaw-key", "baseUrl": "https://kuaifanio.cn/v1"}}}}),
                encoding="utf-8",
            )
            hermes_path.write_text(
                "providers:\n  kuaifan:\n    api: https://kuaifanio.cn/v1\n    api_key: hermes-key\n",
                encoding="utf-8",
            )
            config = module.load_model_config(
                openclaw_config_path=str(openclaw_path),
                hermes_config_path=str(hermes_path),
                runtime="hermes",
            )
        self.assertEqual(module.resolve_provider(config, None)["api_key"], "hermes-key")


class ImageRequestTests(unittest.TestCase):
    def test_text_request_uses_generations_with_n_one(self):
        self.assertTrue(hasattr(module, "build_text_request"), "text request builder must exist")
        request = module.build_text_request(
            "https://kuaifanio.cn/v1", "model", "poster", "1024x1024"
        )
        self.assertEqual(request.full_url, "https://kuaifanio.cn/v1/images/generations")
        self.assertEqual(json.loads(request.data.decode("utf-8"))["n"], 1)

    def test_edit_request_uses_multipart_edits_endpoint(self):
        self.assertTrue(hasattr(module, "build_edit_request"), "edit request builder must exist")
        request = module.build_edit_request(
            "https://kuaifanio.cn/v1",
            "model",
            "edit",
            "1024x1024",
            [("source.png", b"png")],
        )
        self.assertEqual(request.full_url, "https://kuaifanio.cn/v1/images/edits")
        self.assertIn("multipart/form-data", request.get_header("Content-type"))


class SkillPackageTests(unittest.TestCase):
    def test_skill_document_declares_no_secret_and_explicit_trigger(self):
        document = ROOT / "SKILL.md"
        self.assertTrue(document.is_file(), "SKILL.md must exist")
        text = document.read_text(encoding="utf-8")
        self.assertIn("KUAIFAN_API_KEY", text)
        self.assertIn("/生图", text)
        self.assertNotIn("sk-", text)

    def test_dry_run_reads_config_without_printing_its_key(self):
        config = {
            "models": {
                "providers": {
                    "openai": {
                        "apiKey": "test-secret-key",
                        "baseUrl": "https://kuaifanio.cn/v1",
                    }
                }
            }
        }
        with tempfile.TemporaryDirectory() as directory:
            config_path = pathlib.Path(directory) / "openclaw.json"
            output_path = pathlib.Path(directory) / "image.png"
            config_path.write_text(json.dumps(config), encoding="utf-8")
            result = subprocess.run(
                [
                    sys.executable,
                    str(SCRIPT),
                    "--config",
                    str(config_path),
                    "--prompt",
                    "test image",
                    "--output",
                    str(output_path),
                    "--dry-run",
                ],
                check=False,
                capture_output=True,
                text=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("test-secret-key", result.stdout)
        self.assertTrue(result.stdout.strip(), "dry-run must emit a JSON result")
        payload = json.loads(result.stdout)
        self.assertEqual(payload["endpoint"], "https://kuaifanio.cn/v1/images/generations")
        self.assertEqual(payload["n"], 1)



class ImageResponseTests(unittest.TestCase):
    def test_invalid_base64_response_raises_a_safe_error(self):
        payload = json.dumps({"data": [{"b64_json": "%%%"}]}).encode("utf-8")
        with self.assertRaises(module.KuaifanImageError):
            module.image_bytes_from_response(payload, 1)

    def test_empty_base64_response_is_rejected(self):
        payload = json.dumps({"data": [{"b64_json": ""}]}).encode("utf-8")
        with self.assertRaises(module.KuaifanImageError):
            module.image_bytes_from_response(payload, 1)


class ScriptOutputContractTests(unittest.TestCase):
    """Lock the on-the-wire JSON shape the runtime adapters depend on."""

    def test_main_emits_media_marker_for_successful_response(self):
        # Invoke main() in-process with a stubbed urlopen so the script path is
        # exercised end-to-end (no subprocess). Asserts the success result has
        # every field the channel adapter needs.
        from unittest import mock
        import base64
        import io

        fake_png_bytes = b"\x89PNG\r\n\x1a\nfake-bytes"
        fake_png = base64.b64encode(fake_png_bytes).decode("ascii")
        response_payload = json.dumps({"data": [{"b64_json": fake_png}]}).encode("utf-8")

        fake_response = mock.MagicMock()
        fake_response.read.return_value = response_payload
        fake_response.headers.get.return_value = "req-id-1"
        fake_response.__enter__.return_value = fake_response
        fake_response.__exit__.return_value = False

        with tempfile.TemporaryDirectory() as directory:
            config_path = pathlib.Path(directory) / "oc.json"
            config_path.write_text(
                json.dumps({"models": {"providers": {"openai": {"apiKey": "k", "baseUrl": "https://kuaifanio.cn/v1"}}}}),
                encoding="utf-8",
            )
            argv = [
                "kuaifan_image.py",
                "--config", str(config_path),
                "--prompt", "hello",
            ]
            stdout = io.StringIO()
            with mock.patch.object(module, "urlopen", return_value=fake_response), \
                 mock.patch.object(
                     module,
                     "image_bytes_from_response",
                     return_value=(fake_png_bytes, "https://cdn.example.test/render.png"),
                 ), \
                 mock.patch.object(sys, "argv", argv), \
                 mock.patch.object(sys.stdout, "write", stdout.write):
                rc = module.main()
        self.assertEqual(rc, 0)
        output_lines = stdout.getvalue().splitlines()
        payload = json.loads(output_lines[0])
        self.assertEqual(payload["artifact"], "kuaifan-image/v1")
        self.assertEqual(payload["mode"], "text_to_image")
        self.assertTrue(payload["image_path"].endswith(".png"))
        self.assertTrue(payload["absolute_path"].endswith(".png"))
        self.assertTrue(payload["media_marker"].startswith("MEDIA:"))
        self.assertTrue(payload["media_marker"].endswith(".png"))
        self.assertEqual(output_lines[-1], payload["media_marker"])
        self.assertEqual(payload["request_id"], "req-id-1")
        self.assertIsNone(payload["image_url"])
        # absolute_path and image_path both point at the requested output file.
        # The actual write goes through save_image, covered by the dry-run test path
        # and the manual integration check at the end of SKILL.md.

    def test_main_reports_a_retryable_upstream_503_without_exposing_the_key(self):
        import io

        with tempfile.TemporaryDirectory() as directory:
            config_path = pathlib.Path(directory) / "oc.json"
            config_path.write_text(
                json.dumps({"models": {"providers": {"kuaifan": {"apiKey": "test-secret-key", "baseUrl": "https://kuaifanio.cn/v1"}}}}),
                encoding="utf-8",
            )
            upstream_error = HTTPError(
                "https://kuaifanio.cn/v1/images/generations",
                503,
                "Service Unavailable",
                None,
                None,
            )
            argv = [
                "kuaifan_image.py",
                "--config", str(config_path),
                "--prompt", "hello",
                "--retries", "0",
            ]
            stderr = io.StringIO()
            with mock.patch.object(module, "urlopen", side_effect=upstream_error), \
                 mock.patch.object(sys, "argv", argv), \
                 mock.patch.object(sys.stderr, "write", stderr.write):
                rc = module.main()

        self.assertEqual(rc, 1)
        payload = json.loads(stderr.getvalue())
        self.assertEqual(payload["error_code"], "upstream_http_503")
        self.assertTrue(payload["retryable"])
        self.assertIn("HTTP 503", payload["error"])
        self.assertNotIn("test-secret-key", stderr.getvalue())

    def test_build_media_marker_rejects_unanchored_paths(self):
        self.assertIsNone(module.build_media_marker(None))
        self.assertIsNone(module.build_media_marker(""))
        self.assertIsNone(module.build_media_marker("   "))
        # No extension -> rejected (Hermes regex needs deliverable extension).
        with tempfile.TemporaryDirectory() as directory:
            no_ext = pathlib.Path(directory) / "image"
            no_ext.write_text("x")
            self.assertIsNone(module.build_media_marker(str(no_ext)))


class ManagedOutputPathTests(unittest.TestCase):
    def test_hermes_outputs_are_allocated_under_its_managed_image_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            with mock.patch.dict(os.environ, {"HERMES_HOME": directory}, clear=False):
                output_path = module.allocate_output_path(None, "hermes", None)

            root = pathlib.Path(directory, "image_cache", "kuaifan-image").resolve()
            self.assertTrue(output_path.is_relative_to(root))
            self.assertEqual(output_path.suffix, ".png")

    def test_rejects_explicit_outputs_outside_the_managed_root(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            with mock.patch.dict(os.environ, {"HERMES_HOME": str(root / "hermes")}, clear=False):
                with self.assertRaises(module.KuaifanImageError):
                    module.allocate_output_path(str(root / "outside.png"), "hermes", None)

if __name__ == "__main__":
    unittest.main(verbosity=2)
