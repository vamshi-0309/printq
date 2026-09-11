"""
Regression tests for the pairing dialog's server-URL handling.

THE BUG THESE PIN DOWN
    PairingDialog built its config with:

        api_base_url=data.get("apiBaseUrl", base_url)

    so the server's `apiBaseUrl` (its NEXT_PUBLIC_APP_URL, which exists for
    Cashfree return/webhook URLs) silently replaced whatever the operator
    typed. Pairing against http://localhost:3000 saved a public LocalTunnel
    address instead, and every heartbeat afterwards failed with 503.

    The URL entered in the dialog is now authoritative.

Run with:  python -m unittest discover -s agent -v
Uses only the standard library, so it needs no extra packages and no display.
"""

from __future__ import annotations

import unittest
from unittest.mock import patch

from config import AgentConfig, InvalidServerUrl, normalize_base_url


class NormalizeBaseUrlTests(unittest.TestCase):
    def test_keeps_localhost_with_port(self):
        self.assertEqual(normalize_base_url("http://localhost:3000"), "http://localhost:3000")

    def test_strips_trailing_slash(self):
        self.assertEqual(normalize_base_url("http://localhost:3000/"), "http://localhost:3000")
        self.assertEqual(normalize_base_url("http://localhost:3000///"), "http://localhost:3000")

    def test_strips_surrounding_whitespace(self):
        self.assertEqual(normalize_base_url("  http://localhost:3000  "), "http://localhost:3000")

    def test_assumes_http_when_scheme_omitted(self):
        self.assertEqual(normalize_base_url("localhost:3000"), "http://localhost:3000")

    def test_keeps_https_host(self):
        self.assertEqual(normalize_base_url("https://printq.in"), "https://printq.in")

    def test_drops_path_query_and_fragment(self):
        # The agent appends its own /api/... paths.
        self.assertEqual(
            normalize_base_url("http://localhost:3000/dashboard?x=1#y"),
            "http://localhost:3000",
        )

    def test_rejects_empty(self):
        for value in ("", "   ", None):
            with self.assertRaises(InvalidServerUrl):
                normalize_base_url(value)

    def test_rejects_non_http_scheme(self):
        for value in ("ftp://example.com", "file:///c:/tmp"):
            with self.assertRaises(InvalidServerUrl):
                normalize_base_url(value)

    def test_rejects_missing_host(self):
        with self.assertRaises(InvalidServerUrl):
            normalize_base_url("http://")


class _FakeResponse:
    """Minimal stand-in for requests.Response."""

    status_code = 200
    headers = {"content-type": "application/json"}

    def __init__(self, payload):
        self._payload = payload

    def json(self):
        return self._payload


class EnteredUrlWinsTests(unittest.TestCase):
    """
    Drives PairingDialog._on_pair with the network and Tk widgets stubbed, so
    the saved AgentConfig can be inspected directly.
    """

    # The exact payload the real /api/agent/pair returns, including the
    # apiBaseUrl that used to hijack the operator's choice.
    SERVER_PAYLOAD = {
        "agentId": "ab3c3a32-b983-4b0b-9b27-b4bbdc1d9f7d",
        "agentSecret": "a" * 64,
        "shopId": "14e694d1-537b-466b-b49e-f10e70205f54",
        "shopName": "Test Xerox",
        "shopSlug": "test-xerox",
        "apiBaseUrl": "https://little-parents-chew.loca.lt",
    }

    def _pair_with(self, entered_url, payload=None):
        """Returns the AgentConfig that would have been saved."""
        import pairing

        saved = {}

        def fake_save(cfg):
            saved["cfg"] = cfg

        dialog = pairing.PairingDialog.__new__(pairing.PairingDialog)

        class _Var:
            def __init__(self, value=""):
                self._value = value

            def get(self):
                return self._value

            def set(self, value):
                self._value = value

        class _Widget:
            def config(self, **_kwargs):
                pass

        class _Root:
            def update(self):
                pass

            def destroy(self):
                pass

        dialog.url_var = _Var(entered_url)
        dialog.code_var = _Var("556D67")
        dialog.status_var = _Var()
        dialog.pair_btn = _Widget()
        dialog.root = _Root()
        dialog.result = None

        with patch.object(pairing.requests, "post",
                          return_value=_FakeResponse(payload or self.SERVER_PAYLOAD)), \
             patch.object(pairing, "save_config", fake_save), \
             patch.object(pairing.messagebox, "showinfo", lambda *a, **k: None):
            dialog._on_pair()

        return saved.get("cfg")

    def test_entered_localhost_is_saved_not_the_server_suggestion(self):
        cfg = self._pair_with("http://localhost:3000")
        self.assertIsInstance(cfg, AgentConfig)
        self.assertEqual(cfg.api_base_url, "http://localhost:3000")

    def test_server_apibaseurl_cannot_override_entered_url(self):
        cfg = self._pair_with("http://localhost:3000")
        # The precise regression: the tunnel URL must not win.
        self.assertNotEqual(cfg.api_base_url, "https://little-parents-chew.loca.lt")
        self.assertNotIn("loca.lt", cfg.api_base_url)

    def test_entered_url_wins_for_any_server_suggestion(self):
        for suggestion in (
            "https://printq.in",
            "https://some-other-tunnel.ngrok.io",
            "http://192.168.1.50:3000",
        ):
            payload = dict(self.SERVER_PAYLOAD, apiBaseUrl=suggestion)
            cfg = self._pair_with("http://localhost:3000", payload)
            self.assertEqual(cfg.api_base_url, "http://localhost:3000")

    def test_entered_url_still_wins_when_server_omits_apibaseurl(self):
        payload = {k: v for k, v in self.SERVER_PAYLOAD.items() if k != "apiBaseUrl"}
        cfg = self._pair_with("http://localhost:3000", payload)
        self.assertEqual(cfg.api_base_url, "http://localhost:3000")

    def test_entered_url_is_normalized_before_saving(self):
        cfg = self._pair_with("  localhost:3000/  ")
        self.assertEqual(cfg.api_base_url, "http://localhost:3000")

    def test_credentials_from_the_server_are_still_used(self):
        # Only the URL is overridden; everything else comes from the response.
        cfg = self._pair_with("http://localhost:3000")
        self.assertEqual(cfg.agent_id, self.SERVER_PAYLOAD["agentId"])
        self.assertEqual(cfg.agent_secret, self.SERVER_PAYLOAD["agentSecret"])
        self.assertEqual(cfg.shop_id, self.SERVER_PAYLOAD["shopId"])
        self.assertEqual(cfg.shop_name, self.SERVER_PAYLOAD["shopName"])

    def test_invalid_url_aborts_before_any_network_call(self):
        import pairing

        dialog = pairing.PairingDialog.__new__(pairing.PairingDialog)

        class _Var:
            def __init__(self, value=""):
                self._value = value

            def get(self):
                return self._value

            def set(self, value):
                self._value = value

        dialog.url_var = _Var("not a url")
        dialog.code_var = _Var("556D67")
        dialog.status_var = _Var()

        with patch.object(pairing.requests, "post") as post:
            dialog._on_pair()
            # The point of the test: a bad URL is caught locally, so no
            # pairing request is sent and no credentials are consumed.
            post.assert_not_called()

        # And the operator is told why, rather than the dialog just doing
        # nothing when they press Pair.
        self.assertTrue(dialog.status_var.get().strip())


if __name__ == "__main__":
    unittest.main()
