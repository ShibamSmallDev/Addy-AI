"""
Keyboard automation: unicode text injection, press keys, key combinations, macros.

Features:
- Native Win32 SendInput KEYEVENTF_UNICODE driver for typing emojis, symbols, and all international scripts
- Active foreground window verification guard
- Configurable typing speed & clipboard paste acceleration
"""

from __future__ import annotations

import ctypes
import logging
import re
import time
from typing import Any, Dict, List, Optional

from .registry import ToolError, find_known_name, register

log = logging.getLogger("Addy.desktop.keyboard")

KEY_MAP = {
    "enter": "enter",
    "return": "enter",
    "escape": "esc",
    "esc": "esc",
    "tab": "tab",
    "space": "space",
    "spacebar": "space",
    "backspace": "backspace",
    "delete": "delete",
    "del": "delete",
    "up": "up",
    "down": "down",
    "left": "left",
    "right": "right",
    "home": "home",
    "end": "end",
    "pageup": "pageup",
    "pagedown": "pagedown",
    "pgup": "pageup",
    "pgdn": "pagedown",
    "shift": "shift",
    "ctrl": "ctrl",
    "control": "ctrl",
    "alt": "alt",
    "win": "win",
    "super": "win",
    "windows": "win",
    "capslock": "capslock",
    "f1": "f1",
    "f2": "f2",
    "f3": "f3",
    "f4": "f4",
    "f5": "f5",
    "f6": "f6",
    "f7": "f7",
    "f8": "f8",
    "f9": "f9",
    "f10": "f10",
    "f11": "f11",
    "f12": "f12",
    "printscreen": "printscreen",
    "prtsc": "printscreen",
    "insert": "insert",
    # Media & Volume Keys
    "mediaplaypause": "playpause",
    "playpause": "playpause",
    "play_pause": "playpause",
    "pause": "playpause",
    "medianexttrack": "nexttrack",
    "nexttrack": "nexttrack",
    "mediaprevtrack": "prevtrack",
    "prevtrack": "prevtrack",
    "mediastop": "mediastop",
    "stop": "mediastop",
    "volumemute": "volumemute",
    "mute": "volumemute",
    "volumeup": "volumeup",
    "volumedown": "volumedown",
}

MODIFIER_MAP = {
    "ctrl": "ctrl",
    "control": "ctrl",
    "shift": "shift",
    "alt": "alt",
    "win": "win",
    "windows": "win",
    "super": "win",
    "meta": "win",
}

VK_MAP = {
    "enter": 0x0D, "esc": 0x1B, "tab": 0x09, "space": 0x20,
    "backspace": 0x08, "delete": 0x2E, "up": 0x26, "down": 0x28,
    "left": 0x25, "right": 0x27, "home": 0x24, "end": 0x23,
    "pageup": 0x21, "pagedown": 0x22, "shift": 0x10, "ctrl": 0x11,
    "alt": 0x12, "win": 0x5B, "capslock": 0x14, "insert": 0x2D,
    "f1": 0x70, "f2": 0x71, "f3": 0x72, "f4": 0x73, "f5": 0x74,
    "f6": 0x75, "f7": 0x76, "f8": 0x77, "f9": 0x78, "f10": 0x79,
    "f11": 0x7A, "f12": 0x7B,
    # Media keys
    "playpause": 0xB3, "nexttrack": 0xB0, "prevtrack": 0xB1,
    "mediastop": 0xB2, "volumemute": 0xAD, "volumeup": 0xAF, "volumedown": 0xAE,
}


# --- Win32 Direct SendInput Keyboard Structures -----------------------------

ULONG_PTR = ctypes.c_ulong if ctypes.sizeof(ctypes.c_void_p) == 4 else ctypes.c_ulonglong

class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", ctypes.c_ushort),
        ("wScan", ctypes.c_ushort),
        ("dwFlags", ctypes.c_ulong),
        ("time", ctypes.c_ulong),
        ("dwExtraInfo", ULONG_PTR),
    ]

class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [("uMsg", ctypes.c_ulong), ("wParamL", ctypes.c_short), ("wParamH", ctypes.c_ushort)]

class INPUT_UNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]

class INPUT(ctypes.Structure):
    _fields_ = [
        ("type", ctypes.c_ulong),
        ("u", INPUT_UNION),
    ]

INPUT_KEYBOARD = 1
KEYEVENTF_EXTENDEDKEY = 0x0001
KEYEVENTF_KEYUP = 0x0002
KEYEVENTF_UNICODE = 0x0004
KEYEVENTF_SCANCODE = 0x0008


