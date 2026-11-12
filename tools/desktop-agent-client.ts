/**
 * Desktop-agent operation client (roadmap P1-3 — operation IDs + safe retry).
 *
 * Every operation dispatched to the Python sidecar carries a unique operation
 * ID (`op_id`). The sidecar registers the ID BEFORE dispatching to the tool
 * handler and records the outcome, so an ambiguous failure can be reconciled
 * against the sidecar's operation registry (`GET /operations/{op_id}`) instead
 * of being blindly retried.
 *
 * Outcome taxonomy:
 *   - `completed`          — the sidecar confirmed success (directly or via reconciliation).
 *   - `failed`             — a DEFINITIVE failure: rejected before execution, the
 *                            tool reported an error, or reconciliation confirmed failure.
 *   - `cancelled`          — the caller aborted and it can be proven nothing executed.
 *   - `execution_unknown`  — the request may or may not have executed and the
 *                            protocol cannot prove which. NEVER retried.
 *
 * Retry rules enforced here (never at a higher layer):
 *   - Retry is allowed ONLY when it is PROVEN the request never executed
 *     (`retryable: true`: connection never established, or the unchanged,
 *     reachable sidecar has no registry entry for the op_id AND its eviction
 *     watermark proves no record was forgotten since this dispatch).
 *   - A confirmed result is never re-executed; duplicates return the recorded
 *     result (`deduplicated: true`) via the sidecar registry — including
 *     tombstoned outcomes whose payload was compacted away (`evicted: true`).
 *   - Ambiguous outcomes return `execution_unknown` with the operation ID
 *     preserved for reconciliation — no respawn, no re-dispatch.
 *
 * Exactly-once limits (deliberate, documented — see IMPLEMENTATION_STATUS.md):
 * the sidecar registry is IN-MEMORY only. It dedupes while the sidecar process
 * lives; it is lost on sidecar restart, and it is not a durable side-effect
 * journal. After a restart an unknown operation stays `execution_unknown` —
 * it is never assumed safe. Bounded retention is tiered (1000 full records →
 * 5000 compact tombstones → eviction watermark): a lookup miss only proves
 * "never executed" when the watermark shows nothing was forgotten after the
 * dispatch; otherwise the outcome is `execution_unknown`. Durable dedup
 * (DB-backed journal) is a follow-up.
 */

import { randomUUID } from 'node:crypto'

export type ExecutionOutcome = 'completed' | 'failed' | 'cancelled' | 'execution_unknown'

export interface OperationResult {
  /** Unique operation ID — preserved across retries and reconciliation. */
  opId: string
  outcome: ExecutionOutcome
  /** true ONLY for `completed`. */
  ok: boolean
  result?: unknown
  error?: string
  /**
   * true ONLY when it is PROVEN the request never executed (no side effects),
   * so a higher layer may re-dispatch it once. `execution_unknown` is never
   * retryable.
   */
  retryable: boolean
  /** The sidecar returned a previously recorded result instead of re-executing. */
  deduplicated?: boolean
  /** Health of the sidecar as observed during reconciliation (when known). */
  agentReachable?: boolean
  /** true when the outcome was established via the /operations/{opId} registry. */
  reconciled?: boolean
}

export interface DesktopOperationOptions {
  baseUrl: string
  timeoutMs: number
  /** External cancellation (task abort). */
  signal?: AbortSignal
  /** Provide to preserve an existing ID across a retry/re-dispatch. */
  opId?: string
  /** Last-known sidecar process instance id (captured at dispatch time). */
  cachedInstanceId?: () => string | null
  /** Called when a fresh instance id is observed (health probe / responses). */
  onInstanceId?: (id: string | null) => void
  /** GET /health → instance_id (null when unreachable). */
  probeInstanceId?: () => Promise<string | null>
  /**
   * Invoked ONLY when a retry is proven safe. Return true to re-dispatch once
   * with the SAME operation ID. The recursion passes `onBeforeRetry: undefined`,
   * so at most one automatic retry ever happens.
   */
  onBeforeRetry?: () => Promise<boolean>
  /** Structured log sink; every message includes the operation ID. */
  log?: (message: string) => void
}

/**
 * Connect-time error codes: with these codes the TCP connection was never
 * established, so the request provably never reached the sidecar.
 * (ECONNRESET / socket-hang-up after connect are intentionally NOT here —
 * those are ambiguous and must reconcile.)
 */
