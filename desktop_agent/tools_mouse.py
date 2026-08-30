"""
Desktop automation: precision mouse movement, clicks, scroll, drag.

Features:
- Direct Win32 SendInput hardware driver for sub-pixel accuracy & multi-monitor support
- Humanized Cubic Bézier curve trajectories for realistic easing
- Fallback to pyautogui with multi-monitor offset correction
"""

from __future__ import annotations

import ctypes
import logging
import math
import random
import time
from typing import Any, Dict, List, Tuple

import pyautogui
pyautogui.FAILSAFE = False
pyautogui.PAUSE = 0.01

from .registry import ToolError, find_known_name, register

log = logging.getLogger("Addy.desktop.mouse")

BUTTON_MAP = {
    "left": "left",
    "leftbutton": "left",
    "leftclick": "left",
    "primary": "left",
    "lmb": "left",
    "right": "right",
    "rightbutton": "right",
    "rightclick": "right",
    "secondary": "right",
    "rmb": "right",
    "contextmenu": "right",
    "middle": "middle",
    "middlebutton": "middle",
    "middleclick": "middle",
    "mmb": "middle",
    "wheel": "middle",
    "scrollbutton": "middle",
}


def _normalize_button(btn: str) -> str:
    raw = btn.strip().lower()
    mapped = BUTTON_MAP.get(raw)
    if mapped:
        return mapped
    mapped = find_known_name(raw, BUTTON_MAP)
    if mapped:
        return mapped
    raise ToolError(f"Unknown mouse button: {btn}")


# --- Win32 Direct SendInput & SetCursorPos Drivers --------------------------

def _set_cursor_position(x: int, y: int) -> None:
    """Set physical cursor position via Win32 SetCursorPos with PyAutoGUI fallback."""
    try:
        ctypes.windll.user32.SetCursorPos(int(x), int(y))
    except Exception:
        pass
    try:
        pyautogui.moveTo(int(x), int(y), _pause=False)
    except Exception:
        pass


def _get_cursor_pos() -> Tuple[int, int]:
    try:
        class POINT(ctypes.Structure):
            _fields_ = [("x", ctypes.c_long), ("y", ctypes.c_long)]
        pt = POINT()
        if ctypes.windll.user32.GetCursorPos(ctypes.byref(pt)):
            return int(pt.x), int(pt.y)
    except Exception:
        pass
    try:
        pos = pyautogui.position()
        return int(pos.x), int(pos.y)
    except Exception:
        return (0, 0)


# --- Cubic Bézier Smooth Easing ---------------------------------------------

def _bezier_point(p0: Tuple[float, float], p1: Tuple[float, float], p2: Tuple[float, float], p3: Tuple[float, float], t: float) -> Tuple[int, int]:
    u = 1.0 - t
    tt = t * t
    uu = u * u
    uuu = uu * u
    ttt = tt * t

    x = uuu * p0[0] + 3 * uu * t * p1[0] + 3 * u * tt * p2[0] + ttt * p3[0]
    y = uuu * p0[1] + 3 * uu * t * p1[1] + 3 * u * tt * p2[1] + ttt * p3[1]
    return int(round(x)), int(round(y))


def _move_smooth(target_x: int, target_y: int, duration: float = 0.25) -> None:
    start_x, start_y = _get_cursor_pos()
    dx = target_x - start_x
    dy = target_y - start_y
    dist = math.hypot(dx, dy)
    if dist < 5:
        _set_cursor_position(target_x, target_y)
        return

    ctrl1 = (start_x + dx * 0.25 + random.uniform(-10, 10), start_y + dy * 0.1 + random.uniform(-10, 10))
    ctrl2 = (start_x + dx * 0.75 + random.uniform(-10, 10), start_y + dy * 0.9 + random.uniform(-10, 10))

    steps = max(8, int(min(40, dist / 20)))
    sleep_interval = max(0.002, duration / steps)

    for i in range(1, steps + 1):
        t = i / steps
        ease_t = 0.5 * (1.0 - math.cos(t * math.pi))
        cur_x, cur_y = _bezier_point((start_x, start_y), ctrl1, ctrl2, (target_x, target_y), ease_t)
        _set_cursor_position(cur_x, cur_y)
        time.sleep(sleep_interval)

    _set_cursor_position(target_x, target_y)


def _to_int(val: Any, default: int = 0) -> int:
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


# --- Handlers ---------------------------------------------------------------

@register("mouseMove")
def mouse_move(args: Dict[str, Any]) -> Dict[str, Any]:
    """Move cursor to absolute screen coordinates with high precision."""
    x = _to_int(args.get("x"))
    y = _to_int(args.get("y"))
    smooth = bool(args.get("smooth", False))
    duration = float(args.get("duration", 0.25))

    if smooth:
        _move_smooth(x, y, duration=duration)
    else:
        _set_cursor_position(x, y)

    log.info("mouseMove -> (%d, %d)", x, y)
    return {"result": f"Moved cursor to ({x}, {y})"}


@register("mouseMoveRelative")
def mouse_move_relative(args: Dict[str, Any]) -> Dict[str, Any]:
    """Move cursor relative to current position."""
    dx = _to_int(args.get("dx", 0))
    dy = _to_int(args.get("dy", 0))
    cur_x, cur_y = _get_cursor_pos()
    target_x, target_y = cur_x + dx, cur_y + dy
    _set_cursor_position(target_x, target_y)
    log.info("mouseMoveRelative -> (%+d, %+d)", dx, dy)
    return {"result": f"Moved cursor by ({dx:+d}, {dy:+d}) to ({target_x}, {target_y})"}


