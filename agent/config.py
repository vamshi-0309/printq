"""
Persistent agent configuration stored in %APPDATA%/PrintQ/agent.json.

After a successful pairing, the agent stores its credentials here so it
can reconnect automatically on restart without re-pairing.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path
from urllib.parse import urlparse

CONFIG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "PrintQ"
CONFIG_FILE = CONFIG_DIR / "agent.json"

#: Where an installed agent talks to, unless the operator types something else.
#:
#: A shop that installs PrintQAgent-Setup.exe must never have to discover,
#: type, or be told a server address: the installed product has exactly one
#: server. Development overrides it with --server or PRINTQ_API_BASE_URL.
DEFAULT_SERVER_URL = "https://printq-rho.vercel.app"

#: Where the agent keeps the copy of SumatraPDF it manages itself.
#:
#: Under LOCALAPPDATA rather than Program Files so it can be written without
#: administrator rights -- the agent runs as the shop's ordinary desktop user,
#: and a printing tool it can repair on its own beats one that needs an admin
#: to reinstall. The installer puts a copy here too; whichever arrives first,
#: the resolver finds the same path.
MANAGED_SUMATRA_DIR = (
    Path(os.environ.get("LOCALAPPDATA", Path.home())) / "PrintQ" / "SumatraPDF"
)
MANAGED_SUMATRA_EXE = MANAGED_SUMATRA_DIR / "SumatraPDF.exe"


class InvalidServerUrl(ValueError):
    """The server URL typed into the pairing dialog is not usable."""


def normalize_base_url(raw: str) -> str:
    """
    Validate and normalise the PrintQ server URL the operator typed.

    This is the address the agent will call for the rest of its life, so it is
    checked here rather than being discovered later as a connection failure.
    Returns the URL without a trailing slash; raises InvalidServerUrl with a
    message suitable for showing in the dialog.

    The operator's value is authoritative. The pairing response also carries an
    `apiBaseUrl` (derived from the server's NEXT_PUBLIC_APP_URL, which exists
    for Cashfree return/webhook URLs); using that would silently redirect the
    agent to a public tunnel address it may not be able to reach, which is
    exactly what happened with a dead LocalTunnel URL.
    """
    if raw is None:
        raise InvalidServerUrl("Enter the PrintQ server URL.")

    candidate = raw.strip()
    if not candidate:
        raise InvalidServerUrl("Enter the PrintQ server URL.")

    # Accept "localhost:3000" by assuming http, which is what a local dev
    # server serves; anything already carrying a scheme is left alone.
    if "://" not in candidate:
        candidate = f"http://{candidate}"

    parsed = urlparse(candidate)

    if parsed.scheme not in ("http", "https"):
        raise InvalidServerUrl("Server URL must start with http:// or https://")
    if not parsed.netloc:
        raise InvalidServerUrl("Server URL is missing a host name.")

    # urlparse happily accepts "http://not a url" with a netloc containing
    # spaces, so the host is checked explicitly rather than trusted.
    if any(ch.isspace() for ch in parsed.netloc):
        raise InvalidServerUrl("Server URL contains spaces.")
    if not parsed.hostname:
        raise InvalidServerUrl("Server URL is missing a host name.")

    # Drop any path, query or fragment: the agent appends its own /api/... paths.
    normalized = f"{parsed.scheme}://{parsed.netloc}"
    return normalized.rstrip("/")


@dataclass
class AgentConfig:
    api_base_url: str = DEFAULT_SERVER_URL
    shop_id: str = ""
    shop_name: str = ""
    agent_id: str = ""
    agent_secret: str = ""
    sumatra_path: str = r"C:\Program Files\SumatraPDF\SumatraPDF.exe"
    libreoffice_path: str = r"C:\Program Files\LibreOffice\program\soffice.exe"
    work_dir: str = str(Path(os.environ.get("APPDATA", Path.home())) / "PrintQ" / "jobs")
    #: Set from the UI. Persisted so a paused agent stays paused across a
    #: restart -- an operator who paused printing to change toner does not
    #: expect Windows rebooting overnight to undo that.
    paused: bool = False

    @property
    def is_paired(self) -> bool:
        return bool(self.shop_id and self.agent_id and self.agent_secret)


def load_config() -> AgentConfig:
    if not CONFIG_FILE.exists():
        return AgentConfig()
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return AgentConfig(**{k: v for k, v in data.items() if k in AgentConfig.__dataclass_fields__})
    except (json.JSONDecodeError, TypeError):
        return AgentConfig()


def save_config(cfg: AgentConfig) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(asdict(cfg), indent=2), encoding="utf-8")


def clear_config() -> None:
    if CONFIG_FILE.exists():
        CONFIG_FILE.unlink()
