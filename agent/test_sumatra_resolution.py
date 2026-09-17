"""
Finding SumatraPDF on a real Windows machine.

THE BUG
    agent.json carries a hardcoded default of
    C:\\Program Files\\SumatraPDF\\SumatraPDF.exe and the agent launched that
    path directly. SumatraPDF installs per-user by default, to
    %LOCALAPPDATA%\\SumatraPDF\\SumatraPDF.exe, and puts nothing on PATH -- so
    on a machine with a perfectly good install every print died with

        [WinError 2] The system cannot find the file specified

    an error that names no file and suggests no fix.

These tests use real files in temporary directories rather than mocking
os.path.isfile, so they exercise the same filesystem checks the agent makes.
"""

from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import AgentConfig  # noqa: E402
from printq_agent import (  # noqa: E402
    SUMATRA_EXE,
    PrinterUnavailable,
    SumatraNotFound,
    resolve_sumatra_path,
    send_to_printer,
    sumatra_candidates,
)

SELECTED_PRINTER = "Export to WPS PDF"


def make_exe(root: Path, *parts: str) -> str:
    """Create a stand-in SumatraPDF.exe and return its path."""
    target = root.joinpath(*parts, SUMATRA_EXE)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"MZ")  # enough to be a file
    return str(target)


class ResolutionBase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)

        # An empty directory stands in for PATH so a real install on the
        # developer's machine cannot satisfy a test by accident.
        self.empty_path = self.root / "empty-path"
        self.empty_path.mkdir()

        self.env = {
            "PATH": str(self.empty_path),
            "PATHEXT": ".COM;.EXE;.BAT",
        }


class ExplicitOverride(ResolutionBase):
    def test_sumatrapdf_path_env_var_is_used(self):
        exe = make_exe(self.root, "custom")
        self.env["SUMATRAPDF_PATH"] = exe
        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), exe)

    def test_env_var_wins_over_every_discovered_location(self):
        override = make_exe(self.root, "custom")
        local = self.root / "local"
        make_exe(local, "SumatraPDF")
        self.env["SUMATRAPDF_PATH"] = override
        self.env["LOCALAPPDATA"] = str(local)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), override)

    def test_quoted_env_var_is_accepted(self):
        # A path pasted from a shell or shortcut often arrives wrapped.
        exe = make_exe(self.root, "custom")
        self.env["SUMATRAPDF_PATH"] = f'"{exe}"'
        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), exe)

    def test_env_var_pointing_nowhere_falls_through(self):
        # A stale override must not block a working install.
        local = self.root / "local"
        real = make_exe(local, "SumatraPDF")
        self.env["SUMATRAPDF_PATH"] = str(self.root / "gone" / SUMATRA_EXE)
        self.env["LOCALAPPDATA"] = str(local)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), real)


class PerUserInstall(ResolutionBase):
    def test_localappdata_install_is_found(self):
        local = self.root / "local"
        exe = make_exe(local, "SumatraPDF")
        self.env["LOCALAPPDATA"] = str(local)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), exe)

    def test_stale_agent_json_default_does_not_shadow_it(self):
        """The exact failure: a configured path that does not exist."""
        local = self.root / "local"
        exe = make_exe(local, "SumatraPDF")
        self.env["LOCALAPPDATA"] = str(local)

        cfg = AgentConfig(sumatra_path=r"C:\Program Files\SumatraPDF\SumatraPDF.exe")
        self.assertFalse(os.path.isfile(cfg.sumatra_path), "precondition: default must not exist")
        self.assertEqual(resolve_sumatra_path(cfg, self.env), exe)

    def test_a_real_configured_path_is_preferred(self):
        # An operator who set a path deliberately gets it.
        configured = make_exe(self.root, "chosen")
        local = self.root / "local"
        make_exe(local, "SumatraPDF")
        self.env["LOCALAPPDATA"] = str(local)

        cfg = AgentConfig(sumatra_path=configured)
        self.assertEqual(resolve_sumatra_path(cfg, self.env), configured)


