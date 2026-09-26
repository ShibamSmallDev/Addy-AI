"""
Window management: enumerate, focus, snap, minimize, maximize, and close desktop windows.

Uses Win32 user32/dwmapi with ctypes for robust window enumeration and
foreground management, and psutil for process inspection.
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import os
import platform
import subprocess
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from .registry import ToolError, register

SW_MINIMIZE = 6
SW_MAXIMIZE = 3
SW_RESTORE = 9
SW_HIDE = 0
SW_SHOW = 5
DWMWA_CLOAKED = 14


class RECT(ctypes.Structure):
    _fields_ = [
        ("left", ctypes.c_long),
        ("top", ctypes.c_long),
        ("right", ctypes.c_long),
        ("bottom", ctypes.c_long),
    ]


def _is_cloaked(hwnd: int) -> bool:
    """Return True if window is cloaked (hidden virtual desktop, minimized UWP app, etc.)."""
    try:
        cloaked = ctypes.c_int(0)
        res = ctypes.windll.dwmapi.DwmGetWindowAttribute(
            hwnd, DWMWA_CLOAKED, ctypes.byref(cloaked), ctypes.sizeof(cloaked)
        )
        return res == 0 and cloaked.value != 0
    except Exception:
        return False


def _get_foreground_window():
    if platform.system() != "Windows":
        return None
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        if not hwnd or not user32.IsWindow(hwnd):
            return None
        return hwnd
    except Exception:
        return None


def _window_title(hwnd: int) -> str:
    if platform.system() != "Windows" or not hwnd:
        return ""
    try:
        user32 = ctypes.windll.user32
        length = user32.GetWindowTextLengthW(hwnd)
        if length <= 0:
            return ""
        buff = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buff, length + 1)
        return buff.value
    except Exception:
        return ""


def _get_window_process(hwnd: int) -> Tuple[int, str]:
    if platform.system() != "Windows":
        return 0, ""
    try:
        pid = wintypes.DWORD()
        ctypes.windll.user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        if not pid.value:
            return 0, ""
        proc_name = ""
        try:
            import psutil

            proc_name = psutil.Process(pid.value).name()
        except Exception:
            pass
        return pid.value, proc_name
    except Exception:
        return 0, ""


def _get_window_info(hwnd: int) -> Optional[Dict[str, Any]]:
    try:
        user32 = ctypes.windll.user32
        if not user32.IsWindow(hwnd) or not user32.IsWindowVisible(hwnd):
            return None
        if _is_cloaked(hwnd):
            return None

        title = _window_title(hwnd).strip()
        if not title:
            return None

        rc = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rc))
        w = rc.right - rc.left
        h = rc.bottom - rc.top
        if w <= 0 or h <= 0:
            return None

        pid, proc_name = _get_window_process(hwnd)
        fg_hwnd = user32.GetForegroundWindow()
        is_iconic = bool(user32.IsIconic(hwnd))

        return {
            "hwnd": hwnd,
            "title": title,
            "pid": pid,
            "process_name": proc_name,
            "rect": {
                "left": rc.left,
                "top": rc.top,
                "right": rc.right,
                "bottom": rc.bottom,
                "width": w,
                "height": h,
            },
            "is_minimized": is_iconic,
            "is_foreground": hwnd == fg_hwnd,
        }
    except Exception:
        return None


def _enumerate_windows() -> List[Dict[str, Any]]:
    """Enumerate visible windows across the user interactive desktop."""
    if platform.system() != "Windows":
        return []

    user32 = ctypes.windll.user32
    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    windows: List[Dict[str, Any]] = []

    def cb(hwnd, _):
        info = _get_window_info(hwnd)
        if info and info["rect"]["width"] > 50 and info["rect"]["height"] > 50:
            windows.append(info)
        return True

    proc = WNDENUMPROC(cb)

    # First try opening default desktop to ensure access in non-interactive subshells
    DESKTOP_ENUMERATE = 0x0100
    desk = user32.OpenDesktopW("default", 0, False, DESKTOP_ENUMERATE)
    if desk:
        try:
            user32.EnumDesktopWindows(desk, proc, 0)
        finally:
            user32.CloseDesktop(desk)

    # Also run standard EnumWindows if no windows found
    if not windows:
        user32.EnumWindows(proc, 0)

    return windows


def _show_window(hwnd: int, cmd: int) -> None:
    try:
        ctypes.windll.user32.ShowWindow(hwnd, cmd)
    except Exception as e:
        raise ToolError(f"Could not change window state: {e}")


def _close_window_hwnd(hwnd: int) -> None:
    try:
        WM_CLOSE = 0x0010
        ctypes.windll.user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
    except Exception as e:
        raise ToolError(f"Could not close window: {e}")


def _find_window(
    query: str, pid: Optional[int] = None, process_name: Optional[str] = None
) -> Optional[Dict[str, Any]]:
    windows = _enumerate_windows()
    if pid:
        for w in windows:
            if w["pid"] == pid:
                return w
    if process_name:
        q_proc = process_name.lower()
        for w in windows:
            if q_proc in w["process_name"].lower():
                return w
    if query:
        q = query.lower()
        # Exact title match
        for w in windows:
            if q == w["title"].lower():
                return w
        # Substring title match
        for w in windows:
            if q in w["title"].lower():
                return w
        # Substring process match
        for w in windows:
            if q in w["process_name"].lower():
                return w
    return None


def _focus(hwnd: int) -> None:
    """Robustly restore and bring window to the foreground, bypassing Windows foreground lock."""
    if platform.system() != "Windows":
        return
    try:
        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32

        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)

        cur_thread = kernel32.GetCurrentThreadId()
        fg_hwnd = user32.GetForegroundWindow()
        fg_pid = wintypes.DWORD()
        fg_thread = (
            user32.GetWindowThreadProcessId(fg_hwnd, ctypes.byref(fg_pid))
            if fg_hwnd
            else 0
        )
        tgt_pid = wintypes.DWORD()
        tgt_thread = user32.GetWindowThreadProcessId(hwnd, ctypes.byref(tgt_pid))

        if fg_thread != 0 and fg_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, fg_thread, True)
        if tgt_thread != 0 and tgt_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, tgt_thread, True)

        user32.ShowWindow(hwnd, SW_SHOW)
        user32.BringWindowToTop(hwnd)
        user32.SetForegroundWindow(hwnd)

        if fg_thread != 0 and fg_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, fg_thread, False)
        if tgt_thread != 0 and tgt_thread != cur_thread:
            user32.AttachThreadInput(cur_thread, tgt_thread, False)
    except Exception:
        try:
            ctypes.windll.user32.ShowWindow(hwnd, SW_RESTORE)
            time.sleep(0.05)
            ctypes.windll.user32.SetForegroundWindow(hwnd)
        except Exception as e:
            raise ToolError(f"Could not focus window: {e}")


def _resolve_target(args: Dict[str, Any]) -> Tuple[int, str]:
    title: Optional[str] = args.get("title") or args.get("application")
    pid = args.get("pid")
    process_name = args.get("process") or args.get("process_name")

    if title or pid or process_name:
        match = _find_window(
            str(title or ""),
            pid=int(pid) if pid else None,
            process_name=str(process_name or ""),
        )
        if not match:
            raise ToolError(
                f"No visible window matching '{title or process_name or pid}'."
            )
        return match["hwnd"], match["title"]

    hwnd = _get_foreground_window()
    if not hwnd:
        raise ToolError("No active window found.")
    return hwnd, _window_title(hwnd)


# --- Tool handlers -----------------------------------------------------------


@register("listWindows")
def list_windows(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all open visible application windows with titles, PIDs, process names, and bounds."""
    if platform.system() != "Windows":
        return {"windows": [], "count": 0}
    try:
        windows = _enumerate_windows()
        return {"windows": windows, "count": len(windows)}
    except Exception as e:
        raise ToolError(f"Failed to list windows: {e}")


