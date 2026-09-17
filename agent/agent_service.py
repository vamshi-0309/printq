"""
The agent's working loop, separated from whatever is watching it.

Before this, the loop lived inside main() and talked directly to the tray
icon. That was fine when the only interface was a coloured dot, but the shop
now gets a real window: the same loop has to drive a UI, a tray menu, and a
headless run, without any of them reaching into it.

So the loop lives here and publishes a Status snapshot. Callers read the
snapshot and are notified when it changes; they never touch the loop's
internals, and the loop knows nothing about tkinter.

Everything the loop actually does -- heartbeat cadence, claim, print, report
-- is the code that was already running in production, moved rather than
rewritten. The behaviour that has been tested end to end is deliberately
untouched.
"""

from __future__ import annotations

import copy
import threading
import time
from dataclasses import dataclass, field
from typing import Callable, Optional

import requests

import printq_agent as core
from config import AgentConfig, save_config

#: Rolling window of things worth showing on the activity screen.
MAX_ACTIVITY = 50


@dataclass
class Activity:
    at: float
    kind: str  # "printed" | "failed" | "claimed" | "info"
    text: str


@dataclass
class Status:
    """A consistent picture of the agent, safe to read from another thread."""

    state: str = "starting"
    detail: str = "Starting…"
    shop_name: str = ""
    server_url: str = ""
    paired: bool = False
    paused: bool = False
    last_heartbeat: Optional[float] = None
    printers: list = field(default_factory=list)
    current_job: Optional[str] = None
    activity: list = field(default_factory=list)
    #: The printer THIS SHOP has chosen on the server, echoed back by the
    #: heartbeat. The agent never decides this; it only displays it, so the
    #: window and the dashboard cannot disagree about what will print.
    selected_printer: Optional[str] = None

    @property
    def connected(self) -> bool:
        return self.state in ("connected", "printing")


StatusCallback = Callable[[Status], None]


class AgentService:
    """
    Runs the heartbeat/claim/print loop on a background thread.

    Start it, read snapshot(), and optionally pass on_change to be told when
    something moved. stop() asks it to finish the current cycle and exit.
    """

    def __init__(self, cfg: AgentConfig, on_change: Optional[StatusCallback] = None):
        self.cfg = cfg
        self._on_change = on_change
        self._lock = threading.RLock()
        self._status = Status(
            shop_name=cfg.shop_name,
            server_url=cfg.api_base_url,
            paired=cfg.is_paired,
            paused=bool(getattr(cfg, "paused", False)),
        )
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        # Set when the operator changes something the loop should notice at
        # once rather than after the current sleep.
        self._wake = threading.Event()

    # ---------------------------------------------------------------- state

    def snapshot(self) -> Status:
        """A copy, so a caller iterating printers cannot race the loop."""
        with self._lock:
            return copy.deepcopy(self._status)

    def _update(self, **fields) -> None:
        with self._lock:
            for key, value in fields.items():
                setattr(self._status, key, value)
            snapshot = copy.deepcopy(self._status)
        if self._on_change:
            # Outside the lock: a callback that repaints a window must never
            # be able to deadlock the print loop.
            try:
                self._on_change(snapshot)
            except Exception:  # a broken view must not stop printing
                core.log.exception("Status callback failed")

    def _note(self, kind: str, text: str) -> None:
        with self._lock:
            self._status.activity.insert(0, Activity(time.time(), kind, text))
            del self._status.activity[MAX_ACTIVITY:]
        self._update()

    # -------------------------------------------------------------- control

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="printq-agent", daemon=True)
        self._thread.start()

    def stop(self, timeout: float = 10.0) -> None:
        self._stop.set()
        self._wake.set()
        if self._thread:
            self._thread.join(timeout=timeout)

    def pause(self) -> None:
        self._set_paused(True)

    def resume(self) -> None:
        self._set_paused(False)

    def _set_paused(self, value: bool) -> None:
        self.cfg.paused = value
        if self.cfg.is_paired:
            save_config(self.cfg)
        self._update(paused=value, detail="Printing paused" if value else "Resuming…")
        self._note("info", "Printing paused" if value else "Printing resumed")
        self._wake.set()

    def refresh_printers(self) -> list:
        """Re-read Windows printers and push them to the server immediately."""
        printers = core.list_installed_printers()
        self._update(printers=printers)
        self._wake.set()
        return printers

    # ------------------------------------------------------------- the loop

    def _run(self) -> None:
        client = core.PrintQClient(self.cfg)
        hostname = core.os.environ.get("COMPUTERNAME", "")

        last_heartbeat = 0.0
        warned_no_printer = False

        while not self._stop.is_set():
            now = time.time()

            if now - last_heartbeat >= core.HEARTBEAT_INTERVAL_SECONDS:
                try:
                    printers = core.list_installed_printers()
                    reply = client.heartbeat(printers, hostname)
                    last_heartbeat = now
                    self._update(
                        state="connected",
                        detail=f"Connected — {self.cfg.shop_name or 'PrintQ'}",
                        last_heartbeat=now,
                        printers=printers,
                        selected_printer=(reply or {}).get("selected_printer"),
                    )
                except core.AgentAuthError:
                    core.log.error("Auth rejected — check licence and pairing.")
                    self._update(
                        state="auth_error",
                        detail="This computer is no longer authorised. Pair it again.",
                    )
                    self._sleep(30)
                    continue
                except requests.RequestException as exc:
                    core.log.warning("Heartbeat failed: %s", exc)
                    self._update(
                        state="offline",
                        detail="No connection to PrintQ. Retrying…",
                    )

            if self._status.paused:
                self._sleep(core.POLL_INTERVAL_SECONDS)
                continue

            try:
                job = client.claim_next_job()
                warned_no_printer = False
            except core.NoPrinterConfigured as exc:
                # Work is waiting but the shop has not chosen a printer. Said
                # once rather than every five seconds.
                if not warned_no_printer:
                    core.log.error("%s", exc)
                    self._note("failed", str(exc))
                    warned_no_printer = True
                self._update(state="no_printer", detail="No printer selected in PrintQ")
                job = None
            except requests.RequestException as exc:
                core.log.warning("Job poll failed: %s", exc)
                self._update(state="offline", detail="No connection to PrintQ. Retrying…")
                job = None

            if job:
                core.log.info("Claimed job %s", job.jobId)
                self._update(
                    state="printing",
                    detail=f"Printing job {job.jobId[:8]}…",
                    current_job=job.jobId,
                )
                self._note("claimed", f"Received {job.filename}")
                try:
                    core.process_job(client, job, self.cfg)
                    self._note("printed", f"Sent {job.filename} to the printer")
                except Exception as exc:
                    core.log.exception("Unhandled error processing job %s", job.jobId)
                    self._note("failed", f"{job.filename}: {exc}")
                self._update(
                    state="connected",
                    detail=f"Connected — {self.cfg.shop_name or 'PrintQ'}",
                    current_job=None,
                )

            self._sleep(core.POLL_INTERVAL_SECONDS)

        self._update(state="stopped", detail="Agent stopped")
        core.log.info("Agent stopped.")

    def _sleep(self, seconds: float) -> None:
        """Interruptible wait, so stop() and control changes are not delayed."""
        self._wake.wait(timeout=seconds)
        self._wake.clear()
