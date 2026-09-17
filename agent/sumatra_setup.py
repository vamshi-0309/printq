"""
Getting SumatraPDF onto the shop's PC without the shop knowing what that is.

PrintQ prints by handing a PDF to SumatraPDF's silent-print CLI. That is an
implementation detail the person behind the counter should never meet: they
should not install it, find it, or type a path to it. So the agent manages a
copy itself, under %LOCALAPPDATA%\\PrintQ\\SumatraPDF.

WHY DOWNLOAD RATHER THAN BUNDLE
    SumatraPDF is GPLv3. Shipping its binary inside PrintQAgent-Setup.exe
    would make that installer a conveyed GPL work and oblige us to offer the
    corresponding source for it. Fetching the official build at install time
    (or first run) is a plain download by the user's own machine from the
    project's own site -- no redistribution, no obligation, and the shop gets
    an untampered upstream binary.

WHY A PINNED CHECKSUM
    This runs on a shop counter PC and produces an executable that is then
    launched. A download that is merely "over HTTPS from the right domain"
    still trusts whatever that domain serves on the day. The expected SHA-256
    is recorded here, and anything that does not match is discarded unread.
    Bumping SUMATRA_VERSION therefore requires deliberately recording the new
    hash -- which is the point.
"""

from __future__ import annotations

import hashlib
import io
import logging
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Callable, Optional

import requests

from config import MANAGED_SUMATRA_DIR, MANAGED_SUMATRA_EXE

log = logging.getLogger("printq-agent")

SUMATRA_VERSION = "3.6.1"

#: The official portable build. Verified to contain exactly one file, the
#: 64-bit executable.
SUMATRA_URL = (
    f"https://www.sumatrapdfreader.org/dl/rel/{SUMATRA_VERSION}"
    f"/SumatraPDF-{SUMATRA_VERSION}-64.zip"
)

#: sha256 of the .zip as published, and of the .exe inside it.
SUMATRA_ZIP_SHA256 = "98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544"
SUMATRA_EXE_SHA256 = "719f689b34f47be8ca105ce8484948474dafde0e106bab599e4a89326070c3d0"

#: Refuse anything wildly off before spending memory on it.
MAX_DOWNLOAD_BYTES = 40 * 1024 * 1024

ProgressCallback = Callable[[str], None]


class SumatraSetupError(RuntimeError):
    """SumatraPDF could not be provisioned, with a reason worth showing."""


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def is_installed() -> bool:
    """Is the agent-managed copy present?"""
    return MANAGED_SUMATRA_EXE.is_file()


def notice_text() -> str:
    """
    The attribution shown in the agent's About screen.

    Required because we direct the user's machine to fetch GPLv3 software and
    then drive it. Naming it and pointing at its source is both the honest
    thing and what the licence expects of a distributor of the combined
    experience.
    """
    return (
        f"PrintQ prints using SumatraPDF {SUMATRA_VERSION}, free software "
        "licensed under the GNU GPL v3.\n"
        "Downloaded from sumatrapdfreader.org. Source code and licence: "
        "https://github.com/sumatrapdfreader/sumatrapdf"
    )


def download_sumatra(
    progress: Optional[ProgressCallback] = None,
    *,
    url: str = SUMATRA_URL,
    expected_zip_sha256: Optional[str] = SUMATRA_ZIP_SHA256,
    expected_exe_sha256: Optional[str] = SUMATRA_EXE_SHA256,
    dest_dir: Optional[Path] = None,
) -> Path:
    """
    Fetch, verify and install the managed SumatraPDF. Returns its path.

    Raises SumatraSetupError with a message written for the shop, not for a
    log file, because it is shown in the agent window.
    """
    say = progress or (lambda _msg: None)
    target_dir = Path(dest_dir) if dest_dir else MANAGED_SUMATRA_DIR
    target_exe = target_dir / "SumatraPDF.exe"

    say("Downloading the printing component…")
    try:
        response = requests.get(url, timeout=120, stream=True)
        response.raise_for_status()

        declared = int(response.headers.get("Content-Length") or 0)
        if declared and declared > MAX_DOWNLOAD_BYTES:
            raise SumatraSetupError(
                "The printing component download looks wrong (too large). "
                "Check the internet connection and try again."
            )

        buffer = io.BytesIO()
        for chunk in response.iter_content(chunk_size=256 * 1024):
            buffer.write(chunk)
            if buffer.tell() > MAX_DOWNLOAD_BYTES:
                raise SumatraSetupError(
                    "The printing component download looks wrong (too large). "
                    "Check the internet connection and try again."
                )
        payload = buffer.getvalue()
    except requests.RequestException as exc:
        raise SumatraSetupError(
            "Could not download the printing component. Check this computer's "
            f"internet connection and try again.\n\n({exc})"
        ) from exc

    say("Checking the download…")
    if expected_zip_sha256 and _sha256(payload) != expected_zip_sha256:
        # Deliberately not retried and not written to disk.
        raise SumatraSetupError(
            "The printing component failed its security check and was discarded. "
            "Try again; if this keeps happening, contact PrintQ support."
        )

    try:
        archive = zipfile.ZipFile(io.BytesIO(payload))
        members = [m for m in archive.infolist() if m.filename.lower().endswith(".exe")]
        if len(members) != 1:
            raise SumatraSetupError("The printing component archive was not what we expected.")
        exe_bytes = archive.read(members[0])
    except zipfile.BadZipFile as exc:
        raise SumatraSetupError("The printing component download was corrupted.") from exc

    if expected_exe_sha256 and _sha256(exe_bytes) != expected_exe_sha256:
        raise SumatraSetupError(
            "The printing component failed its security check and was discarded."
        )

    if exe_bytes[:2] != b"MZ":
        raise SumatraSetupError("The printing component download was not a Windows program.")

    say("Installing the printing component…")
    target_dir.mkdir(parents=True, exist_ok=True)

    # Write beside the target and move into place, so a half-written file can
    # never be found and launched by the print path.
    fd, temp_name = tempfile.mkstemp(dir=str(target_dir), suffix=".part")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(exe_bytes)
        os.replace(temp_name, target_exe)
    except OSError as exc:
        try:
            os.unlink(temp_name)
        except OSError:
            pass
        raise SumatraSetupError(
            f"Could not save the printing component to {target_dir}.\n\n({exc})"
        ) from exc

    log.info("SumatraPDF %s installed at %s", SUMATRA_VERSION, target_exe)
    say("Printing component ready.")
    return target_exe


def ensure_sumatra(progress: Optional[ProgressCallback] = None) -> Optional[Path]:
    """
    Make sure something printable exists, without ever blocking a print job.

    Returns the managed path when it is present or was just installed, and
    None when it could not be provisioned -- in which case the agent's normal
    resolution order still applies, so a SumatraPDF the shop installed itself,
    or one the installer placed, continues to work untouched.
    """
    if is_installed():
        return MANAGED_SUMATRA_EXE

    try:
        return download_sumatra(progress)
    except SumatraSetupError as exc:
        log.warning("Could not provision SumatraPDF automatically: %s", exc)
        return None


def uninstall_managed() -> None:
    """Remove the managed copy. Used by the uninstaller."""
    if MANAGED_SUMATRA_DIR.exists():
        shutil.rmtree(MANAGED_SUMATRA_DIR, ignore_errors=True)
