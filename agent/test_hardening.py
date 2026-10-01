"""
Launch hardening on the agent side.

  - The server's "attempted" gate is what stops a job printing twice: if it
    refuses, the agent must not print. Tested here against process_job.
  - Orientation and fit/actual size reach SumatraPDF; jobs from an older
    server, which sends neither, produce exactly the old settings string.
  - A mixed-colour order prints as one run per colour segment, collated.
  - Print failures carry a code the dashboard can explain.
  - The printer's own condition is read from the spooler for the heartbeat.
"""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))

import printq_agent  # noqa: E402
from printq_agent import (  # noqa: E402
    InteractivePrinterPort,
    PrinterProblem,
    PrinterUnavailable,
    PrintJob,
    SumatraNotFound,
    build_sumatra_settings,
    classify_print_error,
    print_passes,
    process_job,
    status_from_flags,
)

LEGACY = {"copies": 2, "paperSize": "A4", "colorMode": "bw", "sides": "single", "pageRange": "1-3"}


class SumatraSettings(unittest.TestCase):
    def test_an_older_server_gets_exactly_the_old_string(self):
        self.assertEqual(build_sumatra_settings(LEGACY), "1-3,2x,simplex,monochrome,paper=A4")

    def test_orientation_is_passed_when_chosen(self):
        self.assertIn("landscape", build_sumatra_settings({**LEGACY, "orientation": "landscape"}))
        self.assertIn("portrait", build_sumatra_settings({**LEGACY, "orientation": "portrait"}))

    def test_auto_orientation_leaves_it_to_sumatra(self):
        out = build_sumatra_settings({**LEGACY, "orientation": "auto"})
        self.assertNotIn("portrait", out)
        self.assertNotIn("landscape", out)

    def test_fit_and_actual_size(self):
        self.assertTrue(build_sumatra_settings({**LEGACY, "fitMode": "fit"}).endswith(",fit"))
        self.assertTrue(build_sumatra_settings({**LEGACY, "fitMode": "actual"}).endswith(",noscale"))


class PrintPasses(unittest.TestCase):
    def test_a_single_mode_job_is_one_untouched_run(self):
        settings = {**LEGACY, "colorSegments": None}
        self.assertEqual(print_passes(settings), [settings])

    def test_mixed_colour_is_one_run_per_segment_in_page_order(self):
        settings = {
            **LEGACY,
            "copies": 1,
            "colorSegments": [
                {"pageRange": "1-2", "colorMode": "bw"},
                {"pageRange": "3", "colorMode": "color"},
                {"pageRange": "4-6", "colorMode": "bw"},
            ],
        }
        runs = print_passes(settings)
        self.assertEqual([(r["pageRange"], r["colorMode"]) for r in runs], [("1-2", "bw"), ("3", "color"), ("4-6", "bw")])
        self.assertTrue(all("colorSegments" not in r for r in runs))
        self.assertEqual(build_sumatra_settings(runs[1]), "3,simplex,paper=A4")
        self.assertIn("monochrome", build_sumatra_settings(runs[0]))

    def test_copies_repeat_the_whole_sequence_so_output_is_collated(self):
        settings = {
            **LEGACY,
            "copies": 2,
            "colorSegments": [{"pageRange": "1", "colorMode": "color"}, {"pageRange": "2", "colorMode": "bw"}],
        }
        runs = print_passes(settings)
        self.assertEqual([r["pageRange"] for r in runs], ["1", "2", "1", "2"])
        self.assertTrue(all(r["copies"] == 1 for r in runs))

    def test_a_malformed_segment_is_refused(self):
        for bad in ({"pageRange": "1;del x", "colorMode": "bw"}, {"pageRange": "1", "colorMode": "sepia"}):
            with self.assertRaises(ValueError):
                print_passes({**LEGACY, "colorSegments": [bad, {"pageRange": "2", "colorMode": "bw"}]})


class PrinterCondition(unittest.TestCase):
    def test_flags_map_to_dashboard_codes(self):
        self.assertEqual(status_from_flags(0), "ready")
        self.assertEqual(status_from_flags(0x10), "out_of_paper")
        self.assertEqual(status_from_flags(0x8 | 0x2), "paper_jam")  # the jam, not "error"
        self.assertEqual(status_from_flags(0x400000), "cover_open")
        self.assertEqual(status_from_flags(0x80), "offline")
        self.assertEqual(status_from_flags(0, attributes=0x400), "offline")  # "Use Printer Offline"
        self.assertEqual(status_from_flags(0x2), "error")

    def test_an_unreadable_printer_is_not_reported_as_broken(self):
        fake = mock.Mock()
        fake.OpenPrinter.side_effect = OSError("access denied")
        with mock.patch.object(printq_agent, "win32print", fake):
            self.assertEqual(printq_agent.printer_status("Any"), "ready")


