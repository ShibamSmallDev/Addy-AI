---
type: skill
trigger: "screenshot screen capture analyze ocr read screen text visible"
learned: 2026-08-16
---

## Screenshot & Screen Analysis — Visual Desktop Inspection

Addy can capture, save, and analyze the desktop screen — including full-screen screenshots, saved image files, and OCR text extraction.

### Available Tools

| Tool | Purpose |
|------|---------|
| `takeScreenshot` | Capture full screen, return metadata + small base64 preview |
| `saveScreenshot` | Capture and save to `~/Pictures/AddyScreenshots/` |
| `analyzeScreenshot` | Capture screen, run OCR (pytesseract), return extracted text |
| `readScreen` | OCR of active window only + window title |

### When to Use

- Shibam asks **"What's on my screen?"** or **"What error is showing?"**
- You need to **read text from an application** that doesn't expose an API
- **OCR extraction** from images, dialogs, terminal output, browser windows
- **Debugging visual issues** — capture and describe what's visible

### Examples

| Request | Tool Chain |
|---------|------------|
| "What error dialog is showing on my screen?" | `analyzeScreenshot({})` → read OCR text → describe error |
| "Save a screenshot of my browser" | `saveScreenshot({name: "browser"})` |
| "Read the text in the active terminal window" | `readScreen({})` |
| "Take a quick screenshot for reference" | `takeScreenshot({})` → returns metadata + base64 thumbnail |

### Notes

- Screenshots saved to `~/Pictures/AddyScreenshots/` (auto-created).
- `analyzeScreenshot` runs Tesseract OCR (v5.5, installed at `C:\Program Files\Tesseract-OCR\` on PATH).
- `readScreen` targets the **active window only** (faster, less noise).
- `takeScreenshot` returns a small base64 preview + metadata (not full image) — efficient for quick checks.
- Multi-monitor: `takeScreenshot`/`analyzeScreenshot` capture **all screens**; coordinates may need adjustment.
- These are **desktop agent tools** — routed to Python sidecar on port 8765.