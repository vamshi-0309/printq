"""
The agent half of the print-settings contract.

print_settings_contract.json is also read by the web app's tests
(src/lib/__tests__/printContract.test.ts), which pin that the server sends
exactly `printSettings` for each order and bills `billedPages`. Here the
agent must turn those same settings into exactly `sumatraRuns`, print
exactly `billedPages` pages, understand every key the server sends, and
announce every capability the job requires.
"""

from __future__ import annotations

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from printq_agent import AGENT_CAPABILITIES, build_sumatra_settings, print_passes  # noqa: E402
from version import AGENT_VERSION, parse_version  # noqa: E402

CONTRACT = json.loads((Path(__file__).resolve().parent / "print_settings_contract.json").read_text("utf-8"))

#: Keys the agent reads from printSettings. pageCount is informational.
AGENT_READS = {"colorMode", "paperSize", "orientation", "sides", "copies", "pageRange", "fitMode", "colorSegments"}


def pages_in(page_range: str | None, document_pages: int) -> int:
    if not page_range or page_range == "all":
        return document_pages
    total = 0
    for part in page_range.split(","):
        lo, _, hi = part.partition("-")
        total += (int(hi) if hi else int(lo)) - int(lo) + 1
    return total


class PrintContract(unittest.TestCase):
    def test_every_case(self):
        announced = set(AGENT_CAPABILITIES.split(","))
        for case in CONTRACT["cases"]:
            with self.subTest(case["name"]):
                settings = case["printSettings"]
                runs = print_passes(settings)
                self.assertEqual([build_sumatra_settings(r) for r in runs], case["sumatraRuns"])

                printed = sum(
                    pages_in(r.get("pageRange"), case["documentPages"]) * int(r.get("copies") or 1) for r in runs
                )
                self.assertEqual(printed, case["billedPages"], "pages printed must equal pages billed")

                self.assertLessEqual(set(case["requiredCapabilities"]), announced)

    def test_the_agent_understands_every_setting_the_server_sends(self):
        known = set(CONTRACT["knownSettingKeys"])
        self.assertEqual(known - {"pageCount"}, AGENT_READS)

    def test_this_build_is_new_enough_to_announce_capabilities(self):
        # The server requires 1.1.0 for these settings; a build announcing
        # them must say it is at least that version.
        self.assertGreaterEqual(parse_version(AGENT_VERSION), (1, 1, 0))


if __name__ == "__main__":
    unittest.main()
