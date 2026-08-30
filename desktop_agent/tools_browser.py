"""
Browser automation via Playwright (Version 2.0).

Capabilities:
- Persistent profile support (cookies & logins saved across restarts)
- CDP attachment (connect to existing running Chrome/Edge on port 9222)
- Semantic Accessibility Tree extraction with numbered element IDs
- Resilient role-based & indexed element interaction (click, type, fill forms)
- Clean text / article content extraction (summaries, threads, articles)
- High-res full-page screenshots
- Standard navigation: open, tabs, search, back, forward, scroll
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import threading
from typing import Any, Dict, List, Optional
from urllib.parse import quote_plus

from .registry import STATE, ToolError, register

logger = logging.getLogger("desktop_agent.browser")

# Dedicated event loop + thread for Playwright async coroutines
_LOOP: Optional[asyncio.AbstractEventLoop] = None
_LOOP_THREAD: Optional[threading.Thread] = None
_LOOP_LOCK = threading.Lock()


def _get_loop() -> "asyncio.AbstractEventLoop":
    global _LOOP, _LOOP_THREAD
    with _LOOP_LOCK:
        if _LOOP is None or _LOOP.is_closed():
            _LOOP = asyncio.new_event_loop()
            _LOOP_THREAD = threading.Thread(target=_run_loop, daemon=True)
            _LOOP_THREAD.start()
        return _LOOP


def _run_loop() -> None:
    loop = _LOOP
    assert loop is not None
    asyncio.set_event_loop(loop)
    try:
        loop.run_forever()
    finally:
        try:
            loop.close()
        except Exception:
            pass


def _run(coro):
    """Submit a coroutine to the dedicated Playwright loop and block on it."""
    loop = _get_loop()
    future = asyncio.run_coroutine_threadsafe(coro, loop)
    return future.result(timeout=60)


# --- Browser Profile & Storage Path ------------------------------------------

def _get_profile_dir() -> str:
    local_app_data = os.getenv("LOCALAPPDATA") or os.path.expanduser("~")
    profile_dir = os.path.join(local_app_data, "AddyAI", "browser_profile")
    os.makedirs(profile_dir, exist_ok=True)
    return profile_dir


# --- Async Playwright lifecycle & Chrome Browser Engine --------------------

def _find_chrome_executable() -> Optional[str]:
    """Locate installed Google Chrome executable on Windows."""
    candidates = [
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Google\Chrome\Application\chrome.exe"),
        shutil.which("chrome.exe"),
        shutil.which("chrome"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _find_edge_executable() -> Optional[str]:
    """Locate installed Microsoft Edge executable on Windows as fallback."""
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES(X86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%PROGRAMFILES%\Microsoft\Edge\Application\msedge.exe"),
        shutil.which("msedge.exe"),
        shutil.which("msedge"),
    ]
    for p in candidates:
        if p and os.path.exists(p):
            return p
    return None


def _is_cdp_ready(port: int = 9222) -> bool:
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=0.8) as resp:
            return resp.status == 200
    except Exception:
        return False


def _spawn_native_browser_cdp(port: int = 9222, target_url: str = "") -> bool:
    """Auto-spawn Google Chrome (or Edge fallback) with remote debugging CDP enabled."""
    import subprocess
    import time

    if _is_cdp_ready(port):
        return True

    profile_dir = _get_profile_dir()

    # Clear stale locks in profile
    for lock_name in ["SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"]:
        lock_path = os.path.join(profile_dir, lock_name)
        if os.path.exists(lock_path):
            try:
                os.remove(lock_path)
            except Exception:
                pass

    browser_bin = _find_chrome_executable() or _find_edge_executable()
    if not browser_bin:
        browser_bin = "chrome.exe" if shutil.which("chrome.exe") else "msedge.exe"

    profile_arg = ["--profile-directory=Default"]

    try:
        cmd = [
            browser_bin,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}",
            *profile_arg,
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--start-maximized",
        ]
        if target_url:
            cmd.append(target_url)
        else:
            cmd.append("about:blank")
        subprocess.Popen(cmd, shell=False)
        for _ in range(16):
            time.sleep(0.25)
            if _is_cdp_ready(port):
                logger.info(f"[Browser] Successfully launched Chrome with CDP on port {port}")
                return True
    except Exception as err:
        logger.warning(f"[Browser] Could not auto-spawn Chrome with CDP: {err}")

    return _is_cdp_ready(port)


async def _ensure_browser_async(cdp_url: Optional[str] = None, target_url: str = "") -> Any:
    """Ensure Playwright browser / page is connected and active using Google Chrome."""
    global STATE

    if STATE.page is not None and STATE.context is not None:
        try:
            if not STATE.page.is_closed():
                return STATE.page
        except Exception:
            STATE.reset_playwright()

    if STATE.playwright is None:
        from playwright.async_api import async_playwright
        STATE.playwright = await async_playwright().start()

    target_cdp = cdp_url
    if not target_cdp:
        # Priority 1: Launch/connect to visible Chrome with CDP port 9222
        if _spawn_native_browser_cdp(9222, target_url=target_url):
            target_cdp = "http://127.0.0.1:9222"

    if target_cdp:
        try:
            if STATE.browser:
                try:
                    await STATE.browser.close()
                except Exception:
                    pass
            STATE.browser = await STATE.playwright.chromium.connect_over_cdp(target_cdp)
            contexts = STATE.browser.contexts
            STATE.context = contexts[0] if contexts else await STATE.browser.new_context()
            logger.info(f"[Browser] Connected to Chrome browser via CDP at {target_cdp}")
        except Exception as err:
            logger.warning(f"[Browser] CDP connection to {target_cdp} failed: {err}")
            STATE.context = None

    if STATE.context is None:
        # Priority 2: Launch Google Chrome persistent context directly via exact binary path
        profile_dir = _get_profile_dir()
        chrome_exe = _find_chrome_executable()
        launch_args = ["--start-maximized", "--no-sandbox", "--disable-blink-features=AutomationControlled"]
        
        try:
            launch_kwargs = {
                "user_data_dir": profile_dir,
                "headless": False,
                "args": launch_args,
                "viewport": None,
            }
            if chrome_exe:
                launch_kwargs["executable_path"] = chrome_exe
            else:
                launch_kwargs["channel"] = "chrome"

            STATE.context = await STATE.playwright.chromium.launch_persistent_context(**launch_kwargs)
            logger.info(f"[Browser] Launched native visible Google Chrome ({chrome_exe or 'channel:chrome'}).")
        except Exception as chrome_err:
            logger.warning(f"[Browser] Direct Chrome launch failed ({chrome_err}), checking Edge fallback...")
            STATE.reset_playwright()
            from playwright.async_api import async_playwright
            STATE.playwright = await async_playwright().start()
            edge_exe = _find_edge_executable()
            try:
                edge_kwargs = {
                    "user_data_dir": profile_dir,
                    "headless": False,
                    "args": launch_args,
                    "viewport": None,
                }
                if edge_exe:
                    edge_kwargs["executable_path"] = edge_exe
                else:
                    edge_kwargs["channel"] = "msedge"

                STATE.context = await STATE.playwright.chromium.launch_persistent_context(**edge_kwargs)
                logger.info(f"[Browser] Launched fallback Microsoft Edge ({edge_exe or 'channel:msedge'}).")
            except Exception as edge_err:
                logger.error(f"[Browser] Could not launch native Chrome or Edge: {edge_err}")
                STATE.context = await STATE.playwright.chromium.launch_persistent_context(
                    user_data_dir=profile_dir,
                    headless=False,
                    args=launch_args,
                    viewport=None,
                )
    pages = STATE.context.pages
    if pages:
        blank_pages = [p for p in pages if p.url in ("about:blank", "", "chrome://newtab/")]
        STATE.page = blank_pages[0] if blank_pages else pages[-1]
    else:
        STATE.page = await STATE.context.new_page()

    try:
        await STATE.page.bring_to_front()
    except Exception:
        pass

    return STATE.page


async def _page(target_url: str = "") -> Any:
    return await _ensure_browser_async(target_url=target_url)



def _bring_chrome_window_to_front() -> None:
    """Ensure the visible Google Chrome window is restored and focused in the foreground on Windows."""
    import sys
    if sys.platform != "win32":
        return
    try:
        import win32gui
        import win32con
        def enum_handler(hwnd, _):
            if win32gui.IsWindowVisible(hwnd):
                title = win32gui.GetWindowText(hwnd)
                if "Google Chrome" in title or "Chrome" in title:
                    win32gui.ShowWindow(hwnd, win32con.SW_RESTORE)
                    try:
                        win32gui.SetForegroundWindow(hwnd)
                    except Exception:
                        pass
            return True
        win32gui.EnumWindows(enum_handler, None)
    except Exception:
        pass

def _normalize_url(raw: str) -> str:
    url = raw.strip()
    if not url:
        raise ToolError("Empty URL.")
    if "://" not in url:
        url = "https://" + url
    return url


# --- Semantic Tree Formatter ------------------------------------------------

INTERESTING_ROLES = {
    "button", "link", "textbox", "searchbox", "combobox", "checkbox",
    "radio", "menuitem", "tab", "switch", "heading", "article",
}

def _flatten_accessibility_tree(node: Dict[str, Any], elements: Dict[int, Dict[str, Any]], counter: List[int], depth: int = 0) -> str:
    lines = []
    role = (node.get("role") or "").lower()
    name = (node.get("name") or "").strip()
    value = node.get("value")
    children = node.get("children", [])

    is_interactive = role in INTERESTING_ROLES and bool(name or value or role in ("textbox", "searchbox"))

    if is_interactive:
        counter[0] += 1
        elem_id = counter[0]
        elements[elem_id] = {
            "id": elem_id,
            "role": role,
            "name": name,
            "value": value,
        }
        val_str = f' (value="{value}")' if value else ""
        lines.append(f"{'  ' * depth}[{elem_id}] {role.capitalize()}: \"{name}\"{val_str}")

    for child in children:
        child_text = _flatten_accessibility_tree(child, elements, counter, depth + (1 if is_interactive else 0))
        if child_text:
            lines.append(child_text)

    return "\n".join(lines)


# --- Handlers ---------------------------------------------------------------

@register("desktopBrowserOpen")
async def browser_open(args: Dict[str, Any]) -> Dict[str, Any]:
    url = _normalize_url(args.get("url") or "https://www.google.com")
    page = await _page(target_url=url)
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        if STATE.context:
            all_pages = STATE.context.pages
            if len(all_pages) > 1:
                for p in all_pages:
                    if p != page and p.url in ("about:blank", "", "chrome://newtab/"):
                        try:
                            await p.close()
                        except Exception:
                            pass
        _bring_chrome_window_to_front()
    except Exception as e:
        raise ToolError(f"Could not open {url}: {e}")
    return {"result": f"Opened {url} in the visible Google Chrome browser.", "url": page.url, "title": await page.title()}


@register("desktopBrowserNavigate")
async def browser_navigate(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_open(args)


@register("browserOpen")
async def browser_open_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_open(args)


@register("browserNavigate")
async def browser_navigate_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_open(args)


@register("desktopBrowserConnectCdp")
async def browser_connect_cdp(args: Dict[str, Any]) -> Dict[str, Any]:
    """Connect to a running Chrome/Edge instance via Chrome DevTools Protocol."""
    port = int(args.get("port", 9222))
    cdp_url = args.get("cdpUrl") or f"http://127.0.0.1:{port}"
    try:
        page = await _ensure_browser_async(cdp_url=cdp_url)
        return {
            "result": f"Successfully connected to browser via CDP at {cdp_url}.",
            "url": page.url,
            "title": await page.title(),
        }
    except Exception as e:
        raise ToolError(f"Could not connect to browser via CDP at {cdp_url}. Ensure Chrome is running with '--remote-debugging-port={port}'. Error: {e}")


@register("desktopBrowserGetSemanticTree")
async def browser_get_semantic_tree(args: Dict[str, Any]) -> Dict[str, Any]:
    """Extract a compact semantic accessibility tree with numbered element IDs."""
    page = await _page()
    try:
        snapshot = await page.accessibility.snapshot(interesting_only=True)
        if not snapshot:
            return {"result": "Accessibility tree is empty or page not loaded.", "tree": "", "count": 0}

        elements: Dict[int, Dict[str, Any]] = {}
        counter = [0]
        tree_text = _flatten_accessibility_tree(snapshot, elements, counter)

        # Cache on global state for indexed clicking/typing
        STATE.semantic_elements = elements

        title = await page.title()
        return {
            "result": f"Extracted {len(elements)} interactive elements on '{title}'.",
            "url": page.url,
            "title": title,
            "count": len(elements),
            "tree": tree_text[:4000] if len(tree_text) > 4000 else tree_text,
        }
    except Exception as e:
        raise ToolError(f"Failed to extract accessibility tree: {e}")


@register("desktopBrowserClick")
async def browser_click(args: Dict[str, Any]) -> Dict[str, Any]:
    """Click an element by semantic ID, role/name, CSS selector, or visible text."""
    elem_id = args.get("id")
    role = args.get("role")
    name = args.get("name")
    selector = args.get("selector")
    text = args.get("text")

    page = await _page()
    try:
        if elem_id is not None:
            elem_id = int(elem_id)
            elem = STATE.semantic_elements.get(elem_id)
            if not elem:
                raise ToolError(f"Semantic element [{elem_id}] not found in cache. Call desktopBrowserGetSemanticTree first.")
            elem_role = elem.get("role")
            elem_name = elem.get("name")
            if elem_name:
                try:
                    await page.get_by_role(elem_role, name=elem_name).first.click(timeout=6000)
                    return {"result": f"Clicked [{elem_id}] {elem_role} '{elem_name}'."}
                except Exception:
                    await page.get_by_text(elem_name, exact=False).first.click(timeout=6000)
                    return {"result": f"Clicked [{elem_id}] text '{elem_name}'."}
            else:
                await page.get_by_role(elem_role).first.click(timeout=6000)
                return {"result": f"Clicked [{elem_id}] {elem_role}."}

        elif role and name:
            await page.get_by_role(str(role).lower(), name=str(name)).first.click(timeout=6000)
            return {"result": f"Clicked role '{role}' with name '{name}'."}
        elif selector:
            await page.locator(selector).first.click(timeout=6000)
            return {"result": f"Clicked selector '{selector}'."}
        elif text:
            await page.get_by_text(str(text), exact=False).first.click(timeout=6000)
            return {"result": f"Clicked text '{text}'."}
        else:
            raise ToolError("Provide 'id', 'role' + 'name', 'selector', or 'text' to click.")
    except Exception as e:
        raise ToolError(f"Click failed: {e}")


@register("desktopBrowserType")
async def browser_type(args: Dict[str, Any]) -> Dict[str, Any]:
    """Type text into a field targeted by semantic ID, selector, or current focus."""
    text = args.get("text")
    if text is None:
        raise ToolError("Parameter 'text' is required.")
    text = str(text)

    elem_id = args.get("id")
    selector = args.get("selector")
    clear_first = bool(args.get("clear", True))
    submit = bool(args.get("submit", False))

    page = await _page()
    try:
        if elem_id is not None:
            elem_id = int(elem_id)
            elem = STATE.semantic_elements.get(elem_id)
            if not elem:
                raise ToolError(f"Semantic element [{elem_id}] not found. Run desktopBrowserGetSemanticTree first.")
            elem_role = elem.get("role")
            elem_name = elem.get("name")
            target = page.get_by_role(elem_role, name=elem_name).first if elem_name else page.get_by_role(elem_role).first
            await target.scroll_into_view_if_needed(timeout=3000)
            await target.fill(text, timeout=6000)
        elif selector:
            await page.locator(selector).first.fill(text, timeout=6000)
        else:
            if clear_first:
                await page.keyboard.press("Control+A")
                await page.keyboard.press("Delete")
            await page.keyboard.type(text)

        if submit:
            await page.keyboard.press("Enter")

        return {"result": f"Typed {len(text)} characters{' and submitted' if submit else ''}."}
    except Exception as e:
        raise ToolError(f"Type failed: {e}")


@register("desktopBrowserFillForm")
async def browser_fill_form(args: Dict[str, Any]) -> Dict[str, Any]:
    """Fill multiple fields in a single step. fields = { selector_or_name: value, ... }"""
    fields = args.get("fields")
    submit = args.get("submit")
    if not isinstance(fields, dict) or not fields:
        raise ToolError("Parameter 'fields' (dict of selector/name -> value) is required.")

    page = await _page()
    filled = 0
    try:
        for key, val in fields.items():
            k_str = str(key)
            v_str = str(val)
            try:
                await page.fill(k_str, v_str, timeout=4000)
            except Exception:
                await page.get_by_label(k_str, exact=False).first.fill(v_str, timeout=4000)
            filled += 1

        if submit:
            try:
                await page.locator(str(submit)).first.click(timeout=4000)
            except Exception:
                await page.get_by_role("button", name=str(submit)).first.click(timeout=4000)
    except Exception as e:
        raise ToolError(f"Form fill failed after {filled} field(s): {e}")

    extra = " and submitted." if submit else "."
    return {"result": f"Filled {filled} form field(s){extra}"}


@register("desktopBrowserExtractText")
async def browser_extract_text(args: Dict[str, Any]) -> Dict[str, Any]:
    """Extract clean readable text or article markdown from the active web page."""
    max_chars = int(args.get("maxChars", 4000))
    page = await _page()
    try:
        title = await page.title()
        url = page.url
        text = await page.evaluate("""
            () => {
                const article = document.querySelector('article') || document.querySelector('main') || document.body;
                return article ? (article.innerText || article.textContent || '').trim() : '';
            }
        """)
        clean_text = re.sub(r"\n{3,}", "\n\n", text).strip()
        trimmed = clean_text[:max_chars] + ("..." if len(clean_text) > max_chars else "")
        return {
            "result": f"Extracted {len(clean_text)} characters from '{title}'.",
            "title": title,
            "url": url,
            "content": trimmed,
        }
    except Exception as e:
        raise ToolError(f"Extract text failed: {e}")


@register("desktopBrowserScreenshot")
async def browser_screenshot(args: Dict[str, Any]) -> Dict[str, Any]:
    """Capture a screenshot of the browser viewport or entire full page."""
    full_page = bool(args.get("fullPage", False))
    page = await _page()
    try:
        import base64
        screenshot_bytes = await page.screenshot(full_page=full_page)
        b64 = base64.b64encode(screenshot_bytes).decode("utf-8")
        return {
            "result": f"Captured {'full-page' if full_page else 'viewport'} screenshot.",
            "url": page.url,
            "dataUrl": f"data:image/png;base64,{b64}",
        }
    except Exception as e:
        raise ToolError(f"Screenshot failed: {e}")


@register("desktopBrowserOpenTab")
async def browser_open_tab(args: Dict[str, Any]) -> Dict[str, Any]:
    url = _normalize_url(args.get("url") or "about:blank")
    await _ensure_browser_async()
    ctx = STATE.context
    page = await ctx.new_page()
    STATE.page = page
    if url != "about:blank":
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=25000)
        except Exception as e:
            raise ToolError(f"Opened tab but navigation failed: {e}")
    return {"result": f"New tab opened at {url}.", "url": url}


@register("desktopBrowserCloseTab")
async def browser_close_tab(args: Dict[str, Any]) -> Dict[str, Any]:
    page = await _page()
    try:
        await page.close()
    except Exception:
        pass
    pages = STATE.context.pages if STATE.context else []
    STATE.page = pages[-1] if pages else None
    if STATE.page is None:
        return {"result": "Closed the last tab; browser now empty."}
    return {"result": f"Closed tab. Active tab now: {STATE.page.url}"}


@register("desktopBrowserSearch")
async def browser_search(args: Dict[str, Any]) -> Dict[str, Any]:
    query = args.get("query") or args.get("q")
    engine = (args.get("engine") or "google").strip().lower()
    if not query:
        raise ToolError("Parameter 'query' is required.")
    q = quote_plus(str(query))
    url = {
        "google": f"https://www.google.com/search?q={q}",
        "youtube": f"https://www.youtube.com/results?search_query={q}",
        "github": f"https://github.com/search?q={q}",
        "duckduckgo": f"https://duckduckgo.com/?q={q}",
        "bing": f"https://www.bing.com/search?q={q}",
        "twitter": f"https://x.com/search?q={q}",
        "reddit": f"https://www.reddit.com/search/?q={q}",
    }.get(engine)
    if not url:
        raise ToolError(f"Unsupported engine '{engine}'.")
    page = await _page()
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=25000)
    except Exception as e:
        raise ToolError(f"Search navigation failed: {e}")
    return {"result": f"Searched {engine} for '{query}'.", "url": page.url}


@register("desktopBrowserGoBack")
async def browser_go_back(args: Dict[str, Any]) -> Dict[str, Any]:
    page = await _page()
    try:
        await page.go_back(timeout=15000)
    except Exception as e:
        raise ToolError(f"Back failed: {e}")
    return {"result": f"Went back. Now on {page.url}."}


@register("desktopBrowserGoForward")
async def browser_go_forward(args: Dict[str, Any]) -> Dict[str, Any]:
    page = await _page()
    try:
        await page.go_forward(timeout=15000)
    except Exception as e:
        raise ToolError(f"Forward failed: {e}")
    return {"result": f"Went forward. Now on {page.url}."}


@register("browserSearch")
async def browser_search_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_search(args)


@register("browserClick")
async def browser_click_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_click(args)


@register("browserType")
async def browser_type_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_type(args)


@register("desktopBrowserScroll")
async def browser_scroll(args: Dict[str, Any]) -> Dict[str, Any]:
    direction = (args.get("direction") or "down").lower()
    amount = int(args.get("amount", 500))
    delta = amount if direction != "up" else -amount
    page = await _page()
    try:
        await page.mouse.wheel(0, delta)
    except Exception as e:
        raise ToolError(f"Scroll failed: {e}")
    return {"result": f"Scrolled {direction} {amount}px."}


@register("browserScroll")
async def browser_scroll_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_scroll(args)


@register("browserGoBack")
async def browser_go_back_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_go_back(args)


@register("desktopBrowserCdp")
async def browser_cdp(args: Dict[str, Any]) -> Dict[str, Any]:
    """Execute raw Chrome DevTools Protocol command."""
    method = args.get("method") or args.get("cdpMethod")
    params = args.get("params") or {}
    if not method:
        raise ToolError("Parameter 'method' (e.g. 'Network.enable', 'Page.reload') is required.")
    page = await _page()
    try:
        session = await page.context.new_cdp_session(page)
        result = await session.send(str(method), params if isinstance(params, dict) else {})
        return {"result": f"Executed CDP method '{method}'.", "output": result}
    except Exception as e:
        raise ToolError(f"CDP command '{method}' failed: {e}")


@register("browserCdp")
async def browser_cdp_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_cdp(args)


@register("desktopBrowserDialog")
async def browser_dialog(args: Dict[str, Any]) -> Dict[str, Any]:
    """Set handler for JavaScript browser dialogs (alert, confirm, prompt)."""
    action = (args.get("action") or "accept").lower()
    prompt_text = args.get("promptText") or args.get("text")
    page = await _page()
    try:
        async def _dialog_handler(dialog):
            if action == "accept":
                await dialog.accept(prompt_text or "")
            else:
                await dialog.dismiss()
        page.on("dialog", lambda d: asyncio.create_task(_dialog_handler(d)))
        return {"result": f"Browser dialog handler configured to '{action}'."}
    except Exception as e:
        raise ToolError(f"Failed to configure dialog handler: {e}")


@register("browserDialog")
async def browser_dialog_alias(args: Dict[str, Any]) -> Dict[str, Any]:
    return await browser_dialog(args)


# Wrap async handlers for synchronous dispatcher
def _sync_wrap(async_fn):
    def wrapper(args: Dict[str, Any]) -> Dict[str, Any]:
        return _run(async_fn(args))

    wrapper.__name__ = async_fn.__name__
    wrapper.__doc__ = async_fn.__doc__
    return wrapper


from .registry import TOOLS  # noqa: E402

ALL_ASYNC_BROWSER_TOOLS = [
    "desktopBrowserOpen",
    "desktopBrowserNavigate",
    "desktopBrowserConnectCdp",
    "desktopBrowserGetSemanticTree",
    "desktopBrowserClick",
    "desktopBrowserType",
    "desktopBrowserFillForm",
    "desktopBrowserExtractText",
    "desktopBrowserScreenshot",
    "desktopBrowserOpenTab",
    "desktopBrowserCloseTab",
    "desktopBrowserSearch",
    "desktopBrowserGoBack",
    "desktopBrowserGoForward",
    "desktopBrowserScroll",
    "desktopBrowserCdp",
    "desktopBrowserDialog",
    "browserOpen",
    "browserNavigate",
    "browserSearch",
    "browserClick",
    "browserType",
    "browserScroll",
    "browserGoBack",
    "browserCdp",
    "browserDialog",
]

for _name in ALL_ASYNC_BROWSER_TOOLS:
    if _name in TOOLS:
        _orig = TOOLS[_name]
        if asyncio.iscoroutinefunction(_orig):
            TOOLS[_name] = _sync_wrap(_orig)


def shutdown_browser() -> None:
    """Cleanly stop the Playwright browser on app shutdown."""
    if STATE.browser is None and STATE.context is None:
        return

    async def _stop():
        try:
            if STATE.context:
                await STATE.context.close()
        except Exception:
            pass
        try:
            if STATE.browser:
                await STATE.browser.close()
        except Exception:
            pass
        try:
            if STATE.playwright:
                await STATE.playwright.stop()
        except Exception:
            pass
        STATE.reset_playwright()

    try:
        _run(_stop())
    except Exception:
        STATE.reset_playwright()


__all__ = [
    "browser_open",
    "browser_navigate",
    "browser_connect_cdp",
    "browser_get_semantic_tree",
    "browser_click",
    "browser_type",
    "browser_fill_form",
    "browser_extract_text",
    "browser_screenshot",
    "browser_open_tab",
    "browser_close_tab",
    "browser_search",
    "browser_go_back",
    "browser_go_forward",
    "browser_scroll",
    "browser_cdp",
    "browser_dialog",
    "shutdown_browser",
]
