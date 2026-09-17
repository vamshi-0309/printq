"""
PrintQ Windows Print Agent
===========================

Runs on the shop's Windows PC as a system tray application. Connects to
the PrintQ backend, claims paid print jobs, converts office documents
to PDF via LibreOffice, and sends them to the shop's printer via
SumatraPDF's silent-print CLI.

On first run, a pairing dialog collects a 6-char code from the shop's
PrintQ dashboard and exchanges it for long-lived credentials stored
in %APPDATA%/PrintQ/agent.json.

Packaging: `pyinstaller --onefile --windowed printq_agent.py`

Dependencies (requirements.txt):
    pywin32
    requests
    pystray
    Pillow
    python-dotenv
"""

from __future__ import annotations

import argparse
import logging
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Callable, Optional

import requests

from config import (
    AgentConfig,
    DEFAULT_SERVER_URL,
    InvalidServerUrl,
    MANAGED_SUMATRA_EXE,
    clear_config,
    load_config,
    normalize_base_url,
    save_config,
)
from tray import TrayIcon
from version import AGENT_VERSION, user_agent

try:
    import win32print  # type: ignore
except ImportError:
    win32print = None

# ----------------------------------------------------------------------
# Logging
# ----------------------------------------------------------------------

LOG_DIR = Path(os.environ.get("APPDATA", Path.home())) / "PrintQ"
LOG_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_DIR / "agent.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("printq-agent")

HEARTBEAT_INTERVAL_SECONDS = 20
POLL_INTERVAL_SECONDS = 5

CONVERTIBLE_EXTENSIONS = {".doc", ".docx", ".ppt", ".pptx"}
DIRECT_PRINT_EXTENSIONS = {".pdf"}
IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png"}
ALLOWED_EXTENSIONS = CONVERTIBLE_EXTENSIONS | DIRECT_PRINT_EXTENSIONS | IMAGE_EXTENSIONS

DEV_MODE = os.environ.get("PRINTQ_DEV_MODE", "false").lower() == "true"


# ----------------------------------------------------------------------
# Data
# ----------------------------------------------------------------------

from dataclasses import dataclass


@dataclass
class PrintJob:
    jobId: str
    orderId: str
    downloadUrl: str
    filename: str
    mimeType: str
    printSettings: dict
    # The printer the shop owner chose in Dashboard -> Printers, resolved
    # server-side and sent with the claim: {id, systemName, displayName, ...}.
    # Optional only so an older server that omits it fails loudly in
    # resolve_job_printer rather than crashing at construction.
    printer: Optional[dict] = None


class AgentAuthError(RuntimeError):
    pass


class PrinterUnavailable(RuntimeError):
    """The printer PrintQ selected is not usable on this machine."""


class NoPrinterConfigured(RuntimeError):
    """The shop has queued work but no PrintQ printer chosen."""


class SumatraNotFound(RuntimeError):
    """The SumatraPDF executable could not be located on this machine."""


# ----------------------------------------------------------------------
# Backend API client
# ----------------------------------------------------------------------


class PrintQClient:
    def __init__(self, cfg: AgentConfig):
        self.base_url = cfg.api_base_url.rstrip("/")
        self.shop_id = cfg.shop_id
        self.agent_id = cfg.agent_id
        self.agent_secret = cfg.agent_secret
        self.session = requests.Session()

    def _headers(self) -> dict:
        return {
            "X-PrintQ-Shop-Id": self.shop_id,
            "X-PrintQ-Agent-Id": self.agent_id,
            "X-PrintQ-Agent-Secret": self.agent_secret,
            "Content-Type": "application/json",
            # Identifies the build in server logs without carrying anything
            # identifying about the shop.
            "User-Agent": user_agent(),
        }

    def heartbeat(self, printers: list[dict], hostname: str = "") -> dict:
        resp = self.session.post(
            f"{self.base_url}/api/agent/heartbeat",
            headers=self._headers(),
            json={
                "printers": printers,
                "agent_version": AGENT_VERSION,
                "hostname": hostname,
            },
            timeout=10,
        )
        if resp.status_code == 401:
            raise AgentAuthError("Agent credentials rejected by server.")
        resp.raise_for_status()
        return resp.json()

    def claim_next_job(self) -> Optional[PrintJob]:
        resp = self.session.post(
            f"{self.base_url}/api/agent/jobs/claim",
            headers=self._headers(),
            timeout=10,
        )
        if resp.status_code == 204:
            return None

        # The shop has work waiting but no usable PrintQ printer. This is a
        # setup problem the owner must fix, not a transport error, so it is
        # reported distinctly instead of being retried as a failure.
        if resp.status_code == 409:
            body = resp.json() if resp.content else {}
            raise NoPrinterConfigured(body.get("error") or "No PrintQ printer is configured.")

        resp.raise_for_status()
        data = resp.json()
        return PrintJob(**{k: data[k] for k in PrintJob.__dataclass_fields__ if k in data})

    def report_print_attempted(self, job_id: str, attempt_number: int = 1, printer_id: str | None = None) -> None:
        self.session.post(
            f"{self.base_url}/api/agent/jobs/{job_id}/attempted",
            headers=self._headers(),
            json={"attempt_number": attempt_number, "printer_id": printer_id},
            timeout=10,
        ).raise_for_status()

    def report_result(self, job_id: str, result: str, error_message: str = "") -> None:
        self.session.post(
            f"{self.base_url}/api/agent/jobs/{job_id}/result",
            headers=self._headers(),
            json={"result": result, "error_message": error_message},
            timeout=10,
        ).raise_for_status()

    def download_file(self, signed_url: str, dest: Path) -> None:
        with self.session.get(signed_url, stream=True, timeout=60) as r:
            r.raise_for_status()
            with open(dest, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 256):
                    f.write(chunk)


