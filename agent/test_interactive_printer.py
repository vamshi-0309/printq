"""
A printer that asks a person where to save the output cannot be used
unattended, and must be reported as such.

WHAT ACTUALLY HAPPENED (order PQ105)
    The shop's selected printer was "Microsoft Print to PDF". The agent ran:

        SumatraPDF.exe -print-to "Microsoft Print to PDF"
                       -print-settings 1-1,3x,simplex,paper=A4
                       -silent "...\\clip last.jpeg"

    and the job failed with "SumatraPDF exited 1: " -- an empty explanation.

    Reproducing that command by hand showed it BLOCKS indefinitely, because
    Microsoft Print to PDF is attached to the Windows port PORTPROMPT:, which
    opens a "Save Print Output As" dialog and waits. Exit 1 is what comes back
    when that dialog is dismissed instead of answered.

    The same file, with the same settings, printed to "Export to WPS PDF"
    (port "Kingsoft Virtual Printer Port") with exit code 0 -- so neither the
    JPEG, the settings string, the space in the filename, nor the arguments
    were at fault. The printer was.

The detection keys on the PORT, not on a hardcoded product name: PORTPROMPT:
means "ask the user for a file" whatever the printer is called.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import printq_agent  # noqa: E402
from printq_agent import (  # noqa: E402
    INTERACTIVE_PRINTER_PORTS,
    PrintJob,
    PrinterUnavailable,
    check_printer_can_print_unattended,
    printer_port,
    resolve_job_printer,
)

CFG = None  # set per-test where a config is needed


def refuse(system_name: str, label: str | None = None, port_lookup=None):
    """Run the check the way send_to_printer does."""
    return check_printer_can_print_unattended(
        system_name, label or system_name, port_lookup or ports
    )

# The real printers on the machine this was diagnosed on, with the ports
# Windows actually reports for them.
REAL_PORTS = {
    "Microsoft Print to PDF": "PORTPROMPT:",
    "Export to WPS PDF": "Kingsoft Virtual Printer Port",
    "OneNote (Desktop)": "nul:",
    "OneNote (Desktop) - Protected": "Microsoft.Office.OneNoteVirtualPrinter_...",
}
INSTALLED = list(REAL_PORTS)


def make_job(system_name: str, printer_id: str = "printer-1") -> PrintJob:
    return PrintJob(
        jobId="8f1d9cd9",
        orderId="4b38871b",
        downloadUrl="https://example.invalid/clip%20last.jpeg",
        filename="clip last.jpeg",
        mimeType="image/jpeg",
        # PQ105's actual settings.
        printSettings={
            "copies": 3,
            "paperSize": "A4",
            "colorMode": "color",
            "sides": "single",
            "pageRange": "1-1",
        },
        printer={"id": printer_id, "systemName": system_name, "displayName": system_name},
    )


def ports(name: str) -> str:
    return REAL_PORTS.get(name, "")


class PromptingPrinterIsRefused(unittest.TestCase):
    """PQ105's exact printer."""

    def test_microsoft_print_to_pdf_is_refused(self):
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable) as ctx:
                refuse("Microsoft Print to PDF")

        message = str(ctx.exception)
        self.assertIn("Microsoft Print to PDF", message)
        self.assertIn("PORTPROMPT:", message)

    def test_the_reason_names_the_dialog_rather_than_an_exit_code(self):
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable) as ctx:
                refuse("Microsoft Print to PDF")

        message = str(ctx.exception).lower()
        self.assertIn("save-as", message)
        self.assertIn("unattended", message)
        # The old failure said only this, which explained nothing.
        self.assertNotIn("sumatrapdf exited 1", message)

    def test_the_reason_says_what_to_do(self):
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable) as ctx:
                refuse("Microsoft Print to PDF")
        self.assertIn("Dashboard", str(ctx.exception))

    def test_message_is_ascii_so_console_logging_cannot_crash(self):
        # The agent logs to a Windows console; a non-ASCII character here would
        # turn a clean failure into a UnicodeEncodeError.
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable) as ctx:
                refuse("Microsoft Print to PDF")
        self.assertTrue(str(ctx.exception).isascii())

    def test_detection_is_by_port_not_by_name(self):
        # A differently-named printer on the same port is refused too.
        odd = {"Shop Laser": "PORTPROMPT:"}
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            with self.assertRaises(PrinterUnavailable):
                refuse("Shop Laser", port_lookup=lambda n: odd.get(n, ""))

    def test_port_match_ignores_case_and_padding(self):
        for value in ("portprompt:", " PORTPROMPT: ", "PortPrompt:"):
            with self.subTest(port=value):
                with mock.patch.object(printq_agent, "DEV_MODE", False):
                    with self.assertRaises(PrinterUnavailable):
                        refuse("Weird", port_lookup=lambda n: value)


