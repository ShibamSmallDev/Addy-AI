"""
Addy Desktop Control Agent — Central tool registry.

Each tool module registers handlers into a flat dict `TOOLS` mapping
tool_name -> callable(args: dict) -> dict.

Handlers return a plain dict, typically {"result": "<status string>"}.
Errors should raise ToolError(message) so main.py can map them to {error}.
Shared singletons (Playwright browser/page, confirmation store, etc.) live
on the `State` object so handlers stay stateless and easy to test.
"""

from __future__ import annotations

import importlib
import re
import threading
from typing import Any, Callable, Dict


class ToolError(Exception):
    """Raised by a tool handler to signal a clean, user-facing failure."""

    def __init__(self, message: str, *, fatal: bool = False):
        super().__init__(message)
        self.message = message
        self.fatal = fatal


def find_known_name(text: str, mapping: Dict[str, str]) -> str:
    """Return the mapped value for the longest known name embedded in ``text``.

    Handles model-supplied descriptors like "enter key", "press enter",
    "right button", "middle mouse click". Exact matches are expected to be
    checked by the caller first; unknown text returns "".
    """
    raw = text.strip().lower()
    for name in sorted(mapping, key=len, reverse=True):
        if re.search(rf"\b{re.escape(name)}\b", raw):
            return mapping[name]
    return ""


class State:
    """Process-wide shared state for tool handlers."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        # Confirmation tokens for dangerous (power) actions.
        # token -> {"action": <tool_name>, "expires": <epoch>}
        self.confirmations: Dict[str, Dict[str, Any]] = {}
        # Playwright singletons — lazily initialized on first browser tool use.
        self.playwright = None
        self.browser = None
        self.context = None
        self.page = None
        # Cache of indexed accessibility tree elements {id: {role, name, selector, ...}}
        self.semantic_elements: Dict[int, Dict[str, Any]] = {}

    def reset_playwright(self) -> None:
        """Tear down any cached Playwright resources (used on errors)."""
        try:
            self.semantic_elements.clear()
            if self.page is not None:
                self.page = None
            if self.context is not None:
                self.context = None
            if self.browser is not None:
                self.browser = None
            if self.playwright is not None:
                self.playwright = None
        except Exception:
            pass


STATE = State()

# tool_name -> handler(args: dict) -> dict
TOOLS: Dict[str, Callable[[Dict[str, Any]], Dict[str, Any]]] = {}


def register(name: str):
    """Decorator to register a handler under a tool name."""

    def deco(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        TOOLS[name] = fn
        return fn

    return deco


# The set of all tool names Addy may route to this agent.
# Kept in sync with the functionDeclarations added in server.ts.
DESKTOP_TOOL_NAMES = [
    # applications / websites / search
    "openApplication",
    "closeApplication",
    "openWebsite",
    "searchWeb",
    "searchYouTube",
    "searchGoogle",
    "searchGitHub",
    # files
    "createFile",
    "readFile",
    "readPdf",
    "renameFile",
    "deleteFile",
    "moveFile",
    "openFolder",
    "listFiles",
    "searchFiles",
    # pc control (volume + gated power)
    "volumeUp",
    "volumeDown",
    "muteToggle",
    "setVolume",
    "requestPowerAction",  # first step: issues a confirmation token
    "executePowerAction",  # second step: runs the gated action
    # windows
    "minimizeWindow",
    "maximizeWindow",
    "closeWindow",
    "switchApplication",
    # clipboard
    "copySelected",
    "pasteClipboard",
    "getClipboard",
    "clearClipboard",
    # mouse automation (Desktop Automation V1)
    "mouseMove",
    "mouseMoveRelative",
    "mouseGetPosition",
    "mouseClick",
    "mouseRightClick",
    "mouseDoubleClick",
    "mouseScroll",
    "mouseDrag",
    # keyboard automation
    "typeText",
    "pressKey",
    "pressKeyCombination",
    "holdKey",
    "releaseKey",
    "injectText",
    "injectTextAndSubmit",
    "keyboardMacro",
    # screenshot / screen reading
    "takeScreenshot",
    "saveScreenshot",
    "analyzeScreenshot",
    "readScreen",
    # screen vision (OCR-based element locator)
    "locateElement",
    "getScreenElements",
    # browser automation (Playwright — desktop-owned, separate from holographic UI)
    "desktopBrowserOpen",
    "desktopBrowserNavigate",
    "desktopBrowserOpenTab",
    "desktopBrowserCloseTab",
    "desktopBrowserSearch",
    "desktopBrowserClick",
    "desktopBrowserType",
    "desktopBrowserFillForm",
    "desktopBrowserGoBack",
    "desktopBrowserGoForward",
    "desktopBrowserScroll",
    "desktopBrowserGetSemanticTree",
    "desktopBrowserExtractText",
    "desktopBrowserScreenshot",
    "desktopBrowserConnectCdp",
    "desktopBrowserCdp",
    "desktopBrowserDialog",
    # coding assistance
    "createPythonFile",
    "runPythonScript",
    "createProjectFolder",
    "writeCodeFile",
    # system information
    "systemInfo",
    "gpuInfo",
    "temperatureInfo",
    # brightness control (V2)
    "brightnessUp",
    "brightnessDown",
    "setBrightness",
    # Windows auto-start management (V2)
    "enableAutoStart",
    "disableAutoStart",
    "getAutoStartStatus",
    # social & media connectors
    "socialYouTubeGetTranscript",
    "socialDiscordWebhookSend",
    "socialPostDraft",
]


# --- Eagerly import all tool modules so their @register decorators run. ---
# Each module is imported defensively: a hard import failure here would make
# the whole agent unstartable, which we want to avoid. The modules themselves
# keep optional-dependency imports lazy/try-except.
_MODULE_NAMES = [
    "tools_confirmation",
    "tools_applications",
    "tools_websites",
    "tools_search",
    "tools_files",
    "tools_pc",
    "tools_windows",
    "tools_clipboard",
    "tools_keyboard",
    "tools_mouse",
    "tools_screenshot",
    "tools_vision",
    "tools_browser",
    "tools_coding",
    "tools_system",
    "tools_startup",
    "tools_reach",
    "tools_social",
]


def load_all() -> None:
    for mod_name in _MODULE_NAMES:
        importlib.import_module(f".{mod_name}", package="desktop_agent")


__all__ = ["TOOLS", "STATE", "DESKTOP_TOOL_NAMES", "ToolError", "register", "load_all"]