# ----------------------------------------------------------------------
# Printer discovery
# ----------------------------------------------------------------------


#: Windows ports that make a print job wait for a person.
#:
#: PORTPROMPT: is the port Microsoft Print to PDF (and anything else that
#: writes to a file the user picks) is attached to. Printing to it opens a
#: "Save Print Output As" dialog and blocks until somebody answers it. There is
#: no command-line way to supply that filename through SumatraPDF, so a job
#: sent there can never complete unattended: it hangs until the agent's
#: 180-second timeout, or exits 1 if the dialog is dismissed.
INTERACTIVE_PRINTER_PORTS = {"PORTPROMPT:"}


def printer_port(name: str) -> str:
    """
    The Windows port a printer is attached to, or "" if it cannot be read.

    Read separately from list_installed_printers() so printer discovery and
    the heartbeat keep working exactly as before.
    """
    if win32print is None:
        return ""
    try:
        handle = win32print.OpenPrinter(name)
        try:
            info = win32print.GetPrinter(handle, 2)
            return str(info.get("pPortName") or "")
        finally:
            win32print.ClosePrinter(handle)
    except Exception as exc:  # unknown printer, access denied, driver oddity
        log.debug("Could not read the port for %r: %s", name, exc)
        return ""


def list_installed_printers() -> list[dict]:
    if win32print is None:
        log.warning("win32print not available — returning empty list.")
        return []
    printers = []
    default_name = win32print.GetDefaultPrinter()
    flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
    for _flags, _desc, name, _comment in win32print.EnumPrinters(flags):
        printers.append({"system_name": name, "is_default": name == default_name})
    return printers


# ----------------------------------------------------------------------
# Document conversion
# ----------------------------------------------------------------------


