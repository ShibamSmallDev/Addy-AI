---
type: skill
trigger: "open application website folder file search launch close app window switch volume power"
learned: 2026-08-16
---

## Desktop Apps, Files, Windows & System Control

Addy can open/close applications and websites, manage files and folders, control windows, volume, and power.

### Apps / Websites / Search

| Tool | Purpose |
|------|---------|
| `openApplication` | Launch a desktop application by name |
| `closeApplication` | Close a running application |
| `openWebsite` | Open a URL/site in the default browser (shortcuts: youtube, gmail, github, etc.) |
| `searchWeb` / `searchGoogle` | Web search (opens browser) |
| `searchYouTube` / `searchGitHub` | Targeted site search |

### Files

| Tool | Purpose |
|------|---------|
| `createFile` / `readFile` / `renameFile` / `deleteFile` / `moveFile` | File operations |
| `readPdf` | Extract text from a PDF (pypdf) — use for project reports, documents, books |
| `openFolder` | Open a folder in Explorer |
| `listFiles` | List files in a directory |
| `searchFiles` | Search files by name/pattern |

### Windows

| Tool | Purpose |
|------|---------|
| `minimizeWindow` / `maximizeWindow` / `closeWindow` | Window state |
| `switchApplication` | Switch to another app/window |

### PC Control & System

| Tool | Purpose |
|------|---------|
| `volumeUp` / `volumeDown` / `muteToggle` / `setVolume` | Volume control |
| `requestPowerAction` / `executePowerAction` | Power actions (sleep/restart/shutdown) — **request permission first** |
| `systemInfo` / `gpuInfo` / `temperatureInfo` | System diagnostics |
| `brightnessUp` / `brightnessDown` / `setBrightness` | Display brightness |
| `enableAutoStart` / `disableAutoStart` / `getAutoStartStatus` | Windows startup management |

### Clipboard

| Tool | Purpose |
|------|---------|
| `copySelected` | Copy selected text |
| `pasteClipboard` | Paste clipboard contents |
| `getClipboard` | Read current clipboard |
| `clearClipboard` | Clear clipboard |

### When to Use

- **"Open Chrome / open my email / open that folder"**
- **"Switch to Excel / minimize this / close that window"**
- **"Turn up volume / take a screenshot of system info"**
- **"Move this file / rename that / find the file"**
- Combined flows: open app → wait → click via `locateElement` → keyboard input

### Notes

- **NEVER guess an absolute path like `C:\Users\X\...`** — you don't know the username. Use a folder alias (`downloads`, `documents`, `desktop`, `home`, `pictures`, `music`, `videos`) or `~` instead: `openFolder({path: "downloads"})`.
- **Power actions need explicit confirmation** before `executePowerAction`.
- Use `getScreenElements` after opening an app to see what's on screen.
- Prefer `searchWeb` for unknown URLs; never guess a URL — use `openWebsite` only with a real URL or known shortcut.