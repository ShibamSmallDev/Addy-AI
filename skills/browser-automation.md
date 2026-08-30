---
type: skill
trigger: "browser automation web navigation search click type fill form scroll tab edge semantic tree"
learned: 2026-08-16
---

## Desktop Browser Automation 2.0 (Microsoft Edge & Playwright)

> **STATUS: FULLY INSTALLED & ACTIVE**: Playwright 1.49.1 and native Microsoft Edge (`channel="msedge"`) are verified on this system. Never claim Playwright is missing or tell the user to install it. Call browser tools directly.

Addy controls a **real Microsoft Edge browser with persistent login profiles** (`desktop_agent/data/browser_profile/`), preserving logins for Twitter/X, GitHub, Reddit, LinkedIn, and Discord.

### Available Tools

| Tool | Purpose |
|------|---------|
| `desktopBrowserOpen` | Open any URL in Microsoft Edge |
| `desktopBrowserSearch` | Search Google, YouTube, GitHub, DuckDuckGo, Bing in Edge |
| `desktopBrowserGetSemanticTree` | **CRITICAL**: Return numbered interactive map of buttons, links, inputs with IDs (`[1]`, `[2]`, etc.) |
| `desktopBrowserClick` | Click element by numbered `id` from semantic tree, or CSS selector/text |
| `desktopBrowserType` | Type text into element by numbered `id` or CSS selector |
| `desktopBrowserFillForm` | Fill multiple inputs/fields and submit in 1 step |
| `desktopBrowserExtractText` | Extract clean, readable markdown/text without HTML clutter |
| `desktopBrowserScreenshot` | Capture high-res full-page or viewport screenshot |
| `desktopBrowserConnectCdp` | Attach to running Microsoft Edge instance via CDP (port 9222) |
| `desktopBrowserCdp` | Execute raw Chrome DevTools Protocol command (`method`, `params`) |
| `desktopBrowserDialog` | Configure automated JS dialog handler (`action="accept"/"dismiss"`, `promptText`) |
| `socialYouTubeGetTranscript` | Extract complete video subtitles and transcript |
| `desktopBrowserOpenTab` / `CloseTab` | Tab management |
| `desktopBrowserGoBack` / `GoForward` | History navigation |
| `desktopBrowserScroll` | Scroll up/down by pixels |

### Standard Browser Interaction Flow (NEVER use OCR for web)

1. `desktopBrowserOpen(url="https://...")` or `desktopBrowserSearch(query="...")`
2. `desktopBrowserGetSemanticTree()` → get numbered elements (`[1] Searchbox`, `[2] Button: "Submit"`)
3. `desktopBrowserType(id=1, text="...")` / `desktopBrowserClick(id=2)`
4. `desktopBrowserExtractText()` → read resulting article/post content cleanly