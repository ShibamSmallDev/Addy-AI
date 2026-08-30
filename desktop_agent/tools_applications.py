"""
Application control: launch and close common Windows applications.

Launch strategy is layered for robustness:
  1. Try a known executable / shell verb (fastest, most reliable).
  2. Fall back to the Windows "where"/App Paths lookup via `start`.

Closing uses taskkill on the matching process image name, with a graceful
grace period so apps can save work.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import time
from typing import Any, Dict

from .registry import ToolError, register

# Canonical app key -> (launch_command, kind)
#   kind == "exe"   : launch_command is the executable name (resolved via PATH/App Paths)
#   kind == "shell" : launch_command is a shell builtin verb run with cmd /c
#   kind == "uwp"   : launch_command is an apps-family activation string
APP_COMMANDS: Dict[str, Dict[str, str]] = {
    "notepad": {"exe": "notepad.exe", "image": "notepad.exe", "label": "Notepad"},
    "chrome": {"exe": "chrome.exe", "image": "chrome.exe", "label": "Google Chrome"},
    "edge": {"exe": "msedge.exe", "image": "msedge.exe", "label": "Microsoft Edge"},
    "vscode": {"exe": "code.cmd", "image": "Code.exe", "label": "Visual Studio Code"},
    "calculator": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "calc": {"shell": "calc", "image": "CalculatorApp.exe", "label": "Calculator"},
    "file explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "explorer": {"shell": "explorer", "image": "explorer.exe", "label": "File Explorer"},
    "task manager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "taskmanager": {"shell": "taskmgr", "image": "Taskmgr.exe", "label": "Task Manager"},
    "settings": {"uwp": "ms-settings:", "image": "SystemSettings.exe", "label": "Settings"},
    "command prompt": {"exe": "cmd.exe", "image": "cmd.exe", "label": "Command Prompt"},
    "cmd": {"exe": "cmd.exe", "image": "cmd.exe", "label": "Command Prompt"},
    "powershell": {"exe": "powershell.exe", "image": "powershell.exe", "label": "PowerShell"},
    "wordpad": {"shell": "write", "image": "wordpad.exe", "label": "WordPad"},
    "paint": {"shell": "mspaint", "image": "mspaint.exe", "label": "Paint"},
    "snipping tool": {"uwp": "ms-screenclip:", "image": "ScreenClippingHost.exe", "label": "Snipping Tool"},
}


def _resolve_app(key: str) -> Dict[str, str]:
    norm = (key or "").strip().lower()
    if norm in APP_COMMANDS:
        return APP_COMMANDS[norm]
    # Allow loose aliases (e.g. "code", "visual studio code").
    aliases = {
        "code": "vscode",
        "visual studio code": "vscode",
        "vs code": "vscode",
        "google chrome": "chrome",
        "microsoft edge": "edge",
        "calc": "calculator",
        "settings app": "settings",
        "file explorer": "file explorer",
        "windows explorer": "file explorer",
    }
    if norm in aliases and aliases[norm] in APP_COMMANDS:
        return APP_COMMANDS[aliases[norm]]
    raise ToolError(
        f"Unrecognized application '{key}'. Supported: "
        f"{', '.join(sorted({v['label'] for v in APP_COMMANDS.values()}))}."
    )


def _launch(spec: Dict[str, str]) -> None:
    try:
        if "exe" in spec:
            exe = spec["exe"]
            if shutil.which(exe) or exe.lower().endswith(".exe"):
                # Detached so we don't block the agent.
                subprocess.Popen(
                    [exe],
                    shell=False,
                    close_fds=True,
                    creationflags=getattr(subprocess, "DETACHED_PROCESS", 0)
                    | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
                )
            else:
                # e.g. `code.cmd` lives in PATH; rely on shell resolution.
                subprocess.Popen(f'start "" "{exe}"', shell=True, close_fds=True)
        elif "shell" in spec:
            subprocess.Popen(
                f'start "" {spec["shell"]}', shell=True, close_fds=True
            )
        elif "uwp" in spec:
            subprocess.Popen(
                f'start "" {spec["uwp"]}', shell=True, close_fds=True
            )
        else:
            raise ToolError(f"App spec for {spec.get('label')} is incomplete.")
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not launch {spec.get('label')}: {e}") from e


def _launch_via_start_menu(name: str) -> None:
    """Fallback: open Start menu, type the app name, press Enter."""
    import pyautogui
    pyautogui.press("win")
    time.sleep(0.5)
    pyautogui.typewrite(name, interval=0.03)
    time.sleep(0.4)
    pyautogui.press("enter")


@register("openApplication")
def open_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application")
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    try:
        spec = _resolve_app(str(name))
        _launch(spec)
        return {"result": f"{spec['label']} opened."}
    except ToolError:
        # Not in the known whitelist — fall back to Start menu search.
        _launch_via_start_menu(str(name))
        return {"result": f"Opened '{name}' via Start menu search."}


def _image_alive(image: str) -> bool:
    try:
        r = subprocess.run(
            f'tasklist /FI "IMAGENAME eq {image}" /NH',
            shell=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
        return image.lower() in r.stdout.lower()
    except Exception:
        return True  # assume alive if we can't check


@register("closeApplication")
def close_application(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name") or args.get("application")
    force = bool(args.get("force", False))
    if not name:
        raise ToolError("Parameter 'name' (application name) is required.")
    try:
        spec = _resolve_app(str(name))
        image = spec["image"]
    except ToolError:
        # Not in the whitelist — use the name itself as the process image.
        image = str(name).lower().strip()
        if not image.endswith(".exe"):
            image += ".exe"
        spec = {"label": str(name)}
    force_flag = " /F" if force else ""
    try:
        # Graceful close first (WM_CLOSE via taskkill, no /F so apps can save).
        subprocess.run(
            f'taskkill /IM "{image}"{force_flag}',
            shell=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not close {spec['label']}: {e}") from e
    # Wait up to ~2s for the process to actually exit.
    for _ in range(10):
        if not _image_alive(image):
            return {"result": f"Closed {spec['label']}."}
        time.sleep(0.2)
    if not force:
        raise ToolError(
            f"{spec['label']} is still running — it may have unsaved work or a prompt "
            f"window. Close it manually or retry with force=true."
        )
    # Force kill, then check one last time.
    try:
        subprocess.run(
            f'taskkill /IM "{image}" /F',
            shell=True,
            capture_output=True,
            timeout=10,
        )
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Could not force-close {spec['label']}: {e}") from e
    time.sleep(0.3)
    if _image_alive(image):
        raise ToolError(
            f"{spec['label']} is still running after force-close ({image}). "
            f"Try closing it manually."
        )
    return {"result": f"Closed {spec['label']}."}


__all__ = ["open_application", "close_application", "APP_COMMANDS"]
