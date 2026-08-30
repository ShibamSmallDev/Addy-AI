"""
Addy Desktop Control Agent — FastAPI entrypoint.

Single dispatch endpoint POST /execute { tool, args } -> { result } | { error }.
Addy's Node bridge (server.ts) calls this over HTTP on 127.0.0.1:8765.

Run:
    uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765
or:
    python -m desktop_agent.main
"""

from __future__ import annotations

import logging
import os
import sys
import traceback
from contextlib import asynccontextmanager
from typing import Any, Dict

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .registry import DESKTOP_TOOL_NAMES, TOOLS, ToolError, load_all

# ───────────────────────────────────────────────────────────────────────────
# DPI awareness — must be set BEFORE any tool module is loaded (load_all()),
# because pyautogui, PIL.ImageGrab, and any pywin32 call into Win32 GDI/User32
# inherit the process DPI context at first import. Without this, on any display
# with scaling > 100%, mouse coordinates reported by OCR will be offset from
# where the cursor actually lands by the scaling factor.
# ───────────────────────────────────────────────────────────────────────────
if sys.platform == "win32":
    try:
        import ctypes
        # PROCESS_PER_MONITOR_DPI_AWARE = 2 — correct behaviour on mixed-DPI
        # multi-monitor setups. Runs first so pyautogui/PIL inherit it.
        ctypes.windll.shcore.SetProcessDpiAwareness(2)
    except Exception:
        try:
            # Fallback for older Windows (pre-8.1) that lacks shcore.
            ctypes.windll.user32.SetProcessDPIAware()
        except Exception:
            pass

logging.basicConfig(
    level=logging.INFO,
    format="[%(asctime)s] [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("Addy.desktop")


# Load all tool modules so their handlers register before the app starts.
load_all()
log.info("Loaded %d desktop tools: %s", len(TOOLS), ", ".join(sorted(TOOLS)))


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("Addy Desktop Control Agent v%s starting up.", __version__)
    yield
    # Clean shutdown of the Playwright browser if it was started.
    try:
        from .tools_browser import shutdown_browser

        shutdown_browser()
    except Exception as e:  # noqa: BLE001
        log.warning("Browser shutdown error: %s", e)
    log.info("Addy Desktop Control Agent stopped.")


app = FastAPI(
    title="Addy Desktop Control Agent",
    version=__version__,
    description="JARVIS-style desktop automation backend for Addy.",
    lifespan=lifespan,
)

# Same-origin Node bridge is the only caller; allow localhost origins flexibly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ExecuteRequest(BaseModel):
    tool: str
    args: Dict[str, Any] = {}


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None
    tool: str


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "name": "Addy Desktop Control Agent",
        "version": __version__,
        "tools": sorted(TOOLS.keys()),
        "tool_count": len(TOOLS),
    }


@app.get("/tools")
def list_tools() -> Dict[str, Any]:
    return {"tools": sorted(TOOLS.keys()), "count": len(TOOLS)}


@app.get("/mouse/position")
def get_mouse_position() -> Dict[str, Any]:
    try:
        import pyautogui
        x, y = pyautogui.position()
        return {"x": int(x), "y": int(y)}
    except Exception:
        return {"x": 0, "y": 0}



@app.post("/execute", response_model=ExecuteResponse)
def execute(req: ExecuteRequest) -> ExecuteResponse:
    tool = req.tool
    args = req.args or {}
    log.info("EXEC tool=%s args=%s", tool, _short_args(args))

    if tool not in TOOLS:
        known = ", ".join(sorted(TOOLS.keys()))
        return ExecuteResponse(
            ok=False,
            error=f"Unknown tool '{tool}'. Known tools: {known}",
            tool=tool,
        )

    handler = TOOLS[tool]
    try:
        out = handler(args)
    except ToolError as e:
        log.warning("ToolError in %s: %s", tool, e.message)
        return ExecuteResponse(ok=False, error=e.message, tool=tool)
    except Exception as e:  # noqa: BLE001
        log.error("Unhandled error in %s: %s\n%s", tool, e, traceback.format_exc())
        return ExecuteResponse(
            ok=False,
            error=f"Internal error in {tool}: {e}",
            tool=tool,
        )

    # Handlers return dicts like {"result": "..."}; pass the whole payload.
    result_text = ""
    if isinstance(out, dict):
        result_text = str(out.get("result", out))
    else:
        result_text = str(out)
    log.info("DONE tool=%s -> %s", tool, result_text[:160])

    return ExecuteResponse(ok=True, result=out, tool=tool)


def _short_args(args: Dict[str, Any]) -> str:
    """Compact, log-safe representation of args (truncate long values)."""
    parts = []
    for k, v in args.items():
        s = repr(v)
        if len(s) > 60:
            s = s[:60] + "…"
        parts.append(f"{k}={s}")
    return "{" + ", ".join(parts) + "}"


def main() -> None:
    """Allow `python -m desktop_agent.main` to launch uvicorn."""
    import uvicorn

    host = os.environ.get("ADJ_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("ADJ_AGENT_PORT", "8765"))
    log.info("Launching uvicorn on %s:%d", host, port)
    uvicorn.run(
        "desktop_agent.main:app",
        host=host,
        port=port,
        reload=False,
        log_level="info",
    )


if __name__ == "__main__":
    main()
