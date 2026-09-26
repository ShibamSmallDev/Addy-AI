"""
WhatsApp Web Watcher: Inspects WhatsApp Web for unread messages using the cloned Edge browser profile.

Reads unread badges and snippets without sending messages or marking chats as read.
"""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any, Dict, List

from .registry import ToolError, register


def _get_profile_dir() -> str:
    local_app_data = os.getenv("LOCALAPPDATA") or os.path.expanduser("~")
    return os.path.join(local_app_data, "AddyAI", "browser_profile")


@register("checkWhatsAppMessages")
def check_whatsapp_messages(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check WhatsApp Web for unread messages using the persistent Edge profile.

    Args:
        headless (bool): Run in background without showing browser window (default false, shows visible browser).
        timeout (int): Seconds to wait for page load (default 15).
    """
    headless = bool(args.get("headless", False))
    timeout_sec = int(args.get("timeout", 15))

    user_data_dir = _get_profile_dir()
    if not os.path.exists(user_data_dir):
        return {
            "logged_in": False,
            "unread_chats": 0,
            "chats": [],
            "result": "Browser profile not found. Please clone your Microsoft Edge profile first.",
        }

    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as p:
            # Launch persistent context using the cloned Edge profile
            # Search for msedge.exe first
            edge_paths = [
                r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            ]
            executable_path = next((path for path in edge_paths if os.path.exists(path)), None)

            launch_kwargs: Dict[str, Any] = {
                "user_data_dir": user_data_dir,
                "headless": headless,
                "args": [
                    "--no-first-run",
                    "--no-default-browser-check",
                    "--disable-blink-features=AutomationControlled",
                ],
            }
            if executable_path:
                launch_kwargs["executable_path"] = executable_path
            else:
                launch_kwargs["channel"] = "msedge"

            context = p.chromium.launch_persistent_context(**launch_kwargs)
            page = context.pages[0] if context.pages else context.new_page()

            page.goto("https://web.whatsapp.com", wait_until="domcontentloaded", timeout=timeout_sec * 1000)

            # Wait briefly for main chat container or login QR code
            time.sleep(4)

            # Check if QR code is visible (not logged in)
            is_qr = page.locator("canvas[aria-label='Scan this QR code to link a device'], div[data-ref]").count() > 0
            if is_qr:
                context.close()
                return {
                    "logged_in": False,
                    "unread_chats": 0,
                    "chats": [],
                    "result": "WhatsApp Web is not logged in. Please open web.whatsapp.com in Edge and scan the QR code to link your account.",
                }

            # Check for unread message badges
            # WhatsApp uses spans with aria-label containing 'unread' or data-icon='unread-count'
            unread_chats: List[Dict[str, Any]] = []

            # Query chat list rows
            chat_rows = page.locator("div[role='listitem'], div[role='row']").all()
            for row in chat_rows[:25]:
                try:
                    text_content = row.inner_text()
                    lines = [ln.strip() for ln in text_content.splitlines() if ln.strip()]
                    if not lines:
                        continue

                    # Look for unread badge indicator (numeric string in badge span or unread aria label)
                    has_unread = (
                        row.locator("span[data-icon='unread-count'], span[aria-label*='unread']").count() > 0
                        or any(re.match(r"^\d+$", ln) for ln in lines[-3:])
                    )

                    if has_unread and len(lines) >= 2:
                        sender = lines[0]
                        snippet = lines[1] if len(lines) > 1 else ""
                        unread_chats.append({
                            "sender": sender,
                            "snippet": snippet,
                            "details": lines[:4],
                        })
                except Exception:
                    continue

            context.close()

            if unread_chats:
                lines_formatted = [
                    f"• {c['sender']}: {c['snippet']}"
                    for c in unread_chats
                ]
                result_text = (
                    f"You have unread WhatsApp messages from {len(unread_chats)} contact(s):\n\n"
                    + "\n".join(lines_formatted)
                )
            else:
                result_text = "No unread WhatsApp messages."

            return {
                "logged_in": True,
                "unread_chats": len(unread_chats),
                "chats": unread_chats,
                "result": result_text,
            }

    except Exception as e:
        return {
            "logged_in": False,
            "error": str(e),
            "unread_chats": 0,
            "chats": [],
            "result": f"Could not inspect WhatsApp Web: {e}",
        }


__all__ = ["check_whatsapp_messages"]
