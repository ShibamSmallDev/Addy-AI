---
type: skill
trigger: "mouse move click drag scroll keyboard type press key macro inject text"
learned: 2026-08-16
---

## Mouse & Keyboard Control (Desktop Automation)

Addy can drive the physical mouse and keyboard on the host machine — for native apps, dialogs, and anything not reachable via browser automation.

### Mouse Tools

| Tool | Purpose |
|------|---------|
| `mouseMove` | Move cursor to absolute `x`/`y` screen coordinates |
| `mouseMoveRelative` | Move cursor by `dx`/`dy` offset |
| `mouseGetPosition` | Return current cursor position |
| `mouseClick` | Click at `x`/`y` (or current position) |
| `mouseRightClick` | Right-click at `x`/`y` |
| `mouseDoubleClick` | Double-click at `x`/`y` |
| `mouseDown` / `mouseUp` | Press/release button (drag support) |
| `mouseScroll` | Scroll wheel by amount |
| `mouseDrag` | Drag from `x`/`y` to `to_x`/`to_y` |

### Keyboard Tools

| Tool | Purpose |
|------|---------|
| `typeText` | Type a string into focused element |
| `injectText` | Direct text injection (clipboard-based, faster) |
| `injectTextAndSubmit` | Inject text + press Enter |
| `pressKey` | Press a single key |
| `pressKeyCombination` | Press key combo (e.g. Ctrl+S) |
| `keyboardMacro` | Sequence of keys/typed text |
| `holdKey` / `releaseKey` | Hold/release a modifier key |

### When to Use

- Clicking **native app elements**, taskbar icons, system dialogs
- **Keyboard shortcuts** and fast text entry
- Drag & drop, scrolling, precise cursor placement
- Any interaction that **browser automation can't reach**

### Key Rules

- **Always get real coordinates via `locateElement` / `getScreenElements`** before clicking — never estimate from scaled video.
- Use `mouseGetPosition` to check current cursor state when unsure.
- Prefer `injectText` over `typeText` for long strings (faster, no per-key delay).
- Use `pressKeyCombination` with modifier keys, e.g. `{modifiers:["ctrl"], key:"s"}`.

### Example

| Request | Tool Chain |
|---------|------------|
| "Click the File menu then Save As" | `locateElement(label='File')` → `mouseClick(x,y)` → `locateElement(label='Save As')` → `mouseClick(x,y)` |
| "Type the report name and press enter" | `injectTextAndSubmit(text='Q3 Report')` |
| "Drag that window to the right" | `mouseDrag(x, y, to_x, to_y)` |