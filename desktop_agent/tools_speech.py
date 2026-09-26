"""
Proactive Voice & Speech Engine: Text-to-Speech synthesis on Windows desktop.

Uses Windows System.Speech.Synthesis (SAPI) with Microsoft Zira Desktop / Hazel,
enabling Addy to speak aloud to the user autonomously.
"""

from __future__ import annotations

import os
import platform
import re
import subprocess
import threading
from typing import Any, Dict

from .registry import ToolError, register

# Comprehensive regex to strip Unicode emojis, pictographs, symbols, and variation selectors
EMOJI_PATTERN = re.compile(
    "["
    "\U00010000-\U0010ffff"  # Supplemental symbols, pictographs, emojis
    "\u2600-\u27bf"          # Misc symbols & dingbats
    "\ufe00-\ufe0f"          # Variation selectors
    "\u200d"                 # Zero-width joiner
    "]+",
    flags=re.UNICODE
)

def _strip_emojis(text: str) -> str:
    if not text:
        return ""
    # Strip emojis and pictographs
    cleaned = EMOJI_PATTERN.sub("", text)
    # Strip roleplay asterisk actions like *giggles*, *smiles warmly*
    cleaned = re.sub(r"\*[^*]+\*", "", cleaned)
    # Normalize multiple whitespace
    return re.sub(r"\s+", " ", cleaned).strip()


def _speak_sync(text: str, voice: str = "Microsoft Zira Desktop", rate: int = 1, volume: int = 100) -> None:
    """Invoke Windows System.Speech SAPI synthesizer via PowerShell."""
    if platform.system() != "Windows":
        return

    clean_text = _strip_emojis(text)
    if not clean_text:
        return

    # Escape quotes and backslashes for PowerShell
    safe_text = clean_text.replace("`", "``").replace('"', '`"').replace("$", "`$")
    safe_voice = voice.replace('"', '`"')

    ps_script = f"""
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$installed = ($s.GetInstalledVoices()).VoiceInfo.Name
if ($installed -contains "{safe_voice}") {{
    $s.SelectVoice("{safe_voice}")
}} elseif ($installed.Count -gt 0) {{
    $s.SelectVoice($installed[0])
}}
$s.Rate = {rate}
$s.Volume = {volume}
$s.Speak("{safe_text}")
"""
    subprocess.run(
        ["powershell", "-NoProfile", "-NonInteractive", "-Command", ps_script],
        check=False,
        capture_output=True,
        timeout=30,
    )


@register("speakText")
def speak_text(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Speak text aloud through the computer speakers using native Windows TTS.

    Args:
        text (str): The text message for Addy to speak.
        voice (str): Optional voice name (default "Microsoft Zira Desktop").
        rate (int): Optional speed from -10 to 10 (default 1).
        volume (int): Optional volume from 0 to 100 (default 100).
        async_mode (bool): If true, speaks in background thread without waiting.
    """
    text = (args.get("text") or args.get("message") or "").strip()
    if not text:
        raise ToolError("Parameter 'text' is required.")

    voice = str(args.get("voice") or "Microsoft Zira Desktop")
    rate = max(-10, min(10, int(args.get("rate", 1))))
    volume = max(0, min(100, int(args.get("volume", 100))))
    async_mode = bool(args.get("async_mode", False))

    if async_mode:
        t = threading.Thread(target=_speak_sync, args=(text, voice, rate, volume), daemon=True)
        t.start()
        return {"result": f"Spoke (async): '{text[:60]}...'", "voice": voice}

    _speak_sync(text, voice, rate, volume)
    return {"result": f"Spoke: '{text[:60]}...'", "voice": voice}


__all__ = ["speak_text"]
