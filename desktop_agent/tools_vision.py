"""
Addy Desktop Vision & High-Precision Screen Element Locator.

Combines:
1. Windows UIAutomation (UIA) for pixel-perfect, 0-OCR control identification (buttons, inputs, tabs, menus)
2. RapidOCR ONNX & Windows Native OCR for rendered text, canvas elements, and images
3. DPI-aware coordinate normalization (corrects 125%, 150%, 200% Windows scaling)
4. Advanced fuzzy matching with rapidfuzz for natural-language element queries
"""

from __future__ import annotations

import ctypes
import logging
import os
import re
from typing import Any, Dict, List, Optional, Tuple

from .registry import register

log = logging.getLogger("Addy.desktop.vision")

# Initialize DPI awareness so all coordinates match Windows logical pixels
try:
    ctypes.windll.shcore.SetProcessDpiAwareness(2)  # Per-monitor DPI aware
except Exception:
    try:
        ctypes.windll.user32.SetProcessDPIAware()
    except Exception:
        pass


def _virtual_screen_metrics() -> Tuple[int, int, int, int]:
    """Return (left, top, width, height) of the virtual desktop."""
    try:
        import win32api
        import win32con
        left = win32api.GetSystemMetrics(win32con.SM_XVIRTUALSCREEN)
        top = win32api.GetSystemMetrics(win32con.SM_YVIRTUALSCREEN)
        width = win32api.GetSystemMetrics(win32con.SM_CXVIRTUALSCREEN)
        height = win32api.GetSystemMetrics(win32con.SM_CYVIRTUALSCREEN)
        return (left, top, width, height)
    except Exception:
        try:
            user32 = ctypes.windll.user32
            w = user32.GetSystemMetrics(0)
            h = user32.GetSystemMetrics(1)
            return (0, 0, w, h)
        except Exception:
            return (0, 0, 1920, 1080)


def _capture_win32_gdi() -> Optional[Any]:
    """Capture physical desktop pixels via Win32 GDI DIBits API (100% reliable on Windows)."""
    try:
        import ctypes
        from PIL import Image
        user32 = ctypes.windll.user32
        gdi32 = ctypes.windll.gdi32
        w, h = user32.GetSystemMetrics(0), user32.GetSystemMetrics(1)
        hdc = user32.GetDC(0)
        if not hdc:
            return None
        memdc = gdi32.CreateCompatibleDC(hdc)
        bmp = gdi32.CreateCompatibleBitmap(hdc, w, h)
        gdi32.SelectObject(memdc, bmp)
        gdi32.BitBlt(memdc, 0, 0, w, h, hdc, 0, 0, 0x00CC0020)

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [
                ("biSize", ctypes.c_uint32),
                ("biWidth", ctypes.c_int32),
                ("biHeight", ctypes.c_int32),
                ("biPlanes", ctypes.c_uint16),
                ("biBitCount", ctypes.c_uint16),
                ("biCompression", ctypes.c_uint32),
                ("biSizeImage", ctypes.c_uint32),
                ("biXPelsPerMeter", ctypes.c_int32),
                ("biYPelsPerMeter", ctypes.c_int32),
                ("biClrUsed", ctypes.c_uint32),
                ("biClrImportant", ctypes.c_uint32),
            ]

        bmi = BITMAPINFOHEADER()
        bmi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
        bmi.biWidth = w
        bmi.biHeight = -h
        bmi.biPlanes = 1
        bmi.biBitCount = 32
        bmi.biCompression = 0
        buf = ctypes.create_string_buffer(w * h * 4)
        gdi32.GetDIBits(memdc, bmp, 0, h, buf, ctypes.byref(bmi), 0)

        gdi32.DeleteObject(bmp)
        gdi32.DeleteDC(memdc)
        user32.ReleaseDC(0, hdc)

        return Image.frombuffer("RGB", (w, h), buf, "raw", "BGRX", 0, 1)
    except Exception as e:
        log.debug("Win32 GDI screen capture note: %s", e)
        return None


