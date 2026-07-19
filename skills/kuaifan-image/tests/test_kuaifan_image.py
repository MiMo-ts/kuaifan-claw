import importlib.util
import inspect
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest


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


if __name__ == "__main__":
    unittest.main(verbosity=2)
