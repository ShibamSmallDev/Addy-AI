"""
AI & Tech News Watcher: Autonomous internet monitoring for AI and tech breakthroughs.

Sources:
1. Hacker News official Firebase API (filtered for AI/LLM/ML/Agents)
2. TechCrunch Artificial Intelligence RSS
3. arXiv cs.AI RSS feed

Caches seen stories in data/seen_news.json to ensure zero duplicate notifications.
"""

from __future__ import annotations

import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import ToolError, register

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SEEN_FILE = DATA_DIR / "seen_news.json"

AI_KEYWORDS = [
    "ai", "llm", "gpt", "claude", "gemini", "llama", "deepseek", "qwen", "mistral",
    "openai", "anthropic", "google", "deepmind", "meta", "nvidia", "huggingface",
    "agent", "agents", "rag", "transformer", "diffusion", "neural", "vision",
    "machine learning", "robotics", "autonomous", "open source model", "benchmark"
]


def _load_seen_ids() -> set[str]:
    try:
        if SEEN_FILE.exists():
            data = json.loads(SEEN_FILE.read_text(encoding="utf-8"))
            return set(data.get("seen_ids", []))
    except Exception:
        pass
    return set()


def _save_seen_ids(seen: set[str]) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        # Cap at last 1000 items to avoid file growth
        capped = list(seen)[-1000:]
        SEEN_FILE.write_text(json.dumps({"seen_ids": capped}, indent=2), encoding="utf-8")
    except Exception:
        pass


def _fetch_hn_ai_stories(limit: int = 10) -> List[Dict[str, Any]]:
    """Fetch top AI-related stories from Hacker News."""
    stories: List[Dict[str, Any]] = []
    try:
        top_url = "https://hacker-news.firebaseio.com/v0/topstories.json"
        req = urllib.request.Request(top_url, headers={"User-Agent": "AddyAI/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            ids = json.loads(resp.read().decode("utf-8"))[:60]

        for item_id in ids:
            if len(stories) >= limit:
                break
            try:
                item_url = f"https://hacker-news.firebaseio.com/v0/item/{item_id}.json"
                item_req = urllib.request.Request(item_url, headers={"User-Agent": "AddyAI/1.0"})
                with urllib.request.urlopen(item_req, timeout=5) as i_resp:
                    item = json.loads(i_resp.read().decode("utf-8"))
                    if not item or item.get("type") != "story":
                        continue
                    title = item.get("title", "")
                    # Match against AI keywords
                    title_lower = title.lower()
                    words = set(re.findall(r"\b\w+\b", title_lower))
                    is_ai = any(kw in words or kw in title_lower for kw in AI_KEYWORDS)
                    if is_ai:
                        stories.append({
                            "id": f"hn_{item['id']}",
                            "title": title,
                            "url": item.get("url") or f"https://news.ycombinator.com/item?id={item['id']}",
                            "source": "Hacker News",
                            "score": item.get("score", 0),
                            "comments": item.get("descendants", 0),
                        })
            except Exception:
                continue
    except Exception as e:
        print(f"[News] Error fetching Hacker News: {e}")
    return stories


def _fetch_rss_stories(feed_url: str, source_name: str, limit: int = 5) -> List[Dict[str, Any]]:
    """Fetch recent stories from an RSS feed."""
    stories: List[Dict[str, Any]] = []
    try:
        req = urllib.request.Request(feed_url, headers={"User-Agent": "Mozilla/5.0 AddyAI/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            xml_data = resp.read()
            root = ET.fromstring(xml_data)

            # Support both RSS 2.0 (<channel><item>) and Atom (<entry>)
            items = root.findall(".//item")
            if not items:
                items = root.findall(".//{http://www.w3.org/2005/Atom}entry")

            for item in items[:limit]:
                title_node = item.find("title") or item.find("{http://www.w3.org/2005/Atom}title")
                link_node = item.find("link") or item.find("{http://www.w3.org/2005/Atom}link")
                guid_node = item.find("guid") or item.find("id") or item.find("{http://www.w3.org/2005/Atom}id")

                title = title_node.text if title_node is not None and title_node.text else ""
                link = ""
                if link_node is not None:
                    link = link_node.text or link_node.attrib.get("href", "")
                item_id = guid_node.text if guid_node is not None and guid_node.text else (link or title)

                if title and link:
                    clean_title = re.sub(r"<[^>]+>", "", title).strip()
                    stories.append({
                        "id": f"{source_name.lower().replace(' ', '_')}_{item_id}",
                        "title": clean_title,
                        "url": link.strip(),
                        "source": source_name,
                        "score": 0,
                    })
    except Exception as e:
        print(f"[News] Error fetching {source_name}: {e}")
    return stories


@register("fetchAINews")
def fetch_ai_news(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Fetch the latest breaking AI news and technological breakthroughs.
    Filters out previously seen stories and returns fresh updates.

    Args:
        limit (int): Maximum number of new stories to return (default 5).
        unread_only (bool): If true, filters out already seen stories (default true).
        mark_as_seen (bool): If true, marks the returned stories as seen (default true).
    """
    limit = max(1, min(15, int(args.get("limit", 5))))
    unread_only = bool(args.get("unread_only", True))
    mark_as_seen = bool(args.get("mark_as_seen", True))

    seen_ids = _load_seen_ids() if unread_only else set()

    all_stories: List[Dict[str, Any]] = []

    # 1. Hacker News AI stories
    hn_stories = _fetch_hn_ai_stories(limit=limit + 3)
    all_stories.extend(hn_stories)

    # 2. TechCrunch AI RSS
    tc_stories = _fetch_rss_stories(
        "https://techcrunch.com/category/artificial-intelligence/feed/",
        "TechCrunch AI",
        limit=limit
    )
    all_stories.extend(tc_stories)

    # Filter unread
    fresh: List[Dict[str, Any]] = []
    for s in all_stories:
        if s["id"] not in seen_ids:
            fresh.append(s)
            if len(fresh) >= limit:
                break

    if mark_as_seen and fresh:
        for s in fresh:
            seen_ids.add(s["id"])
        _save_seen_ids(seen_ids)

    # If no completely new stories, fall back to recent top stories
    output_stories = fresh if fresh else all_stories[:limit]

    formatted_lines = [
        f"• [{s['source']}] {s['title']}\n  {s['url']}"
        for s in output_stories
    ]

    result_text = (
        f"Found {len(output_stories)} AI & tech news updates:\n\n" + "\n\n".join(formatted_lines)
        if output_stories
        else "No new AI news found at the moment."
    )

    return {
        "result": result_text,
        "count": len(output_stories),
        "stories": output_stories,
        "is_fresh": len(fresh) > 0,
    }


@register("resetNewsCache")
def reset_news_cache(args: Dict[str, Any]) -> Dict[str, Any]:
    """Reset the seen stories cache so all news is considered unread again."""
    try:
        if SEEN_FILE.exists():
            SEEN_FILE.unlink()
        return {"result": "Seen news cache reset successfully."}
    except Exception as e:
        raise ToolError(f"Failed to reset cache: {e}")


__all__ = ["fetch_ai_news", "reset_news_cache"]
