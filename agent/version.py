"""
The agent's version, in one place.

Read by three things that must never disagree:

  - the heartbeat, so the dashboard can show which build a shop is running;
  - the installer, which stamps the same number on PrintQAgent-Setup.exe;
  - the update check, which compares this against what the server offers.

Bump this, tag the repository `agent-v<version>`, and the release workflow
builds an installer carrying the same number. Nothing else needs editing.
"""

from __future__ import annotations

AGENT_VERSION = "1.0.0"

#: Shown in the UI and the tray tooltip.
AGENT_NAME = "PrintQ Agent"


def user_agent() -> str:
    """Value sent as the HTTP User-Agent, so server logs identify the build."""
    return f"PrintQAgent/{AGENT_VERSION} (Windows)"


def parse_version(value: str) -> tuple[int, ...]:
    """
    "1.2.3" -> (1, 2, 3), for comparing versions without a dependency.

    Anything unparseable becomes (0,), which sorts below every real release —
    so a malformed version from the server can never look newer than what is
    installed and trigger a spurious update prompt.
    """
    parts: list[int] = []
    for chunk in str(value or "").strip().split("."):
        digits = "".join(ch for ch in chunk if ch.isdigit())
        if not digits:
            return (0,)
        parts.append(int(digits))
    return tuple(parts) if parts else (0,)


def is_newer(candidate: str, current: str = AGENT_VERSION) -> bool:
    """Is `candidate` a later release than `current`?"""
    return parse_version(candidate) > parse_version(current)
