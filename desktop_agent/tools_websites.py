import logging
import os
import re
import subprocess
import sys
from typing import Any, Dict
from urllib.parse import quote
import webbrowser

from .registry import ToolError, register

logger = logging.getLogger("desktop_agent.websites")

# Extensions we can hand straight to the OS when a local file path is given.
_LOCAL_FILE_RE = re.compile(r"\.(pdf|docx?|xlsx?|pptx?|txt|md|csv|rtf|odt|ods|zip|mp4|mp3|wav|log|json|html?)$", re.I)


def looks_like_local_path(raw: Any) -> bool:
    """True when a string is a filesystem path, not a web URL.

    Without this, "C:\\Users\\me\\Downloads\\x.pdf" has no "://" so it gets
    blindly prefixed into "https://C:/Users/..." and the browser is sent to a
    garbage host instead of the file being opened.
    """
    t = str(raw or "").strip().strip('"').strip("'")
    if not t:
        return False
    low = t.lower()
    if low.startswith("file://"):
        return True
    if re.match(r"^[a-z]:[\\/]", low):          # C:\... or C:/...
        return True
    if low.startswith("\\\\"):                   # UNC \\server\share
        return True
    # POSIX absolute path that names a file, e.g. /home/me/notes.pdf
    if low.startswith("/") and _LOCAL_FILE_RE.search(low):
        return True
    return False


def open_local_file(path: str) -> str:
    """Open a local file with the OS default handler (PDF -> viewer, etc.)."""
    p = str(path).strip().strip('"').strip("'")
    if p.lower().startswith("file://"):
        from urllib.parse import urlparse, unquote

        p = unquote(urlparse(p).path)
        if re.match(r"^/[a-z]:", p, re.I):      # /C:/... -> C:/...
            p = p[1:]
    if not os.path.exists(p):
        raise ToolError(f"File not found: {p}")
    try:
        if sys.platform == "win32":
            os.startfile(p)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", p])
        else:
            subprocess.Popen(["xdg-open", p])
    except Exception as e:
        raise ToolError(f"Could not open {p}: {e}")
    return p

# Named shortcuts the model can request by friendly name.
SITE_URLS: Dict[str, str] = {
    "youtube": "https://www.youtube.com",
    "gmail": "https://mail.google.com",
    "chatgpt": "https://chatgpt.com",
    "openai": "https://chat.openai.com",
    "google": "https://www.google.com",
    "github": "https://github.com",
    "wikipedia": "https://www.wikipedia.org",
    "reddit": "https://www.reddit.com",
    "twitter": "https://twitter.com",
    "x": "https://x.com",
    "instagram": "https://www.instagram.com",
    "facebook": "https://www.facebook.com",
    "linkedin": "https://www.linkedin.com",
    "maps": "https://maps.google.com",
    "translate": "https://translate.google.com",
    "drive": "https://drive.google.com",
    "calendar": "https://calendar.google.com",
    "amazon": "https://www.amazon.com",
    "netflix": "https://www.netflix.com",
    "spotify": "https://open.spotify.com",
    "stack overflow": "https://stackoverflow.com",
    "stackoverflow": "https://stackoverflow.com",
    "huggingface": "https://huggingface.co",
}


def _normalize_url(raw: str) -> str:
    url = raw.strip()
    if not url:
        raise ToolError("Empty URL.")
    if "://" not in url:
        # Treat bare "youtube.com" as https://youtube.com
        url = "https://" + url
    return url


def open_url(url: str) -> str:
    """Open a URL in the default browser; returns the resolved URL."""
    url = _normalize_url(url)
    ok = webbrowser.open(url, new=2)  # new tab in a new window group if possible
    if not ok:
        raise ToolError(f"Failed to open default browser for {url}.")
    return url


@register("openWebsite")
def open_website(args: Dict[str, Any]) -> Dict[str, Any]:
    name = args.get("name")
    url = args.get("url")

    # A filesystem path is not a URL — open it with the OS handler instead of
    # mangling it into https://c/Users/...
    for candidate in (url, name):
        if candidate and looks_like_local_path(candidate):
            opened = open_local_file(str(candidate))
            return {
                "result": f"Opened the local file {opened} with its default application.",
                "kind": "local_file",
                "path": opened,
            }

    if name and not url:
        key = str(name).strip().lower()
        if key in SITE_URLS:
            url = SITE_URLS[key]
        else:
            # Treat the name itself as a domain if it looks like one.
            url = str(name)
    if not url and not name:
        raise ToolError("Provide 'name' (e.g. 'youtube') or 'url'.")

    target_url = _normalize_url(url or str(name))

    # Try opening via automation browser (Microsoft Edge) first
    try:
        from .tools_browser import _run, browser_open

        res = _run(browser_open({"url": target_url}))
        return {"result": f"Opened {target_url} in Microsoft Edge.", "details": res}
    except Exception as e:
        logger.info(f"browser_open failed ({e}), falling back to OS default browser...")
        resolved = open_url(target_url)
        return {"result": f"Opened {resolved} in your default browser."}


# Expose for sibling modules (tools_search).
def _build_search_url(engine: str, query: str) -> str:
    q = quote(query)
    base = {
        "google": f"https://www.google.com/search?q={q}",
        "youtube": f"https://www.youtube.com/results?search_query={q}",
        "github": f"https://github.com/search?q={q}&type=repositories",
        "chatgpt": f"https://www.google.com/search?q={q}",  # no search API
        "duckduckgo": f"https://duckduckgo.com/?q={q}",
        "bing": f"https://www.bing.com/search?q={q}",
        "amazon": f"https://www.amazon.com/s?k={q}",
        "wikipedia": f"https://en.wikipedia.org/w/index.php?search={q}",
    }
    if engine not in base:
        raise ToolError(
            f"Unsupported search engine '{engine}'. Choose from "
            f"{', '.join(sorted(base))}."
        )
    return base[engine]


__all__ = ["open_website", "open_url", "SITE_URLS", "_build_search_url"]
