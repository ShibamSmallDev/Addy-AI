import logging
from typing import Any, Dict
from urllib.parse import quote
import webbrowser

from .registry import ToolError, register

logger = logging.getLogger("desktop_agent.websites")

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
    
    # Try opening via automation browser (Chrome) first
    try:
        from .tools_browser import _run, browser_open
        res = _run(browser_open({"url": target_url}))
        return {"result": f"Opened {target_url} in your Google Chrome browser.", "details": res}
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
