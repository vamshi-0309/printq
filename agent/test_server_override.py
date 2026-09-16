"""
Tests for correcting an agent that was paired against an unreachable URL.

THE SITUATION THESE COVER
    An agent paired while pairing.py still honoured the server's apiBaseUrl
    stored https://<tunnel>.loca.lt in agent.json. Fixing pairing.py does not
    help that agent: it reads the stored URL on every start and never
    re-checks it, so it kept calling the dead tunnel and getting 503.

    `--server` (or $PRINTQ_API_BASE_URL) overrides the stored address and
    saves the correction, so valid credentials do not have to be thrown away
    and re-paired just to change a hostname.

Run with:  python -m unittest discover -s agent -v
"""

from __future__ import annotations

import importlib
import os
import unittest
from contextlib import contextmanager
from unittest.mock import patch

from config import AgentConfig, InvalidServerUrl


@contextmanager
def reloaded_with(env: dict):
    """
    Reload printq_agent so its module-level defaults re-read the environment,
    then put the module's original contents back.

    importlib.reload re-executes the module in place, which builds fresh class
    objects for everything it defines. Any other test file that did
    `from printq_agent import SomeError` still holds the OLD class, so
    `assertRaises(SomeError)` silently stops matching in whichever file happens
    to run next -- the whole suite becomes order-dependent. Snapshotting and
    restoring __dict__ keeps the reload local to this test.

    A value of None means "remove this variable".
    """
    import printq_agent

    original = printq_agent.__dict__.copy()
    present = {k: v for k, v in env.items() if v is not None}
    absent = [k for k, v in env.items() if v is None]

    try:
        with patch.dict("os.environ", present, clear=False):
            for name in absent:
                os.environ.pop(name, None)
            importlib.reload(printq_agent)
            yield printq_agent
    finally:
        printq_agent.__dict__.clear()
        printq_agent.__dict__.update(original)

TUNNEL = "https://little-parents-chew.loca.lt"
LOCAL = "http://localhost:3000"


def _paired(url=TUNNEL) -> AgentConfig:
    return AgentConfig(
        api_base_url=url,
        shop_id="1fc9582b-4624-4075-83ea-8e115ad845d4",
        shop_name="insaneshop",
        agent_id="c6ca9d09-cdab-45c8-9b40-f3b5a1d521d5",
        agent_secret="8b" * 32,
    )


class ServerOverrideTests(unittest.TestCase):
    def test_override_replaces_a_stored_tunnel_url(self):
        import printq_agent

        cfg = _paired()
        with patch.object(printq_agent, "save_config") as save:
            out = printq_agent.apply_server_override(cfg, LOCAL)
        self.assertEqual(out.api_base_url, LOCAL)
        # Persisted, so the flag is only needed once.
        save.assert_called_once()

    def test_override_keeps_the_existing_credentials(self):
        import printq_agent

        cfg = _paired()
        with patch.object(printq_agent, "save_config"):
            out = printq_agent.apply_server_override(cfg, LOCAL)
        # The whole point: no re-pairing required.
        self.assertEqual(out.agent_id, "c6ca9d09-cdab-45c8-9b40-f3b5a1d521d5")
        self.assertEqual(out.shop_id, "1fc9582b-4624-4075-83ea-8e115ad845d4")
        self.assertEqual(out.shop_name, "insaneshop")
        self.assertTrue(out.is_paired)

    def test_override_normalizes_the_value(self):
        import printq_agent

        with patch.object(printq_agent, "save_config"):
            out = printq_agent.apply_server_override(_paired(), "  localhost:3000/  ")
        self.assertEqual(out.api_base_url, LOCAL)

    def test_no_override_leaves_config_untouched(self):
        import printq_agent

        cfg = _paired()
        with patch.object(printq_agent, "save_config") as save:
            out = printq_agent.apply_server_override(cfg, "")
        self.assertEqual(out.api_base_url, TUNNEL)
        save.assert_not_called()

    def test_matching_override_does_not_rewrite_the_file(self):
        import printq_agent

        cfg = _paired(LOCAL)
        with patch.object(printq_agent, "save_config") as save:
            out = printq_agent.apply_server_override(cfg, LOCAL)
        self.assertEqual(out.api_base_url, LOCAL)
        save.assert_not_called()

    def test_invalid_override_raises_rather_than_silently_ignoring(self):
        import printq_agent

        with patch.object(printq_agent, "save_config"):
            with self.assertRaises(InvalidServerUrl):
                printq_agent.apply_server_override(_paired(), "not a url")

    def test_unpaired_config_is_updated_but_not_saved(self):
        import printq_agent

        cfg = AgentConfig()
        with patch.object(printq_agent, "save_config") as save:
            out = printq_agent.apply_server_override(cfg, LOCAL)
        self.assertEqual(out.api_base_url, LOCAL)
        # Nothing worth persisting until pairing supplies credentials.
        save.assert_not_called()


class ArgParsingTests(unittest.TestCase):
    def test_server_flag_is_read(self):
        import printq_agent

        self.assertEqual(printq_agent.parse_args(["--server", LOCAL]).server, LOCAL)

    def test_defaults_to_env_var(self):
        with reloaded_with({"PRINTQ_API_BASE_URL": LOCAL}) as printq_agent:
            self.assertEqual(printq_agent.parse_args([]).server, LOCAL)

    def test_defaults_to_empty_without_env(self):
        with reloaded_with({"PRINTQ_API_BASE_URL": None}) as printq_agent:
            self.assertEqual(printq_agent.parse_args([]).server, "")


if __name__ == "__main__":
    unittest.main()
