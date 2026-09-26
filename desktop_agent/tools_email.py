"""
Email Monitoring Engine: Headless IMAP reader for Gmail, Outlook, and standard mail servers.

Allows Addy to check unread emails in the background 24/7 without opening any browser windows.
Configuration is stored in data/email_config.json.
"""

from __future__ import annotations

import email
import email.header
import imaplib
import json
import os
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from .registry import ToolError, register

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
CONFIG_FILE = DATA_DIR / "email_config.json"


def _load_config() -> Dict[str, Any]:
    if CONFIG_FILE.exists():
        try:
            return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {}


def _save_config(config: Dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    CONFIG_FILE.write_text(json.dumps(config, indent=2), encoding="utf-8")


def _decode_mime_header(header_value: Optional[str]) -> str:
    """Decode MIME-encoded email headers (e.g. =?UTF-8?B?...)."""
    if not header_value:
        return ""
    try:
        decoded_parts = email.header.decode_header(header_value)
        result = []
        for content, encoding in decoded_parts:
            if isinstance(content, bytes):
                result.append(content.decode(encoding or "utf-8", errors="replace"))
            else:
                result.append(str(content))
        return " ".join(result)
    except Exception:
        return str(header_value)


def _extract_body_snippet(msg: email.message.Message, max_chars: int = 300) -> str:
    """Extract clean plain-text snippet from an email message."""
    body = ""
    try:
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                cdispo = str(part.get("Content-Disposition"))
                if ctype == "text/plain" and "attachment" not in cdispo:
                    payload = part.get_payload(decode=True)
                    if payload:
                        body = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
                        break
        else:
            payload = msg.get_payload(decode=True)
            if payload:
                body = payload.decode(msg.get_content_charset() or "utf-8", errors="replace")
    except Exception:
        pass

    # Clean whitespace and strip HTML tags if any leaked through
    cleaned = re.sub(r"<[^>]+>", " ", body)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:max_chars]


def _infer_imap_server(user_email: str) -> str:
    domain = user_email.split("@")[-1].lower() if "@" in user_email else ""
    if domain in ("gmail.com", "googlemail.com"):
        return "imap.gmail.com"
    if domain in ("outlook.com", "hotmail.com", "live.com", "office365.com"):
        return "outlook.office365.com"
    if domain in ("yahoo.com", "ymail.com"):
        return "imap.mail.yahoo.com"
    if domain in ("icloud.com", "me.com"):
        return "imap.mail.me.com"
    return f"imap.{domain}" if domain else "imap.gmail.com"


@register("configureEmail")
def configure_email(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Configure email account credentials for background monitoring.

    Args:
        email (str): Your email address (e.g. you@gmail.com).
        app_password (str): 16-letter App Password (for Gmail: Google Account -> App Passwords).
        imap_server (str): Optional IMAP server hostname (auto-detected if omitted).
        imap_port (int): Optional IMAP port (default 993).
    """
    user_email = (args.get("email") or "").strip()
    app_password = (args.get("app_password") or args.get("password") or "").strip()

    if not user_email or not app_password:
        raise ToolError("Both 'email' and 'app_password' are required.")

    imap_server = (args.get("imap_server") or "").strip() or _infer_imap_server(user_email)
    imap_port = int(args.get("imap_port", 993))

    # Test connection
    try:
        mail = imaplib.IMAP4_SSL(imap_server, imap_port, timeout=10)
        mail.login(user_email, app_password)
        mail.logout()
    except Exception as e:
        raise ToolError(f"Failed to connect to {imap_server} with provided credentials: {e}")

    config = {
        "email": user_email,
        "app_password": app_password,
        "imap_server": imap_server,
        "imap_port": imap_port,
        "enabled": True,
    }
    _save_config(config)
    return {"result": f"Email monitoring configured and verified successfully for {user_email} via {imap_server}."}


@register("checkEmails")
def check_emails(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Check for unread emails in your inbox, returning sender, subject, and snippet.

    Args:
        limit (int): Maximum unread emails to retrieve (default 5).
        mark_as_read (bool): If true, marks inspected emails as read (default false).
    """
    config = _load_config()
    user_email = config.get("email")
    app_password = config.get("app_password")
    imap_server = config.get("imap_server") or _infer_imap_server(user_email or "")
    imap_port = int(config.get("imap_port", 993))

    if not user_email or not app_password:
        return {
            "configured": False,
            "count": 0,
            "emails": [],
            "result": "Email monitoring is not yet configured. Run configureEmail(email, app_password) or add your 16-character App Password to start monitoring.",
        }

    limit = max(1, min(20, int(args.get("limit", 5))))
    mark_as_read = bool(args.get("mark_as_read", False))

    emails: List[Dict[str, Any]] = []
    try:
        mail = imaplib.IMAP4_SSL(imap_server, imap_port, timeout=12)
        mail.login(user_email, app_password)
        mail.select("INBOX", readonly=not mark_as_read)

        # Search for unread messages
        status, response = mail.search(None, "UNSEEN")
        if status != "OK":
            mail.logout()
            return {"configured": True, "count": 0, "emails": [], "result": "No unread emails."}

        msg_ids = response[0].split()
        total_unread = len(msg_ids)

        # Fetch latest N messages (reverse chronological)
        latest_ids = msg_ids[-limit:]
        latest_ids.reverse()

        for mid in latest_ids:
            try:
                fetch_cmd = "(RFC822)" if mark_as_read else "(BODY.PEEK[])"
                res, data = mail.fetch(mid, fetch_cmd)
                if res != "OK" or not data or not isinstance(data[0], tuple):
                    continue

                raw_email = data[0][1]
                msg = email.message_from_bytes(raw_email)

                sender = _decode_mime_header(msg.get("From"))
                subject = _decode_mime_header(msg.get("Subject"))
                date_str = _decode_mime_header(msg.get("Date"))
                snippet = _extract_body_snippet(msg)

                emails.append({
                    "id": mid.decode("utf-8", errors="replace"),
                    "from": sender,
                    "subject": subject,
                    "date": date_str,
                    "snippet": snippet,
                })
            except Exception:
                continue

        mail.logout()

        lines = [
            f"• From: {e['from']}\n  Subject: {e['subject']}\n  Snippet: {e['snippet'][:150]}..."
            for e in emails
        ]

        result_text = (
            f"You have {total_unread} unread email(s) ({len(emails)} shown):\n\n" + "\n\n".join(lines)
            if emails
            else "You have no unread emails."
        )

        return {
            "configured": True,
            "total_unread": total_unread,
            "count": len(emails),
            "emails": emails,
            "result": result_text,
        }

    except Exception as e:
        raise ToolError(f"Failed to check emails on {imap_server}: {e}")


__all__ = ["configure_email", "check_emails"]
