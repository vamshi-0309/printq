"""
The agent must print to the printer PrintQ selected, and to nothing else.

THE BUG
    send_to_printer() ended with:

        printer_name = settings.get("printerName") or win32print.GetDefaultPrinter()

    Nothing ever put "printerName" into settings, so every job went to the
    Windows default -- a setting owned by Windows and unrelated to the printer
    the shop owner chose in Dashboard -> Printers. A shop that selected
    "Export to WPS PDF" had its customers' documents sent to whatever Windows
    preferred, with no indication anywhere that the choice was ignored.

These tests pin the replacement: the printer comes from the claim response,
a missing one is an error rather than an excuse to guess, and the Windows
default is never consulted on the print path.
"""

from __future__ import annotations

import ast
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import printq_agent  # noqa: E402
from printq_agent import (  # noqa: E402
    PrintJob,
    PrinterUnavailable,
    SumatraNotFound,
    resolve_job_printer,
    send_to_printer,
)

# The printers actually installed on the machine this was developed against.
INSTALLED = [
    "OneNote (Desktop) - Protected",
    "OneNote (Desktop)",
    "Microsoft Print to PDF",
    "Export to WPS PDF",
]

WINDOWS_DEFAULT = "Microsoft Print to PDF"


def make_job(printer: dict | None) -> PrintJob:
    return PrintJob(
        jobId="job-1",
        orderId="order-1",
        downloadUrl="https://example.invalid/file.pdf",
        filename="doc.pdf",
        mimeType="application/pdf",
        printSettings={"copies": 1, "paperSize": "A4", "colorMode": "bw", "sides": "single"},
        printer=printer,
    )


SELECTED = {
    "id": "d831321e-0000-0000-0000-000000000000",
    "systemName": "Export to WPS PDF",
    "displayName": "Export to WPS PDF",
    "supportsColor": False,
    "supportsDuplex": False,
}


class ResolveSelectedPrinter(unittest.TestCase):
    def test_uses_the_printer_printq_selected(self):
        name, printer_id = resolve_job_printer(make_job(SELECTED), INSTALLED)
        self.assertEqual(name, "Export to WPS PDF")
        self.assertEqual(printer_id, SELECTED["id"])

    def test_does_not_use_the_windows_default(self):
        # The decisive assertion: the selected printer is NOT the machine's
        # default, so picking the default would be visible here.
        name, _ = resolve_job_printer(make_job(SELECTED), INSTALLED)
        self.assertNotEqual(name, WINDOWS_DEFAULT)

    def test_returns_the_persisted_printer_id_for_the_attempt(self):
        _, printer_id = resolve_job_printer(make_job(SELECTED), INSTALLED)
        self.assertEqual(printer_id, SELECTED["id"])

    def test_follows_a_different_selection(self):
        other = dict(SELECTED, systemName="OneNote (Desktop)", id="e418ba38")
        name, printer_id = resolve_job_printer(make_job(other), INSTALLED)
        self.assertEqual(name, "OneNote (Desktop)")
        self.assertEqual(printer_id, "e418ba38")

    def test_selecting_the_windows_default_still_works(self):
        # Choosing the same printer Windows prefers is legitimate; it must be
        # honoured because it was selected, not because Windows likes it.
        #
        # resolve_job_printer settles identity only. Whether that printer can
        # run unattended is a separate question, asked later in send_to_printer
        # and covered in test_interactive_printer.py -- which matters here
        # because on this machine "Microsoft Print to PDF" is on PORTPROMPT:
        # and would be refused by that other rule.
        same = dict(
            SELECTED, systemName=WINDOWS_DEFAULT, displayName=WINDOWS_DEFAULT, id="ab65ad2b"
        )
        name, _ = resolve_job_printer(make_job(same), INSTALLED)
        self.assertEqual(name, WINDOWS_DEFAULT)


class NoPrinterSupplied(unittest.TestCase):
    def test_missing_printer_object_is_an_error(self):
        with self.assertRaises(PrinterUnavailable) as ctx:
            resolve_job_printer(make_job(None), INSTALLED)
        self.assertIn("Dashboard", str(ctx.exception))

    def test_empty_printer_object_is_an_error(self):
        with self.assertRaises(PrinterUnavailable):
            resolve_job_printer(make_job({}), INSTALLED)

    def test_blank_system_name_is_an_error(self):
        with self.assertRaises(PrinterUnavailable):
            resolve_job_printer(make_job(dict(SELECTED, systemName="   ")), INSTALLED)

    def test_never_falls_back_to_the_windows_default(self):
        # The whole point: no printer supplied must NOT mean "use the default".
        for missing in (None, {}, dict(SELECTED, systemName="")):
            with self.subTest(missing=missing):
                with self.assertRaises(PrinterUnavailable):
                    resolve_job_printer(make_job(missing), INSTALLED)


