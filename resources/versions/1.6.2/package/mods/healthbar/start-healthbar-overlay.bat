@echo off
rem SPDX-License-Identifier: AGPL-3.0-only. Copyright (C) 2026 the healthbar authors. See LICENSE.
rem Starts the healthbar overlay in the background with no window. Quit it from its tray icon (bottom right).
rem To start it automatically with Windows: press Win+R, type  shell:startup  and put a shortcut to this file there.
start "" powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0healthbar-overlay.ps1"