def convert_to_pdf(input_path: Path, output_dir: Path, cfg: AgentConfig) -> Path:
    if DEV_MODE:
        log.info("[DEV] Simulating conversion of %s", input_path.name)
        fake_pdf = output_dir / (input_path.stem + ".pdf")
        fake_pdf.write_bytes(b"%PDF-1.4\n% simulated\n")
        return fake_pdf

    cmd = [
        cfg.libreoffice_path,
        "--headless", "--convert-to", "pdf",
        "--outdir", str(output_dir),
        str(input_path),
    ]
    log.info("Converting via LibreOffice: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, timeout=120)
    if result.returncode != 0:
        raise RuntimeError(f"LibreOffice conversion failed: {result.stderr.decode(errors='replace')}")
    return output_dir / (input_path.stem + ".pdf")


# ----------------------------------------------------------------------
# Printing
# ----------------------------------------------------------------------


def build_sumatra_settings(settings: dict) -> str:
    parts = []
    page_range = settings.get("pageRange", "all")
    if page_range and page_range != "all":
        parts.append(page_range)
    copies = settings.get("copies", 1)
    if copies and copies > 1:
        parts.append(f"{copies}x")
    if settings.get("sides") == "double":
        parts.append("duplex")
    else:
        parts.append("simplex")
    if settings.get("colorMode") == "bw":
        parts.append("monochrome")
    paper = settings.get("paperSize")
    if paper:
        parts.append(f"paper={paper}")
    return ",".join(parts)


def resolve_job_printer(
    job: PrintJob, installed: Optional[list[str]] = None
) -> tuple[str, Optional[str]]:
    """
    Work out which printer this job must go to, and refuse to guess.

    Returns (windows_printer_name, printq_printer_id).

    The server sends the printer the shop owner selected in Dashboard ->
    Printers. This function will not fall back to win32print.GetDefaultPrinter()
    if that printer is missing: the Windows default is a different setting,
    owned by Windows, and silently using it is how a customer's document ends
    up on a machine nobody chose. A missing printer raises PrinterUnavailable,
    which the caller reports as a job failure with the reason attached.
    """
    printer = job.printer or {}
    name = (printer.get("systemName") or "").strip()
    printer_id = printer.get("id")

    if not name:
        raise PrinterUnavailable(
            "PrintQ did not supply a printer for this job. Choose a default printer in "
            "Dashboard -> Printers."
        )

    if installed is None:
        installed = [p["system_name"] for p in list_installed_printers()]

    # An empty list means we could not enumerate (no pywin32); trusting the
    # name is better than refusing every job on a machine we cannot inspect.
    if installed and name not in installed:
        label = printer.get("displayName") or name
        raise PrinterUnavailable(
            f"The printer chosen in PrintQ ({label}) is not available on this PC. "
            f"Windows reports: {', '.join(installed) if installed else 'no printers'}."
        )

    return name, printer_id


def check_printer_can_print_unattended(
    printer_name: str,
    label: Optional[str] = None,
    port_lookup: Optional[Callable[[str], str]] = None,
) -> None:
    """
    Refuse a printer that will stop and ask a person where to save the output.

    Deliberately called from send_to_printer, not from resolve_job_printer.
    The job has to be in PRINT_ATTEMPTED before the agent is allowed to report
    a result: /api/agent/jobs/<id>/result rejects anything else with 409, and
    jobState.ts has no CLAIMED -> FAILED edge. Checking earlier -- which is
    where this started -- left the job stranded in CLAIMED with the agent
    unable to say why, which is worse than the failure it was preventing.

    Skipped in DEV_MODE, which never launches SumatraPDF and so can never
    raise the dialog.
    """
    if DEV_MODE:
        return

    port = (port_lookup or printer_port)(printer_name)
    if not port or port.strip().upper() not in INTERACTIVE_PRINTER_PORTS:
        return

    shown = label or printer_name
    raise PrinterUnavailable(
        f"{shown} saves to a file and makes Windows ask where to put it "
        f"(port {port.strip()}), so PrintQ cannot print to it unattended - "
        "the job stops waiting for a Save-as dialog nobody is there to answer. "
        "Choose a real printer as the PrintQ default in Dashboard > Printers."
    )


SUMATRA_EXE = "SumatraPDF.exe"


def install_dir() -> Path:
    """
    The directory the running agent lives in.

    Under PyInstaller, sys.executable is the installed PrintQAgent.exe; from
    source it is the interpreter, so the module's own directory is used
    instead. The installer can drop files next to the executable and have the
    agent find them either way.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def sumatra_candidates(cfg: Optional[AgentConfig] = None, env: Optional[dict] = None) -> list[tuple[str, str]]:
    """
    Where SumatraPDF might be, in the order worth trying, as (reason, path).

    The order matters. An operator who names a path explicitly means it, so
    that wins; a discovered install is only consulted when nothing was named.
    """
    env = os.environ if env is None else env
    found: list[tuple[str, str]] = []

    # 1. An explicit override. Quotes are stripped because a value pasted from
    #    a shell or a shortcut often arrives wrapped in them.
    explicit = (env.get("SUMATRAPDF_PATH") or "").strip().strip('"').strip("'")
    if explicit:
        found.append(("SUMATRAPDF_PATH", explicit))

    # 2. Whatever agent.json holds. This carries a default pointing at Program
    #    Files, so it is a candidate to test rather than a path to trust: a
    #    stale default must not shadow a real install found below.
    configured = (getattr(cfg, "sumatra_path", "") or "").strip()
    if configured:
        found.append(("agent.json sumatra_path", configured))

    # 3. The copy PrintQ manages itself, placed by the installer or fetched by
    #    the agent on first run. Checked before anything the machine happens to
    #    have lying around, because this one's version is known.
    managed = env.get("PRINTQ_MANAGED_SUMATRA") or str(MANAGED_SUMATRA_EXE)
    if managed:
        found.append(("PrintQ managed copy", managed))

    # 4. Beside the installed agent, for an installer that chose to place it
    #    in the program directory instead.
    beside = install_dir() / "SumatraPDF" / SUMATRA_EXE
    found.append(("next to PrintQ Agent", str(beside)))

    # 5. The per-user install, which is what SumatraPDF's own installer now
    #    produces by default and is not on PATH.
    local_appdata = env.get("LOCALAPPDATA")
    if local_appdata:
        found.append(
            ("%LOCALAPPDATA%", str(Path(local_appdata) / "SumatraPDF" / SUMATRA_EXE))
        )

    # 6. Machine-wide installs, 64- and 32-bit.
    for var in ("ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"):
        base = env.get(var)
        if base:
            found.append((f"%{var}%", str(Path(base) / "SumatraPDF" / SUMATRA_EXE)))

    # De-duplicate while keeping order: several of the variables above often
    # resolve to the same directory.
    seen: set[str] = set()
    unique: list[tuple[str, str]] = []
    for reason, path in found:
        key = os.path.normcase(os.path.normpath(path))
        if key in seen:
            continue
        seen.add(key)
        unique.append((reason, path))
    return unique


def resolve_sumatra_path(cfg: Optional[AgentConfig] = None, env: Optional[dict] = None) -> str:
    """
    Find the SumatraPDF executable, or say precisely where we looked.

    SumatraPDF installs per-user by default, at
    %LOCALAPPDATA%\\SumatraPDF\\SumatraPDF.exe, and puts nothing on PATH. The
    agent only ever tried the hardcoded Program Files path from agent.json, so
    on a machine with a perfectly good install every print failed with
    "[WinError 2] The system cannot find the file specified" — an error that
    names no file and points at nothing.

    PATH is tried last rather than first: a name found on PATH is whatever the
    environment happens to expose, while the locations above are places
    SumatraPDF is actually installed.
    """
    env = os.environ if env is None else env
    candidates = sumatra_candidates(cfg, env)

    for reason, path in candidates:
        if path and os.path.isfile(path):
            log.debug("Using SumatraPDF from %s: %s", reason, path)
            return path

    on_path = shutil.which(SUMATRA_EXE, path=env.get("PATH"))
    if on_path:
        log.debug("Using SumatraPDF found on PATH: %s", on_path)
        return on_path

    checked = "\n".join(f"  - {path}   ({reason})" for reason, path in candidates)
    raise SumatraNotFound(
        "SumatraPDF is required to print but was not found on this PC.\n"
        "Install it from https://www.sumatrapdfreader.org/ , or set the "
        "SUMATRAPDF_PATH environment variable to the full path of "
        f"{SUMATRA_EXE}.\n"
        f"Checked these locations:\n{checked}\n  - {SUMATRA_EXE} on PATH"
    )


def send_to_printer(
    pdf_path: Path,
    settings: dict,
    cfg: AgentConfig,
    printer_name: str,
    port_lookup: Optional[Callable[[str], str]] = None,
) -> None:
    """
    Print to exactly the printer named. The caller resolves it; this function
    never chooses one, and in particular never consults the Windows default.
    """
    if not printer_name:
        raise PrinterUnavailable("No printer was supplied for this job.")

    # Refuse a printer that would block on a "Save Print Output As" dialog.
    # Done here rather than earlier so the caller can still report the failure:
    # by this point the job is PRINT_ATTEMPTED, which is the only state the
    # result endpoint accepts.
    check_printer_can_print_unattended(printer_name, port_lookup=port_lookup)

    sumatra_settings = build_sumatra_settings(settings)

    if DEV_MODE:
        log.info(
            "[DEV] Would print %s to %r with settings: %s",
            pdf_path.name, printer_name, sumatra_settings,
        )
        return

    # Resolved per job rather than at startup so installing SumatraPDF fixes a
    # failing shop without restarting the agent.
    sumatra = resolve_sumatra_path(cfg)

    cmd = [
        sumatra,
        "-print-to", printer_name,
        "-print-settings", sumatra_settings,
        "-silent",
        str(pdf_path),
    ]
    log.info("Sending to printer: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, timeout=180)
    if result.returncode != 0:
        # SumatraPDF reports on stdout and leaves stderr empty, so the previous
        # message was always the bare "SumatraPDF exited 1: " — a failure with
        # nothing in it. Include whatever it did say.
        detail = (
            result.stderr.decode(errors="replace").strip()
            or result.stdout.decode(errors="replace").strip()
            or "it produced no output"
        )
        raise RuntimeError(
            f"{printer_name} did not accept the job (SumatraPDF exited "
            f"{result.returncode}): {detail}"
        )


# ----------------------------------------------------------------------
# Job processing
# ----------------------------------------------------------------------


def safe_job_filename(raw: str, fallback: str = "document.pdf") -> str:
    """
    Turn a customer-supplied filename into something safe to write.

    The name travels customer -> upload -> order row -> claim response -> here,
    and arrives as a plain string. `job_dir / raw` is a path join, so a name
    like "../../Startup/x.pdf" (or its backslash form) would place the file
    outside the job
    directory entirely. The upload route sanitises the name it builds a STORAGE
    path from, but keeps the original for display, so the agent cannot assume
    it has been cleaned -- and the agent is what actually touches this disk.

    Everything except the final path component is discarded, along with the
    characters Windows forbids in a name. The extension is preserved because
    the caller decides what to do with the file from it.
    """
    name = str(raw or "").strip().replace("\\", "/")

    # Take only the last segment: drops "../", absolute paths and drive letters.
    name = name.rsplit("/", 1)[-1]

    # ":" would reintroduce a drive or an NTFS alternate data stream.
    name = "".join("_" if ch in '<>:"|?*' or ord(ch) < 32 else ch for ch in name)

    # A name that is only dots ("." or "..") is not a file.
    if not name.strip(". ") or name in (".", ".."):
        return fallback

    # Windows reserved device names, with or without an extension.
    stem = name.split(".", 1)[0].upper()
    if stem in {
        "CON", "PRN", "AUX", "NUL",
        *(f"COM{i}" for i in range(1, 10)),
        *(f"LPT{i}" for i in range(1, 10)),
    }:
        name = f"_{name}"

    # Long names blow past MAX_PATH once joined to the job directory.
    if len(name) > 120:
        suffix = Path(name).suffix[:20]
        name = name[: 120 - len(suffix)] + suffix

    return name or fallback


def process_job(client: PrintQClient, job: PrintJob, cfg: AgentConfig) -> None:
    work_dir = Path(cfg.work_dir)
    job_dir = work_dir / job.jobId
    job_dir.mkdir(parents=True, exist_ok=True)

    # Never join a customer-supplied name straight onto a path.
    safe_name = safe_job_filename(job.filename)
    ext = Path(safe_name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        client.report_result(job.jobId, "error", f"Unsupported file type: {ext}")
        return

    # Resolve the printer BEFORE downloading or converting anything. If the
    # shop's chosen printer is not on this machine there is no point fetching
    # the customer's document, and the job should fail with a reason the owner
    # can act on rather than after a pointless download.
    try:
        printer_name, printer_id = resolve_job_printer(job)
    except PrinterUnavailable as exc:
        log.error("Job %s: %s", job.jobId, exc)
        client.report_result(job.jobId, "error", str(exc))
        return

    log.info("Job %s will print to %r (PrintQ printer %s)", job.jobId, printer_name, printer_id)

    downloaded = job_dir / safe_name
    client.download_file(job.downloadUrl, downloaded)

    if ext in CONVERTIBLE_EXTENSIONS:
        pdf_path = convert_to_pdf(downloaded, job_dir, cfg)
    elif ext in IMAGE_EXTENSIONS:
        pdf_path = downloaded
    else:
        pdf_path = downloaded

    # The printer id goes with the attempt so print_attempts records which
    # device the job was actually sent to.
    client.report_print_attempted(job.jobId, printer_id=printer_id)

    try:
        send_to_printer(pdf_path, job.printSettings, cfg, printer_name)
    except Exception as exc:
        log.exception("Print failed for job %s", job.jobId)
        client.report_result(job.jobId, "error", str(exc))
        return

    client.report_result(job.jobId, "confirmed")

    try:
        for f in job_dir.iterdir():
            f.unlink()
        job_dir.rmdir()
    except OSError:
        pass


# ----------------------------------------------------------------------
# Pairing
# ----------------------------------------------------------------------


def run_pairing() -> Optional[AgentConfig]:
    from pairing import PairingDialog
    dialog = PairingDialog()
    return dialog.run()


# ----------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------

_running = True


def parse_args(argv: Optional[list[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="printq_agent",
        description="PrintQ Windows print agent.",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help=(
            "Run the loop with no window, as the agent did before it had a UI. "
            "Used for development and automated checks; an installed agent "
            "always opens its window."
        ),
    )
    parser.add_argument(
        "--minimised",
        "--minimized",
        dest="minimised",
        action="store_true",
        help=(
            "Start with the window hidden in the system tray. Windows startup "
            "uses this so a reboot does not put a window in the shop's face."
        ),
    )
    parser.add_argument(
        "--server",
        metavar="URL",
        default=os.environ.get("PRINTQ_API_BASE_URL", ""),
        help=(
            "PrintQ server URL to use for this run, e.g. http://localhost:3000. "
            "Overrides the address stored at pairing time and is saved back, so "
            "an agent paired against an unreachable URL can be corrected without "
            "re-pairing. Defaults to $PRINTQ_API_BASE_URL."
        ),
    )
    return parser.parse_args(argv)


def apply_server_override(cfg: AgentConfig, server: str) -> AgentConfig:
    """
    Point an already-paired agent at a different server.

    Without this, the URL captured during pairing is permanent: the agent
    reads it from agent.json on every start and never re-checks it, so an
    agent paired against an address that later stops resolving (a closed
    tunnel, a changed LAN IP) fails forever with no way out except deleting
    the credentials and pairing again. The corrected URL is persisted so the
    override only has to be passed once.
    """
    if not server or not server.strip():
        return cfg

    normalized = normalize_base_url(server)
    if normalized == cfg.api_base_url:
        return cfg

    log.info("Server URL override: %s -> %s", cfg.api_base_url or "(unset)", normalized)
    cfg.api_base_url = normalized
    if cfg.is_paired:
        save_config(cfg)
        log.info("Saved corrected server URL; future runs need no --server flag.")
    return cfg


def main(argv: Optional[list[str]] = None) -> None:
    global _running

    args = parse_args(argv)
    cfg = load_config()

    try:
        cfg = apply_server_override(cfg, args.server)
    except InvalidServerUrl as exc:
        log.error("Invalid --server value: %s", exc)
        return

    if not cfg.is_paired and args.headless:
        log.info("No stored credentials — launching pairing dialog.")
        result = run_pairing()
        if result is None:
            log.info("Pairing cancelled. Exiting.")
            return
        cfg = result
        # A --server flag also wins over whatever pairing just stored.
        try:
            cfg = apply_server_override(cfg, args.server)
        except InvalidServerUrl as exc:
            log.error("Invalid --server value: %s", exc)
            return

    log.info("Using PrintQ server: %s", cfg.api_base_url)
    Path(cfg.work_dir).mkdir(parents=True, exist_ok=True)

    if not args.headless:
        # The installed product. Pairing, printer choice and status all happen
        # in the window; imported here so the headless path never needs tkinter.
        from app_ui import run as run_ui

        run_ui(cfg, start_minimised=args.minimised)
        return

    # Headless: the same loop the window drives, with a tray icon instead of a
    # window. Kept on AgentService rather than a second inline copy, because two
    # implementations of "claim, print, report" are two things to keep correct.
    from agent_service import AgentService, Status

    service = AgentService(cfg)

    def on_quit() -> None:
        service.stop(timeout=5)

    def on_repair() -> None:
        clear_config()
        service.stop(timeout=5)
        log.info("Config cleared — restart the agent to re-pair.")

    tray = TrayIcon(
        shop_name=cfg.shop_name or "PrintQ",
        on_quit=on_quit,
        on_repair=on_repair,
    )
    tray.run_detached()
    tray.set_status("yellow", "Connecting…")

    def mirror(status: Status) -> None:
        colour = {
            "connected": "green",
            "printing": "green",
            "offline": "yellow",
            "no_printer": "yellow",
            "auth_error": "red",
            "stopped": "grey",
        }.get(status.state, "grey")
        tray.set_status(colour, status.detail)

    service._on_change = mirror
    service.start()

    try:
        # The service owns the loop; this thread just waits for it to finish.
        while service._thread and service._thread.is_alive():
            service._thread.join(timeout=1)
    except KeyboardInterrupt:
        log.info("Interrupted — stopping.")
        service.stop(timeout=5)

    tray.stop()
    log.info("Agent stopped.")


if __name__ == "__main__":
    main()