class UnavailableSelectedPrinter(unittest.TestCase):
    def test_printer_not_installed_is_reported_not_substituted(self):
        gone = dict(SELECTED, systemName="Reception Laser", displayName="Reception Laser")
        with self.assertRaises(PrinterUnavailable) as ctx:
            resolve_job_printer(make_job(gone), INSTALLED)
        message = str(ctx.exception)
        self.assertIn("Reception Laser", message)
        # The message lists what IS available so the owner can fix the choice.
        self.assertIn("Export to WPS PDF", message)

    def test_does_not_silently_switch_to_another_printer(self):
        gone = dict(SELECTED, systemName="Reception Laser")
        with self.assertRaises(PrinterUnavailable):
            resolve_job_printer(make_job(gone), INSTALLED)

    def test_trusts_the_name_when_enumeration_is_unavailable(self):
        # No pywin32 (or no printers enumerable): refusing every job would be
        # worse than trusting a name the server vouched for.
        name, _ = resolve_job_printer(make_job(SELECTED), [])
        self.assertEqual(name, "Export to WPS PDF")


class SendToPrinterBase(unittest.TestCase):
    """
    Supplies a SumatraPDF that actually exists.

    These tests previously passed `cfg = mock.Mock(sumatra_path=
    r"C:\\SumatraPDF.exe")`, a path that is not there on any machine. That
    looked like it supplied an executable but did not: resolve_sumatra_path
    correctly refuses a configured path that does not exist and falls through
    to the other candidate locations. On a developer desktop it then found the
    real per-user install and the tests passed; on a build runner with no
    SumatraPDF anywhere it raised SumatraNotFound before a single assertion
    ran, which is exactly the errors=2 that failed the release.

    A real file in a temporary directory makes the resolver succeed for the
    stated reason, so what these tests assert -- the command handed to
    SumatraPDF -- is what they actually exercise, on any machine.
    """

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.sumatra = Path(self._tmp.name) / "SumatraPDF.exe"
        self.sumatra.write_bytes(b"MZ")  # enough to be a file
        self.cfg = mock.Mock(sumatra_path=str(self.sumatra))


class SendToPrinterTargetsTheSelection(SendToPrinterBase):
    def test_passes_the_selected_printer_to_sumatra(self):
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "Export to WPS PDF")

        cmd = run.call_args[0][0]
        self.assertIn("-print-to", cmd)
        self.assertEqual(cmd[cmd.index("-print-to") + 1], "Export to WPS PDF")

    def test_launches_the_resolved_executable(self):
        # The configured path is used because it exists, which is the whole
        # reason the assertions above are reached.
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "Export to WPS PDF")

        self.assertEqual(run.call_args[0][0][0], str(self.sumatra))

    def test_the_selected_printer_is_never_substituted(self):
        # Whatever else is installed, the name that goes to -print-to is the
        # one that came in.
        for chosen in ("Export to WPS PDF", "HP LaserJet Pro M404", "Canon LBP2900"):
            with self.subTest(printer=chosen):
                with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
                    "printq_agent.subprocess.run"
                ) as run:
                    run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
                    send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, chosen)
                cmd = run.call_args[0][0]
                self.assertEqual(cmd[cmd.index("-print-to") + 1], chosen)

    def test_the_command_is_a_list_never_a_shell_string(self):
        # A printer name containing quotes or an ampersand must not be able to
        # become part of a command line.
        hostile = 'HP & "Laser" | Pro'
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, hostile)

        args, kwargs = run.call_args
        self.assertIsInstance(args[0], list)
        self.assertEqual(args[0][args[0].index("-print-to") + 1], hostile)
        self.assertNotIn("shell", kwargs)

    def test_refuses_an_empty_printer_name(self):
        with mock.patch("printq_agent.DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable):
                send_to_printer(Path("doc.pdf"), {}, self.cfg, "")

    def test_refuses_a_whitespace_only_printer_name(self):
        # "   " is truthy, so it used to reach SumatraPDF as a printer name.
        for blank in ("   ", "\t", "\n "):
            with self.subTest(name=repr(blank)):
                with mock.patch("printq_agent.DEV_MODE", False):
                    with self.assertRaises(PrinterUnavailable):
                        send_to_printer(Path("doc.pdf"), {}, self.cfg, blank)

    def test_a_padded_printer_name_is_trimmed_not_rejected(self):
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "  Export to WPS PDF  ")

        cmd = run.call_args[0][0]
        self.assertEqual(cmd[cmd.index("-print-to") + 1], "Export to WPS PDF")

    def test_a_non_zero_exit_is_a_clear_failure(self):
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            run.return_value = mock.Mock(returncode=1, stderr=b"", stdout=b"out of paper")
            with self.assertRaises(RuntimeError) as ctx:
                send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "Export to WPS PDF")

        message = str(ctx.exception)
        self.assertIn("Export to WPS PDF", message)
        self.assertIn("1", message)
        self.assertIn("out of paper", message)

    def test_a_missing_sumatra_is_reported_clearly(self):
        # The condition the CI runner was actually in.
        cfg = mock.Mock(sumatra_path=str(Path(self._tmp.name) / "gone.exe"))
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch.object(
            printq_agent, "sumatra_candidates",
            return_value=[("agent.json sumatra_path", cfg.sumatra_path)],
        ), mock.patch.object(printq_agent.shutil, "which", return_value=None):
            with self.assertRaises(SumatraNotFound):
                send_to_printer(Path("doc.pdf"), {"copies": 1}, cfg, "Export to WPS PDF")

    def test_dev_mode_still_names_the_printer(self):
        with mock.patch("printq_agent.DEV_MODE", True), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "Export to WPS PDF")
        run.assert_not_called()

    def test_dev_mode_needs_no_sumatra_at_all(self):
        # Development must stay possible on a machine without SumatraPDF.
        cfg = mock.Mock(sumatra_path=str(Path(self._tmp.name) / "gone.exe"))
        with mock.patch("printq_agent.DEV_MODE", True), mock.patch(
            "printq_agent.subprocess.run"
        ) as run:
            send_to_printer(Path("doc.pdf"), {"copies": 1}, cfg, "Export to WPS PDF")
        run.assert_not_called()


