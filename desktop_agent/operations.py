"""
Operation-result registry for the desktop agent (roadmap P1-3).

Purpose — idempotency / deduplication:
    The Node bridge (server.ts) tags every POST /execute with a unique
    ``op_id``. ``/execute`` claims the ID via :func:`claim_operation` BEFORE
    dispatching to the tool handler and records the outcome afterwards. If the
    same ``op_id`` arrives again (a retry, or a retry triggered by a lost
    response), ``/execute`` returns the ORIGINAL recorded result instead of
    executing the action twice.

Bounded retention — exact guarantee (review finding P1-3a):
    The registry is tiered so that a lookup MISS can never be mistaken for
    "never executed" without supporting evidence:

    1. FULL RECORDS — in-progress entries plus the newest
       ``MAX_FINISHED_RECORDS`` (1000) finished records keep the payload.
       In-progress entries are NEVER compacted.
    2. TOMBSTONES — finished records pushed out of tier 1 are COMPACTED, not
       forgotten: ``op_id -> {status, finished}`` (payload dropped) for the
       newest ``MAX_TOMBSTONES`` (5000) evictions. A duplicate op_id in this
       tier still replays its final status (``evicted: True``) and never
       re-executes. Remembering an outcome in tier 2 is NOT an eviction.
    3. EVICTION WATERMARK — only when a tombstone itself is dropped (tier-2
       overflow) is a record truly forgotten, and that moment is stamped in
       ``last_eviction_at``. The bridge may conclude "definitely never
       executed" from a registry miss ONLY if ``last_eviction_at`` is either
       unset or older than the operation's dispatch time; otherwise the
       outcome is reported as ``execution_unknown`` and never retried.
       Bounded retention therefore CANNOT cause a blind re-dispatch.

    Accurate guarantee summary: an operation outcome is *replayable* while it
    is one of the newest 1000 finished full records or 5000 tombstones; beyond
    that it is *unknown* (never silently "not executed").

Guarantees and deliberate limits (do not over-claim):
    * IN-MEMORY ONLY — the registry lives in this Python process. A crash or
      restart loses it. The Node bridge detects a restart via the per-process
      ``instance_id`` and reports the operation as ``execution_unknown``; it
      never assumes a registry miss on a restarted sidecar means "never ran".
    * NOT A SIDE-EFFECT JOURNAL — this records tool outcomes, not a durable
      log of external effects (keystrokes, clicks, files). Exactly-once
      execution across crashes is NOT guaranteed and is not claimed here.
    * DURABLE DEDUP (database-backed journal) is a documented follow-up task,
      not something this module pretends to provide.

Thread safety: uvicorn may run handlers in a thread pool, so all mutations
happen under a single lock. Within the lock the watermark is stamped BEFORE
the dropped record is removed, so a concurrent reader never observes a miss
without the matching watermark.
"""

from __future__ import annotations

import threading
import time
import uuid
from typing import Any, Dict, Optional

# Unique per process instance — lets the bridge detect "the sidecar restarted
# and lost the registry" versus "a live sidecar never saw this operation".
INSTANCE_ID = uuid.uuid4().hex

# Tier 1: finished full records kept (payload intact). In-progress excluded.
MAX_FINISHED_RECORDS = 1000
# Tier 2: compact tombstones kept (status only). Overflow => true eviction.
MAX_TOMBSTONES = 5000

_LOCK = threading.Lock()
_OPS: Dict[str, Dict[str, Any]] = {}  # op_id -> full record (in_progress | finished+payload)
_TOMBSTONES: Dict[str, Dict[str, Any]] = {}  # op_id -> {"status", "finished"} (no payload)
_LAST_EVICTED_AT: Optional[float] = None  # last time a record was FULLY forgotten


def instance_id() -> str:
    """Process instance id reported by /health and /execute responses."""
    return INSTANCE_ID


def last_eviction_at() -> Optional[float]:
    """
    Epoch seconds of the last time an operation record was completely
    forgotten (tier-2 tombstone drop), or None if nothing was ever forgotten.
    The bridge compares this against the operation's dispatch time: a miss
    with an eviction AFTER dispatch proves nothing and must stay unknown.
    """
    with _LOCK:
        return _LAST_EVICTED_AT