class MachineWideInstall(ResolutionBase):
    def test_program_files_install_is_found(self):
        pf = self.root / "ProgramFiles"
        exe = make_exe(pf, "SumatraPDF")
        self.env["ProgramFiles"] = str(pf)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), exe)

    def test_program_files_x86_install_is_found(self):
        pf86 = self.root / "ProgramFilesx86"
        exe = make_exe(pf86, "SumatraPDF")
        self.env["ProgramFiles(x86)"] = str(pf86)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), exe)

    def test_per_user_install_is_preferred_over_program_files(self):
        local = self.root / "local"
        per_user = make_exe(local, "SumatraPDF")
        pf = self.root / "ProgramFiles"
        make_exe(pf, "SumatraPDF")
        self.env["LOCALAPPDATA"] = str(local)
        self.env["ProgramFiles"] = str(pf)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), per_user)

    def test_duplicate_program_file_variables_are_not_checked_twice(self):
        pf = self.root / "ProgramFiles"
        self.env["ProgramFiles"] = str(pf)
        self.env["ProgramW6432"] = str(pf)

        paths = [p for _, p in sumatra_candidates(AgentConfig(sumatra_path=""), self.env)]
        self.assertEqual(len(paths), len(set(paths)))


class PathFallback(ResolutionBase):
    def test_found_on_path_when_nowhere_else(self):
        on_path = self.root / "onpath"
        exe = make_exe(on_path)
        self.env["PATH"] = str(on_path)

        resolved = resolve_sumatra_path(AgentConfig(), self.env)
        self.assertEqual(os.path.normcase(resolved), os.path.normcase(exe))

    def test_path_is_a_last_resort(self):
        # A known install location beats whatever PATH happens to expose.
        local = self.root / "local"
        per_user = make_exe(local, "SumatraPDF")
        on_path = self.root / "onpath"
        make_exe(on_path)
        self.env["LOCALAPPDATA"] = str(local)
        self.env["PATH"] = str(on_path)

        self.assertEqual(resolve_sumatra_path(AgentConfig(), self.env), per_user)


class MissingExecutable(ResolutionBase):
    def test_raises_when_not_installed_anywhere(self):
        with self.assertRaises(SumatraNotFound):
            resolve_sumatra_path(AgentConfig(), self.env)

    def test_error_lists_every_location_checked(self):
        local = self.root / "local"
        pf = self.root / "ProgramFiles"
        self.env["LOCALAPPDATA"] = str(local)
        self.env["ProgramFiles"] = str(pf)

        with self.assertRaises(SumatraNotFound) as ctx:
            resolve_sumatra_path(AgentConfig(), self.env)

        message = str(ctx.exception)
        self.assertIn(str(local / "SumatraPDF" / SUMATRA_EXE), message)
        self.assertIn(str(pf / "SumatraPDF" / SUMATRA_EXE), message)
        self.assertIn("on PATH", message)

    def test_error_says_what_to_do_about_it(self):
        with self.assertRaises(SumatraNotFound) as ctx:
            resolve_sumatra_path(AgentConfig(), self.env)

        message = str(ctx.exception)
        self.assertIn("not found", message.lower())
        self.assertIn("SUMATRAPDF_PATH", message)
        self.assertIn("sumatrapdfreader.org", message)