class ErrorCodes(unittest.TestCase):
    def test_codes(self):
        self.assertEqual(classify_print_error(SumatraNotFound("x")), "sumatra_missing")
        self.assertEqual(classify_print_error(InteractivePrinterPort("x")), "interactive_port")
        self.assertEqual(classify_print_error(PrinterUnavailable("x")), "printer_unavailable")
        self.assertEqual(classify_print_error(subprocess.TimeoutExpired("s", 180)), "timeout")
        with mock.patch.object(printq_agent, "printer_status", return_value="ready"):
            self.assertEqual(classify_print_error(RuntimeError("exit 1"), "HP"), "printer_rejected")

    def test_a_refused_print_is_explained_by_the_printer_when_it_can(self):
        with mock.patch.object(printq_agent, "printer_status", return_value="out_of_paper"):
            self.assertEqual(classify_print_error(RuntimeError("exit 1"), "HP"), "out_of_paper")

    def test_interactive_port_is_still_a_printer_unavailable(self):
        # Existing handling of PrinterUnavailable must keep catching it.
        self.assertTrue(issubclass(InteractivePrinterPort, PrinterUnavailable))


def make_job(settings: dict | None = None) -> PrintJob:
    return PrintJob(
        jobId="job-1",
        orderId="order-1",
        downloadUrl="https://example.invalid/file.pdf",
        filename="doc.pdf",
        mimeType="application/pdf",
        printSettings=settings or dict(LEGACY),
        printer={"id": "p1", "systemName": "HP", "displayName": "HP"},
    )


class ProcessJobGate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.cfg = mock.Mock(work_dir=self.tmp.name)
        self.client = mock.Mock()
        self.client.download_file.side_effect = lambda url, dest: Path(dest).write_bytes(b"%PDF-1.4")
        patches = [
            mock.patch.object(printq_agent, "resolve_job_printer", return_value=("HP", "p1")),
            mock.patch.object(printq_agent, "send_to_printer"),
        ]
        self.resolve, self.send = [p.start() for p in patches]
        for p in patches:
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)

    def test_a_refused_attempt_report_means_nothing_is_printed(self):
        refused = requests.HTTPError("409 Client Error: Conflict")
        self.client.report_print_attempted.side_effect = refused
        with self.assertRaises(requests.HTTPError):
            process_job(self.client, make_job(), self.cfg)
        self.send.assert_not_called()
        self.client.report_result.assert_not_called()

    def test_prints_only_after_the_attempt_is_accepted(self):
        order = []
        self.client.report_print_attempted.side_effect = lambda *a, **k: order.append("attempted")
        self.send.side_effect = lambda *a, **k: order.append("print")
        process_job(self.client, make_job(), self.cfg)
        self.assertEqual(order, ["attempted", "print"])
        self.client.report_result.assert_called_once_with("job-1", "confirmed")

    def test_a_mixed_colour_job_runs_each_pass(self):
        settings = {
            **LEGACY,
            "copies": 1,
            "colorSegments": [{"pageRange": "1", "colorMode": "bw"}, {"pageRange": "2", "colorMode": "color"}],
        }
        process_job(self.client, make_job(settings), self.cfg)
        modes = [call.args[1]["colorMode"] for call in self.send.call_args_list]
        self.assertEqual(modes, ["bw", "color"])
        self.client.report_print_attempted.assert_called_once()

    def test_a_failure_part_way_says_how_far_it_got_and_why(self):
        settings = {
            **LEGACY,
            "copies": 1,
            "colorSegments": [{"pageRange": "1", "colorMode": "bw"}, {"pageRange": "2", "colorMode": "color"}],
        }
        self.send.side_effect = [None, PrinterUnavailable("gone")]
        process_job(self.client, make_job(settings), self.cfg)
        args, kwargs = self.client.report_result.call_args
        self.assertEqual(args[1], "error")
        self.assertIn("Stopped after 1 of 2", args[2])
        self.assertEqual(kwargs["error_code"], "printer_unavailable")


class ClaimDistinguishesPrinterProblems(unittest.TestCase):
    def _client(self, status: int, body: dict):
        cfg = mock.Mock(api_base_url="https://x", shop_id="s", agent_id="a", agent_secret="k")
        client = printq_agent.PrintQClient(cfg)
        resp = mock.Mock(status_code=status, content=b"{}")
        resp.json.return_value = body
        client.session = mock.Mock()
        client.session.post.return_value = resp
        return client

    def test_a_printer_problem_is_its_own_error(self):
        client = self._client(409, {"code": "printer_problem", "error": "HP: Out of paper."})
        with self.assertRaises(PrinterProblem) as ctx:
            client.claim_next_job()
        self.assertIn("Out of paper", str(ctx.exception))

    def test_no_printer_is_still_reported_as_before(self):
        client = self._client(409, {"code": "no_printer_configured", "error": "Pick one"})
        with self.assertRaises(printq_agent.NoPrinterConfigured) as ctx:
            client.claim_next_job()
        self.assertNotIsInstance(ctx.exception, PrinterProblem)


if __name__ == "__main__":
    unittest.main()
