"""
Social media and messaging connectors for Addy.

Capabilities:
- Twitter/X: Search topics, draft posts, read threads via persistent Edge browser
- WhatsApp Web: Send voice-commanded messages via persistent Edge session
- YouTube: Extract full video transcripts and bulleted chapter summaries
- Discord: Send rich webhook alert cards & build completion notifications
- Safety: Draft & confirm preview payloads
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from .registry import STATE, ToolError, register

log = logging.getLogger("Addy.desktop.social")


# --- YouTube Transcript Extractor -------------------------------------------

def _extract_youtube_video_id(url_or_id: str) -> Optional[str]:
    raw = url_or_id.strip()
    if len(raw) == 11 and re.match(r"^[a-zA-Z0-9_-]{11}$", raw):
        return raw
    patterns = [
        r"(?:v=|\/)([0-9A-Za-z_-]{11}).*",
        r"youtu\.be\/([0-9A-Za-z_-]{11})",
        r"youtube\.com\/embed\/([0-9A-Za-z_-]{11})",
        r"youtube\.com\/shorts\/([0-9A-Za-z_-]{11})",
    ]
    for p in patterns:
        m = re.search(p, raw)
        if m:
            return m.group(1)
    return None


@register("socialYouTubeGetTranscript")
def youtube_get_transcript(args: Dict[str, Any]) -> Dict[str, Any]:
    """Fetch and return full transcript text for a YouTube video URL or ID."""
    url = args.get("url") or args.get("videoId") or ""
    if not url:
        raise ToolError("Parameter 'url' or 'videoId' is required.")

    video_id = _extract_youtube_video_id(str(url))
    if not video_id:
        raise ToolError(f"Could not extract YouTube video ID from '{url}'.")

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        transcript_list = YouTubeTranscriptApi.get_transcript(video_id, languages=['en', 'en-US', 'en-GB', 'a.en'])
        full_text = " ".join([t['text'] for t in transcript_list])
        clean_text = re.sub(r"\s+", " ", full_text).strip()

        duration = int(transcript_list[-1]['start'] + transcript_list[-1]['duration']) if transcript_list else 0
        minutes = duration // 60
        seconds = duration % 60

        preview = clean_text[:3000] + ("..." if len(clean_text) > 3000 else "")
        return {
            "result": f"Extracted transcript for YouTube video {video_id} ({minutes}m {seconds}s).",
            "videoId": video_id,
            "durationSeconds": duration,
            "charCount": len(clean_text),
            "transcript": preview,
        }
    except Exception as e:
        raise ToolError(f"Could not retrieve YouTube transcript: {e}")


# --- Discord Webhook Sender -------------------------------------------------

@register("socialDiscordWebhookSend")
def discord_webhook_send(args: Dict[str, Any]) -> Dict[str, Any]:
    """Send a formatted notification message or embed card to a Discord webhook."""
    webhook_url = args.get("webhookUrl") or args.get("url")
    content = args.get("content") or args.get("message")
    title = args.get("title")
    color = int(args.get("color", 0x5865F2))  # Discord Blurple

    if not webhook_url:
        raise ToolError("Parameter 'webhookUrl' is required.")
    if not content and not title:
        raise ToolError("Either 'content' or 'title' is required.")

    payload: Dict[str, Any] = {"username": "Addy AI"}
    if content:
        payload["content"] = str(content)

    if title:
        embed: Dict[str, Any] = {
            "title": str(title),
            "description": str(content or ""),
            "color": color,
        }
        fields = args.get("fields")
        if isinstance(fields, list):
            embed["fields"] = fields
        payload["embeds"] = [embed]

    try:
        import requests
        res = requests.post(webhook_url, json=payload, timeout=10)
        if res.status_code in (200, 204):
            return {"result": "Discord message delivered successfully."}
        return {"result": f"Discord webhook returned status {res.status_code}: {res.text}"}
    except Exception as e:
        raise ToolError(f"Failed to send Discord webhook: {e}")


# --- Social Media Post Drafter (With Safety Confirmation) --------------------

@register("socialPostDraft")
def social_post_draft(args: Dict[str, Any]) -> Dict[str, Any]:
    """Draft a social media post (Twitter/X, LinkedIn, Discord) for review before posting."""
    platform = (args.get("platform") or "twitter").lower()
    text = args.get("text")
    if not text:
        raise ToolError("Parameter 'text' is required.")
    text = str(text)

    char_limit = 280 if platform in ("twitter", "x") else 3000
    is_over_limit = len(text) > char_limit

    return {
        "result": f"Draft created for {platform.capitalize()}.",
        "platform": platform,
        "characterCount": len(text),
        "characterLimit": char_limit,
        "isOverLimit": is_over_limit,
        "draftText": text,
        "status": "ready_for_user_confirmation",
    }


__all__ = [
    "youtube_get_transcript",
    "discord_webhook_send",
    "social_post_draft",
]