class SendToPrinterUsesResolvedPath(ResolutionBase):
    def _run_send(self, extra_env: dict) -> list[str]:
        env = {**self.env, **extra_env}
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch.dict(
            os.environ, env, clear=True
        ), mock.patch("printq_agent.subprocess.run") as run:
            run.return_value = mock.Mock(returncode=0, stderr=b"")
            send_to_printer(
                Path("doc.pdf"),
                {"copies": 1, "paperSize": "A4", "colorMode": "bw", "sides": "single"},
                AgentConfig(),
                SELECTED_PRINTER,
            )
        return run.call_args[0][0]

    def test_launches_the_absolute_resolved_path(self):
        local = self.root / "local"
        exe = make_exe(local, "SumatraPDF")
        cmd = self._run_send({"LOCALAPPDATA": str(local)})

        self.assertEqual(cmd[0], exe)
        self.assertTrue(os.path.isabs(cmd[0]))

    def test_selected_printer_is_still_passed(self):
        local = self.root / "local"
        make_exe(local, "SumatraPDF")
        cmd = self._run_send({"LOCALAPPDATA": str(local)})

        self.assertIn("-print-to", cmd)
        self.assertEqual(cmd[cmd.index("-print-to") + 1], SELECTED_PRINTER)

    def test_windows_default_printer_is_still_never_used(self):
        local = self.root / "local"
        make_exe(local, "SumatraPDF")
        with mock.patch("printq_agent.win32print") as win32print:
            cmd = self._run_send({"LOCALAPPDATA": str(local)})
        win32print.GetDefaultPrinter.assert_not_called()
        self.assertEqual(cmd[cmd.index("-print-to") + 1], SELECTED_PRINTER)

    def test_silent_flag_and_settings_survive(self):
        local = self.root / "local"
        make_exe(local, "SumatraPDF")
        cmd = self._run_send({"LOCALAPPDATA": str(local)})

        self.assertIn("-silent", cmd)
        self.assertIn("-print-settings", cmd)
        self.assertIn("simplex", cmd[cmd.index("-print-settings") + 1])

    def test_missing_executable_surfaces_as_sumatra_not_found(self):
        # process_job turns this into a FAILED job carrying the message, so the
        # shop owner sees "install SumatraPDF" instead of WinError 2.
        with self.assertRaises(SumatraNotFound):
            self._run_send({})

    def test_an_empty_printer_name_is_still_refused_before_resolving(self):
        with mock.patch("printq_agent.DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable):
                send_to_printer(Path("doc.pdf"), {}, AgentConfig(), "")


class DevModeUnchanged(ResolutionBase):
    def test_dev_mode_does_not_require_sumatra(self):
        # No executable anywhere, and DEV_MODE must still succeed exactly as
        # before -- it is what lets the pipeline be exercised without a printer.
        with mock.patch("printq_agent.DEV_MODE", True), mock.patch.dict(
            os.environ, self.env, clear=True
        ), mock.patch("printq_agent.subprocess.run") as run:
            send_to_printer(Path("doc.pdf"), {"copies": 1}, AgentConfig(), SELECTED_PRINTER)
        run.assert_not_called()

    def test_dev_mode_still_refuses_an_empty_printer(self):
        with mock.patch("printq_agent.DEV_MODE", True):
            with self.assertRaises(PrinterUnavailable):
                send_to_printer(Path("doc.pdf"), {}, AgentConfig(), "")


class RealMachine(unittest.TestCase):
    """
    Against this machine's actual environment -- asserting an invariant that
    holds anywhere, not a fact about one machine.

    This previously required SumatraPDF to be installed at a specific
    per-user path and skipped otherwise, so it was green on a developer
    desktop and skipped on a build runner. Neither outcome told anyone whether
    resolution works.

    What is asserted now is true on every machine: resolution either returns a
    path that really exists, or it raises SumatraNotFound naming where it
    looked. There is no third outcome, and in particular it never returns a
    path that is not there -- which is the failure that produced the original
    "[WinError 2] The system cannot find the file specified".
    """

    def test_resolution_either_finds_a_real_file_or_says_where_it_looked(self):
        try:
            resolved = resolve_sumatra_path(AgentConfig())
        except SumatraNotFound as exc:
            message = str(exc)
            self.assertIn("SUMATRAPDF_PATH", message)
            self.assertIn("on PATH", message)
            return

        self.assertTrue(
            os.path.isfile(resolved),
            f"resolution returned {resolved!r}, which does not exist",
        )

    def test_candidates_on_this_machine_are_absolute_and_unique(self):
        # Every candidate must be something the caller could actually launch,
        # and the list must not check the same place twice.
        paths = [p for _, p in sumatra_candidates(AgentConfig())]
        self.assertTrue(paths, "no candidate locations at all")
        for path in paths:
            with self.subTest(path=path):
                self.assertTrue(os.path.isabs(path), path)
        normalised = [os.path.normcase(os.path.normpath(p)) for p in paths]
        self.assertEqual(len(normalised), len(set(normalised)))


if __name__ == "__main__":
    unittest.main()
