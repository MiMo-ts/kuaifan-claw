import pathlib
import unittest
import zipfile


ROOT = pathlib.Path(__file__).resolve().parents[1]
HERMES_AGENT_ZIP = ROOT / "bundled-hermes" / "hermes-agent.zip"


class BundledHermesRuntimeTests(unittest.TestCase):
    def test_agent_archive_contains_api_server_dependencies(self):
        with zipfile.ZipFile(HERMES_AGENT_ZIP) as archive:
            names = set(archive.namelist())

        required = {
            "aiohttp/__init__.py",
            "aiohappyeyeballs/__init__.py",
            "aiosignal/__init__.py",
            "attr/__init__.py",
            "frozenlist/__init__.py",
            "multidict/__init__.py",
            "propcache/__init__.py",
            "yarl/__init__.py",
        }
        self.assertFalse(required - names, f"missing entries: {sorted(required - names)}")


if __name__ == "__main__":
    unittest.main(verbosity=2)
