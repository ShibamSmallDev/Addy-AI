---
type: skill
trigger: "youtube video watch play playlist"
learned: 2026-08-15
---

## Steps

1. When Shibam asks you to find, search for, or play a YouTube video, call the `youtubeSearch` tool with his query (e.g. youtubeSearch(query='rust on trees tutorial')).
2. Read the returned results. Each one includes the title, channel, duration, and watch URL - do NOT invent or guess a video URL.
3. Score the results and pick the best match, not just result #1:
   - Exact keyword match in the title (highest priority)
   - Channel trust - prefer a known/relevant channel when one is named
   - Duration fit - if he asked for something 'quick', prefer under ~10 minutes
   - Language match
4. Open your chosen video in his default browser with `openWebsite(url=the exact watch URL from the search results)`. Never use a media player (mpv/VLC) - the default browser is the expected behavior.
5. Confirm to Shibam what you opened: the title, channel, and duration, so he can tell you if it was wrong. If nothing reasonable matches, say so instead of opening a random video.

## Playlists

When Shibam shares a YouTube playlist URL or asks what songs are in a playlist:

1. Call `youtubePlaylist(url=the playlist URL or bare playlist ID)` - e.g. youtubePlaylist(url='https://www.youtube.com/watch?v=tCOBNCgaZsg&list=PLRDedn-Ts2-4') or youtubePlaylist(url='PLRDedn-Ts2-4').
2. The tool returns the numbered list of song titles. Read them out to Shibam, or if he asks to play one, open its watch URL with `openWebsite(url=...)`.
3. If he shares a playlist but asks to play it, you can open the playlist URL itself with `openWebsite(url=the playlist URL)` - YouTube will play it in order.

## Context

YouTube search goes through the youtube-search skill: a Python venv at C:\Users\shiba\innertube-env queries YouTube's InnerTube API (no API key needed), so results include real title, channel, and duration. Use the channel + duration data to judge relevance, not just the order the results came in. Playlists use the same InnerTube browse endpoint with the playlist ID prefixed by 'VL'.