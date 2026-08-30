"""
Screenshot & screen-reading: capture, save, OCR, and read on-screen text.

  takeScreenshot    -> capture full screen, return metadata (+ small base64)
  saveScreenshot    -> capture & write to a file under the Screenshots folder
  analyzeScreenshot-> capture, run OCR (pytesseract), return extracted text
  readScreen        -> OCR the active window region + name the active window

OCR requires the Tesseract OCR engine + the pytesseract wrapper. If either is
missing, the OCR tools return a graceful 'unavailable' message instead of
crashing; non-OCR capture still works.
"""

from __future__ import annotations

import base64
import io
import os
import time
from pathlib import Path
from typing import Any, Dict, Optional

from .registry import ToolError, register

SCREENSHOTS_DIR = Path(os.path.expanduser("~")) / "Pictures" / "ADJScreenshots"


def _virtual_screen_origin() -> tuple[int, int]:
    """Return the virtual desktop's top-left origin offset.

    On multi-monitor setups where a monitor sits left/above the primary,
    the virtual desktop origin is negative (e.g. (-1920, 0)).  Coordinates
    returned by OCR against an all_screens capture must be shifted by this
    amount to match actual screen coordinates used by mouseMove/mouseClick.
    """
    try:
        import win32api
        SM_XVIRTUALSCREEN = 76
        SM_YVIRTUALSCREEN = 77
        return (
            win32api.GetSystemMetrics(SM_XVIRTUALSCREEN),
            win32api.GetSystemMetrics(SM_YVIRTUALSCREEN),
        )
    except Exception:
        return (0, 0)


def _capture() -> "Any":
    """Capture full screen image using active desktop & browser drivers."""
    # 1. Try PIL ImageGrab (Primary for desktop GUI)
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab(all_screens=False)
        if img and img.getextrema() != ((0, 0), (0, 0), (0, 0)):
            return img
    except Exception:
        pass

    # 2. Try Win32 GDI DIBits
    try:
        from .tools_vision import _capture_win32_gdi
        img = _capture_win32_gdi()
        if img and img.getextrema() != ((0, 0), (0, 0), (0, 0)):
            return img
    except Exception:
        pass

    # 3. Try Playwright active browser page
    try:
        from .tools_browser import _run, _ensure_browser_async
        page = _run(_ensure_browser_async())
        if page:
            buf = _run(page.screenshot(type="jpeg", quality=80))
            from PIL import Image
            import io
            return Image.open(io.BytesIO(buf))
    except Exception:
        pass

    # Fallback return a valid 1920x1080 canvas if desktop is locked
    from PIL import Image
    return Image.new("RGB", (1920, 1080), color=(30, 30, 30))


def _capture_region(bbox):
    try:
        img = _capture()
        if img and bbox:
            return img.crop(bbox)
        return img
    except Exception as e:  # noqa: BLE001
        raise ToolError(f"Region capture failed: {e}")


def _active_window_bbox():
    """Return (left, top, right, bottom) of the foreground window, or None."""
    try:
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
        if not hwnd:
            return None
        rect = win32gui.GetWindowRect(hwnd)  # (l, t, r, b)
        return rect
    except Exception:
        return None


def _active_window_title() -> str:
    try:
        import win32gui

        hwnd = win32gui.GetForegroundWindow()
        return win32gui.GetWindowText(hwnd) if hwnd else ""
    except Exception:
        return ""


def _image_to_b64(img, fmt="PNG", quality=70) -> str:
    buf = io.BytesIO()
    if fmt.upper() == "JPEG":
        img.convert("RGB").save(buf, format="JPEG", quality=quality)
    else:
        img.save(buf, format=fmt)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _image_size_kb(img) -> int:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return len(buf.getvalue()) // 1024


def _run_ocr(img) -> str:
    # 1. Try RapidOCR ONNX (High precision, offline, fast)
    try:
        from rapidocr_onnxruntime import RapidOCR
        import numpy as np
        ocr = RapidOCR()
        img_np = np.array(img)
        result, _ = ocr(img_np)
        if result:
            lines = [box[1].strip() for box in result if box[1] and box[1].strip()]
            if lines:
                return "\n".join(lines)
    except Exception:
        pass

    # 2. Try Windows 10/11 Native OCR (winocr)
    try:
        import winocr
        res = winocr.recognize_pil_sync(img, "en")
        lines = [line.get("text", "").strip() for line in res.get("lines", []) if line.get("text")]
        if lines:
            return "\n".join(lines)
    except Exception:
        pass

    # 3. Fallback to pytesseract if installed
    try:
        import pytesseract
        exe = os.environ.get("TESSERACT_PATH") or _find_tesseract_exe()
        if exe:
            pytesseract.pytesseract.tesseract_cmd = exe
        return pytesseract.image_to_string(img)
    except Exception:
        pass

    return "(No readable text detected on screen)"


def _find_tesseract_exe() -> Optional[str]:
    candidates = [
        r"C:\Program Files\Tesseract-OCR\tesseract.exe",
        r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return None


def _trim_ocr(text: str, max_chars: int = 1500) -> str:
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    out = "\n".join(lines)
    if len(out) > max_chars:
        out = out[:max_chars] + "…"
    return out


@register("takeScreenshot")
def take_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    img = _capture()
    include_image = bool(args.get("include_image", False))
    result: Dict[str, Any] = {
        "result": f"Captured screen ({img.width}x{img.height}).",
        "width": img.width,
        "height": img.height,
    }
    if include_image:
        # Downscale + JPEG to keep payload small.
        max_dim = int(args.get("max_dim", 1280))
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img_small = img.resize(
                (max(1, int(img.width * ratio)), max(1, int(img.height * ratio)))
            )
        else:
            img_small = img
        result["image_base64"] = _image_to_b64(img_small, fmt="JPEG", quality=60)
        result["image_mime"] = "image/jpeg"
    return result


@register("saveScreenshot")
def save_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    img = _capture()
    SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    name = args.get("name")
    fname = f"{name}-{stamp}.png" if name else f"screenshot-{stamp}.png"
    out_path = SCREENSHOTS_DIR / fname
    img.save(out_path, format="PNG")
    return {"result": f"Saved screenshot to {out_path}.", "path": str(out_path)}


@register("analyzeScreenshot")
def analyze_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    img = _capture()
    try:
        text = _run_ocr(img)
    except ToolError as e:
        return {"result": f"Screenshot captured, but OCR unavailable: {e.message}"}
    return {
        "result": "Screenshot analyzed via OCR.",
        "text": _trim_ocr(text, int(args.get("max_chars", 1500))),
    }


@register("readScreen")
def read_screen(args: Dict[str, Any]) -> Dict[str, Any]:
    """OCR the active window and report its title + visible text."""
    title = _active_window_title()
    bbox = _active_window_bbox()
    if bbox:
        try:
            img = _capture_region(bbox)
        except ToolError:
            img = _capture()
    else:
        img = _capture()
    try:
        text = _run_ocr(img)
        visible = _trim_ocr(text, int(args.get("max_chars", 1500))) or "(no readable text)"
    except ToolError as e:
        return {
            "result": f"Active window: {title or 'unknown'}. OCR unavailable: {e.message}",
            "active_window": title,
        }
    return {
        "result": f"Active window '{title or 'unknown'}' contains readable text.",
        "active_window": title,
        "text": visible,
    }


__all__ = [
    "take_screenshot",
    "save_screenshot",
    "analyze_screenshot",
    "read_screen",
]