class PrintPathNeverConsultsWindowsDefault(SendToPrinterBase):
    def test_send_to_printer_does_not_call_get_default_printer(self):
        with mock.patch("printq_agent.DEV_MODE", False), mock.patch(
            "printq_agent.subprocess.run"
        ) as run, mock.patch("printq_agent.win32print") as win32print:
            run.return_value = mock.Mock(returncode=0, stderr=b"", stdout=b"")
            send_to_printer(Path("doc.pdf"), {"copies": 1}, self.cfg, "Export to WPS PDF")
        win32print.GetDefaultPrinter.assert_not_called()

    def test_resolve_does_not_call_get_default_printer(self):
        with mock.patch("printq_agent.win32print") as win32print:
            resolve_job_printer(make_job(SELECTED), INSTALLED)
        win32print.GetDefaultPrinter.assert_not_called()

    def test_print_path_source_contains_no_default_printer_fallback(self):
        """
        The two functions that decide where a job prints must not mention the
        Windows default at all. Checked on the parsed syntax tree rather than
        the raw text, so the explanatory docstring -- which does name it --
        cannot make the assertion pass or fail by accident.
        """
        source = (
            Path(__file__).resolve().parent.joinpath("printq_agent.py").read_text(encoding="utf-8")
        )
        tree = ast.parse(source)

        print_path = [
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name in {"resolve_job_printer", "send_to_printer"}
        ]
        self.assertEqual(len(print_path), 2, "print path functions not found")

        for func in print_path:
            called = {
                ast.unparse(node.func)
                for node in ast.walk(func)
                if isinstance(node, ast.Call)
            }
            self.assertNotIn(
                "win32print.GetDefaultPrinter",
                called,
                f"{func.name} still consults the Windows default printer",
            )

    def test_detection_still_reports_the_windows_default(self):
        """
        list_installed_printers legitimately reports which printer Windows
        considers default -- the heartbeat uses it to seed a shop's first
        selection. Removing that would break printer detection, so it stays.
        """
        source = (
            Path(__file__).resolve().parent.joinpath("printq_agent.py").read_text(encoding="utf-8")
        )
        tree = ast.parse(source)
        detection = next(
            node
            for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "list_installed_printers"
        )
        called = {
            ast.unparse(node.func) for node in ast.walk(detection) if isinstance(node, ast.Call)
        }
        self.assertIn("win32print.GetDefaultPrinter", called)


if __name__ == "__main__":
    unittest.main()
