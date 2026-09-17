"""
A customer picks the filename. The agent writes it to disk.

THE HOLE
    process_job did `downloaded = job_dir / job.filename`, and job.filename is
    whatever the customer called their upload, carried through unchanged:

        customer's phone -> /api/upload -> order_files.original_filename
                         -> claim response -> this path join

    The upload route sanitises the name it builds a STORAGE path from, but
    deliberately keeps the original for display, so nothing between the phone
    and the disk removed "../". A file named "..\\..\\Startup\\x.pdf" would be
    written outside the job directory -- and the extension check passed,
    because Path(".. /../Startup/x.pdf").suffix is still ".pdf".

    The content is the customer's own document and the extension must be one
    PrintQ accepts, so this is not arbitrary code execution. Writing a file to
    a path of someone else's choosing on a shop's PC is still not something
    this program should do.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from printq_agent import safe_job_filename  # noqa: E402


class TraversalIsRemoved(unittest.TestCase):
    def test_windows_parent_traversal(self):
        self.assertEqual(safe_job_filename(r"..\..\Startup\evil.pdf"), "evil.pdf")

    def test_posix_parent_traversal(self):
        self.assertEqual(safe_job_filename("../../../etc/passwd.pdf"), "passwd.pdf")

    def test_absolute_windows_path(self):
        self.assertEqual(safe_job_filename(r"C:\Windows\System32\x.pdf"), "x.pdf")

    def test_absolute_posix_path(self):
        self.assertEqual(safe_job_filename("/etc/cron.d/x.pdf"), "x.pdf")

    def test_unc_path(self):
        self.assertEqual(safe_job_filename(r"\\server\share\x.pdf"), "x.pdf")

    def test_the_result_never_escapes_the_job_directory(self):
        # The property that actually matters, asserted by resolving the join.
        with tempfile.TemporaryDirectory() as tmp:
            job_dir = Path(tmp) / "job"
            job_dir.mkdir()
            hostile = [
                r"..\..\evil.pdf",
                "../../evil.pdf",
                r"C:\Windows\evil.pdf",
                "/etc/evil.pdf",
                r"..\..\..\..\..\..\Users\Public\evil.pdf",
                "....//....//evil.pdf",
            ]
            for raw in hostile:
                with self.subTest(raw=raw):
                    target = (job_dir / safe_job_filename(raw)).resolve()
                    self.assertEqual(
                        target.parent,
                        job_dir.resolve(),
                        f"{raw!r} escaped to {target}",
                    )


class WindowsSpecificHazards(unittest.TestCase):
    def test_alternate_data_stream_is_defused(self):
        # "x:stream" would write an NTFS alternate data stream.
        self.assertNotIn(":", safe_job_filename("x:stream.pdf"))

    def test_reserved_device_names_are_prefixed(self):
        for name in ("CON.pdf", "PRN.pdf", "NUL.pdf", "COM1.pdf", "LPT9.pdf", "aux.pdf"):
            with self.subTest(name=name):
                result = safe_job_filename(name)
                self.assertTrue(result.startswith("_"), result)

    def test_forbidden_characters_are_replaced(self):
        result = safe_job_filename('we<ir>d|na?me*.pdf')
        for ch in '<>|?*':
            self.assertNotIn(ch, result)

    def test_control_characters_are_replaced(self):
        result = safe_job_filename("bad\x00\x1fname.pdf")
        self.assertNotIn("\x00", result)
        self.assertNotIn("\x1f", result)

    def test_absurdly_long_names_are_trimmed(self):
        result = safe_job_filename("a" * 400 + ".pdf")
        self.assertLessEqual(len(result), 120)

    def test_a_trimmed_name_keeps_its_extension(self):
        # process_job decides what to do with the file from its suffix.
        result = safe_job_filename("b" * 400 + ".docx")
        self.assertTrue(result.endswith(".docx"), result)


class OrdinaryNamesSurvive(unittest.TestCase):
    def test_a_normal_name_is_untouched(self):
        self.assertEqual(safe_job_filename("report.pdf"), "report.pdf")

    def test_spaces_are_kept(self):
        # The real filename from order PQ105.
        self.assertEqual(safe_job_filename("clip last.jpeg"), "clip last.jpeg")

    def test_unicode_is_kept(self):
        self.assertEqual(safe_job_filename("शुल्क.pdf"), "शुल्क.pdf")

    def test_dots_in_the_name_are_kept(self):
        self.assertEqual(safe_job_filename("2026.09.17 invoice.pdf"), "2026.09.17 invoice.pdf")

    def test_parentheses_and_dashes_survive(self):
        self.assertEqual(safe_job_filename("essay (final)-v2.docx"), "essay (final)-v2.docx")


class EmptyAndNonsense(unittest.TestCase):
    def test_empty_becomes_the_fallback(self):
        self.assertEqual(safe_job_filename(""), "document.pdf")

    def test_none_becomes_the_fallback(self):
        self.assertEqual(safe_job_filename(None), "document.pdf")

    def test_dots_only_become_the_fallback(self):
        for raw in (".", "..", "...", "   ", " . "):
            with self.subTest(raw=raw):
                self.assertEqual(safe_job_filename(raw), "document.pdf")

    def test_a_bare_directory_becomes_the_fallback(self):
        self.assertEqual(safe_job_filename("../../"), "document.pdf")


class UsedByProcessJob(unittest.TestCase):
    def test_process_job_sanitises_before_joining(self):
        source = Path(__file__).resolve().parent.joinpath("printq_agent.py").read_text(
            encoding="utf-8"
        )
        # The raw name must never be joined onto a path again.
        self.assertNotIn("job_dir / job.filename", source)
        self.assertIn("safe_job_filename(job.filename)", source)
        self.assertIn("job_dir / safe_name", source)


if __name__ == "__main__":
    unittest.main()
