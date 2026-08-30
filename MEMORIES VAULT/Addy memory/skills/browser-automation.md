---
type: skill
trigger: "browser automation web navigation search click type fill form scroll tab"
learned: 2026-08-16
---

## Desktop Browser Automation (Playwright)

Addy controls a **real, persistent Chromium browser** via the Python desktop agent — independent of the holographic BrowserAgent and any local-agent.js server.

### Available Tools

| Tool | Purpose |
|------|---------|
| `desktopBrowserOpen` | Open a URL (or search if no scheme) |
| `desktopBrowserNavigate` | Alias for open |
| `desktopBrowserOpenTab` | Open new tab, optionally navigate |
| `desktopBrowserCloseTab` | Close current tab |
| `desktopBrowserSearch` | Search Google/YouTube/GitHub/DuckDuckGo/Bing |
| `desktopBrowserClick` | Click by CSS selector or visible text |
| `desktopBrowserType` | Type into focused element or selector |
| `desktopBrowserFillForm` | Fill multiple fields at once, optional submit |
| `desktopBrowserGoBack` / `GoForward` | Navigation history |
| `desktopBrowserScroll` | Scroll up/down by pixels |

### When to Use

- Shibam asks you to **open a site, search the web, fill a form, click a button, scroll, or navigate tabs**
- You need to **interact with a real page** (not just fetch content)
- Multi-step browser workflows: search → click result → fill form → submit

### Examples

| Request | Tool Chain |
|---------|------------|
| "Open GitHub and search for rust async" | `desktopBrowserOpen(url='https://github.com')` → `desktopBrowserFillForm` → `desktopBrowserClick` |
| "Search YouTube for blender tutorial and play first result" | `desktopBrowserSearch(query='blender tutorial', engine='youtube')` → `desktopBrowserClick(selector='a#video-title')` |
| "Fill login on example.com with user:admin pass:1234" | `desktopBrowserOpen(url='example.com')` → `desktopBrowserFillForm(fields={'#user':'admin','#pass':'1234'}, submit='#login-btn')` |

### Tips

- The browser is **headed** (visible) and persistent across calls — tabs stay open.
- Use `desktopBrowserSearch` for any web search; don't guess URLs.
- For form filling, prefer `desktopBrowserFillForm` with CSS selectors.
- If a page loads slowly, the tool waits for `domcontentloaded` (20s timeout).
- This is **separate** from `browserOpen`/`browserSearch` (which open the user's default browser). Use `desktopBrowser*` when you need to *drive* the page programmatically.