const NEVER_EXECUTED_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EADDRNOTAVAIL',
])

/** Walk the `cause` chain (and AggregateError lists) looking for a known code. */
export function isDefinitelyNotExecuted(err: unknown): boolean {
  const seen = new Set<unknown>()
  const stack: unknown[] = [err]
  while (stack.length > 0) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object' || seen.has(cur)) continue
    seen.add(cur)
    const code = (cur as { code?: unknown }).code
    if (typeof code === 'string' && NEVER_EXECUTED_CODES.has(code)) return true
    const cause = (cur as { cause?: unknown }).cause
    if (cause) stack.push(cause)
    const errors = (cur as { errors?: unknown }).errors
    if (Array.isArray(errors)) stack.push(...errors)
  }
  return false
}

export function newOpId(): string {
  return `op_${randomUUID()}`
}

// ---------------------------------------------------------------------------
// Reconciliation — ask the sidecar's registry what actually happened
// ---------------------------------------------------------------------------

export type ReconcileState = 'completed' | 'failed' | 'in_progress' | 'not_found' | 'unreachable'

export interface ReconcileResult {
  opId: string
  state: ReconcileState
  result?: unknown
  error?: string
  /** Health probe succeeded (the sidecar process answered /health). */
  agentReachable: boolean
  /** Instance id observed at reconciliation time (null when unreachable/absent). */
  currentInstanceId: string | null
  /**
   * true only when the sidecar is reachable, the registry has NO record of the
   * op, and its instance id is unchanged since dispatch — i.e. a live process
   * that continuously ran never registered the request.
   */
  sameInstance: boolean
  /**
   * Epoch seconds of the sidecar's last full-record loss (tier-2 tombstone
   * drop), null if nothing has ever been forgotten, undefined if the sidecar
   * did not report the watermark (old build — treated as unknown).
   */
  lastEvictionAt: number | null | undefined
  /** Found in tier-2 tombstones: outcome known, payload compacted away. */
  evicted: boolean
  /**
   * ONLY meaningful for state === 'not_found': true when non-execution is
   * actually established — reachable, same instance, AND no record has been
   * forgotten since this operation was dispatched (minus a safety margin).
   * A miss without that evidence (evicted/expired record) is NOT proof and
   * must map to `execution_unknown`, never to a retry.
   */
  provenNeverExecuted: boolean
}

export interface ReconcileOptions {
  baseUrl: string
  /** Instance id captured BEFORE the operation was dispatched. */
  dispatchInstanceId: string | null
  probeInstanceId?: () => Promise<string | null>
  /** Health-probe / status timeout (default 5000ms). */
  timeoutMs?: number
  /**
   * Epoch seconds captured BEFORE the operation was dispatched — compared
   * against the sidecar's eviction watermark to decide whether a registry
   * miss can prove non-execution. Omit only if you accept a conservative
   * "not proven" answer whenever the sidecar has ever evicted anything.
   */
  dispatchedAt?: number
}

/**
 * Safety margin when comparing the dispatch time against the sidecar's
 * eviction watermark (both clocks are the same host; the margin only widens
 * the conservative direction — a too-early eviction timestamp makes us say
 * "unknown" instead of "proven", never the reverse).
 */
const EVICTION_SAFETY_MARGIN_S = 2

