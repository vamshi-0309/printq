"""
The PrintQ Agent window.

This is the whole product for the person behind the counter. They installed
something, it opened, and everything they need to do has to be on screen: pair
the computer, see that it is connected, pick the printer, and see that paper
came out. No terminal, no config file, no URL to know.

Built on tkinter because it ships with Python and survives PyInstaller
packaging without extra runtime dependencies -- a shop PC gets one executable,
not a toolchain. The styling is deliberately restrained and Windows-native:
PrintQ's ink/cyan palette on system fonts, rather than a web design
approximated badly in a widget toolkit.

Threading rule: tkinter may only be touched from the thread that made the
window. The agent loop runs elsewhere and reports through a queue that the UI
drains on a timer, so no worker ever calls a widget directly.
"""

from __future__ import annotations

import queue
import sys
import threading
import tkinter as tk
import webbrowser
from tkinter import messagebox, ttk
from typing import Optional

import requests

from agent_service import AgentService, Status
from config import (
    DEFAULT_SERVER_URL,
    AgentConfig,
    InvalidServerUrl,
    clear_config,
    load_config,
    normalize_base_url,
    save_config,
)
from version import AGENT_NAME, AGENT_VERSION

# PrintQ palette.
INK = "#0A1F3C"
INK_SOFT = "#2C3E5C"
CYAN = "#0098C7"
CYAN_DEEP = "#007DA6"
MAGENTA = "#D6006E"
PAPER = "#FFFFFF"
PAPER_GREY = "#EDF1F5"
LINE = "#D7E0E9"
GREEN = "#0F7B4F"
AMBER = "#8A6A00"

FONT = "Segoe UI"
MONO = "Consolas"


def _f(size: int, weight: str = "normal") -> tuple:
    return (FONT, size, weight)