class UsablePrintersStillWork(unittest.TestCase):
    def test_wps_printer_is_accepted(self):
        # Proven by reproduction: this one printed the same JPEG with exit 0.
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            refuse("Export to WPS PDF")  # must not raise
            name, printer_id = resolve_job_printer(
                make_job("Export to WPS PDF", "d831321e"), INSTALLED
            )
        self.assertEqual(name, "Export to WPS PDF")
        self.assertEqual(printer_id, "d831321e")

    def test_a_printer_on_an_ordinary_port_is_accepted(self):
        usb = {"HP LaserJet": "USB001"}
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            refuse("HP LaserJet", port_lookup=lambda n: usb.get(n, ""))  # must not raise
            name, _ = resolve_job_printer(make_job("HP LaserJet"), ["HP LaserJet"])
        self.assertEqual(name, "HP LaserJet")

    def test_unreadable_port_does_not_block_the_job(self):
        # printer_port returns "" when the port cannot be read. Refusing every
        # job on that basis would be worse than attempting the print.
        with mock.patch.object(printq_agent, "DEV_MODE", False):
            refuse("Mystery", port_lookup=lambda n: "")  # must not raise
            name, _ = resolve_job_printer(make_job("Mystery"), ["Mystery"])
        self.assertEqual(name, "Mystery")

    def test_windows_default_is_still_never_substituted(self):
        # The refusal must not become a reason to pick another printer.
        with mock.patch.object(printq_agent, "DEV_MODE", False), mock.patch.object(
            printq_agent, "win32print"
        ) as win32print:
            with self.assertRaises(PrinterUnavailable):
                refuse("Microsoft Print to PDF")
        win32print.GetDefaultPrinter.assert_not_called()


class DevModeSkipsTheCheck(unittest.TestCase):
    def test_dev_mode_allows_a_prompting_printer(self):
        # DEV_MODE never launches SumatraPDF, so no dialog can appear and the
        # pipeline stays exercisable without a real printer.
        with mock.patch.object(printq_agent, "DEV_MODE", True):
            refuse("Microsoft Print to PDF")  # must not raise
            name, _ = resolve_job_printer(make_job("Microsoft Print to PDF"), INSTALLED)
        self.assertEqual(name, "Microsoft Print to PDF")

    def test_dev_mode_does_not_query_the_port_at_all(self):
        called = []

        def spy(name):
            called.append(name)
            return "PORTPROMPT:"

        with mock.patch.object(printq_agent, "DEV_MODE", True):
            check_printer_can_print_unattended("Microsoft Print to PDF", port_lookup=spy)
        self.assertEqual(called, [])