def _send_unicode_char(char: str) -> None:
    """Send a single character via SendInput KEYEVENTF_UNICODE."""
    code_points = [ord(c) for c in char.encode('utf-16-le').decode('utf-16-le')]
    u32 = ctypes.windll.user32

    for cp in code_points:
        inp_down = INPUT()
        inp_down.type = INPUT_KEYBOARD
        inp_down.u.ki.wVk = 0
        inp_down.u.ki.wScan = cp
        inp_down.u.ki.dwFlags = KEYEVENTF_UNICODE
        inp_down.u.ki.time = 0
        inp_down.u.ki.dwExtraInfo = 0

        inp_up = INPUT()
        inp_up.type = INPUT_KEYBOARD
        inp_up.u.ki.wVk = 0
        inp_up.u.ki.wScan = cp
        inp_up.u.ki.dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP
        inp_up.u.ki.time = 0
        inp_up.u.ki.dwExtraInfo = 0

        u32.SendInput(1, ctypes.byref(inp_down), ctypes.sizeof(INPUT))
        time.sleep(0.005)
        u32.SendInput(1, ctypes.byref(inp_up), ctypes.sizeof(INPUT))
        time.sleep(0.005)


def _send_vk(vk: int, down: bool = True, up: bool = True) -> None:
    u32 = ctypes.windll.user32
    if down:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.u.ki.wVk = vk
        inp.u.ki.wScan = 0
        inp.u.ki.dwFlags = 0
        u32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
    if down and up:
        time.sleep(0.015)
    if up:
        inp = INPUT()
        inp.type = INPUT_KEYBOARD
        inp.u.ki.wVk = vk
        inp.u.ki.wScan = 0
        inp.u.ki.dwFlags = KEYEVENTF_KEYUP
        u32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def _get_active_window_title() -> str:
    try:
        u32 = ctypes.windll.user32
        hwnd = u32.GetForegroundWindow()
        if not hwnd:
            return ""
        length = u32.GetWindowTextLengthW(hwnd)
        buff = ctypes.create_unicode_buffer(length + 1)
        u32.GetWindowTextW(hwnd, buff, length + 1)
        return buff.value
    except Exception:
        return ""


def _normalize_key(key: str) -> str:
    raw = key.strip().lower()
    if not raw:
        raise ToolError("'key' argument is empty.")
    mapped = KEY_MAP.get(raw)
    if mapped:
        return mapped
    mapped = find_known_name(raw, KEY_MAP)
    if mapped:
        return mapped
    if len(raw) == 1:
        return raw
    raise ToolError(f"Unknown key: {key}")


def _normalize_modifier(mod: str) -> str:
    raw = mod.strip().lower()
    mapped = MODIFIER_MAP.get(raw)
    if mapped:
        return mapped
    mapped = find_known_name(raw, MODIFIER_MAP)
    if mapped:
        return mapped
    raise ToolError(f"Unknown modifier key: {mod}")


# --- Handlers ---------------------------------------------------------------

@register("typeText")
def type_text(args: Dict[str, Any]) -> Dict[str, Any]:
    """Type text into focused field using native Unicode SendInput hardware events.
    
    Supports emojis, international characters, and symbols without mangling.
    """
    text = args.get("text")
    if text is None:
        raise ToolError("'text' argument is required.")
    text = str(text)
    speed = float(args.get("speed", 0.0))
    delay = max(0.0, min(speed, 0.5))

    target_window = args.get("targetWindow")
    if target_window:
        current_title = _get_active_window_title()
        if target_window.lower() not in current_title.lower():
            raise ToolError(f"Active window mismatch: expected '{target_window}', but active window is '{current_title}'.")

    # If text is long (>50 chars), auto-accelerate via injectText unless speed was explicitly specified
    if len(text) > 50 and speed == 0.0:
        return inject_text(args)

    for char in text:
        _send_unicode_char(char)
        if delay > 0:
            time.sleep(delay)

    preview = text if len(text) <= 200 else text[:200] + "..."
    return {"result": f"Typed {len(text)} characters via Unicode driver.", "text": preview}


@register("pressKey")
def press_key(args: Dict[str, Any]) -> Dict[str, Any]:
    """Press a single key (Enter, Tab, Escape, Backspace, Arrows, F1-F12)."""
    key = args.get("key")
    if not key:
        raise ToolError("'key' argument is required.")
    normalized = _normalize_key(key)
    count = int(args.get("count", 1))
    interval = float(args.get("interval", 0.05))

    vk = VK_MAP.get(normalized) or ord(normalized.upper())
    for _ in range(count):
        _send_vk(vk)
        if count > 1 and interval > 0:
            time.sleep(interval)

    return {"result": f"Pressed {key} ({count} time(s))."}


