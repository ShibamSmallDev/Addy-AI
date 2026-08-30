---
type: skill
trigger: "locate element find coordinates click position mouse ocr vision label text box"
learned: 2026-08-16
---

## Element Location (OCR-based coordinate finding)

When you need to click or interact with something on the real screen, **never guess coordinates** from scaled video or visual estimation. Use OCR-based locator tools to get real physical pixel coordinates from the host system.

### Available Tools

| Tool | Purpose |
|------|---------|
| `locateElement` | Find a UI element by visible text label via OCR, returns center `x`/`y` + bounding box |
| `getScreenElements` | List all visible text elements with their `x`/`y` positions |

### When to Use

- Shibam asks you to **click a specific button, tab, menu item, or window element**
- You need **exact coordinates** for `mouseClick` / `mouseMove`
- The element is **not reachable via browser automation** (native apps, dialogs, taskbar, system UI)
- Visual context from video is **scaled or ambiguous** — resolve via OCR, not estimation

### Flow

1. `getScreenElements({max_items: 30})` → see what text is on screen and where
2. `locateElement({label: "English Literature Project"})` → get exact `x`/`y`
3. `mouseClick({x: <x>, y: <y>})` → click the real screen position
4. `analyzeScreenshot({})` → verify the action landed correctly

### Examples

| Request | Tool Chain |
|---------|------------|
| "Click the 'Compile' button in my IDE" | `locateElement(label='Compile')` → `mouseClick(x, y)` |
| "Switch to the English Literature Project tab" | `locateElement(label='English Literature Project')` → `mouseClick(x, y)` |
| "What's clickable on my screen right now?" | `getScreenElements({max_items: 50})` |

### Notes

- Coordinates are in **real screen pixels** — safe to pass directly to `mouseClick`/`mouseMove`.
- Fuzzy-matches labels; exact matches get a confidence bonus.
- Requires Tesseract OCR (installed at `C:\Program Files\Tesseract-OCR\`).
- If not found, returns a list of visible texts so you can retry with the exact on-screen label.
- Preferred over clicking based on scaled video frame coordinates.