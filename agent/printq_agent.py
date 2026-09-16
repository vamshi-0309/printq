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
from typing import Optional

import requests

from config import (
    AgentConfig,
    InvalidServerUrl,
    clear_config,
    load_config,
    normalize_base_url,
    save_config,
)
from tray import TrayIcon

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
        }

    def heartbeat(self, printers: list[dict], hostname: str = "") -> dict:
        resp = self.session.post(
            f"{self.base_url}/api/agent/heartbeat",
            headers=self._headers(),
            json={
                "printers": printers,
                "agent_version": "1.0.0",
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


def resolve_job_printer(job: PrintJob, installed: Optional[list[str]] = None) -> tuple[str, Optional[str]]:
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


SUMATRA_EXE = "SumatraPDF.exe"


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

    # 3. The per-user install, which is what SumatraPDF's own installer now
    #    produces by default and is not on PATH.
    local_appdata = env.get("LOCALAPPDATA")
    if local_appdata:
        found.append(
            ("%LOCALAPPDATA%", str(Path(local_appdata) / "SumatraPDF" / SUMATRA_EXE))
        )

    # 4. Machine-wide installs, 64- and 32-bit.
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


def send_to_printer(pdf_path: Path, settings: dict, cfg: AgentConfig, printer_name: str) -> None:
    """
    Print to exactly the printer named. The caller resolves it; this function
    never chooses one, and in particular never consults the Windows default.
    """
    if not printer_name:
        raise PrinterUnavailable("No printer was supplied for this job.")

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
        raise RuntimeError(
            f"SumatraPDF exited {result.returncode}: {result.stderr.decode(errors='replace')}"
        )


# ----------------------------------------------------------------------
# Job processing
# ----------------------------------------------------------------------


def process_job(client: PrintQClient, job: PrintJob, cfg: AgentConfig) -> None:
    work_dir = Path(cfg.work_dir)
    job_dir = work_dir / job.jobId
    job_dir.mkdir(parents=True, exist_ok=True)

    ext = Path(job.filename).suffix.lower()
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

    downloaded = job_dir / job.filename
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

    if not cfg.is_paired:
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

    def on_quit() -> None:
        global _running
        _running = False

    def on_repair() -> None:
        global _running
        clear_config()
        _running = False
        log.info("Config cleared — restart the agent to re-pair.")

    tray = TrayIcon(
        shop_name=cfg.shop_name or "PrintQ",
        on_quit=on_quit,
        on_repair=on_repair,
    )
    tray.run_detached()
    tray.set_status("yellow", "Connecting…")

    client = PrintQClient(cfg)
    hostname = os.environ.get("COMPUTERNAME", "")

    last_heartbeat = 0.0
    consecutive_errors = 0
    warned_no_printer = False

    while _running:
        now = time.time()

        if now - last_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
            try:
                client.heartbeat(list_installed_printers(), hostname)
                last_heartbeat = now
                consecutive_errors = 0
                tray.set_status("green", f"Connected — {cfg.shop_name}")
            except AgentAuthError:
                log.error("Auth rejected — check licence and pairing.")
                tray.set_status("red", "Auth rejected")
                time.sleep(30)
                continue
            except requests.RequestException as exc:
                consecutive_errors += 1
                log.warning("Heartbeat failed (%d): %s", consecutive_errors, exc)
                tray.set_status("yellow", "Connection issue")

        try:
            job = client.claim_next_job()
            warned_no_printer = False
        except NoPrinterConfigured as exc:
            # Work is waiting but the shop has not chosen a printer. Log once
            # per occurrence rather than every five seconds, and say so in the
            # tray where the owner will actually see it.
            if not warned_no_printer:
                log.error("%s", exc)
                warned_no_printer = True
            tray.set_status("yellow", "No printer selected in PrintQ")
            job = None
        except requests.RequestException as exc:
            log.warning("Job poll failed: %s", exc)
            job = None

        if job:
            log.info("Claimed job %s", job.jobId)
            tray.set_status("green", f"Printing job {job.jobId[:8]}…")
            try:
                process_job(client, job, cfg)
            except Exception:
                log.exception("Unhandled error processing job %s", job.jobId)
            tray.set_status("green", f"Connected — {cfg.shop_name}")

        time.sleep(POLL_INTERVAL_SECONDS)

    tray.stop()
    log.info("Agent stopped.")


if __name__ == "__main__":
    main()
