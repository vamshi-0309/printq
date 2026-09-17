"""
The installed product, as a shop receives it.

These cover the things that only matter once the agent stops being a script
someone runs and becomes an executable someone installs: which server it talks
to out of the box, what it reports about itself, that its configuration
survives an upgrade, that background startup is wired correctly -- and, most
importantly, that no backend secret ever ends up inside a binary handed to a
shop.
"""

from __future__ import annotations

import ast
import json
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import config as config_module  # noqa: E402
import printq_agent  # noqa: E402
from config import (  # noqa: E402
    DEFAULT_SERVER_URL,
    MANAGED_SUMATRA_EXE,
    AgentConfig,
    load_config,
    save_config,
)
from version import AGENT_VERSION, is_newer, parse_version, user_agent  # noqa: E402

AGENT_DIR = Path(__file__).resolve().parent
REPO_ROOT = AGENT_DIR.parent
INSTALLER = REPO_ROOT / "installer" / "PrintQAgent.iss"
WORKFLOW = REPO_ROOT / ".github" / "workflows" / "agent-release.yml"


class ProductionServerUrl(unittest.TestCase):
    def test_default_is_the_production_site(self):
        self.assertEqual(DEFAULT_SERVER_URL, "https://printq-rho.vercel.app")

    def test_a_fresh_config_points_at_production(self):
        # A shop that installs and pairs must never have to type a URL.
        self.assertEqual(AgentConfig().api_base_url, DEFAULT_SERVER_URL)

    def test_default_is_https(self):
        self.assertTrue(DEFAULT_SERVER_URL.startswith("https://"))

    def test_default_is_not_a_development_address(self):
        for bad in ("localhost", "127.0.0.1", "ngrok", "loca.lt", "trycloudflare", ":3000"):
            self.assertNotIn(bad, DEFAULT_SERVER_URL)

    def test_pairing_screen_offers_the_production_url(self):
        source = (AGENT_DIR / "app_ui.py").read_text(encoding="utf-8")
        self.assertIn("DEFAULT_SERVER_URL", source)
        # And does not hardcode some other address next to it.
        self.assertNotIn("http://localhost", source)


class VersionReporting(unittest.TestCase):
    def test_version_looks_like_a_release(self):
        self.assertRegex(AGENT_VERSION, r"^\d+\.\d+\.\d+$")

    def test_heartbeat_sends_the_real_version(self):
        # Previously a literal "1.0.0" that could not follow the module.
        source = (AGENT_DIR / "printq_agent.py").read_text(encoding="utf-8")
        self.assertIn('"agent_version": AGENT_VERSION', source)
        self.assertNotIn('"agent_version": "1.0.0"', source)

    def test_requests_identify_the_build(self):
        self.assertIn(AGENT_VERSION, user_agent())
        self.assertIn("PrintQAgent", user_agent())

    def test_version_comparison(self):
        self.assertTrue(is_newer("1.0.1", "1.0.0"))
        self.assertTrue(is_newer("1.1.0", "1.0.9"))
        self.assertFalse(is_newer("1.0.0", "1.0.0"))
        self.assertFalse(is_newer("0.9.9", "1.0.0"))

    def test_unparseable_version_never_looks_newer(self):
        # A malformed value from the server must not trigger an update prompt.
        for junk in ("", "latest", "not-a-version", None):
            self.assertFalse(is_newer(junk, AGENT_VERSION), junk)

    def test_parse_version(self):
        self.assertEqual(parse_version("1.2.3"), (1, 2, 3))
        self.assertEqual(parse_version("junk"), (0,))