@register("getActiveWindow")
def get_active_window(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get information about the current foreground window."""
    hwnd = _get_foreground_window()
    if not hwnd:
        return {"window": None, "result": "No active window found."}
    info = _get_window_info(hwnd)
    return {
        "window": info,
        "result": f"Active window: {info['title'] if info else 'Unknown'} ({info['process_name'] if info else ''})",
    }


@register("focusWindow")
def focus_window(args: Dict[str, Any]) -> Dict[str, Any]:
    """Bring a window to foreground by partial title, process name, or PID."""
    title = args.get("title") or args.get("application")
    pid = args.get("pid")
    process_name = args.get("process") or args.get("process_name")

    if not title and not pid and not process_name:
        raise ToolError("Must provide 'title', 'process', or 'pid' to focusWindow.")

    match = _find_window(
        str(title or ""),
        pid=int(pid) if pid else None,
        process_name=str(process_name or ""),
    )
    if not match:
        raise ToolError(
            f"No matching window found for {title or process_name or pid}."
        )

    _focus(match["hwnd"])
    return {
        "result": f"Focused window: '{match['title']}' (PID: {match['pid']}, Process: {match['process_name']})",
        "hwnd": match["hwnd"],
    }


@register("snapWindow")
def snap_window(args: Dict[str, Any]) -> Dict[str, Any]:
    """Snap active or target window to a zone: 'left', 'right', 'top', 'bottom', 'maximize', 'center'."""
    zone = (args.get("zone") or args.get("position") or "maximize").strip().lower()
    hwnd, title = _resolve_target(args)
    if platform.system() != "Windows":
        raise ToolError("snapWindow is only supported on Windows.")
    try:
        user32 = ctypes.windll.user32

        rc = RECT()
        SPI_GETWORKAREA = 0x0030
        user32.SystemParametersInfoW(SPI_GETWORKAREA, 0, ctypes.byref(rc), 0)
        sw = rc.right - rc.left
        sh = rc.bottom - rc.top
        ox = rc.left
        oy = rc.top

        user32.ShowWindow(hwnd, SW_RESTORE)
        time.sleep(0.05)

        if zone == "left":
            user32.MoveWindow(hwnd, ox, oy, sw // 2, sh, True)
        elif zone == "right":
            user32.MoveWindow(hwnd, ox + (sw // 2), oy, sw // 2, sh, True)
        elif zone == "top":
            user32.MoveWindow(hwnd, ox, oy, sw, sh // 2, True)
        elif zone == "bottom":
            user32.MoveWindow(hwnd, ox, oy + (sh // 2), sw, sh // 2, True)
        elif zone == "center":
            cw = int(sw * 0.75)
            ch = int(sh * 0.75)
            cx = ox + (sw - cw) // 2
            cy = oy + (sh - ch) // 2
            user32.MoveWindow(hwnd, cx, cy, cw, ch, True)
        elif zone == "maximize":
            user32.ShowWindow(hwnd, SW_MAXIMIZE)
        else:
            raise ToolError(
                f"Unknown snap zone '{zone}'. Use: left, right, top, bottom, center, maximize."
            )

        _focus(hwnd)
        return {"result": f"Snapped window '{title}' to {zone}."}
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Failed to snap window: {e}")


@register("minimizeWindow")
def minimize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _show_window(hwnd, SW_MINIMIZE)
    return {"result": f"Minimized window: {title or 'active window'}."}


@register("maximizeWindow")
def maximize_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _show_window(hwnd, SW_MAXIMIZE)
    return {"result": f"Maximized window: {title or 'active window'}."}


@register("closeWindow")
def close_window(args: Dict[str, Any]) -> Dict[str, Any]:
    hwnd, title = _resolve_target(args)
    _close_window_hwnd(hwnd)
    return {"result": f"Closed window: {title or 'active window'}."}


@register("switchApplication")
def switch_application(args: Dict[str, Any]) -> Dict[str, Any]:
    """Focus a window by title, or cycle windows (Alt+Tab) if no title given."""
    title = args.get("title") or args.get("application")
    if title:
        match = _find_window(str(title))
        if not match:
            raise ToolError(f"No visible window matching '{title}'.")
        _focus(match["hwnd"])
        return {"result": f"Switched to: {match['title']}."}

    # No specific title -> Alt+Tab cycle.
    try:
        import pyautogui

        pyautogui.hotkey("alt", "tab")
        return {"result": "Cycled to the next window."}
    except Exception:
        windows = _enumerate_windows()
        if windows:
            fg = _get_foreground_window()
            idx = next((i for i, w in enumerate(windows) if w["hwnd"] == fg), -1)
            nxt = windows[(idx + 1) % len(windows)]
            _focus(nxt["hwnd"])
            return {"result": f"Switched to: {nxt['title']}."}
        raise ToolError("Could not switch applications.")


__all__ = [
    "list_windows",
    "get_active_window",
    "focus_window",
    "snap_window",
    "minimize_window",
    "maximize_window",
    "close_window",
    "switch_application",
]