export async function reconcileDesktopOperation(
  opId: string,
  opts: ReconcileOptions
): Promise<ReconcileResult> {
  const timeoutMs = opts.timeoutMs ?? 5000
  let state: ReconcileState = 'unreachable'
  let result: unknown
  let error: string | undefined
  let lastEvictionAt: number | null | undefined = undefined
  let evicted = false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${opts.baseUrl}/operations/${encodeURIComponent(opId)}`, {
      signal: controller.signal,
    })
    if (res.ok) {
      const data = (await res.json().catch(() => null)) as {
        found?: boolean
        status?: string
        result?: unknown
        error?: unknown
        evicted?: boolean
        last_eviction_at?: number | null
      } | null
      if (data === null) {
        // 200 with an unreadable body tells us nothing — stay 'unreachable'
        // (undeterminable) rather than fabricating a not_found.
        state = 'unreachable'
      } else {
        if ('last_eviction_at' in data) {
          // null = sidecar has never forgotten a record; a number = watermark.
          // Field absent (old build) = unknown → conservative (never proven).
          lastEvictionAt =
            data.last_eviction_at === null
              ? null
              : typeof data.last_eviction_at === 'number'
                ? data.last_eviction_at
                : undefined
        }
        evicted = data.evicted === true
        if (data.found) {
          if (data.status === 'completed') {
            state = 'completed'
            result = data.result
          } else if (data.status === 'failed') {
            state = 'failed'
            error = typeof data.error === 'string' ? data.error : undefined
          } else {
            state = 'in_progress'
          }
        } else {
          state = 'not_found'
        }
      }
    }
    // non-ok HTTP from the status endpoint stays 'unreachable' (undeterminable)
  } catch {
    state = 'unreachable'
  } finally {
    clearTimeout(timer)
  }

  let currentInstanceId: string | null = null
  let agentReachable = false
  if (opts.probeInstanceId) {
    try {
      const id = await opts.probeInstanceId()
      if (id) {
        currentInstanceId = id
        agentReachable = true
      }
    } catch {
      /* unreachable */
    }
  }

  const sameInstance =
    state !== 'unreachable' &&
    agentReachable &&
    opts.dispatchInstanceId !== null &&
    currentInstanceId === opts.dispatchInstanceId

  // Registry miss ⇒ "definitely never executed" ONLY when the sidecar's
  // eviction watermark proves nothing was forgotten after this dispatch
  // (bounded retention must never manufacture a false safe-to-retry).
  const provenNeverExecuted =
    state === 'not_found' &&
    sameInstance &&
    lastEvictionAt !== undefined &&
    (lastEvictionAt === null ||
      (opts.dispatchedAt !== undefined &&
        lastEvictionAt <= opts.dispatchedAt - EVICTION_SAFETY_MARGIN_S))

  return {
    opId,
    state,
    result,
    error,
    agentReachable,
    currentInstanceId,
    sameInstance,
    lastEvictionAt,
    evicted,
    provenNeverExecuted,
  }
}

// ---------------------------------------------------------------------------
// Outcome mapping
// ---------------------------------------------------------------------------

function fromReconcile(
  rec: ReconcileResult,
  reason: string,
  dispatchInstanceId: string | null,
  cancelled: boolean
): OperationResult {
  const base = { opId: rec.opId, reconciled: true, agentReachable: rec.agentReachable }
  switch (rec.state) {
    case 'completed':
      return { ...base, outcome: 'completed', ok: true, result: rec.result, retryable: false }
    case 'failed':
      return {
        ...base,
        outcome: 'failed',
        ok: false,
        retryable: false,
        error: `Operation ${rec.opId} was confirmed FAILED via reconciliation (original error: ${rec.error || 'unknown'}). Checked because: ${reason}.`,
      }
    case 'in_progress':
      return {
        ...base,
        outcome: 'execution_unknown',
        ok: false,
        retryable: false,
        error: `execution_unknown: ${reason}; operation ${rec.opId} is still executing on the desktop agent. Its final outcome is UNKNOWN and it was NOT retried (re-running could duplicate side effects). Reconcile later with operation ID ${rec.opId}.`,
      }
    case 'not_found':
      if (rec.sameInstance && rec.provenNeverExecuted) {
        // A live, continuously-running sidecar with no registry entry AND an
        // eviction watermark that predates this dispatch (or no eviction ever)
        // proves the request never executed.
        if (cancelled) {
          return {
            ...base,
            outcome: 'cancelled',
            ok: false,
            retryable: false,
            error: `cancelled: operation ${rec.opId} was aborted and never executed — the desktop agent has no record of it (no side effects occurred).`,
          }
        }
        return {
          ...base,
          outcome: 'failed',
          ok: false,
          retryable: true,
          error: `${reason}, but the unchanged desktop agent has no record of operation ${rec.opId}: it DEFINITELY never executed and produced no side effects. It is safe to retry.`,
        }
      }
      if (rec.sameInstance) {
        // Registry miss, same live instance — but the miss is NOT proof:
        // bounded retention has forgotten records since this dispatch (or the
        // sidecar does not report its watermark). Conservative: unknown.
        const watermark =
          rec.lastEvictionAt === undefined
            ? 'not reported by this sidecar build'
            : rec.lastEvictionAt === null
              ? 'none reported yet'
              : `eviction at t=${rec.lastEvictionAt}`
        return {
          ...base,
          outcome: 'execution_unknown',
          ok: false,
          retryable: false,
          error: `execution_unknown: ${reason}; the sidecar has no registry entry for operation ${rec.opId}, but its bounded registry (1000 full records / 5000 tombstones) has evicted or expired records since this dispatch (${watermark}), so non-execution CANNOT be proven. The operation may already have executed and was NOT retried (re-running could duplicate side effects). Reconcile with operation ID ${rec.opId} — treat as unknown until durable journaling exists.`,
        }
      }
      return {
        ...base,
        outcome: 'execution_unknown',
        ok: false,
        retryable: false,
        error: `execution_unknown: ${reason}; operation ${rec.opId} cannot be verified because ${
          !rec.agentReachable
            ? 'the desktop agent is unreachable'
            : dispatchInstanceId === null
              ? 'the sidecar instance that received the request was never identified'
              : 'the desktop agent restarted and its in-memory operation registry was lost'
        }. The operation may or may not have executed and was NOT retried (re-running could duplicate side effects). Reconcile with operation ID ${rec.opId} once the agent is back — note a restart clears the registry.`,
      }
    case 'unreachable':
      return {
        ...base,
        outcome: 'execution_unknown',
        ok: false,
        retryable: false,
        error: `execution_unknown: ${reason}; the desktop agent could not be reached to reconcile operation ${rec.opId}. Its execution status is UNKNOWN and it was NOT retried (re-running could duplicate side effects). Reconcile with operation ID ${rec.opId} once the agent is back — note a restart clears the registry.`,
      }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

async function attemptOnce(
  tool: string,
  args: Record<string, unknown>,
  opts: DesktopOperationOptions,
  opId: string
): Promise<OperationResult> {
  const { baseUrl, timeoutMs } = opts
  // Captured BEFORE dispatch: only this exact process instance can prove a
  // registry miss means "never executed", and only an eviction watermark that
  // predates this dispatch time can back that proof.
  const dispatchInstanceId = opts.cachedInstanceId?.() ?? null
  const dispatchedAt = Date.now() / 1000

  if (opts.signal?.aborted) {
    return {
      opId,
      outcome: 'cancelled',
      ok: false,
      retryable: false,
      error: `cancelled: operation ${opId} was cancelled before dispatch — the desktop agent never received it, so nothing executed.`,
    }
  }

  const controller = new AbortController()
  let timedOut = false
  let callerAborted = false
  opts.log?.(`DISPATCH op=${opId} tool=${tool}`)
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onCallerAbort = () => {
    callerAborted = true
    controller.abort()
  }
  opts.signal?.addEventListener('abort', onCallerAbort, { once: true })

  let res: Response | null = null
  let fetchError: unknown = null
  try {
    res = await fetch(`${baseUrl}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Connection: 'keep-alive' },
      body: JSON.stringify({ tool, args, op_id: opId }),
      signal: controller.signal,
    })
  } catch (err) {
    fetchError = err
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onCallerAbort)
  }

  const doReconcile = async (reason: string): Promise<OperationResult> => {
    const rec = await reconcileDesktopOperation(opId, {
      baseUrl,
      dispatchInstanceId,
      probeInstanceId: opts.probeInstanceId,
      timeoutMs: Math.min(timeoutMs, 5000),
      dispatchedAt,
    })
    opts.log?.(
      `RECONCILE op=${opId} tool=${tool} state=${rec.state} reachable=${rec.agentReachable} sameInstance=${rec.sameInstance} proven=${rec.provenNeverExecuted} evictedRecord=${rec.evicted} watermark=${rec.lastEvictionAt ?? 'none'} (${reason})`
    )
    if (rec.agentReachable && rec.currentInstanceId) opts.onInstanceId?.(rec.currentInstanceId)
    return fromReconcile(rec, reason, dispatchInstanceId, callerAborted)
  }

  if (fetchError !== null) {
    const msg = String((fetchError as Error)?.message || fetchError)
    if (isDefinitelyNotExecuted(fetchError)) {
      // Connection was never established → provably never executed.
      if (callerAborted) {
        return {
          opId,
          outcome: 'cancelled',
          ok: false,
          retryable: false,
          error: `cancelled: operation ${opId} was aborted before the connection was established — nothing executed.`,
        }
      }
      return {
        opId,
        outcome: 'failed',
        ok: false,
        retryable: true,
        error: `Desktop agent unreachable (${msg}) — the request never reached execution, so operation ${opId} has no side effects and may be retried safely.`,
      }
    }
    const reason = callerAborted
      ? `the caller cancelled the operation after dispatch (op ${opId})`
      : timedOut
        ? `the request timed out after ${timeoutMs}ms before a response was received`
        : `the connection failed mid-request (${msg})`
    return doReconcile(reason)
  }

  const response = res!
  if (response.ok) {
    let data: {
      ok?: boolean
      status?: string
      result?: unknown
      error?: unknown
      op_id?: unknown
      deduplicated?: unknown
      instance_id?: unknown
    } | null = null
    try {
      data = await response.json()
    } catch {
      // A 200 means the handler ran and returned; only the payload was lost.
      return doReconcile(`a 200 response was received for op ${opId} but its payload could not be read`)
    }
    if (typeof data?.instance_id === 'string') opts.onInstanceId?.(data.instance_id)
    const protocolStatus = typeof data?.status === 'string' ? data.status : data?.ok ? 'completed' : 'failed'
    if (protocolStatus === 'in_progress') {
      return {
        opId,
        outcome: 'execution_unknown',
        ok: false,
        retryable: false,
        error: `execution_unknown: operation ${opId} is already in progress on the desktop agent (duplicate operation ID) and was NOT executed again. Reconcile with operation ID ${opId}.`,
      }
    }
    if (data?.ok && protocolStatus === 'completed') {
      return {
        opId,
        outcome: 'completed',
        ok: true,
        result: data.result,
        deduplicated: data.deduplicated === true,
        retryable: false,
      }
    }
    return {
      opId,
      outcome: 'failed',
      ok: false,
      retryable: false,
      deduplicated: data?.deduplicated === true,
      error: `${typeof data?.error === 'string' && data.error ? data.error : 'Desktop agent reported a failure'} (operation ${opId}, status=${protocolStatus})`,
    }
  }

  const status = response.status
  const text = await response.text().catch(() => '')
  if (status < 500) {
    // 4xx (e.g. FastAPI 422 validation) is rejected before the handler runs —
    // a definitive pre-execution failure. No reconciliation needed.
    return {
      opId,
      outcome: 'failed',
      ok: false,
      retryable: false,
      error: `Desktop agent rejected operation ${opId} before execution (HTTP ${status}): ${text.slice(0, 200)}`,
    }
  }
  // 5xx: the handler may or may not have run — reconcile.
  return doReconcile(`the desktop agent returned HTTP ${status} for op ${opId}`)
}