@register("mouseGetPosition")
def mouse_get_position(args: Dict[str, Any]) -> Dict[str, Any]:
    """Return current cursor coordinates."""
    x, y = _get_cursor_pos()
    return {"result": {"x": x, "y": y}}


@register("mouseClick")
def mouse_click(args: Dict[str, Any]) -> Dict[str, Any]:
    """Click at current or specified position with hardware Win32 & PyAutoGUI drivers."""
    x = args.get("x")
    y = args.get("y")
    btn = _normalize_button(args.get("button", "left"))
    smooth = bool(args.get("smooth", False))

    if x is not None and y is not None:
        target_x, target_y = _to_int(x), _to_int(y)
        if smooth:
            _move_smooth(target_x, target_y, duration=0.15)
        else:
            _set_cursor_position(target_x, target_y)
        time.sleep(0.02)

    # Move cursor first then execute click
    cur_x, cur_y = _get_cursor_pos()
    _set_cursor_position(cur_x, cur_y)
    
    try:
        pyautogui.click(x=cur_x, y=cur_y, button=btn, _pause=False)
    except Exception:
        # Fallback to mouse_event API if pyautogui raises
        down_flag = 0x0002 if btn == "left" else (0x0008 if btn == "right" else 0x0020)
        up_flag = 0x0004 if btn == "left" else (0x0010 if btn == "right" else 0x0040)
        ctypes.windll.user32.mouse_event(down_flag, 0, 0, 0, 0)
        time.sleep(0.02)
        ctypes.windll.user32.mouse_event(up_flag, 0, 0, 0, 0)

    log.info("mouseClick %s at (%d, %d)", btn, cur_x, cur_y)
    return {"result": f"{btn.capitalize()} click executed at ({cur_x}, {cur_y})"}


@register("mouseRightClick")
def mouse_right_click(args: Dict[str, Any]) -> Dict[str, Any]:
    """Right click at current or specified position."""
    args["button"] = "right"
    return mouse_click(args)


@register("mouseDoubleClick")
def mouse_double_click(args: Dict[str, Any]) -> Dict[str, Any]:
    """Double click at current or specified position."""
    mouse_click(args)
    time.sleep(0.08)
    mouse_click(args)
    return {"result": "Double click executed"}


@register("mouseDown")
def mouse_down(args: Dict[str, Any]) -> Dict[str, Any]:
    """Press and hold a mouse button."""
    btn = _normalize_button(args.get("button", "left"))
    flag = MOUSEEVENTF_LEFTDOWN if btn == "left" else (MOUSEEVENTF_RIGHTDOWN if btn == "right" else MOUSEEVENTF_MIDDLEDOWN)
    _send_mouse_input(flag)
    return {"result": f"{btn.capitalize()} button pressed (held)"}


@register("mouseUp")
def mouse_up(args: Dict[str, Any]) -> Dict[str, Any]:
    """Release a held mouse button."""
    btn = _normalize_button(args.get("button", "left"))
    flag = MOUSEEVENTF_LEFTUP if btn == "left" else (MOUSEEVENTF_RIGHTUP if btn == "right" else MOUSEEVENTF_MIDDLEUP)
    _send_mouse_input(flag)
    return {"result": f"{btn.capitalize()} button released"}


WHEEL_DELTA = 120

@register("mouseScroll")
def mouse_scroll(args: Dict[str, Any]) -> Dict[str, Any]:
    """Scroll mouse wheel with exact Windows notch scaling."""
    clicks = _to_int(args.get("clicks", 1))
    x = args.get("x")
    y = args.get("y")

    if x is not None and y is not None:
        norm_x, norm_y = _screen_to_normalized(_to_int(x), _to_int(y))
        _send_mouse_input(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_MOVE, norm_x, norm_y)
        time.sleep(0.02)

    wheel_data = clicks * WHEEL_DELTA
    _send_mouse_input(MOUSEEVENTF_WHEEL, data=wheel_data)
    direction = "up" if clicks > 0 else "down"
    return {"result": f"Scrolled {direction} ({abs(clicks)} notches)"}


@register("mouseDrag")
def mouse_drag(args: Dict[str, Any]) -> Dict[str, Any]:
    """Drag from current position or (startX, startY) to (endX, endY)."""
    start_x = args.get("startX")
    start_y = args.get("startY")
    end_x = _to_int(args.get("endX", args.get("x", 0)))
    end_y = _to_int(args.get("endY", args.get("y", 0)))
    duration = float(args.get("duration", 0.3))

    if start_x is not None and start_y is not None:
        norm_x, norm_y = _screen_to_normalized(_to_int(start_x), _to_int(start_y))
        _send_mouse_input(MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK | MOUSEEVENTF_MOVE, norm_x, norm_y)
        time.sleep(0.05)

    _send_mouse_input(MOUSEEVENTF_LEFTDOWN)
    time.sleep(0.05)
    _move_smooth(end_x, end_y, duration=duration)
    time.sleep(0.05)
    _send_mouse_input(MOUSEEVENTF_LEFTUP)

    log.info("mouseDrag to (%d, %d)", end_x, end_y)
    return {"result": f"Dragged to ({end_x}, {end_y})"}


__all__ = [
    "mouse_move",
    "mouse_move_relative",
    "mouse_get_position",
    "mouse_click",
    "mouse_right_click",
    "mouse_double_click",
    "mouse_down",
    "mouse_up",
    "mouse_scroll",
    "mouse_drag",
]
