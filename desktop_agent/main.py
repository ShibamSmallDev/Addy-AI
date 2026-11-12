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
from typing import Any, Dict, Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import __version__
from .registry import DESKTOP_TOOL_NAMES, TOOLS, ToolError, load_all
from .operations import claim_operation, get_operation, instance_id, last_eviction_at, record_result

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
    # P1-3: unique operation id from the Node bridge. Enables deduplication
    # (same op_id → replay the recorded result, never execute twice).
    op_id: Optional[str] = None


class ExecuteResponse(BaseModel):
    ok: bool
    result: Any = None
    error: str | None = None
    tool: str
    # P1-3 protocol additions (all defaulted — older callers keep working):
    op_id: Optional[str] = None
    status: str = "completed"  # completed | failed | in_progress
    deduplicated: bool = False  # true → result comes from the op registry
    evicted: bool = False  # true → outcome replayed from a tier-2 tombstone
    instance_id: str = ""  # process instance id (restart detection)


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "status": "ok",
        "name": "Addy Desktop Control Agent",
        "version": __version__,
        "tools": sorted(TOOLS.keys()),
        "tool_count": len(TOOLS),
        # P1-3: per-process instance id — the bridge uses it to tell a
        # restarted sidecar (empty operation registry) from a live one.
        "instance_id": instance_id(),
    }


@app.get("/operations/{op_id}")
def operation_status(op_id: str) -> Dict[str, Any]:
    """P1-3: reconcile an operation ID after an ambiguous client outcome.

    ``last_eviction_at`` is the tier-2 watermark: on ``found: false`` the
    bridge must only conclude "never executed" when it is null or predates
    the operation's dispatch — otherwise the outcome is unknown (bounded
    retention could have forgotten a real result).
    """
    rec = get_operation(op_id)
    watermark = last_eviction_at()
    if rec is None:
        return {
            "found": False,
            "op_id": op_id,
            "instance_id": instance_id(),
            "last_eviction_at": watermark,
        }
    return {
        "found": True,
        "op_id": op_id,
        "status": rec.get("status"),
        "tool": rec.get("tool"),
        "result": rec.get("result"),
        "error": rec.get("error"),
        "evicted": bool(rec.get("evicted", False)),
        "instance_id": instance_id(),
        "last_eviction_at": watermark,
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
    op_id = req.op_id
    log.info("EXEC op=%s tool=%s args=%s", op_id or "-", tool, _short_args(args))

    # P1-3 idempotency: claim the operation ID BEFORE any dispatch decision
    # (including the unknown-tool rejection below). A duplicate op_id — a retry
    # after a lost response — replays the recorded outcome and NEVER enters
    # the handler twice.
    if op_id:
        existing = claim_operation(op_id, tool)
        if existing is not None:
            prev_status = existing.get("status", "in_progress")
            log.info(
                "DUP op=%s tool=%s status=%s -> replaying recorded result (NOT re-executing)",
                op_id,
                tool,
                prev_status,
            )
            if prev_status == "in_progress":
                return ExecuteResponse(
                    ok=False,
                    status="in_progress",
                    error=f"Operation {op_id} is already in progress; not re-executing.",
                    tool=tool,
                    op_id=op_id,
                    deduplicated=True,
                    instance_id=instance_id(),
                )
            return ExecuteResponse(
                ok=prev_status == "completed",
                status=prev_status if prev_status in ("completed", "failed") else "failed",
                result=existing.get("result"),
                error=existing.get("error"),
                tool=tool,
                op_id=op_id,
                deduplicated=True,
                evicted=bool(existing.get("evicted", False)),
                instance_id=instance_id(),
            )

    if tool not in TOOLS:
        known = ", ".join(sorted(TOOLS.keys()))
        err = f"Unknown tool '{tool}'. Known tools: {known}"
        if op_id:
            # Record so a duplicate op_id replays this same failure instead of
            # being treated as a fresh attempt.
            record_result(op_id, "failed", error=err)
        return ExecuteResponse(
            ok=False,
            status="failed",
            error=err,
            tool=tool,
            op_id=op_id,
            instance_id=instance_id(),
        )

    handler = TOOLS[tool]
    try:
        out = handler(args)
    except ToolError as e:
        log.warning("ToolError in %s (op=%s): %s", tool, op_id or "-", e.message)
        if op_id:
            record_result(op_id, "failed", error=e.message)
        return ExecuteResponse(
            ok=False, status="failed", error=e.message, tool=tool, op_id=op_id, instance_id=instance_id()
        )
    except Exception as e:  # noqa: BLE001
        log.error("Unhandled error in %s (op=%s): %s\n%s", tool, op_id or "-", e, traceback.format_exc())
        err = f"Internal error in {tool}: {e}"
        if op_id:
            record_result(op_id, "failed", error=err)
        return ExecuteResponse(
            ok=False, status="failed", error=err, tool=tool, op_id=op_id, instance_id=instance_id()
        )

    # Handlers return dicts like {"result": "..."}; pass the whole payload.
    result_text = ""
    if isinstance(out, dict):
        result_text = str(out.get("result", out))
    else:
        result_text = str(out)
    log.info("DONE op=%s tool=%s -> %s", op_id or "-", tool, result_text[:160])

    if op_id:
        record_result(op_id, "completed", result=out)
    return ExecuteResponse(
        ok=True, status="completed", result=out, tool=tool, op_id=op_id, instance_id=instance_id()
    )


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

    # Accept both prefixes: the Node launcher exports ADDY_AGENT_HOST/PORT, while
    # older tooling and docs used ADJ_AGENT_HOST/PORT. Reading only one silently
    # ignored the launcher's values (masked because both default to 127.0.0.1:8765).
    host = os.environ.get("ADDY_AGENT_HOST") or os.environ.get("ADJ_AGENT_HOST", "127.0.0.1")
    port = int(os.environ.get("ADDY_AGENT_PORT") or os.environ.get("ADJ_AGENT_PORT", "8765"))
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