def _capture_screen() -> Optional[Any]:
    """Capture screen image with multi-engine fallback (Win32 GDI -> PIL ImageGrab -> mss)."""
    # 1. Try Win32 GDI DIBits API (most reliable)
    img = _capture_win32_gdi()
    if img:
        return img

    # 2. Try PIL ImageGrab
    try:
        from PIL import ImageGrab
        img = ImageGrab.grab(all_screens=False)
        if img:
            return img
    except Exception:
        pass

    # 3. Try mss
    try:
        import mss
        from PIL import Image
        with mss.mss() as sct:
            mon = sct.monitors[0]
            sct_img = sct.grab(mon)
            return Image.frombytes("RGB", sct_img.size, sct_img.bgra, "raw", "BGRX")
    except Exception:
        pass

    return None


# ---------------------------------------------------------------------------
# Engine 1: Windows UIAutomation (UIA)
# ---------------------------------------------------------------------------

def _get_uia_elements(max_depth: int = 12) -> List[Dict[str, Any]]:
    """Enumerate interactive controls and labels using Windows UI Automation."""
    elements = []
    try:
        import uiautomation as auto

        targets = []
        try:
            fg = auto.GetForegroundControl()
            if fg and fg.Exists(0.1, 0.1):
                targets.append(fg)
        except Exception:
            pass

        root = auto.GetRootControl()
        if root:
            targets.append(root)
            try:
                for win in root.GetChildren():
                    if win.ControlTypeName == "WindowControl" and win.BoundingRectangle and win.BoundingRectangle.width() > 50:
                        targets.append(win)
            except Exception:
                pass

        seen_coords = set()

        def scan_control(ctrl, depth=0):
            if depth > max_depth or not ctrl:
                return
            try:
                rect = ctrl.BoundingRectangle
                if rect and rect.width() > 4 and rect.height() > 4:
                    name = (ctrl.Name or "").strip()
                    auto_id = (ctrl.AutomationId or "").strip()
                    ctrl_type = ctrl.ControlTypeName or ""
                    
                    # If control has no direct name, check child text elements
                    if not name:
                        for child in ctrl.GetChildren():
                            c_name = (child.Name or "").strip()
                            if c_name:
                                name = c_name
                                break

                    # Keep interactive and textual controls
                    is_useful = bool(name or auto_id) and ctrl_type not in ("WindowControl",)
                    if is_useful:
                        cx = rect.left + rect.width() // 2
                        cy = rect.top + rect.height() // 2
                        coord_key = (cx, cy)
                        if coord_key not in seen_coords:
                            seen_coords.add(coord_key)
                            elements.append({
                                "text": name or auto_id,
                                "name": name,
                                "auto_id": auto_id,
                                "type": ctrl_type.replace("Control", ""),
                                "x": rect.left,
                                "y": rect.top,
                                "w": rect.width(),
                                "h": rect.height(),
                                "cx": cx,
                                "cy": cy,
                                "confidence": 100,
                                "source": "uiautomation",
                            })

                for child in ctrl.GetChildren():
                    scan_control(child, depth + 1)
            except Exception:
                pass

        for target in targets:
            scan_control(target, 0)
            if len(elements) >= 200:
                break

    except Exception as e:
        log.debug("UIAutomation enumeration note: %s", e)

    return elements


# ---------------------------------------------------------------------------
# Engine 2: RapidOCR ONNX & WinOCR
# ---------------------------------------------------------------------------

_RAPID_OCR_INSTANCE = None

def _get_rapid_ocr():
    global _RAPID_OCR_INSTANCE
    if _RAPID_OCR_INSTANCE is None:
        try:
            from rapidocr_onnxruntime import RapidOCR
            _RAPID_OCR_INSTANCE = RapidOCR()
        except Exception as e:
            log.debug("RapidOCR init: %s", e)
    return _RAPID_OCR_INSTANCE


