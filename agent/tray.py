"""
System tray icon for the PrintQ agent.

Shows a colored dot in the system tray:
  - Green: connected, polling for jobs
  - Yellow: connecting / heartbeat failed
  - Red: auth error or licence expired
  - Grey: stopped

Right-click menu: Status, Re-pair, Quit.
"""

from __future__ import annotations

import threading
from typing import Callable, Optional

from PIL import Image, ImageDraw

try:
    import pystray  # type: ignore
except ImportError:
    pystray = None


def _make_icon(color: str) -> Image.Image:
    size = 64
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    colors = {
        "green": (0, 152, 199),
        "yellow": (230, 180, 30),
        "red": (214, 0, 110),
        "grey": (160, 160, 160),
    }
    fill = colors.get(color, colors["grey"])
    draw.ellipse([8, 8, size - 8, size - 8], fill=fill)
    return img


class TrayIcon:
    def __init__(
        self,
        shop_name: str = "PrintQ Agent",
        on_quit: Optional[Callable[[], None]] = None,
        on_repair: Optional[Callable[[], None]] = None,
    ):
        self.shop_name = shop_name
        self._on_quit = on_quit
        self._on_repair = on_repair
        self._status_text = "Starting…"
        self._color = "grey"
        self._icon: Optional[pystray.Icon] = None

        if pystray is None:
            return

        self._icon = pystray.Icon(
            "printq",
            icon=_make_icon("grey"),
            title=f"PrintQ — {shop_name}",
            menu=pystray.Menu(
                pystray.MenuItem(lambda _: self._status_text, None, enabled=False),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Re-pair agent", lambda: self._on_repair() if self._on_repair else None),
                pystray.MenuItem("Quit", lambda: self._quit()),
            ),
        )

    def _quit(self) -> None:
        if self._icon:
            self._icon.stop()
        if self._on_quit:
            self._on_quit()

    def set_status(self, color: str, text: str) -> None:
        self._color = color
        self._status_text = text
        if self._icon:
            self._icon.icon = _make_icon(color)
            self._icon.title = f"PrintQ — {text}"

    def run_detached(self) -> None:
        if self._icon is None:
            return
        thread = threading.Thread(target=self._icon.run, daemon=True)
        thread.start()

    def stop(self) -> None:
        if self._icon:
            self._icon.stop()