class FailureIsReportedNotSwallowed(unittest.TestCase):
    def test_process_job_reports_the_reason_and_does_not_complete(self):
        """Requirement: report cleanly rather than marking the job completed."""
        client = mock.Mock()
        job = make_job("Microsoft Print to PDF")

        with tempfile.TemporaryDirectory() as work_dir:
            cfg = mock.Mock(work_dir=work_dir)
            with mock.patch.object(printq_agent, "DEV_MODE", False), mock.patch.object(
                printq_agent, "printer_port", ports
            ), mock.patch.object(printq_agent, "list_installed_printers",
                                 lambda: [{"system_name": n} for n in INSTALLED]):
                printq_agent.process_job(client, job, cfg)

        client.report_result.assert_called_once()
        args = client.report_result.call_args[0]
        self.assertEqual(args[0], job.jobId)
        self.assertEqual(args[1], "error")
        self.assertIn("PORTPROMPT:", args[2])
        self.assertNotIn("exited 1", args[2])

        # The attempt IS filed first, and that is deliberate. The result
        # endpoint only accepts PRINT_ATTEMPTED or PRINTING, and jobState.ts
        # has no CLAIMED -> FAILED edge, so refusing before the attempt leaves
        # the job stranded in CLAIMED with a 409 and no way to explain itself.
        # Downloading the file is the small cost of being able to report.
        client.report_print_attempted.assert_called_once()
        self.assertEqual(
            client.report_print_attempted.call_args.kwargs.get("printer_id"), "printer-1"
        )
        client.download_file.assert_called_once()

        # Whatever else happened, the job was never reported as printed.
        self.assertNotIn(
            "confirmed", [c[0][1] for c in client.report_result.call_args_list]
        )


class ExitCodeMessageIsUseful(unittest.TestCase):
    def _fail_with(self, stdout: bytes, stderr: bytes, code: int = 1) -> str:
        cfg = mock.Mock(sumatra_path=r"C:\SumatraPDF.exe")
        with mock.patch.object(printq_agent, "DEV_MODE", False), mock.patch.object(
            printq_agent, "resolve_sumatra_path", lambda c: r"C:\SumatraPDF.exe"
        ), mock.patch.object(printq_agent, "subprocess") as sp:
            sp.run.return_value = mock.Mock(returncode=code, stdout=stdout, stderr=stderr)
            with self.assertRaises(RuntimeError) as ctx:
                printq_agent.send_to_printer(
                    Path("doc.pdf"), {"copies": 1}, cfg, "Export to WPS PDF"
                )
        return str(ctx.exception)

    def test_stdout_is_included_when_stderr_is_empty(self):
        # SumatraPDF writes its diagnostics to stdout and leaves stderr empty,
        # which is why PQ105's error was the bare "SumatraPDF exited 1: ".
        message = self._fail_with(b"ParseFlags: argName: '-print-to'", b"")
        self.assertIn("ParseFlags", message)
        self.assertIn("Export to WPS PDF", message)

    def test_says_so_when_there_was_no_output_at_all(self):
        message = self._fail_with(b"", b"")
        self.assertIn("no output", message)
        self.assertNotIn(": \n", message)

    def test_stderr_is_preferred_when_present(self):
        message = self._fail_with(b"noise", b"the real problem")
        self.assertIn("the real problem", message)

    def test_names_the_printer_that_refused(self):
        message = self._fail_with(b"", b"")
        self.assertIn("Export to WPS PDF", message)


class RealMachinePorts(unittest.TestCase):
    """Against this machine's actual printers."""

    def test_microsoft_print_to_pdf_really_is_on_portprompt(self):
        port = printer_port("Microsoft Print to PDF")
        if not port:
            self.skipTest("Microsoft Print to PDF is not installed here")
        self.assertIn(port.strip().upper(), INTERACTIVE_PRINTER_PORTS)

    def test_a_working_virtual_printer_is_not_flagged(self):
        port = printer_port("Export to WPS PDF")
        if not port:
            self.skipTest("Export to WPS PDF is not installed here")
        self.assertNotIn(port.strip().upper(), INTERACTIVE_PRINTER_PORTS)


if __name__ == "__main__":
    unittest.main()