@register("pressKeyCombination")
def press_key_combination(args: Dict[str, Any]) -> Dict[str, Any]:
    """Press key combination like Ctrl+C, Alt+Tab, Ctrl+Shift+P."""
    modifiers = args.get("modifiers", [])
    key = args.get("key")
    if not key:
        raise ToolError("'key' argument is required.")
    if isinstance(modifiers, str):
        modifiers = [modifiers]

    mod_keys = [_normalize_modifier(m) for m in modifiers]
    main_key = _normalize_key(key)

    mod_vks = [VK_MAP.get(m, 0) for m in mod_keys]
    main_vk = VK_MAP.get(main_key) or ord(main_key.upper())

    # Press modifiers down
    for vk in mod_vks:
        if vk:
            _send_vk(vk, down=True, up=False)
            time.sleep(0.01)

    # Press and release main key
    _send_vk(main_vk, down=True, up=True)
    time.sleep(0.01)

    # Release modifiers in reverse order
    for vk in reversed(mod_vks):
        if vk:
            _send_vk(vk, down=False, up=True)
            time.sleep(0.01)

    combo_name = "+".join(mod_keys + [main_key])
    return {"result": f"Pressed {combo_name}."}


@register("holdKey")
def hold_key(args: Dict[str, Any]) -> Dict[str, Any]:
    """Hold a key down."""
    key = args.get("key")
    if not key:
        raise ToolError("'key' argument is required.")
    normalized = _normalize_key(key)
    vk = VK_MAP.get(normalized) or ord(normalized.upper())
    _send_vk(vk, down=True, up=False)
    return {"result": f"Holding {key}."}


@register("releaseKey")
def release_key(args: Dict[str, Any]) -> Dict[str, Any]:
    """Release a held key."""
    key = args.get("key")
    if not key:
        raise ToolError("'key' argument is required.")
    normalized = _normalize_key(key)
    vk = VK_MAP.get(normalized) or ord(normalized.upper())
    _send_vk(vk, down=False, up=True)
    return {"result": f"Released {key}."}


@register("injectText")
def inject_text(args: Dict[str, Any]) -> Dict[str, Any]:
    """Fast clipboard paste injection (preserves previous clipboard state)."""
    text = args.get("text")
    if text is None:
        raise ToolError("'text' argument is required.")
    text = str(text)

    try:
        import pyperclip
    except ImportError:
        # Fallback to type_text if pyperclip unavailable
        return type_text(args)

    saved = None
    try:
        saved = pyperclip.paste()
    except Exception:
        pass

    try:
        pyperclip.copy(text)
        time.sleep(0.03)
        # Ctrl+V
        _send_vk(VK_MAP["ctrl"], down=True, up=False)
        time.sleep(0.01)
        _send_vk(ord("V"), down=True, up=True)
        time.sleep(0.01)
        _send_vk(VK_MAP["ctrl"], down=False, up=True)
        time.sleep(0.05)
    finally:
        if saved is not None:
            try:
                pyperclip.copy(saved)
            except Exception:
                pass

    preview = text if len(text) <= 200 else text[:200] + "..."
    return {"result": f"Injected {len(text)} characters via accelerated paste.", "text": preview}


@register("injectTextAndSubmit")
def inject_text_and_submit(args: Dict[str, Any]) -> Dict[str, Any]:
    """Inject text into focused field and immediately press Enter."""
    res = inject_text(args)
    time.sleep(0.08)
    _send_vk(VK_MAP["enter"])
    return {"result": f"{res['result']} and submitted."}


@register("keyboardMacro")
def keyboard_macro(args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute a sequence of keyboard actions in one atomic call."""
    steps = args.get("steps")
    if not steps or not isinstance(steps, list):
        raise ToolError("'steps' array is required.")

    results = []
    for i, step in enumerate(steps):
        action = (step.get("action") or step.get("type") or "").lower()
        if action in ("type", "text"):
            t = str(step.get("text", ""))
            for char in t:
                _send_unicode_char(char)
            results.append(f"step {i}: typed {len(t)} chars")
        elif action == "inject":
            inject_text(step)
            results.append(f"step {i}: injected text")
        elif action in ("key", "press"):
            press_key(step)
            results.append(f"step {i}: pressed key {step.get('key')}")
        elif action in ("hotkey", "combination"):
            press_key_combination(step)
            results.append(f"step {i}: pressed hotkey")
        elif action == "wait":
            ms = int(step.get("ms", 200))
            time.sleep(ms / 1000.0)
            results.append(f"step {i}: waited {ms}ms")
        elif action == "hold":
            hold_key(step)
            results.append(f"step {i}: held {step.get('key')}")
        elif action == "release":
            release_key(step)
            results.append(f"step {i}: released {step.get('key')}")

    return {"result": f"Executed {len(steps)} macro steps.", "detail": results}


__all__ = [
    "type_text", "press_key", "press_key_combination",
    "hold_key", "release_key", "inject_text",
    "inject_text_and_submit", "keyboard_macro",
]