def _get_ocr_elements(img) -> List[Dict[str, Any]]:
    """Extract text boxes from image using RapidOCR / WinOCR with DPI normalization."""
    if img is None:
        return []

    boxes = []
    vx, vy, vw, vh = _virtual_screen_metrics()
    img_w, img_h = img.size

    # Calculate DPI scaling ratio between physical image pixels and logical desktop coordinates
    scale_x = vw / float(img_w) if img_w > 0 else 1.0
    scale_y = vh / float(img_h) if img_h > 0 else 1.0

    # 1. Try RapidOCR ONNX
    ocr = _get_rapid_ocr()
    if ocr is not None:
        try:
            import numpy as np
            img_np = np.array(img)
            result, _ = ocr(img_np)
            if result:
                for item in result:
                    coords, text, conf = item
                    text = (text or "").strip()
                    if not text:
                        continue
                    # coords is [[x1,y1], [x2,y2], [x3,y3], [x4,y4]]
                    raw_x = min(pt[0] for pt in coords)
                    raw_y = min(pt[1] for pt in coords)
                    raw_w = max(pt[0] for pt in coords) - raw_x
                    raw_h = max(pt[1] for pt in coords) - raw_y

                    # Convert to logical desktop coordinates
                    log_x = int(raw_x * scale_x) + vx
                    log_y = int(raw_y * scale_y) + vy
                    log_w = max(1, int(raw_w * scale_x))
                    log_h = max(1, int(raw_h * scale_y))
                    cx = log_x + log_w // 2
                    cy = log_y + log_h // 2

                    boxes.append({
                        "text": text,
                        "name": text,
                        "type": "Text",
                        "x": log_x,
                        "y": log_y,
                        "w": log_w,
                        "h": log_h,
                        "cx": cx,
                        "cy": cy,
                        "confidence": int(conf * 100) if isinstance(conf, (int, float)) else 85,
                        "source": "ocr",
                    })
                return boxes
        except Exception as e:
            log.debug("RapidOCR failed: %s", e)

    # 2. Try WinOCR (Windows 10/11 native)
    try:
        import winocr
        res = winocr.recognize_pil_sync(img, "en")
        for line in res.get("lines", []):
            text = (line.get("text") or "").strip()
            words = line.get("words", [])
            if not text or not words:
                continue
            first_rect = words[0].get("boundingRect", {})
            last_rect = words[-1].get("boundingRect", {})
            raw_x = first_rect.get("x", 0)
            raw_y = first_rect.get("y", 0)
            raw_w = (last_rect.get("x", 0) + last_rect.get("width", 0)) - raw_x
            raw_h = max(w.get("boundingRect", {}).get("height", 20) for w in words)

            log_x = int(raw_x * scale_x) + vx
            log_y = int(raw_y * scale_y) + vy
            log_w = max(1, int(raw_w * scale_x))
            log_h = max(1, int(raw_h * scale_y))
            cx = log_x + log_w // 2
            cy = log_y + log_h // 2

            boxes.append({
                "text": text,
                "name": text,
                "type": "Text",
                "x": log_x,
                "y": log_y,
                "w": log_w,
                "h": log_h,
                "cx": cx,
                "cy": cy,
                "confidence": 90,
                "source": "winocr",
            })
    except Exception as e:
        log.debug("WinOCR failed: %s", e)

    return boxes


# ---------------------------------------------------------------------------
# Scoring & Matching Engine
# ---------------------------------------------------------------------------

def _score_candidate(query: str, candidate_text: str, candidate_type: str = "") -> float:
    """Calculate match score (0..100) using rapidfuzz and semantic heuristics."""
    q = query.lower().strip()
    c = candidate_text.lower().strip()

    if not q or not c:
        return 0.0

    # Exact string match
    if q == c:
        return 100.0

    try:
        from rapidfuzz import fuzz
        token_set = fuzz.token_set_ratio(q, c)
        partial = fuzz.partial_ratio(q, c)
        score = max(token_set, partial)

        # Boost substring match
        if q in c or c in q:
            score = max(score, 88.0)

        # Control type relevance boost (e.g. searching for "close button" matching "Close")
        if candidate_type:
            ct = candidate_type.lower()
            if ct in q:
                score += 8.0

        return min(100.0, float(score))
    except Exception:
        if q == c:
            return 100.0
        if q in c:
            return 85.0
        q_words = set(re.findall(r"\w+", q))
        c_words = set(re.findall(r"\w+", c))
        if q_words and q_words.issubset(c_words):
            return 80.0
        return 0.0


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------