class ConfigurationPersistence(unittest.TestCase):
    """Configuration lives in Windows application data, not next to the exe."""

    def test_config_is_in_appdata(self):
        self.assertIn("PrintQ", str(config_module.CONFIG_FILE))
        self.assertTrue(str(config_module.CONFIG_FILE).endswith("agent.json"))

    def test_saved_pairing_is_read_back(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent.json"
            with mock.patch.object(config_module, "CONFIG_DIR", Path(tmp)), \
                 mock.patch.object(config_module, "CONFIG_FILE", path):
                cfg = AgentConfig(
                    api_base_url=DEFAULT_SERVER_URL,
                    shop_id="shop-1",
                    shop_name="ABC Xerox",
                    agent_id="agent-1",
                    agent_secret="s3cret",
                )
                save_config(cfg)
                again = load_config()

        self.assertEqual(again.shop_id, "shop-1")
        self.assertEqual(again.agent_id, "agent-1")
        self.assertEqual(again.shop_name, "ABC Xerox")
        self.assertTrue(again.is_paired)

    def test_pause_survives_a_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent.json"
            with mock.patch.object(config_module, "CONFIG_DIR", Path(tmp)), \
                 mock.patch.object(config_module, "CONFIG_FILE", path):
                save_config(AgentConfig(shop_id="s", agent_id="a", agent_secret="x", paused=True))
                self.assertTrue(load_config().paused)

    def test_unknown_keys_from_a_newer_build_are_ignored(self):
        # Downgrading must not crash on a config written by a later version.
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent.json"
            path.write_text(json.dumps({"shop_id": "s", "invented_later": True}), encoding="utf-8")
            with mock.patch.object(config_module, "CONFIG_DIR", Path(tmp)), \
                 mock.patch.object(config_module, "CONFIG_FILE", path):
                self.assertEqual(load_config().shop_id, "s")

    def test_corrupt_config_does_not_crash_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "agent.json"
            path.write_text("{ not json", encoding="utf-8")
            with mock.patch.object(config_module, "CONFIG_DIR", Path(tmp)), \
                 mock.patch.object(config_module, "CONFIG_FILE", path):
                self.assertFalse(load_config().is_paired)


class NoBackendSecrets(unittest.TestCase):
    """
    Nothing the shop receives may contain a backend credential.

    The agent authenticates with its own per-shop secret, issued at pairing.
    A service-role key or a payment secret inside a binary that is downloaded
    from a public URL would be a total compromise, so this is asserted over
    every file that goes into the build rather than trusted to review.
    """

    SHIPPED = ["printq_agent.py", "config.py", "app_ui.py", "agent_service.py",
               "sumatra_setup.py", "pairing.py", "tray.py", "version.py",
               "build_support.py", "printq_agent.spec"]

    FORBIDDEN = [
        "SUPABASE_SERVICE_ROLE_KEY",
        "service_role",
        "CASHFREE_SECRET",
        "CASHFREE_APP_ID",
        "SUPABASE_URL",
        "NEXT_PUBLIC_SUPABASE_ANON_KEY",
        "eyJhbGciOi",  # a JWT, which is what a Supabase key looks like
    ]

    def test_no_backend_secret_names_in_shipped_source(self):
        for name in self.SHIPPED:
            text = (AGENT_DIR / name).read_text(encoding="utf-8")
            for needle in self.FORBIDDEN:
                self.assertNotIn(needle, text, f"{needle} appears in {name}")

    def test_installer_carries_no_secrets(self):
        text = INSTALLER.read_text(encoding="utf-8")
        for needle in self.FORBIDDEN:
            self.assertNotIn(needle, text, f"{needle} appears in the installer script")

    def test_agent_only_talks_to_agent_endpoints(self):
        """The agent must not reach for dashboard or admin APIs."""
        source = (AGENT_DIR / "printq_agent.py").read_text(encoding="utf-8")
        for path in re.findall(r'/api/[a-z0-9/\-\[\]{}._]+', source):
            self.assertTrue(
                path.startswith("/api/agent/"),
                f"agent calls a non-agent endpoint: {path}",
            )

    def test_ui_only_talks_to_agent_endpoints(self):
        source = (AGENT_DIR / "app_ui.py").read_text(encoding="utf-8")
        for path in re.findall(r'/api/[a-z0-9/\-\[\]{}._]+', source):
            self.assertTrue(
                path.startswith("/api/agent/"),
                f"the UI calls a non-agent endpoint: {path}",
            )

    def test_credentials_are_sent_as_headers_not_in_urls(self):
        # A secret in a query string ends up in server logs and browser history.
        source = (AGENT_DIR / "printq_agent.py").read_text(encoding="utf-8")
        self.assertNotIn("agent_secret=", source)
        self.assertNotIn("?secret", source)


class ManagedSumatra(unittest.TestCase):
    def test_managed_copy_is_user_writable(self):
        # Under LOCALAPPDATA, so the agent can repair itself without an admin.
        self.assertIn("PrintQ", str(MANAGED_SUMATRA_EXE))
        self.assertTrue(str(MANAGED_SUMATRA_EXE).endswith("SumatraPDF.exe"))

    def test_resolver_knows_about_the_managed_copy(self):
        reasons = [r for r, _ in printq_agent.sumatra_candidates(AgentConfig(), {})]
        self.assertIn("PrintQ managed copy", reasons)

    def test_resolver_knows_about_the_installed_copy(self):
        reasons = [r for r, _ in printq_agent.sumatra_candidates(AgentConfig(), {})]
        self.assertIn("next to PrintQ Agent", reasons)

    def test_managed_copy_outranks_a_stray_system_install(self):
        env = {"LOCALAPPDATA": r"C:\Users\x\AppData\Local"}
        paths = [p for _, p in printq_agent.sumatra_candidates(AgentConfig(), env)]
        managed = next(i for i, p in enumerate(paths) if "PrintQ" in p)
        stray = next(i for i, p in enumerate(paths) if p.endswith(r"Local\SumatraPDF\SumatraPDF.exe"))
        self.assertLess(managed, stray)

    def test_download_is_pinned_to_a_checksum(self):
        import sumatra_setup

        self.assertRegex(sumatra_setup.SUMATRA_ZIP_SHA256, r"^[0-9a-f]{64}$")
        self.assertRegex(sumatra_setup.SUMATRA_EXE_SHA256, r"^[0-9a-f]{64}$")
        self.assertTrue(sumatra_setup.SUMATRA_URL.startswith("https://"))

    def test_a_tampered_download_is_rejected(self):
        import sumatra_setup

        class FakeResponse:
            headers = {"Content-Length": "10"}

            def raise_for_status(self):
                pass

            def iter_content(self, chunk_size):
                yield b"not-a-real-zip"

        with mock.patch.object(sumatra_setup.requests, "get", return_value=FakeResponse()):
            with self.assertRaises(sumatra_setup.SumatraSetupError) as ctx:
                sumatra_setup.download_sumatra()
        self.assertIn("security check", str(ctx.exception))

    def test_licence_notice_names_sumatrapdf_and_the_gpl(self):
        import sumatra_setup

        notice = sumatra_setup.notice_text()
        self.assertIn("SumatraPDF", notice)
        self.assertIn("GPL", notice)
        self.assertIn("sumatrapdfreader", notice)


class StartupAndBackgroundOperation(unittest.TestCase):
    def test_minimised_flag_exists_for_windows_startup(self):
        self.assertTrue(printq_agent.parse_args(["--minimised"]).minimised)
        self.assertTrue(printq_agent.parse_args(["--minimized"]).minimised)

    def test_ui_is_the_default_and_headless_is_opt_in(self):
        self.assertFalse(printq_agent.parse_args([]).headless)
        self.assertTrue(printq_agent.parse_args(["--headless"]).headless)

    def test_installer_registers_startup_minimised(self):
        text = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("CurrentVersion\\Run", text)
        self.assertIn("--minimised", text)

    def test_installer_startup_entry_is_per_user(self):
        # HKCU, so printing runs in the interactive desktop session where
        # printer drivers actually work.
        text = INSTALLER.read_text(encoding="utf-8")
        self.assertIn("Root: HKCU", text)
        self.assertNotIn("Root: HKLM", text)

    def test_closing_the_window_does_not_stop_printing(self):
        source = (AGENT_DIR / "app_ui.py").read_text(encoding="utf-8")
        self.assertIn("WM_DELETE_WINDOW", source)
        self.assertIn("withdraw", source)


class InstallerConfiguration(unittest.TestCase):
    def setUp(self):
        self.text = INSTALLER.read_text(encoding="utf-8")

    def test_installer_script_exists(self):
        self.assertTrue(INSTALLER.is_file())

    def test_app_id_is_a_real_guid(self):
        match = re.search(r"AppId=\{\{([0-9A-Fa-f\-]+)\}", self.text)
        self.assertIsNotNone(match, "AppId missing")
        self.assertRegex(
            match.group(1),
            r"^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$",
        )

    def test_no_administrator_rights_required(self):
        self.assertIn("PrivilegesRequired=lowest", self.text)

    def test_ships_the_executable(self):
        self.assertIn("PrintQAgent.exe", self.text)

    def test_creates_start_menu_and_optional_desktop_shortcuts(self):
        self.assertIn("{group}\\PrintQ Agent", self.text)
        self.assertIn("desktopicon", self.text)

    def test_launches_the_agent_after_install(self):
        self.assertIn("[Run]", self.text)
        self.assertIn("postinstall", self.text)

    def test_closes_a_running_agent_before_replacing_it(self):
        self.assertIn("CloseApplications=yes", self.text)

    def test_uninstall_keeps_pairing_by_default(self):
        # The prompt defaults to No, so upgrading never re-pairs a shop.
        self.assertIn("MB_DEFBUTTON2", self.text)

    def test_uninstall_does_not_delete_unrelated_folders(self):
        # Only paths under our own app and data directories may be removed.
        for target in re.findall(r"DelTree\(ExpandConstant\('([^']+)'\)", self.text):
            self.assertIn("PrintQ", target, f"uninstaller would delete {target}")

    def test_sumatra_download_is_over_https(self):
        self.assertIn("https://www.sumatrapdfreader.org/", self.text)
        self.assertNotIn("http://www.sumatrapdfreader.org/", self.text)

    def test_failed_sumatra_download_does_not_fail_the_install(self):
        # skipifsourcedoesntexist is what lets the agent provision it later.
        self.assertIn("skipifsourcedoesntexist", self.text)


class ReleaseWorkflow(unittest.TestCase):
    def setUp(self):
        self.text = WORKFLOW.read_text(encoding="utf-8")

    def test_workflow_exists(self):
        self.assertTrue(WORKFLOW.is_file())

    def test_builds_on_windows(self):
        self.assertIn("runs-on: windows-latest", self.text)

    def test_runs_agent_tests_before_packaging(self):
        # Matched against the build invocation, not the pip install that
        # merely mentions pyinstaller earlier in the file.
        tests_at = self.text.index("unittest discover")
        build_at = self.text.index("pyinstaller --noconfirm")
        self.assertLess(tests_at, build_at, "tests must run before the build")

    def test_does_not_publish_on_every_push_to_main(self):
        # A release is an explicit act: a tag or a manual run.
        self.assertNotIn("branches:", self.text)
        self.assertIn("tags:", self.text)
        self.assertIn("agent-v*", self.text)

    def test_publishes_the_expected_asset_name(self):
        # The website looks for exactly this file on the release.
        self.assertIn("PrintQAgent-Setup.exe", self.text)

    def test_refuses_a_tag_that_disagrees_with_version_py(self):
        self.assertIn("does not match version.py", self.text)


class PyInstallerSpec(unittest.TestCase):
    def setUp(self):
        self.text = (AGENT_DIR / "printq_agent.spec").read_text(encoding="utf-8")

    def test_no_console_window(self):
        self.assertIn("console=False", self.text)

    def test_includes_lazily_imported_modules(self):
        # These are imported inside functions, so PyInstaller cannot see them.
        for module in ("app_ui", "agent_service", "sumatra_setup"):
            self.assertIn(f'"{module}"', self.text)

    def test_includes_windows_printing_support(self):
        self.assertIn("win32print", self.text)

    def test_spec_is_valid_python(self):
        # It is executed by PyInstaller, so a syntax error fails the release.
        ast.parse(self.text)


if __name__ == "__main__":
    unittest.main()
