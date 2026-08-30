"""
Addy — Agent-Reach Internet Tools
===================================
New tool module for the desktop_agent sidecar (Python FastAPI on port 8765).

Adds 5 tools that give Addy the ability to *read* the internet content instead
of just *opening* it in a browser:

  readWebpage        — clean markdown of any URL via Jina Reader (zero API key)
  youtubeTranscript  — full transcript of a YouTube video via yt-dlp
  youtubeSearch      — search YouTube, returns titles + IDs (no browser needed)
  githubRepo         — repo overview + README via gh CLI
  webSearch          — semantic web search via agent-reach / Exa

Drop this file into desktop_agent/ alongside the other tools_*.py files,
then add "tools_reach" to _MODULE_NAMES in registry.py.

Dependencies (run once):
    pip install agent-reach yt-dlp
    winget install --id GitHub.cli && gh auth login
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Any, Dict
from urllib.parse import quote

from .registry import ToolError, register

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run(cmd: list[str], timeout: int = 30) -> str:
    """Run a subprocess, return stdout as string, raise ToolError on failure."""
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode != 0:
            raise ToolError(
                f"Command failed ({result.returncode}): {result.stderr.strip()[:300]}"
            )
        return result.stdout
    except subprocess.TimeoutExpired:
        raise ToolError(f"Command timed out after {timeout}s: {' '.join(cmd[:3])}")
    except FileNotFoundError:
        raise ToolError(
            f"Tool not found: '{cmd[0]}'. "
            "Run: pip install agent-reach yt-dlp  and  winget install GitHub.cli"
        )


def _strip_vtt(vtt_text: str) -> str:
    """Convert raw VTT subtitle file to clean readable text."""
    lines = vtt_text.splitlines()
    seen: set[str] = set()
    out: list[str] = []
    for line in lines:
        line = line.strip()
        # Skip headers, timestamps, and blank lines
        if not line or line.startswith("WEBVTT") or re.match(r"\d{2}:\d{2}", line):
            continue
        # Strip inline tags like <00:00:01.000><c>text</c>
        clean = re.sub(r"<[^>]+>", "", line).strip()
        # Deduplicate consecutive identical lines (VTT overlap)
        if clean and clean not in seen:
            out.append(clean)
            seen.add(clean)
    return " ".join(out)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

@register("readWebpage")
def read_webpage(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch a URL and return clean readable markdown via Jina Reader.
    No API key required. Works on almost any public webpage.

    Args:
        url (str): The full URL to read, e.g. https://example.com/article
    """
    url = (args.get("url") or "").strip()
    if not url:
        raise ToolError("Parameter 'url' is required.")
    if not url.startswith("http"):
        url = "https://" + url

    jina_url = f"https://r.jina.ai/{url}"
    try:
        result = subprocess.run(
            ["curl", "-s", "-L", "--max-time", "20", jina_url],
            capture_output=True, text=True, timeout=25, encoding="utf-8", errors="replace"
        )
        content = result.stdout.strip()
        if not content or len(content) < 50:
            raise ToolError(f"No readable content returned from {url}.")
        # Truncate very long pages at ~6000 chars (enough for most articles)
        if len(content) > 6000:
            content = content[:6000] + "\n\n[... content truncated ...]"
        return {"result": content, "url": url}
    except subprocess.TimeoutExpired:
        raise ToolError(f"Timed out reading {url} via Jina Reader.")