@register("locateElement")
def locate_element(args: Dict[str, Any]) -> Dict[str, Any]:
    """Find a UI element by text label, name, or description with high precision."""
    label = args.get("label") or args.get("text") or args.get("name") or ""
    if not label:
        return {"result": "Provide a 'label' to search for.", "found": False}

    candidates: List[Dict[str, Any]] = []

    # 1. Query Windows UIAutomation elements
    uia_elements = _get_uia_elements()
    candidates.extend(uia_elements)

    # 2. Query RapidOCR / WinOCR elements
    img = _capture_screen()
    if img:
        ocr_elements = _get_ocr_elements(img)
        candidates.extend(ocr_elements)

    if not candidates:
        return {
            "result": f"Could not scan screen elements for '{label}'.",
            "found": False
        }

    # Score candidates
    scored = []
    for elem in candidates:
        match_score = _score_candidate(label, elem["text"], elem.get("type", ""))
        if match_score >= 50.0:
            # Prefer UIAutomation controls over OCR when scores are close
            adjusted_score = match_score + (10.0 if elem.get("source") == "uiautomation" else 0.0)
            scored.append((adjusted_score, elem))

    if not scored:
        visible_samples = list({c["text"] for c in candidates if len(c["text"]) > 2})[:15]
        return {
            "result": f"Could not find element matching '{label}' on screen.",
            "found": False,
            "visible_samples": visible_samples,
        }

    scored.sort(key=lambda x: -x[0])
    best_score, best = scored[0]

    return {
        "result": f"Located '{best['text']}' at screen coordinates ({best['cx']}, {best['cy']}) [{best.get('type', 'Element')}].",
        "found": True,
        "label": best["text"],
        "x": best["cx"],
        "y": best["cy"],
        "width": best["w"],
        "height": best["h"],
        "bbox": {"x": best["x"], "y": best["y"], "w": best["w"], "h": best["h"]},
        "type": best.get("type", "Element"),
        "source": best.get("source", "vision"),
        "confidence": int(best_score),
    }


@register("getScreenElements")
def get_screen_elements(args: Dict[str, Any]) -> Dict[str, Any]:
    """List all detected interactive UI controls and text labels on screen."""
    max_items = int(args.get("max_items", 40))
    candidates: List[Dict[str, Any]] = []

    # Combine UIA + OCR
    uia_elems = _get_uia_elements()
    candidates.extend(uia_elems)

    img = _capture_screen()
    if img:
        ocr_elems = _get_ocr_elements(img)
        candidates.extend(ocr_elems)

    # Deduplicate by coordinates and text
    unique = []
    seen = set()
    for c in candidates:
        key = (c["text"].lower(), c["cx"] // 10, c["cy"] // 10)
        if key not in seen:
            seen.add(key)
            unique.append({
                "text": c["text"],
                "type": c.get("type", "Element"),
                "x": c["cx"],
                "y": c["cy"],
                "w": c["w"],
                "h": c["h"],
                "source": c.get("source", "vision"),
            })

    return {
        "result": f"Detected {len(unique)} screen elements (showing first {min(len(unique), max_items)}).",
        "count": len(unique),
        "elements": unique[:max_items],
    }


@register("inspectControl")
def inspect_control(args: Dict[str, Any]) -> Dict[str, Any]:
    """Inspect active window controls via Windows UIAutomation."""
    elements = _get_uia_elements(max_depth=5)
    return {
        "result": f"Inspected active window: found {len(elements)} controls.",
        "controls": elements[:50],
    }


__all__ = ["locate_element", "get_screen_elements", "inspect_control"]
