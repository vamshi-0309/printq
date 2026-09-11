"""
First-run pairing dialog using tkinter.

Shows a simple window where the shop owner enters:
  1. The PrintQ server URL (pre-filled with printq.in)
  2. The 6-character pairing code from their dashboard

On success, stores credentials via config.save_config() and closes.
"""

from __future__ import annotations

import tkinter as tk
from tkinter import messagebox
from typing import Optional

import requests

from config import AgentConfig, InvalidServerUrl, normalize_base_url, save_config


class PairingDialog:
    def __init__(self) -> None:
        self.result: Optional[AgentConfig] = None

        self.root = tk.Tk()
        self.root.title("PrintQ Agent — Pair with shop")
        self.root.resizable(False, False)
        self.root.configure(bg="#EDF1F5")

        frame = tk.Frame(self.root, bg="#EDF1F5", padx=30, pady=24)
        frame.pack()

        tk.Label(
            frame, text="PrintQ Agent Setup", font=("Segoe UI", 14, "bold"),
            bg="#EDF1F5", fg="#0A1F3C",
        ).pack(anchor="w")

        tk.Label(
            frame, text="Enter the pairing code from your PrintQ dashboard.",
            font=("Segoe UI", 9), bg="#EDF1F5", fg="#555",
        ).pack(anchor="w", pady=(4, 16))

        tk.Label(frame, text="Server URL", font=("Segoe UI", 9), bg="#EDF1F5", fg="#0A1F3C").pack(anchor="w")
        self.url_var = tk.StringVar(value="https://printq.in")
        tk.Entry(frame, textvariable=self.url_var, width=36, font=("Segoe UI", 10)).pack(anchor="w", pady=(2, 12))

        tk.Label(frame, text="Pairing code", font=("Segoe UI", 9), bg="#EDF1F5", fg="#0A1F3C").pack(anchor="w")
        self.code_var = tk.StringVar()
        code_entry = tk.Entry(
            frame, textvariable=self.code_var, width=12,
            font=("Consolas", 16, "bold"), justify="center",
        )
        code_entry.pack(anchor="w", pady=(2, 20))
        code_entry.focus_set()

        self.status_var = tk.StringVar()
        tk.Label(frame, textvariable=self.status_var, font=("Segoe UI", 9), bg="#EDF1F5", fg="#D6006E").pack(anchor="w")

        btn_frame = tk.Frame(frame, bg="#EDF1F5")
        btn_frame.pack(fill="x", pady=(8, 0))

        self.pair_btn = tk.Button(
            btn_frame, text="Pair", font=("Segoe UI", 10, "bold"),
            bg="#0098C7", fg="white", relief="flat", padx=20, pady=6,
            command=self._on_pair,
        )
        self.pair_btn.pack(side="right")

        tk.Button(
            btn_frame, text="Cancel", font=("Segoe UI", 10),
            relief="flat", padx=12, pady=6,
            command=self.root.destroy,
        ).pack(side="right", padx=(0, 8))

        self.root.bind("<Return>", lambda _: self._on_pair())

    def _on_pair(self) -> None:
        code = self.code_var.get().strip().upper()

        if not code or len(code) != 6:
            self.status_var.set("Enter a 6-character pairing code.")
            return

        try:
            base_url = normalize_base_url(self.url_var.get())
        except InvalidServerUrl as exc:
            self.status_var.set(str(exc))
            return

        self.pair_btn.config(state="disabled", text="Pairing…")
        self.status_var.set("")
        self.root.update()

        try:
            resp = requests.post(
                f"{base_url}/api/agent/pair",
                json={"pairing_code": code},
                timeout=15,
            )
        except requests.RequestException as exc:
            self.status_var.set(f"Connection failed: {exc}")
            self.pair_btn.config(state="normal", text="Pair")
            return

        if resp.status_code != 200:
            error = resp.json().get("error", "Pairing failed.") if resp.headers.get("content-type", "").startswith("application/json") else f"Server error ({resp.status_code})"
            self.status_var.set(error)
            self.pair_btn.config(state="normal", text="Pair")
            return

        data = resp.json()

        # The URL typed above is authoritative. The server also returns an
        # `apiBaseUrl` (its NEXT_PUBLIC_APP_URL, used for Cashfree return and
        # webhook URLs), but honouring it here silently pointed the agent at a
        # public tunnel address instead of the server the operator chose — and
        # when that tunnel was down, every heartbeat failed with 503. It is
        # treated as a suggestion only, and noted when it differs.
        suggested = str(data.get("apiBaseUrl") or "").rstrip("/")
        if suggested and suggested != base_url:
            print(
                f"[pairing] server suggested {suggested}; keeping the entered URL {base_url}"
            )

        cfg = AgentConfig(
            api_base_url=base_url,
            shop_id=data["shopId"],
            shop_name=data.get("shopName", ""),
            agent_id=data["agentId"],
            agent_secret=data["agentSecret"],
        )
        save_config(cfg)
        self.result = cfg

        messagebox.showinfo(
            "Paired successfully",
            f"Agent paired with {cfg.shop_name or 'your shop'}.\n\n"
            "The agent will now start and appear in your system tray.",
        )
        self.root.destroy()

    def run(self) -> Optional[AgentConfig]:
        self.root.mainloop()
        return self.result