@register("youtubeTranscript")
def youtube_transcript(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Extract the full spoken transcript of a YouTube video using native yt_dlp & youtube_transcript_api.
    No external CLI binaries or API keys needed.

    Args:
        url (str): YouTube video URL or video ID.
    """
    url = (args.get("url") or args.get("videoId") or "").strip()
    if not url:
        raise ToolError("Parameter 'url' is required.")

    vid_match = re.search(r"(?:v=|youtu\.be/|shorts/|embed/)([A-Za-z0-9_-]{11})", url)
    vid_id = vid_match.group(1) if vid_match else url

    if not re.match(r"^[A-Za-z0-9_-]{11}$", vid_id):
        raise ToolError(f"Could not parse YouTube video ID from: {url}")

    # Method 1: Try youtube_transcript_api
    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript_data = None
        try:
            transcript_data = YouTubeTranscriptApi.get_transcript(vid_id)
        except Exception:
            try:
                transcript_data = YouTubeTranscriptApi().fetch(vid_id)
            except Exception:
                pass

        if transcript_data:
            lines = []
            for item in transcript_data:
                txt = getattr(item, 'text', None) or (item.get('text') if isinstance(item, dict) else str(item))
                if txt:
                    lines.append(txt)
            full_text = " ".join(lines)
            if len(full_text) > 8000:
                full_text = full_text[:8000] + "\n\n[... transcript truncated ...]"
            return {
                "result": full_text,
                "video_id": vid_id,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "char_count": len(full_text),
            }
    except Exception:
        pass

    # Method 2: Fallback to native yt_dlp subtitles download
    try:
        import yt_dlp
        with tempfile.TemporaryDirectory() as tmpdir:
            out_template = os.path.join(tmpdir, "%(id)s")
            ydl_opts = {
                "skip_download": True,
                "writeautomaticsub": True,
                "writesubtitles": True,
                "subtitleslangs": ["en", "en-US", "en-orig"],
                "outtmpl": out_template,
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f"https://www.youtube.com/watch?v={vid_id}"])

            vtt_files = list(Path(tmpdir).glob("*.vtt"))
            if not vtt_files:
                raise ToolError(
                    f"No English captions found for video {vid_id}. "
                    "The video may not have auto-captions or may be private."
                )
            vtt_text = vtt_files[0].read_text(encoding="utf-8", errors="replace")
            transcript = _strip_vtt(vtt_text)
            if len(transcript) > 8000:
                transcript = transcript[:8000] + "\n\n[... transcript truncated ...]"

            return {
                "result": transcript,
                "video_id": vid_id,
                "url": f"https://www.youtube.com/watch?v={vid_id}",
                "char_count": len(transcript),
            }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Could not retrieve transcript for {vid_id}: {e}")


@register("youtubeSearch")
def youtube_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search YouTube and return top results (title, channel, duration, url) without
    opening a browser.

    Args:
        query (str): The search query string.
        limit (int): Number of results to return (default 5, max 15).
    """
    query = (args.get("query") or args.get("q") or "").strip()
    if not query:
        raise ToolError("Parameter 'query' is required.")
    limit = min(max(int(args.get("limit", 5)), 1), 15)

    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist",
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            search_query = f"ytsearch{limit}:{query}"
            info = ydl.extract_info(search_query, download=False)
            entries = info.get("entries", []) if info else []

            results = []
            for e in entries:
                if not e:
                    continue
                vid_id = e.get("id") or ""
                title = e.get("title") or "YouTube Video"
                channel = e.get("uploader") or e.get("channel") or ""
                dur = e.get("duration")
                if isinstance(dur, (int, float)) and dur > 0:
                    dur_str = f"{int(dur // 60)}:{int(dur % 60):02d}"
                else:
                    dur_str = e.get("duration_string") or ""
                
                url = f"https://www.youtube.com/watch?v={vid_id}" if vid_id else (e.get("url") or "")
                results.append({
                    "id": vid_id,
                    "title": title,
                    "channel": channel,
                    "duration": dur_str,
                    "views": e.get("view_count", ""),
                    "url": url,
                })

            if not results:
                raise ToolError(f"No YouTube results found for: {query}")

            lines = [
                f"{i+1}. {r['title']} [{r.get('channel') or '?'} · {r.get('duration') or '?'}]\n   {r['url']}"
                for i, r in enumerate(results)
            ]
            return {
                "result": "\n".join(lines),
                "items": results,
            }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"YouTube search error: {e}")