class PrintQApp:
    def __init__(self, cfg: AgentConfig, start_minimised: bool = False):
        self.cfg = cfg
        self.service: Optional[AgentService] = None
        self._events: "queue.Queue[Status]" = queue.Queue()
        self._latest: Optional[Status] = None

        self.root = tk.Tk()
        self.root.title(f"{AGENT_NAME} {AGENT_VERSION}")
        self.root.configure(bg=PAPER)
        self.root.minsize(560, 520)
        self.root.geometry("640x580")
        self._set_icon()

        # Closing the window leaves the agent printing in the background; the
        # tray icon is how it comes back. Quitting is an explicit choice.
        self.root.protocol("WM_DELETE_WINDOW", self._on_close)

        self.container = tk.Frame(self.root, bg=PAPER)
        self.container.pack(fill="both", expand=True)

        if cfg.is_paired:
            self._show_main()
            self._start_service()
        else:
            self._show_pairing()

        if start_minimised:
            self.root.withdraw()

        self.root.after(200, self._drain_events)

    # ------------------------------------------------------------- plumbing

    def _set_icon(self) -> None:
        try:
            from PIL import Image, ImageDraw, ImageTk

            img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
            ImageDraw.Draw(img).ellipse([6, 6, 58, 58], fill=(0, 152, 199, 255))
            self._icon_ref = ImageTk.PhotoImage(img)
            self.root.iconphoto(True, self._icon_ref)
        except Exception:
            # An icon is not worth failing to start over.
            pass

    def _clear(self) -> None:
        for child in self.container.winfo_children():
            child.destroy()

    def _on_status(self, status: Status) -> None:
        """Called from the worker thread. Hands off; never touches widgets."""
        self._events.put(status)

    def _drain_events(self) -> None:
        latest = None
        try:
            while True:
                latest = self._events.get_nowait()
        except queue.Empty:
            pass
        if latest is not None:
            self._latest = latest
            self._render_status(latest)
        self.root.after(400, self._drain_events)

    def _start_service(self) -> None:
        self.service = AgentService(self.cfg, on_change=self._on_status)
        self.service.start()

    def _on_close(self) -> None:
        if self.service is None:
            self.quit()
            return
        self.root.withdraw()

    def show(self) -> None:
        self.root.deiconify()
        self.root.lift()
        self.root.focus_force()

    def quit(self) -> None:
        if self.service:
            self.service.stop(timeout=3)
        try:
            self.root.destroy()
        except tk.TclError:
            pass

    def run(self) -> None:
        self.root.mainloop()

    # ------------------------------------------------------- pairing screen

    def _show_pairing(self) -> None:
        self._clear()
        wrap = tk.Frame(self.container, bg=PAPER, padx=36, pady=30)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text="Connect this computer", font=_f(19, "bold"), bg=PAPER, fg=INK).pack(anchor="w")
        tk.Label(
            wrap,
            text="Open your PrintQ dashboard, go to Agent, and enter the pairing code shown there.",
            font=_f(10), bg=PAPER, fg=INK_SOFT, wraplength=480, justify="left",
        ).pack(anchor="w", pady=(6, 24))

        tk.Label(wrap, text="PAIRING CODE", font=(FONT, 8, "bold"), bg=PAPER, fg=INK_SOFT).pack(anchor="w")
        self.code_var = tk.StringVar()
        code_entry = tk.Entry(
            wrap, textvariable=self.code_var, width=10, font=(MONO, 26, "bold"),
            justify="center", relief="solid", bd=1,
        )
        code_entry.pack(anchor="w", pady=(6, 4), ipady=6)
        code_entry.focus_set()
        tk.Label(wrap, text="6 characters, e.g. 4F2A9C", font=_f(9), bg=PAPER, fg=INK_SOFT).pack(anchor="w")

        self.pair_status = tk.StringVar()
        tk.Label(
            wrap, textvariable=self.pair_status, font=_f(10), bg=PAPER, fg=MAGENTA,
            wraplength=480, justify="left",
        ).pack(anchor="w", pady=(16, 0))

        self.pair_btn = tk.Button(
            wrap, text="Connect", font=_f(11, "bold"), bg=CYAN, fg=PAPER,
            activebackground=CYAN_DEEP, activeforeground=PAPER,
            relief="flat", padx=28, pady=9, cursor="hand2", command=self._do_pair,
        )
        self.pair_btn.pack(anchor="w", pady=(18, 0))
        self.root.bind("<Return>", lambda _e: self._do_pair())

        # The server address is fixed for an installed agent. It stays
        # reachable for development, but folded away so nobody at a shop
        # counter is ever invited to wonder what to type here.
        advanced = tk.Frame(wrap, bg=PAPER)
        advanced.pack(anchor="w", fill="x", pady=(28, 0))
        self.url_var = tk.StringVar(value=self.cfg.api_base_url or DEFAULT_SERVER_URL)
        self._advanced_open = False

        def toggle() -> None:
            self._advanced_open = not self._advanced_open
            if self._advanced_open:
                url_row.pack(anchor="w", fill="x", pady=(8, 0))
                toggle_btn.config(text="▾ Advanced")
            else:
                url_row.pack_forget()
                toggle_btn.config(text="▸ Advanced")

        toggle_btn = tk.Label(
            advanced, text="▸ Advanced", font=_f(9), bg=PAPER, fg=INK_SOFT, cursor="hand2"
        )
        toggle_btn.pack(anchor="w")
        toggle_btn.bind("<Button-1>", lambda _e: toggle())

        url_row = tk.Frame(advanced, bg=PAPER)
        tk.Label(url_row, text="PrintQ server", font=_f(9), bg=PAPER, fg=INK_SOFT).pack(anchor="w")
        tk.Entry(url_row, textvariable=self.url_var, width=46, font=_f(10), relief="solid", bd=1).pack(
            anchor="w", pady=(3, 0), ipady=3
        )

        tk.Label(
            wrap, text=f"{AGENT_NAME} {AGENT_VERSION}", font=_f(8), bg=PAPER, fg="#8FA0B4"
        ).pack(side="bottom", anchor="w")

    def _do_pair(self) -> None:
        code = self.code_var.get().strip().upper().replace("-", "").replace(" ", "")
        if len(code) != 6:
            self.pair_status.set("Enter the 6-character code from your dashboard.")
            return

        try:
            base_url = normalize_base_url(self.url_var.get())
        except InvalidServerUrl as exc:
            self.pair_status.set(str(exc))
            return

        self.pair_btn.config(state="disabled", text="Connecting…")
        self.pair_status.set("")
        self.root.update_idletasks()

        # Off the UI thread so the window keeps painting during the request.
        def work() -> None:
            try:
                resp = requests.post(
                    f"{base_url}/api/agent/pair",
                    json={"pairing_code": code},
                    timeout=20,
                )
            except requests.RequestException as exc:
                self.root.after(0, lambda: self._pair_failed(
                    "Could not reach PrintQ. Check this computer's internet connection."
                    f"\n\n({exc})"
                ))
                return

            if resp.status_code != 200:
                try:
                    message = resp.json().get("error") or f"Pairing failed ({resp.status_code})."
                except ValueError:
                    message = f"Pairing failed ({resp.status_code})."
                self.root.after(0, lambda: self._pair_failed(message))
                return

            data = resp.json()
            # The address typed here is authoritative; the server's suggested
            # apiBaseUrl is only a hint and has pointed at dead tunnels before.
            cfg = AgentConfig(
                api_base_url=base_url,
                shop_id=data["shopId"],
                shop_name=data.get("shopName", ""),
                agent_id=data["agentId"],
                agent_secret=data["agentSecret"],
            )
            save_config(cfg)
            self.root.after(0, lambda: self._pair_succeeded(cfg))

        threading.Thread(target=work, daemon=True).start()

    def _pair_failed(self, message: str) -> None:
        self.pair_status.set(message)
        self.pair_btn.config(state="normal", text="Connect")

    def _pair_succeeded(self, cfg: AgentConfig) -> None:
        self.cfg = cfg
        self.root.unbind("<Return>")
        self._show_main()
        self._start_service()

    # ---------------------------------------------------------- main screen

    def _show_main(self) -> None:
        self._clear()

        header = tk.Frame(self.container, bg=INK, padx=22, pady=14)
        header.pack(fill="x")
        tk.Label(header, text=AGENT_NAME, font=_f(13, "bold"), bg=INK, fg=PAPER).pack(anchor="w")
        self.header_shop = tk.Label(
            header, text=self.cfg.shop_name or "", font=_f(9), bg=INK, fg="#9DB4CC"
        )
        self.header_shop.pack(anchor="w")

        self.status_dot = tk.Label(header, text="●  Starting…", font=_f(10, "bold"), bg=INK, fg="#9DB4CC")
        self.status_dot.pack(anchor="w", pady=(8, 0))

        style = ttk.Style()
        try:
            style.theme_use("clam")
        except tk.TclError:
            pass
        style.configure("TNotebook", background=PAPER, borderwidth=0)
        style.configure("TNotebook.Tab", font=_f(10), padding=(16, 8))

        self.tabs = ttk.Notebook(self.container)
        self.tabs.pack(fill="both", expand=True, padx=0, pady=0)

        self.tab_status = tk.Frame(self.tabs, bg=PAPER)
        self.tab_printers = tk.Frame(self.tabs, bg=PAPER)
        self.tab_activity = tk.Frame(self.tabs, bg=PAPER)
        self.tab_about = tk.Frame(self.tabs, bg=PAPER)
        self.tabs.add(self.tab_status, text="Status")
        self.tabs.add(self.tab_printers, text="Printers")
        self.tabs.add(self.tab_activity, text="Activity")
        self.tabs.add(self.tab_about, text="About")

        self._build_status_tab()
        self._build_printers_tab()
        self._build_activity_tab()
        self._build_about_tab()

    def _build_status_tab(self) -> None:
        wrap = tk.Frame(self.tab_status, bg=PAPER, padx=24, pady=22)
        wrap.pack(fill="both", expand=True)

        self.state_title = tk.Label(wrap, text="Connecting…", font=_f(16, "bold"), bg=PAPER, fg=INK)
        self.state_title.pack(anchor="w")
        self.state_detail = tk.Label(
            wrap, text="", font=_f(10), bg=PAPER, fg=INK_SOFT, wraplength=520, justify="left"
        )
        self.state_detail.pack(anchor="w", pady=(6, 18))

        card = tk.Frame(wrap, bg=PAPER_GREY, padx=18, pady=16)
        card.pack(fill="x")
        self.fact_rows = {}
        for key, label in (
            ("computer", "Computer"),
            ("printer", "PrintQ printer"),
            ("heartbeat", "Last contact"),
        ):
            row = tk.Frame(card, bg=PAPER_GREY)
            row.pack(fill="x", pady=3)
            tk.Label(row, text=label, font=_f(9), bg=PAPER_GREY, fg=INK_SOFT, width=15, anchor="w").pack(side="left")
            value = tk.Label(row, text="—", font=(MONO, 10), bg=PAPER_GREY, fg=INK, anchor="w")
            value.pack(side="left", fill="x", expand=True)
            self.fact_rows[key] = value

        buttons = tk.Frame(wrap, bg=PAPER)
        buttons.pack(anchor="w", pady=(22, 0))
        self.pause_btn = tk.Button(
            buttons, text="Pause printing", font=_f(10), bg=PAPER, fg=INK,
            relief="solid", bd=1, padx=16, pady=6, cursor="hand2", command=self._toggle_pause,
        )
        self.pause_btn.pack(side="left")
        tk.Button(
            buttons, text="Disconnect this computer", font=_f(10), bg=PAPER, fg=MAGENTA,
            relief="solid", bd=1, padx=16, pady=6, cursor="hand2", command=self._unpair,
        ).pack(side="left", padx=(10, 0))

    def _build_printers_tab(self) -> None:
        wrap = tk.Frame(self.tab_printers, bg=PAPER, padx=24, pady=22)
        wrap.pack(fill="both", expand=True)

        tk.Label(wrap, text="Printers on this computer", font=_f(14, "bold"), bg=PAPER, fg=INK).pack(anchor="w")
        tk.Label(
            wrap,
            text="PrintQ sends every job to the printer marked as default. "
                 "Printers that ask you to pick a file cannot be used.",
            font=_f(9), bg=PAPER, fg=INK_SOFT, wraplength=520, justify="left",
        ).pack(anchor="w", pady=(4, 14))

        self.printer_list = tk.Frame(wrap, bg=PAPER)
        self.printer_list.pack(fill="both", expand=True)

        controls = tk.Frame(wrap, bg=PAPER)
        controls.pack(anchor="w", pady=(14, 0))
        tk.Button(
            controls, text="Refresh printers", font=_f(10), bg=PAPER, fg=INK,
            relief="solid", bd=1, padx=16, pady=6, cursor="hand2",
            command=self._refresh_printers,
        ).pack(side="left")
        self.printer_status = tk.Label(wrap, text="", font=_f(9), bg=PAPER, fg=INK_SOFT,
                                       wraplength=520, justify="left")
        self.printer_status.pack(anchor="w", pady=(10, 0))

    def _build_activity_tab(self) -> None:
        wrap = tk.Frame(self.tab_activity, bg=PAPER, padx=24, pady=22)
        wrap.pack(fill="both", expand=True)
        tk.Label(wrap, text="Recent print jobs", font=_f(14, "bold"), bg=PAPER, fg=INK).pack(anchor="w")
        self.activity_box = tk.Frame(wrap, bg=PAPER)
        self.activity_box.pack(fill="both", expand=True, pady=(12, 0))
        self.activity_empty = tk.Label(
            self.activity_box, text="Nothing yet. Jobs appear here as they print.",
            font=_f(10), bg=PAPER, fg=INK_SOFT,
        )
        self.activity_empty.pack(anchor="w")

    def _build_about_tab(self) -> None:
        from sumatra_setup import notice_text

        wrap = tk.Frame(self.tab_about, bg=PAPER, padx=24, pady=22)
        wrap.pack(fill="both", expand=True)
        tk.Label(wrap, text=AGENT_NAME, font=_f(14, "bold"), bg=PAPER, fg=INK).pack(anchor="w")
        tk.Label(wrap, text=f"Version {AGENT_VERSION}", font=(MONO, 10), bg=PAPER, fg=INK_SOFT).pack(anchor="w")

        tk.Label(wrap, text="Server", font=_f(9, "bold"), bg=PAPER, fg=INK).pack(anchor="w", pady=(16, 2))
        tk.Label(wrap, text=self.cfg.api_base_url, font=(MONO, 9), bg=PAPER, fg=INK_SOFT).pack(anchor="w")

        link = tk.Label(
            wrap, text="Open PrintQ dashboard", font=_f(10, "bold"), bg=PAPER, fg=CYAN, cursor="hand2"
        )
        link.pack(anchor="w", pady=(16, 0))
        link.bind("<Button-1>", lambda _e: webbrowser.open(f"{self.cfg.api_base_url}/dashboard"))

        tk.Label(wrap, text="Open source notice", font=_f(9, "bold"), bg=PAPER, fg=INK).pack(anchor="w", pady=(22, 4))
        tk.Label(
            wrap, text=notice_text(), font=_f(8), bg=PAPER, fg=INK_SOFT,
            wraplength=520, justify="left",
        ).pack(anchor="w")

    # ------------------------------------------------------------- updating

    def _render_status(self, status: Status) -> None:
        colours = {
            "connected": (GREEN, "●  Connected"),
            "printing": (CYAN, "●  Printing"),
            "offline": (MAGENTA, "✕  Disconnected"),
            "auth_error": (MAGENTA, "⚠  Attention required"),
            "no_printer": (AMBER, "⚠  No printer selected"),
            "paused": (AMBER, "❚❚  Paused"),
            "stopped": ("#9DB4CC", "●  Stopped"),
        }
        key = "paused" if status.paused else status.state
        colour, text = colours.get(key, ("#9DB4CC", "●  Starting…"))

        if hasattr(self, "status_dot"):
            self.status_dot.config(text=text, fg=colour)
        if hasattr(self, "state_title"):
            headline = {
                "connected": "Ready to print",
                "printing": "Printing a job",
                "offline": "Not connected to PrintQ",
                "auth_error": "This computer needs pairing again",
                "no_printer": "Choose a printer",
                "paused": "Printing is paused",
                "stopped": "Agent stopped",
            }.get(key, "Starting…")
            self.state_title.config(text=headline)
            self.state_detail.config(text=status.detail)

        if hasattr(self, "fact_rows"):
            import os as _os

            self.fact_rows["computer"].config(text=_os.environ.get("COMPUTERNAME", "this PC"))
            selected = getattr(status, "selected_printer", None)
            self.fact_rows["printer"].config(text=selected or "not chosen yet")
            if status.last_heartbeat:
                import time as _time

                age = int(_time.time() - status.last_heartbeat)
                self.fact_rows["heartbeat"].config(
                    text="just now" if age < 45 else f"{age // 60} min ago"
                )
            else:
                self.fact_rows["heartbeat"].config(text="not yet")

        if hasattr(self, "pause_btn"):
            self.pause_btn.config(text="Resume printing" if status.paused else "Pause printing")

        self._render_printers(status)
        self._render_activity(status)

    def _render_printers(self, status: Status) -> None:
        if not hasattr(self, "printer_list"):
            return
        for child in self.printer_list.winfo_children():
            child.destroy()

        if not status.printers:
            tk.Label(
                self.printer_list,
                text="No printers found yet. Make sure a printer is installed in Windows, then Refresh.",
                font=_f(10), bg=PAPER, fg=INK_SOFT, wraplength=520, justify="left",
            ).pack(anchor="w")
            return

        import printq_agent as core

        selected = getattr(status, "selected_printer", None)
        self._printer_choice = getattr(self, "_printer_choice", tk.StringVar())
        if selected and not self._printer_choice.get():
            self._printer_choice.set(selected)

        for printer in status.printers:
            name = printer.get("system_name", "")
            port = core.printer_port(name)
            interactive = bool(port) and port.strip().upper() in core.INTERACTIVE_PRINTER_PORTS

            row = tk.Frame(self.printer_list, bg=PAPER_GREY if interactive else PAPER,
                           highlightbackground=LINE, highlightthickness=1, padx=12, pady=9)
            row.pack(fill="x", pady=3)

            if interactive:
                tk.Label(row, text="⚠", font=_f(11), bg=PAPER_GREY, fg=AMBER).pack(side="left", padx=(0, 8))
                text_bg = PAPER_GREY
            else:
                tk.Radiobutton(
                    row, variable=self._printer_choice, value=name, bg=PAPER,
                    activebackground=PAPER, command=self._choose_printer,
                ).pack(side="left", padx=(0, 6))
                text_bg = PAPER

            box = tk.Frame(row, bg=text_bg)
            box.pack(side="left", fill="x", expand=True)
            tk.Label(box, text=name, font=_f(10, "bold"), bg=text_bg, fg=INK, anchor="w").pack(anchor="w")

            if interactive:
                note = ("This printer asks you to choose a file each time, so PrintQ "
                        "cannot use it for automatic printing.")
                colour = AMBER
            elif name == selected:
                note = "PrintQ prints to this printer"
                colour = GREEN
            else:
                note = "Ready"
                colour = INK_SOFT
            tk.Label(box, text=note, font=_f(9), bg=text_bg, fg=colour,
                     wraplength=430, justify="left", anchor="w").pack(anchor="w")

    def _render_activity(self, status: Status) -> None:
        if not hasattr(self, "activity_box"):
            return
        for child in self.activity_box.winfo_children():
            child.destroy()

        if not status.activity:
            tk.Label(
                self.activity_box, text="Nothing yet. Jobs appear here as they print.",
                font=_f(10), bg=PAPER, fg=INK_SOFT,
            ).pack(anchor="w")
            return

        import time as _time

        icons = {"printed": ("✓", GREEN), "failed": ("✕", MAGENTA),
                 "claimed": ("●", CYAN), "info": ("•", INK_SOFT)}
        for item in status.activity[:20]:
            mark, colour = icons.get(item.kind, ("•", INK_SOFT))
            row = tk.Frame(self.activity_box, bg=PAPER)
            row.pack(fill="x", pady=2)
            tk.Label(row, text=mark, font=_f(10, "bold"), bg=PAPER, fg=colour, width=2).pack(side="left")
            tk.Label(row, text=item.text, font=_f(9), bg=PAPER, fg=INK, anchor="w",
                     wraplength=420, justify="left").pack(side="left", fill="x", expand=True)
            tk.Label(row, text=_time.strftime("%H:%M", _time.localtime(item.at)),
                     font=(MONO, 8), bg=PAPER, fg=INK_SOFT).pack(side="right")

    # -------------------------------------------------------------- actions

    def _toggle_pause(self) -> None:
        if not self.service:
            return
        if self.service.snapshot().paused:
            self.service.resume()
        else:
            self.service.pause()

    def _refresh_printers(self) -> None:
        if not self.service:
            return
        found = self.service.refresh_printers()
        self.printer_status.config(
            text=f"Found {len(found)} printer{'' if len(found) == 1 else 's'}. "
                 "PrintQ is told about them automatically."
        )

    def _choose_printer(self) -> None:
        """Ask the server to make the chosen printer this shop's default."""
        if not self.service:
            return
        name = self._printer_choice.get()
        self.printer_status.config(text=f"Setting {name} as the PrintQ printer…")
        self.root.update_idletasks()

        def work() -> None:
            try:
                resp = requests.post(
                    f"{self.cfg.api_base_url}/api/agent/printers/default",
                    headers={
                        "X-PrintQ-Shop-Id": self.cfg.shop_id,
                        "X-PrintQ-Agent-Id": self.cfg.agent_id,
                        "X-PrintQ-Agent-Secret": self.cfg.agent_secret,
                        "Content-Type": "application/json",
                    },
                    json={"system_name": name},
                    timeout=20,
                )
                if resp.status_code == 200:
                    message = f"PrintQ now prints to {name}."
                else:
                    try:
                        message = resp.json().get("error") or f"Could not change the printer ({resp.status_code})."
                    except ValueError:
                        message = f"Could not change the printer ({resp.status_code})."
            except requests.RequestException as exc:
                message = f"Could not reach PrintQ. ({exc})"

            self.root.after(0, lambda: self.printer_status.config(text=message))
            if self.service:
                self.service.refresh_printers()

        threading.Thread(target=work, daemon=True).start()

    def _unpair(self) -> None:
        if not messagebox.askyesno(
            "Disconnect this computer",
            "PrintQ will stop printing on this computer until you pair it again.\n\nDisconnect?",
        ):
            return
        if self.service:
            self.service.stop(timeout=3)
            self.service = None
        clear_config()
        self.cfg = load_config()
        self._show_pairing()


def run(cfg: AgentConfig, start_minimised: bool = False) -> None:
    """Launch the window. Returns when the user quits."""
    app = PrintQApp(cfg, start_minimised=start_minimised)

    # The tray keeps the agent alive after the window is closed, which is what
    # lets a shop shut the window and still receive jobs.
    try:
        from tray import TrayIcon

        tray = TrayIcon(
            shop_name=cfg.shop_name or "PrintQ",
            on_quit=lambda: app.root.after(0, app.quit),
            on_repair=lambda: app.root.after(0, app.show),
        )
        tray.run_detached()

        def mirror(status: Status) -> None:
            colour = {
                "connected": "green", "printing": "green", "offline": "yellow",
                "auth_error": "red", "no_printer": "yellow", "stopped": "grey",
            }.get(status.state, "grey")
            tray.set_status(colour, status.detail)

        original = app._on_status

        def both(status: Status) -> None:
            original(status)
            mirror(status)

        app._on_status = both  # type: ignore[method-assign]
        if app.service:
            app.service._on_change = both
    except Exception:
        tray = None

    try:
        app.run()
    finally:
        if tray:
            tray.stop()


if __name__ == "__main__":
    run(load_config(), start_minimised="--minimised" in sys.argv)
