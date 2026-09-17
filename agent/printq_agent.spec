# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller build for PrintQ Agent.

A spec file rather than a pile of command-line flags, because the build runs
unattended in CI and the exact inputs need to be reviewable in the repository.

Two things here are not obvious and matter:

  - `app_ui` and `agent_service` are imported lazily inside main(), so that a
    headless run never needs tkinter. PyInstaller follows imports statically
    and would therefore leave them out entirely, producing an executable that
    starts and immediately dies with ModuleNotFoundError. They are listed
    explicitly below.

  - windowed=True means no console window. A shop double-clicking this must
    not get a black terminal box; that was the entire point of the exercise.
    Diagnostics go to %APPDATA%\\PrintQ\\agent.log instead.

Built by .github/workflows/agent-release.yml; `build.bat` runs the same thing
locally.
"""

import os

block_cipher = None

VERSION = os.environ.get("PRINTQ_AGENT_VERSION", "1.0.0")

a = Analysis(
    ["printq_agent.py"],
    pathex=["."],
    binaries=[],
    datas=[],
    hiddenimports=[
        # Lazily imported, so invisible to static analysis.
        "app_ui",
        "agent_service",
        "sumatra_setup",
        "pairing",
        # Windows printing and the tray backend.
        "win32print",
        "win32api",
        "pystray._win32",
        "PIL._tkinter_finder",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Nothing here is used, and each pulls in tens of MB.
        "numpy",
        "pandas",
        "matplotlib",
        "pytest",
        "setuptools",
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="PrintQAgent",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    # No console window.
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon="printq.ico" if os.path.exists("printq.ico") else None,
    version="file_version_info.txt" if os.path.exists("file_version_info.txt") else None,
)