@register("youtubePlaylist")
def youtube_playlist(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch the song/video titles in a YouTube playlist.

    Args:
        url (str): The playlist URL or playlist ID.
    """
    url = (args.get("url") or args.get("playlist") or args.get("id") or "").strip()
    if not url:
        raise ToolError("Parameter 'url' (playlist URL or ID) is required.")

    if not url.startswith("http"):
        url = f"https://www.youtube.com/playlist?list={url}"

    try:
        import yt_dlp
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": "in_playlist",
            "skip_download": True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            entries = info.get("entries", []) if info else []
            titles = [e.get("title") for e in entries if e and e.get("title")]

            if not titles:
                raise ToolError("Playlist returned no titles (may be private or empty).")

            return {
                "result": "\n".join(f"{i+1}. {t}" for i, t in enumerate(titles)),
                "items": titles,
                "title": info.get("title", "YouTube Playlist"),
            }
    except ToolError:
        raise
    except Exception as e:
        raise ToolError(f"Playlist lookup error: {e}")


# ---------------------------------------------------------------------------
# ---------------------------------------------------------------------------
# GitHub Tools (Native REST API + gh CLI fallback)
# ---------------------------------------------------------------------------

def _find_gh_binary() -> str:
    """Find gh CLI executable path."""
    import shutil
    bin_path = shutil.which("gh")
    if bin_path:
        return bin_path
    for candidate in [
        r"C:\Program Files\GitHub CLI\gh.exe",
        r"C:\Program Files (x86)\GitHub CLI\gh.exe",
        os.path.expanduser(r"~\AppData\Local\Programs\GitHub CLI\gh.exe"),
    ]:
        if os.path.exists(candidate):
            return candidate
    return "gh"

def _get_github_token() -> str:
    """Retrieve GitHub token from environment variables, .env file, or gh CLI."""
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
    if token:
        return token
    if os.path.exists(".env"):
        try:
            with open(".env", "r", encoding="utf-8") as fp:
                for line in fp:
                    line = line.strip()
                    if line.startswith("GITHUB_TOKEN=") or line.startswith("GH_TOKEN="):
                        token = line.split("=", 1)[1].strip().strip('"').strip("'")
                        if token:
                            return token
        except Exception:
            pass
    
    # Try gh auth token from installed GitHub CLI
    gh_bin = _find_gh_binary()
    try:
        res = subprocess.run([gh_bin, "auth", "token"], capture_output=True, text=True, timeout=5)
        if res.returncode == 0 and res.stdout.strip():
            return res.stdout.strip()
    except Exception:
        pass

    return ""

def _github_api_request(endpoint: str, params: Dict[str, Any] = None) -> Any:
    """Perform an authenticated GitHub REST API request."""
    import urllib.request
    import urllib.parse
    
    token = _get_github_token()
    url = f"https://api.github.com/{endpoint.lstrip('/')}"
    if params:
        query_str = urllib.parse.urlencode(params)
        url += f"?{query_str}"
        
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "Addy-AI-Desktop-Agent",
    }
    if token:
        headers["Authorization"] = f"token {token}"
        
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        err_body = err.read().decode("utf-8", errors="replace")
        try:
            err_json = json.loads(err_body)
            msg = err_json.get("message", err_body)
        except Exception:
            msg = err_body[:200]
        if err.code == 401:
            raise ToolError("GitHub API: Unauthorized. Please check or set GITHUB_TOKEN in your .env file.")
        elif err.code == 404:
            raise ToolError(f"GitHub API: Resource not found ({endpoint}).")
        elif err.code == 403 and "rate limit" in msg.lower():
            raise ToolError("GitHub API: Rate limit exceeded. Add a GITHUB_TOKEN in .env for 5,000 req/hr.")
        raise ToolError(f"GitHub API error ({err.code}): {msg}")
    except Exception as e:
        raise ToolError(f"GitHub connection failed: {e}")

@register("githubUser")
def github_user(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get authenticated GitHub user profile, repos count, and bio."""
    username = (args.get("username") or args.get("user") or "").strip()
    endpoint = f"users/{username}" if username else "user"
    data = _github_api_request(endpoint)
    
    login = data.get("login", "Unknown")
    name = data.get("name") or login
    bio = data.get("bio") or "No bio"
    public_repos = data.get("public_repos", 0)
    followers = data.get("followers", 0)
    html_url = data.get("html_url", "")
    
    summary = f"**GitHub User:** {name} (@{login})\nURL: {html_url}\nBio: {bio}\nRepos: {public_repos} | Followers: {followers}"
    return {"result": summary, "data": data}

@register("githubRepo")
def github_repo(args: Dict[str, Any]) -> Dict[str, Any]:
    """Get a GitHub repository description, topics, stars, and README."""
    repo = (args.get("repo") or args.get("url") or "").strip()
    if not repo:
        raise ToolError("Parameter 'repo' (owner/repo) is required.")

    repo = re.sub(r"https?://github\.com/", "", repo).rstrip("/")
    if repo.count("/") != 1:
        raise ToolError(f"Invalid repo format '{repo}'. Expected 'owner/repo'.")

    data = _github_api_request(f"repos/{repo}")
    
    readme_text = ""
    try:
        import base64
        readme_data = _github_api_request(f"repos/{repo}/readme")
        if readme_data and "content" in readme_data:
            content_bytes = base64.b64decode(readme_data["content"])
            readme_text = content_bytes.decode("utf-8", errors="replace")
    except Exception:
        pass

    if len(readme_text) > 3000:
        readme_text = readme_text[:3000] + "\n\n[... README truncated ...]"

    summary = (
        f"**{data.get('full_name', repo)}**\n"
        f"Stars: {data.get('stargazers_count', 0)} | Forks: {data.get('forks_count', 0)}\n"
        f"URL: {data.get('html_url', '')}\n"
        f"Description: {data.get('description') or 'No description'}\n"
        f"Language: {data.get('language') or 'N/A'}\n\n"
        f"README:\n{readme_text or '(No README found)'}"
    )
    return {"result": summary, "data": data}

@register("githubIssues")
def github_issues(args: Dict[str, Any]) -> Dict[str, Any]:
    """Search or list issues/PRs in a repository."""
    repo = (args.get("repo") or "").strip()
    query = (args.get("query") or args.get("q") or "").strip()
    state = (args.get("state") or "open").strip()
    limit = min(int(args.get("limit", 5)), 15)

    if not repo:
        raise ToolError("Parameter 'repo' (owner/repo) is required.")

    repo = re.sub(r"https?://github\.com/", "", repo).rstrip("/")
    
    if query:
        q_str = f"repo:{repo} is:issue {query}"
        if state != "all":
            q_str += f" is:{state}"
        res = _github_api_request("search/issues", {"q": q_str, "per_page": limit})
        items = res.get("items", [])
    else:
        items = _github_api_request(f"repos/{repo}/issues", {"state": state, "per_page": limit})

    if not items:
        return {"result": f"No issues found matching query in {repo}."}

    lines = [f"#{i.get('number')} [{i.get('state', 'open')}] {i.get('title')}\n  {i.get('html_url', '')}" for i in items[:limit]]
    return {
        "result": f"Issues in {repo}:\n\n" + "\n\n".join(lines),
        "items": items[:limit],
    }

@register("githubListRepos")
def github_list_repos(args: Dict[str, Any]) -> Dict[str, Any]:
    """List repositories for the authenticated user or a specified username."""
    username = (args.get("username") or args.get("user") or "").strip()
    endpoint = f"users/{username}/repos" if username else "user/repos"
    sort = args.get("sort", "updated")
    limit = min(int(args.get("limit", 10)), 20)
    
    items = _github_api_request(endpoint, {"sort": sort, "per_page": limit})
    if not items:
        return {"result": "No repositories found."}
        
    lines = [
        f"- **{r.get('name')}** (Stars: {r.get('stargazers_count', 0)}) - {r.get('description') or 'No description'}\n  {r.get('html_url')}"
        for r in items[:limit]
    ]
    return {
        "result": f"Repositories ({len(lines)} shown):\n\n" + "\n\n".join(lines),
        "items": items[:limit],
    }


@register("webSearch")
def web_search(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search the web semantically and return extracted search results.

    Args:
        query (str): The search query.
    """
    query = (args.get("query") or args.get("q") or "").strip()
    if not query:
        raise ToolError("Parameter 'query' is required.")

    import urllib.request
    import urllib.parse
    import re
    from html import unescape

    # Try agent-reach if valid command
    try:
        raw = _run(["agent-reach", "get", query], timeout=15)
        if raw and raw.strip():
            return {"result": raw[:5000]}
    except Exception:
        pass

    # Fallback: DuckDuckGo HTML extraction
    try:
        url = f"https://html.duckduckgo.com/html/?q={urllib.parse.quote(query)}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            html_content = resp.read().decode("utf-8", errors="replace")
            snippets = re.findall(r'class="result__snippet"[^>]*>(.*?)</a>', html_content, re.DOTALL)
            urls = re.findall(r'class="result__url"[^>]*>(.*?)</a>', html_content, re.DOTALL)
            results = []
            for u, s in zip(urls[:6], snippets[:6]):
                u_clean = unescape(re.sub(r'<[^>]+>', '', u)).strip()
                s_clean = unescape(re.sub(r'<[^>]+>', '', s)).strip()
                if s_clean:
                    results.append(f"• {u_clean}\n  {s_clean}")
            if results:
                return {"result": f"Search results for '{query}':\n\n" + "\n\n".join(results)}
    except Exception:
        pass

    search_url = f"https://www.google.com/search?q={urllib.parse.quote(query)}"
    return {"result": f"Web search for '{query}' prepared. URL: {search_url}"}


@register("readRSS")
def read_rss(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch and parse an RSS or Atom feed, returning the latest entries.

    Args:
        url   (str): The RSS/Atom feed URL.
        limit (int): Max entries to return (default 5).
    """
    url = (args.get("url") or "").strip()
    limit = min(int(args.get("limit", 5)), 20)
    if not url:
        raise ToolError("Parameter 'url' (feed URL) is required.")

    raw = _run(["agent-reach", "rss", url], timeout=20)
    lines = raw.strip().splitlines()
    # Take up to limit entries (agent-reach rss returns one per line)
    preview = "\n".join(lines[:limit])
    return {"result": preview, "total_lines": len(lines)}
