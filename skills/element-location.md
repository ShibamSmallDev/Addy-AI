---
type: skill
trigger: "locate element find coordinates click position mouse ocr vision label text box native app"
learned: 2026-08-16
---

## Element Location (OCR-based coordinate finding for Native Apps)

> **CRITICAL RULE**: For browser webpages, NEVER use OCR! Use `desktopBrowserGetSemanticTree()` and `desktopBrowserClick(id)` / `desktopBrowserType(id)` instead.
> Use `locateElement` ONLY for native Windows desktop software (Notepad, Calculator, File Explorer, Task Manager, native dialogs) that cannot be controlled via DOM/accessibility trees.

### Available Tools

| Tool | Purpose |
|------|---------|
| `locateElement` | Find a native UI element by visible text label via OCR, returns center `x`/`y` + bounding box |
| `getScreenElements` | List all visible text elements with their `x`/`y` positions |

### When to Use

- Clicking **native desktop software elements** (menus, buttons in native desktop tools)
- System dialogs, taskbar icons, Windows settings
- Visual context from video is scaled or ambiguous in native applications

### Native Desktop App Flow

1. `getScreenElements({max_items: 30})` → inspect visible text labels
2. `locateElement({label: "Save As"})` → get exact `x`/`y` physical coordinates
3. `mouseClick({x: <x>, y: <y>})` → click physical position