def claim_operation(op_id: str, tool: str) -> Optional[Dict[str, Any]]:
    """
    Atomically claim ``op_id`` for ``tool``.

    Returns ``None`` when the claim succeeded (the caller now owns the
    operation and must execute it, then call :func:`record_result`).

    Returns a copy of the EXISTING record when the operation ID is a
    duplicate — the caller must NOT execute again, just replay the record.
    Tier-2 duplicates come back with ``evicted: True`` (status retained,
    payload dropped) and are still duplicates: never re-executed.
    """
    with _LOCK:
        existing = _OPS.get(op_id)
        if existing is not None:
            return dict(existing)
        tomb = _TOMBSTONES.get(op_id)
        if tomb is not None:
            return {
                "status": tomb["status"],
                "evicted": True,
                "tool": None,
                "ts": tomb.get("finished"),
            }
        _OPS[op_id] = {"status": "in_progress", "tool": tool, "ts": time.time()}
        return None


def record_result(
    op_id: str,
    status: str,
    *,
    result: Any = None,
    error: Optional[str] = None,
) -> None:
    """
    Record the final outcome of ``op_id`` (upsert: records failures that never
    got claimed, e.g. an unknown-tool rejection, so they dedupe too).

    ``status`` is ``"completed"`` or ``"failed"``. If the process dies before
    this is called the entry stays ``in_progress`` — which is exactly why a
    restarted sidecar must be treated as `execution_unknown` by the bridge.
    """
    if not op_id:
        return
    with _LOCK:
        prev = _OPS.get(op_id, {})
        _OPS[op_id] = {
            "status": status,
            "result": result,
            "error": error,
            "tool": prev.get("tool"),
            "ts": prev.get("ts", time.time()),
            "finished": time.time(),
        }
        # A live full record supersedes any stale tombstone for this op_id.
        _TOMBSTONES.pop(op_id, None)
        _compact_locked()


def get_operation(op_id: str) -> Optional[Dict[str, Any]]:
    """Return a copy of the record for ``op_id``, or None if fully unknown."""
    with _LOCK:
        rec = _OPS.get(op_id)
        if rec is not None:
            return dict(rec)
        tomb = _TOMBSTONES.get(op_id)
        if tomb is not None:
            return {"status": tomb["status"], "evicted": True, "tool": None}
        return None


def reset_registry() -> None:
    """Test helper: drop every record and tombstone (keeps INSTANCE_ID)."""
    global _LAST_EVICTED_AT
    with _LOCK:
        _OPS.clear()
        _TOMBSTONES.clear()
        _LAST_EVICTED_AT = None


def registry_stats() -> Dict[str, Any]:
    """Observability: sizes of both tiers and the watermark."""
    with _LOCK:
        return {
            "full_records": len(_OPS),
            "tombstones": len(_TOMBSTONES),
            "last_eviction_at": _LAST_EVICTED_AT,
            "instance_id": INSTANCE_ID,
        }


def _compact_locked() -> None:
    """Caller must hold _LOCK. Tier-1 overflow -> tombstone; tier-2 overflow
    -> stamp the watermark, then drop (oldest first)."""
    global _LAST_EVICTED_AT
    finished_full = sorted(
        (
            (oid, rec)
            for oid, rec in _OPS.items()
            if rec["status"] != "in_progress"
        ),
        key=lambda item: item[1].get("finished", item[1].get("ts", 0.0)),
    )
    overflow = len(finished_full) - MAX_FINISHED_RECORDS
    if overflow > 0:
        for oid, rec in finished_full[:overflow]:
            _TOMBSTONES[oid] = {
                "status": rec["status"],
                "finished": rec.get("finished", rec.get("ts", time.time())),
            }
            _OPS.pop(oid, None)

    tomb_overflow = len(_TOMBSTONES) - MAX_TOMBSTONES
    if tomb_overflow > 0:
        by_age = sorted(_TOMBSTONES.items(), key=lambda item: item[1].get("finished", 0.0))
        # Watermark FIRST, then remove: a reader observing the miss must also
        # observe the eviction (single lock, ordered mutations).
        _LAST_EVICTED_AT = time.time()
        for oid, _tomb in by_age[:tomb_overflow]:
            _TOMBSTONES.pop(oid, None)


__all__ = [
    "INSTANCE_ID",
    "instance_id",
    "last_eviction_at",
    "claim_operation",
    "record_result",
    "get_operation",
    "reset_registry",
    "registry_stats",
    "MAX_FINISHED_RECORDS",
    "MAX_TOMBSTONES",
]
