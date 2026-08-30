---
type: skill
trigger: "read webpage article fetch content transcript youtube github issues repo rss web search"
learned: 2026-08-16
---

## Internet Reading (content extraction without a browser)

Addy can READ the internet directly — fetch pages, transcripts, GitHub data, RSS feeds — without opening a browser window.

### Tools

| Tool | Purpose |
|------|---------|
| `readWebpage` | Fetch and return a webpage's text content |
| `webSearch` | Search the web, return results |
| `youtubeSearch` | Search YouTube, return top results with titles/watch URLs |
| `youtubeTranscript` | Get a video's transcript text |
| `youtubePlaylist` | List all song titles in a YouTube playlist |
| `githubRepo` | Get repo info/files |
| `githubIssues` | Search GitHub issues by keyword |
| `readRSS` | Read an RSS feed |

### When to Use

- **"What does this article say?"** — `readWebpage`
- **"Summarize this video"** — `youtubeTranscript`
- **"What songs are in this playlist?"** — `youtubePlaylist`
- **"Is there a known bug for this?"** — `githubIssues`
- **"Read me the news"** — `readRSS`

### Notes

- Use `readWebpage` to actually READ content — don't just open it in a browser.
- `youtubeSearch` returns structured results (title, channel, duration, URL); open the best match with `openWebsite(url=...)`.
- This is **separate** from `desktopBrowserSearch` (which drives a visible browser). Prefer these for quick content lookups.
- Prefer `readRSS` for recurring news/sources.