/**
 * Execute one desktop-agent operation with a unique operation ID and
 * outcome-safe retry semantics. See module docstring for the full rules.
 */
export async function executeDesktopOperation(
  tool: string,
  args: Record<string, unknown>,
  opts: DesktopOperationOptions
): Promise<OperationResult> {
  const opId = opts.opId || newOpId()
  let out = await attemptOnce(tool, args, opts, opId)

  if (out.retryable && opts.onBeforeRetry) {
    // ONLY a proven-never-executed operation reaches here. Same op_id is
    // preserved so the sidecar dedup registry is a second line of defence.
    opts.log?.(
      `RETRY-SAFE op=${opId} tool=${tool} — proven never executed; re-verifying sidecar before one re-dispatch`
    )
    let ready = false
    try {
      ready = await opts.onBeforeRetry()
    } catch {
      ready = false
    }
    if (ready) {
      out = await attemptOnce(tool, args, opts, opId) // single retry: no onBeforeRetry above
    } else {
      opts.log?.(`RETRY-ABORTED op=${opId} tool=${tool} — sidecar not ready; no re-dispatch`)
    }
  }

  opts.log?.(
    `OUTCOME op=${out.opId} tool=${tool} outcome=${out.outcome} retryable=${out.retryable}${out.deduplicated ? ' deduplicated' : ''}${out.error ? ` error=${out.error}` : ''}`
  )
  return out
}
