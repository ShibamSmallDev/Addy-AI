/**
 * P1-3 regression tests — operation IDs + safe retry semantics for the
 * desktop-agent bridge.
 *
 * Covered (the 8 required scenarios):
 *   1. normal successful execution
 *   2. definite pre-execution failure
 *   3. timeout BEFORE execution  (proven never executed → safe retry, same op id)
 *   4. timeout AFTER execution but before response delivery (reconciled → completed)
 *   5. duplicate operation ID (replays the recorded result, never re-executes)
 *   6. non-idempotent operation with unknown outcome (never retried)
 *   7. sidecar restart during an operation (registry lost → execution_unknown)
 *   8. reconciliation via the original operation ID (internal + explicit helper)
 *   9a-e. eviction edge cases (review finding P1-3a): a tombstoned outcome
 *     still reconciles/dedups, a FULLY forgotten outcome is execution_unknown
 *     (never proof of non-execution), a watermark postdating dispatch destroys
 *     the retry proof, and a legitimate safe retry with an OLD watermark works.
 * Plus: cancelled-before-dispatch outcome, the agent-loop refusal to re-run an
 * execution_unknown step, and a Python end-to-end dedup test against the REAL
 * FastAPI app (skipped if python is unavailable).
 *
 * The fake sidecar mirrors the real protocol (POST /execute with op_id,
 * GET /operations/{op_id}, GET /health with instance_id) so the decision
 * logic under test is the production logic in tools/desktop-agent-client.ts.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// server_paths resolves DATA_DIR at module load, so env MUST be set before any
// project module is imported (dynamic imports keep the ordering deterministic).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-desktop-op-'))
process.env.ADDY_DATA_DIR = TMP
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'stub-key'

// Keep the embedding model from downloading if a completion path is ever hit.
import { env as tfEnv } from '@xenova/transformers'
tfEnv.allowRemoteModels = false
tfEnv.allowLocalModels = true
tfEnv.localModelPath = path.join(TMP, 'empty-models')

const {
  executeDesktopOperation,
  reconcileDesktopOperation,
  isDefinitelyNotExecuted,
  newOpId,
} = await import('../tools/desktop-agent-client')
type DesktopOperationOptions = import('../tools/desktop-agent-client').DesktopOperationOptions

// ---------------------------------------------------------------------------
// Fake sidecar implementing the P1-3 protocol
// ---------------------------------------------------------------------------

interface OpRecord {
  status: string
  result?: unknown
  error?: string
}

/** Tier-2 tombstone: outcome retained, payload compacted away. */
interface Tombstone {
  status: string
  evicted: true
  tool?: null
  ts?: number
}

interface ExecuteCtx {
  tool: string
  args: Record<string, unknown>
  opId: string | null
  sidecar: FakeSidecar
  res: http.ServerResponse
  respond: (status: number, body: unknown) => void
  /** Default sidecar behaviour: claim → execute → record → respond. */
  runDefault: () => void
}

type ExecuteHandler = (ctx: ExecuteCtx) => void

interface FakeSidecar {
  instanceId: string
  baseUrl: string
  /** Handler invocations == real executions (dedup replays do NOT count). */
  executions: Array<{ tool: string; opId: string | null }>
  /** Every /execute request the HTTP server received (incl. dupes/hangs). */
  receivedOpIds: Array<string | null>
  ops: Map<string, OpRecord>
  /** Tier-2: evicted-but-remembered outcomes (mirrors operations.py). */
  tombstones: Map<string, Tombstone>
  /** Tier-3 watermark: last time a record was FULLY forgotten (null = never). */
  lastEvictionAt: number | null
  statusQueries: string[]
  healthQueries: number
  onExecute: ExecuteHandler
  /** Tier-1 overflow: move a full record into a tombstone (outcome still known). */
  evict: (opId: string) => void
  /** Tier-2 overflow: fully forget a record — tombstone dropped, watermark stamped. */
  forget: (opId: string) => void
  /** Simulate a process restart: new instance id + empty registry. */
  restart: () => void
  close: () => Promise<void>
}

function respondJson(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function startSidecar(opts: { onExecute?: ExecuteHandler } = {}): Promise<FakeSidecar> {
  const sc = {
    instanceId: `inst_${randomUUID()}`,
    baseUrl: '',
    executions: [] as Array<{ tool: string; opId: string | null }>,
    receivedOpIds: [] as Array<string | null>,
    ops: new Map<string, OpRecord>(),
    tombstones: new Map<string, Tombstone>(),
    lastEvictionAt: null as number | null,
    statusQueries: [] as string[],
    healthQueries: 0,
    onExecute: null as unknown as ExecuteHandler,
    evict(opId: string) {
      const rec = this.ops.get(opId)
      if (!rec) return
      this.ops.delete(opId)
      this.tombstones.set(opId, { status: rec.status, evicted: true, tool: null })
      // NO watermark: the outcome is still remembered (tier 2).
    },
    forget(opId: string) {
      // Mirrors tier-2 overflow: whatever tier held it is now gone, so the
      // watermark MUST be stamped (a miss can no longer prove anything).
      const removed = this.ops.delete(opId) || this.tombstones.delete(opId)
      if (removed) this.lastEvictionAt = Date.now() / 1000
    },
    restart() {
      this.instanceId = `inst_${randomUUID()}`
      this.ops.clear()
      this.tombstones.clear()
      this.lastEvictionAt = null
    },
    close: async () => {},
  } as unknown as FakeSidecar

  const runDefaultFor = (ctx: ExecuteCtx) => {
    const { sidecar, tool, opId } = ctx
    // Mirror desktop_agent/operations.py: dedup BEFORE executing.
    if (opId) {
      const prev = sidecar.ops.get(opId)
      const tomb = sidecar.tombstones.get(opId)
      if (prev || tomb) {
        ctx.respond(200, {
          ok: tomb ? tomb.status === 'completed' : prev!.status === 'completed',
          status: tomb ? tomb.status : prev!.status,
          result: prev?.result,
          error: prev?.error,
          tool,
          op_id: opId,
          deduplicated: true,
          evicted: tomb !== undefined,
          instance_id: sidecar.instanceId,
        })
        return
      }
      sidecar.ops.set(opId, { status: 'in_progress' })
    }
    sidecar.executions.push({ tool, opId })
    const result = { echo: tool, runCount: sidecar.executions.length }
    if (opId) sidecar.ops.set(opId, { status: 'completed', result })
    ctx.respond(200, {
      ok: true,
      status: 'completed',
      result,
      tool,
      op_id: opId,
      deduplicated: false,
      instance_id: sidecar.instanceId,
    })
  }

  sc.onExecute =
    opts.onExecute ??
    ((ctx: ExecuteCtx) => {
      ctx.runDefault()
    })

  const server = http.createServer((req, res) => {
    const url = req.url || '/'
    if (req.method === 'GET' && url === '/health') {
      sc.healthQueries++
      respondJson(res, 200, { status: 'ok', instance_id: sc.instanceId })
      return
    }
    if (req.method === 'GET' && url.startsWith('/operations/')) {
      const id = decodeURIComponent(url.slice('/operations/'.length))
      sc.statusQueries.push(id)
      const rec = sc.ops.get(id)
      const tomb = sc.tombstones.get(id)
      if (!rec && !tomb) {
        respondJson(res, 200, {
          found: false,
          op_id: id,
          instance_id: sc.instanceId,
          last_eviction_at: sc.lastEvictionAt,
        })
        return
      }
      respondJson(res, 200, {
        found: true,
        op_id: id,
        status: rec ? rec.status : tomb!.status,
        result: rec?.result,
        error: rec?.error,
        evicted: rec === undefined,
        instance_id: sc.instanceId,
        last_eviction_at: sc.lastEvictionAt,
      })
      return
    }
    if (req.method === 'POST' && url === '/execute') {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        let body: { tool?: string; args?: Record<string, unknown>; op_id?: string } = {}
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch {
          respondJson(res, 422, { detail: 'invalid JSON' })
          return
        }
        sc.receivedOpIds.push(body.op_id ?? null)
        const ctx: ExecuteCtx = {
          tool: body.tool ?? '',
          args: body.args ?? {},
          opId: body.op_id ?? null,
          sidecar: sc,
          res,
          respond: (status, responseBody) => respondJson(res, status, responseBody),
          runDefault: () =>
            runDefaultFor({
              tool: body.tool ?? '',
              args: body.args ?? {},
              opId: body.op_id ?? null,
              sidecar: sc,
              res,
              respond: (status, responseBody) => respondJson(res, status, responseBody),
              runDefault: () => {},
            }),
        }
        try {
          sc.onExecute(ctx)
        } catch (e) {
          respondJson(res, 500, { error: String(e) })
        }
      })
      return
    }
    respondJson(res, 404, { error: 'not found' })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  if (!addr || typeof addr === 'string') throw new Error('fake sidecar failed to bind')
  sc.baseUrl = `http://127.0.0.1:${addr.port}`
  sc.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections?.()
      server.close(() => resolve())
    })
  return sc
}

async function probeHealth(sc: FakeSidecar): Promise<string | null> {
  try {
    const res = await fetch(`${sc.baseUrl}/health`)
    if (!res.ok) return null
    const data = (await res.json()) as { instance_id?: unknown }
    return typeof data.instance_id === 'string' ? data.instance_id : null
  } catch {
    return null
  }
}

function makeOpts(sc: FakeSidecar, extra: Partial<DesktopOperationOptions> = {}): DesktopOperationOptions {
  return {
    baseUrl: sc.baseUrl,
    timeoutMs: 600,
    cachedInstanceId: () => sc.instanceId,
    probeInstanceId: () => probeHealth(sc),
    ...extra,
  }
}

/** onBeforeRetry that fails the test if it is ever invoked. */
const noRetryAllowed = async (): Promise<boolean> => {
  throw new Error('onBeforeRetry must NOT be called for this outcome')
}

// ---------------------------------------------------------------------------
// 1. Normal successful execution
// ---------------------------------------------------------------------------

test('1. normal successful execution: completed with op id in request and logs', async () => {
  const sc = await startSidecar()
  const logs: string[] = []
  try {
    const out = await executeDesktopOperation(
      'readFile',
      { path: 'x.txt' },
      makeOpts(sc, { log: (m) => logs.push(m) })
    )
    assert.equal(out.outcome, 'completed')
    assert.equal(out.ok, true)
    assert.equal(out.retryable, false)
    assert.match(out.opId, /^op_/)
    assert.equal(out.deduplicated, false)
    assert.equal(sc.executions.length, 1)
    assert.equal(sc.executions[0]!.opId, out.opId, 'op id must reach the sidecar')
    assert.equal(sc.receivedOpIds[0], out.opId, 'op id must be in the request body')
    assert.ok(
      logs.some((l) => l.includes(out.opId)),
      `operation id must appear in logs, got: ${JSON.stringify(logs)}`
    )
    assert.equal(sc.statusQueries.length, 0, 'no reconciliation for a clean success')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 2. Definite pre-execution failure
// ---------------------------------------------------------------------------

test('2. definite pre-execution failure: failed, not retryable, no reconciliation', async () => {
  let mode: 'http422' | 'protocol_failed' = 'http422'
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // Never claimed, never executed — rejected before the handler.
      if (mode === 'http422') {
        ctx.respond(422, { detail: [{ msg: 'field required', loc: ['body', 'tool'] }] })
      } else {
        ctx.respond(200, {
          ok: false,
          status: 'failed',
          error: "Unknown tool 'definitelyNotATool'",
          tool: ctx.tool,
          op_id: ctx.opId,
          instance_id: ctx.sidecar.instanceId,
        })
      }
    },
  })
  try {
    const out1 = await executeDesktopOperation('readFile', {}, makeOpts(sc, { onBeforeRetry: noRetryAllowed }))
    assert.equal(out1.outcome, 'failed')
    assert.equal(out1.ok, false)
    assert.equal(out1.retryable, false, 'a 422 is a deterministic failure — nothing to retry')
    assert.match(out1.error!, /before execution \(HTTP 422\)/)
    assert.ok(out1.error!.includes(out1.opId), 'error must carry the op id')
    assert.equal(sc.executions.length, 0)
    assert.equal(sc.statusQueries.length, 0, 'definite failures need no reconciliation')

    mode = 'protocol_failed'
    const out2 = await executeDesktopOperation(
      'definitelyNotATool',
      {},
      makeOpts(sc, { onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out2.outcome, 'failed')
    assert.equal(out2.retryable, false)
    assert.match(out2.error!, /Unknown tool 'definitelyNotATool'/)
    assert.ok(out2.error!.includes(out2.opId))
    assert.equal(sc.executions.length, 0)
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 3. Timeout BEFORE execution
// ---------------------------------------------------------------------------

test('3a. timeout before execution: proven never executed → retryable failed with explanation', async () => {
  const sc = await startSidecar({
    onExecute: () => {
      /* request received but never processed/claimed → no response */
    },
  })
  try {
    const out = await executeDesktopOperation('createFile', { path: 'a.txt' }, makeOpts(sc))
    assert.equal(out.outcome, 'failed', 'a proven never-executed request is a definite failure, not unknown')
    assert.equal(out.retryable, true, 'safe to retry: no side effects occurred')
    assert.equal(out.ok, false)
    assert.match(out.error!, /DEFINITELY never executed/)
    assert.match(out.error!, /safe to retry/)
    assert.ok(out.error!.includes(out.opId))
    assert.equal(sc.executions.length, 0, 'nothing executed')
    assert.deepEqual(sc.statusQueries, [out.opId], 'reconciliation used the ORIGINAL op id')
  } finally {
    await sc.close()
  }
})

test('3b. timeout before execution: safe retry re-dispatches with the SAME op id and executes once', async () => {
  let attempt = 0
  let retries = 0
  const sc = await startSidecar({
    onExecute: (ctx) => {
      attempt++
      if (attempt === 1) return // hang: never executed, no response
      ctx.runDefault()
    },
  })
  try {
    const out = await executeDesktopOperation(
      'createFile',
      { path: 'a.txt' },
      makeOpts(sc, {
        onBeforeRetry: async () => {
          retries++
          return true
        },
      })
    )
    assert.equal(out.outcome, 'completed')
    assert.equal(out.ok, true)
    assert.equal(retries, 1, 'exactly one safe retry')
    assert.equal(sc.executions.length, 1, 'the tool executed exactly once')
    assert.equal(sc.receivedOpIds.length, 2, 'two HTTP attempts reached the sidecar')
    assert.equal(sc.receivedOpIds[0], out.opId, 'first attempt used the op id')
    assert.equal(sc.receivedOpIds[1], out.opId, 'the retry PRESERVED the original op id')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 4. Timeout AFTER execution, before response delivery
// ---------------------------------------------------------------------------

test('4. timeout after execution before response: reconciled to completed, never re-executed', async () => {
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // Executed and recorded — but the response is lost.
      if (ctx.opId) ctx.sidecar.ops.set(ctx.opId, { status: 'completed', result: { secret: 'already-ran' } })
      ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
    },
  })
  try {
    const out = await executeDesktopOperation(
      'createFile',
      { path: 'a.txt' },
      makeOpts(sc, { onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out.outcome, 'completed', 'the registry proves it completed')
    assert.equal(out.ok, true)
    assert.deepEqual(out.result, { secret: 'already-ran' }, 'original result returned')
    assert.equal(out.reconciled, true)
    assert.equal(out.retryable, false)
    assert.equal(sc.executions.length, 1, 'MUST NOT execute a confirmed operation again')
    assert.deepEqual(sc.statusQueries, [out.opId], 'reconciled with the original op id')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 5. Duplicate operation ID
// ---------------------------------------------------------------------------

test('5. duplicate operation ID: replays the original result, never executes twice', async () => {
  const sc = await startSidecar()
  const opId = newOpId()
  try {
    const first = await executeDesktopOperation('readFile', { path: 'x.txt' }, makeOpts(sc, { opId }))
    assert.equal(first.outcome, 'completed')
    assert.equal(first.deduplicated, false)
    assert.equal(sc.executions.length, 1)

    const second = await executeDesktopOperation(
      'readFile',
      { path: 'x.txt' },
      makeOpts(sc, { opId, onBeforeRetry: noRetryAllowed })
    )
    assert.equal(second.outcome, 'completed')
    assert.equal(second.ok, true)
    assert.equal(second.opId, opId, 'the same op id was re-dispatched')
    assert.equal(second.deduplicated, true, 'the sidecar recognised the duplicate')
    assert.deepEqual(second.result, first.result, 'identical recorded result returned')
    assert.equal(sc.executions.length, 1, 'the non-idempotent tool ran exactly once')

    const third = await executeDesktopOperation('readFile', { path: 'x.txt' }, makeOpts(sc, { opId }))
    assert.equal(third.deduplicated, true)
    assert.equal(sc.executions.length, 1, 'still exactly one execution')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 6. Non-idempotent operation with unknown outcome
// ---------------------------------------------------------------------------

test('6. non-idempotent operation with unknown outcome: execution_unknown, never retried', async () => {
  const logs: string[] = []
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // Started (claimed) but the connection dies before any outcome: the
      // sidecar may still be running the non-idempotent action.
      if (ctx.opId) ctx.sidecar.ops.set(ctx.opId, { status: 'in_progress' })
      ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
      ctx.res.destroy()
    },
  })
  try {
    const out = await executeDesktopOperation(
      'typeText',
      { text: 'IMPORTANT SECRET' },
      makeOpts(sc, { onBeforeRetry: noRetryAllowed, log: (m) => logs.push(m) })
    )
    assert.equal(out.outcome, 'execution_unknown')
    assert.equal(out.ok, false)
    assert.equal(out.retryable, false, 'an unknown outcome must NEVER be blindly retried')
    assert.match(out.error!, /^execution_unknown:/)
    assert.match(out.error!, /NOT retried/)
    assert.ok(out.error!.includes(out.opId), 'the op id is preserved for reconciliation')
    assert.equal(sc.executions.length, 1, 'exactly one dispatch — no re-execution')
    assert.ok(
      logs.some((l) => l.includes('execution_unknown') && l.includes(out.opId)),
      'the unknown outcome must be logged with its op id'
    )
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 7. Sidecar restart during an operation
// ---------------------------------------------------------------------------

test('7. sidecar restart during an operation: registry lost → execution_unknown, no retry', async () => {
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // The handler started, then the sidecar process dies and comes back
      // (new instance id, empty registry) before the client hears anything.
      if (ctx.opId) ctx.sidecar.ops.set(ctx.opId, { status: 'in_progress' })
      ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
      ctx.sidecar.restart()
      ctx.res.destroy()
    },
  })
  try {
    const out = await executeDesktopOperation(
      'executePowerAction',
      { action: 'shutdown' },
      makeOpts(sc, { onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out.outcome, 'execution_unknown')
    assert.equal(out.retryable, false, 'a lost registry must never be treated as safe-to-retry')
    assert.match(out.error!, /restarted/)
    assert.match(out.error!, /may or may not have executed/)
    assert.ok(out.error!.includes(out.opId))
    assert.equal(sc.executions.length, 1, 'never re-executed after the restart')
    assert.equal(sc.ops.size, 0, 'the restarted sidecar really lost the registry')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 8. Retry reconciliation using the original operation ID
// ---------------------------------------------------------------------------

test('8a. explicit reconciliation helper resolves an op id against the registry', async () => {
  const sc = await startSidecar()
  const opId = newOpId()
  try {
    const out = await executeDesktopOperation('readFile', { path: 'r.txt' }, makeOpts(sc, { opId }))
    assert.equal(out.outcome, 'completed')

    const rec = await reconcileDesktopOperation(opId, {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
    })
    assert.equal(rec.state, 'completed')
    assert.deepEqual(rec.result, out.result, 'reconciliation returns the original result')
    assert.equal(rec.sameInstance, true)

    const missing = await reconcileDesktopOperation('op_never_existed', {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
    })
    assert.equal(missing.state, 'not_found')
    assert.equal(missing.sameInstance, true, 'live sidecar + no record ⇒ provably never executed')

    const afterRestart = await reconcileDesktopOperation(opId, {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: 'inst_some_old_process',
      probeInstanceId: () => probeHealth(sc),
    })
    assert.equal(afterRestart.state, 'completed', 'a found record is authoritative even across instance change')
  } finally {
    await sc.close()
  }
})

test('8b. lost response after execution: internal reconciliation via the ORIGINAL op id', async () => {
  const sc = await startSidecar({
    onExecute: (ctx) => {
      if (ctx.opId) ctx.sidecar.ops.set(ctx.opId, { status: 'completed', result: { recovered: true } })
      ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
      ctx.res.destroy() // response lost after execution
    },
  })
  try {
    const out = await executeDesktopOperation('readFile', { path: 'r.txt' }, makeOpts(sc))
    assert.equal(out.outcome, 'completed')
    assert.deepEqual(out.result, { recovered: true })
    assert.equal(out.reconciled, true)
    assert.equal(sc.executions.length, 1, 'no re-execution')
    assert.deepEqual(sc.statusQueries, [out.opId], 'checked with the ORIGINAL operation id')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// 9. Eviction edge cases (review finding P1-3a): bounded retention must never
//    turn a forgotten record into proof of non-execution.
// ---------------------------------------------------------------------------

test('9a. completed + tier-1 eviction (tombstone): reconcile still proves the outcome, never re-executes', async () => {
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // Executed, recorded, response lost — then the full record is compacted
      // into a tier-2 tombstone before the client reconciles.
      if (ctx.opId) {
        ctx.sidecar.ops.set(ctx.opId, { status: 'completed', result: { ran: true } })
        ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
        ctx.sidecar.evict(ctx.opId)
      }
      ctx.res.destroy()
    },
  })
  try {
    const out = await executeDesktopOperation(
      'createFile',
      { path: 'a.txt' },
      makeOpts(sc, { onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out.outcome, 'completed', 'a tombstoned outcome must still reconcile as completed')
    assert.equal(out.ok, true)
    assert.equal(out.retryable, false)
    assert.equal(sc.executions.length, 1, 'an evicted record is NOT evidence of non-execution')
    const rec = await reconcileDesktopOperation(out.opId, {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
      dispatchedAt: Date.now() / 1000,
    })
    assert.equal(rec.state, 'completed')
    assert.equal(rec.evicted, true, 'the status endpoint reports the tombstone')
    assert.equal(rec.provenNeverExecuted, false)
  } finally {
    await sc.close()
  }
})

test('9b. completed + FULLY forgotten (watermark after dispatch): execution_unknown, no retry', async () => {
  const sc = await startSidecar({
    onExecute: (ctx) => {
      // Executed and recorded, response lost — then bounded retention
      // forgets the record entirely AFTER this dispatch (watermark > dispatch).
      if (ctx.opId) {
        ctx.sidecar.ops.set(ctx.opId, { status: 'completed', result: { ran: true } })
        ctx.sidecar.executions.push({ tool: ctx.tool, opId: ctx.opId })
        ctx.sidecar.forget(ctx.opId)
      }
      ctx.res.destroy()
    },
  })
  try {
    const out = await executeDesktopOperation(
      'typeText',
      { text: 'SECRET' },
      makeOpts(sc, { onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out.outcome, 'execution_unknown', 'a miss caused by eviction is NOT proof of non-execution')
    assert.equal(out.ok, false)
    assert.equal(out.retryable, false, 'must never be retried — the operation may have executed')
    assert.match(out.error!, /^execution_unknown:/)
    assert.match(out.error!, /CANNOT be proven/)
    assert.match(out.error!, /NOT retried/)
    assert.ok(out.error!.includes(out.opId), 'op id preserved for reconciliation')
    assert.equal(sc.executions.length, 1, 'exactly one execution — no blind re-dispatch')
  } finally {
    await sc.close()
  }
})

test('9c. explicit reconcile after full eviction: not_found but provenNeverExecuted stays false', async () => {
  const sc = await startSidecar()
  try {
    const opId = newOpId()
    const now = Date.now() / 1000

    // (i) watermark stamped after dispatch ⇒ cannot prove anything.
    sc.ops.set(opId, { status: 'completed', result: {} })
    sc.forget(opId)
    const afterEviction = await reconcileDesktopOperation(opId, {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
      dispatchedAt: now - 5, // dispatched 5s ago; eviction happened just now
    })
    assert.equal(afterEviction.state, 'not_found')
    assert.equal(afterEviction.sameInstance, true)
    assert.equal(afterEviction.lastEvictionAt !== undefined && afterEviction.lastEvictionAt > now - 5, true, 'watermark exists and postdates dispatch')
    assert.equal(afterEviction.provenNeverExecuted, false, 'eviction after dispatch destroys the proof')

    // (ii) no dispatchedAt supplied ⇒ conservative: never proven.
    const noDispatchTime = await reconcileDesktopOperation('op_never_existed_2', {
      baseUrl: sc.baseUrl,
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
    })
    assert.equal(noDispatchTime.state, 'not_found')
    assert.equal(noDispatchTime.provenNeverExecuted, false, 'without a dispatch time a watermark can never be compared')

    // (iii) sidecar that does not answer the status endpoint (old build /
    // unreachable) ⇒ conservative: state undeterminable, never proven.
    const oldBuild = await reconcileDesktopOperation('op_never_existed_3', {
      baseUrl: 'http://127.0.0.1:1', // nothing listens here
      dispatchInstanceId: sc.instanceId,
      probeInstanceId: () => probeHealth(sc),
      dispatchedAt: now,
    })
    assert.equal(oldBuild.state, 'unreachable')
    assert.equal(oldBuild.provenNeverExecuted, false)
  } finally {
    await sc.close()
  }
})

test('9d. duplicate op ID after tier-1 eviction: dedup replay, still exactly one execution', async () => {
  const sc = await startSidecar()
  const opId = newOpId()
  try {
    const first = await executeDesktopOperation('readFile', { path: 'x.txt' }, makeOpts(sc, { opId }))
    assert.equal(first.outcome, 'completed')
    assert.equal(sc.executions.length, 1)

    sc.evict(opId) // tier-1 overflow: payload compacted, status retained

    const second = await executeDesktopOperation(
      'readFile',
      { path: 'x.txt' },
      makeOpts(sc, { opId, onBeforeRetry: noRetryAllowed })
    )
    assert.equal(second.outcome, 'completed', 'the tombstone still replays the final status')
    assert.equal(second.deduplicated, true, 'an evicted record is still a duplicate — never re-executed')
    assert.equal(second.opId, opId)
    assert.equal(sc.executions.length, 1, 'the tool must NOT run a second time')
    assert.equal(sc.receivedOpIds.length, 2, 'the request did reach the sidecar (and was deduped there)')
  } finally {
    await sc.close()
  }
})

test('9e. normal safe retry still works when the watermark predates this dispatch', async () => {
  let attempt = 0
  let retries = 0
  const sc = await startSidecar({
    onExecute: (ctx) => {
      attempt++
      if (attempt === 1) return // hang: provably never claimed/executed
      ctx.runDefault()
    },
  })
  try {
    // The sidecar evicted something long BEFORE this dispatch — that watermark
    // must not block a legitimate retry whose own miss proves non-execution.
    sc.lastEvictionAt = Date.now() / 1000 - 10

    const out = await executeDesktopOperation(
      'createFile',
      { path: 'a.txt' },
      makeOpts(sc, {
        onBeforeRetry: async () => {
          retries++
          return true
        },
      })
    )
    assert.equal(out.outcome, 'completed', 'an old watermark must not turn a proven miss into unknown')
    assert.equal(retries, 1, 'the safe retry still happened')
    assert.equal(sc.executions.length, 1, 'executed exactly once')
    assert.equal(sc.receivedOpIds.length, 2, 'two HTTP attempts, same op id')
    assert.equal(sc.receivedOpIds[0], sc.receivedOpIds[1], 'op id preserved across the retry')
  } finally {
    await sc.close()
  }
})

// ---------------------------------------------------------------------------
// Extras: cancellation, loop-level no-retry guard, Python end-to-end dedup
// ---------------------------------------------------------------------------

test('cancelled before dispatch: outcome cancelled, zero executions, never retried', async () => {
  const sc = await startSidecar()
  try {
    const controller = new AbortController()
    controller.abort()
    const out = await executeDesktopOperation(
      'readFile',
      { path: 'x.txt' },
      makeOpts(sc, { signal: controller.signal, onBeforeRetry: noRetryAllowed })
    )
    assert.equal(out.outcome, 'cancelled')
    assert.equal(out.ok, false)
    assert.equal(out.retryable, false)
    assert.match(out.error!, /cancelled/)
    assert.equal(sc.executions.length, 0)
    assert.equal(sc.receivedOpIds.length, 0, 'nothing even reached the sidecar')
  } finally {
    await sc.close()
  }
})

test('isDefinitelyNotExecuted: connect-time codes only, ambiguous errors excluded', () => {
  assert.equal(isDefinitelyNotExecuted(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })), true)
  assert.equal(
    isDefinitelyNotExecuted(new TypeError('fetch failed', { cause: Object.assign(new Error('x'), { code: 'ECONNREFUSED' }) })),
    true
  )
  assert.equal(
    isDefinitelyNotExecuted(
      new TypeError('fetch failed', {
        cause: new AggregateError([Object.assign(new Error('x'), { code: 'ECONNREFUSED' })]),
      })
    ),
    true
  )
  assert.equal(isDefinitelyNotExecuted(Object.assign(new Error('x'), { code: 'ECONNRESET' })), false, 'reset after connect is ambiguous')
  assert.equal(isDefinitelyNotExecuted(new Error('socket hang up')), false, 'hang up is ambiguous')
  assert.equal(isDefinitelyNotExecuted(new Error('aborted')), false)
})

test('agent loop NEVER re-runs a step whose outcome is execution_unknown', async () => {
  const { providerManager } = await import('../providers/ProviderManager')
  const { initDatabase } = await import('../database')
  await initDatabase(TMP)
  const { AgentTaskManager } = await import('../agent/task-manager')
  type AgentProgress = import('../agent/task-manager').AgentProgress

  let planCalls = 0
  let repairCalls = 0
  const realGen = providerManager.generateResilientCompletion.bind(providerManager)
  ;(providerManager as any).generateResilientCompletion = async (prompt: string) => {
    if (prompt.includes('Plan the optimal')) {
      planCalls++
      return JSON.stringify({
        analysis: 'One step.',
        reflection: 'go',
        steps: [
          { thought: 't', description: 'Type the text', tool: 'typeText', args: { text: 'IMPORTANT SECRET' }, spokenCue: 'Typing.', expected: 'typed' },
        ],
      })
    }
    if (prompt.includes('Suggest a corrected tool call')) {
      repairCalls++
      return JSON.stringify({ tool: 'typeText', args: { text: 'IMPORTANT SECRET' }, spokenCue: 'Retrying.' })
    }
    if (prompt.includes('Summarize the outcome')) return 'Task done.'
    return ''
  }
  try {
    const events: AgentProgress[] = []
    const execCalls: string[] = []
    const mgr = new AgentTaskManager(async (tool) => {
      execCalls.push(tool)
      // Exactly what the server bridge returns for an ambiguous desktop call:
      return {
        success: false,
        error: 'execution_unknown: the request timed out; operation op_loop_1 was NOT retried. Reconcile with operation ID op_loop_1.',
        outcome: 'execution_unknown' as const,
        opId: 'op_loop_1',
      }
    }, (p) => events.push(p))

    const rec = mgr.start('type the secret text')
    const start = Date.now()
    while (!events.some((e) => e.event === 'completed' || e.event === 'failed')) {
      if (Date.now() - start > 5000) throw new Error('waitFor timed out')
      await new Promise((r) => setTimeout(r, 5))
    }
    const final = mgr.get(rec.taskId)!
    assert.equal(final.status, 'failed', 'the task must fail — the outcome is unknown')
    assert.match(String(final.error), /execution_unknown/)
    assert.equal(execCalls.length, 1, 'the non-idempotent operation must NOT be re-executed')
    assert.equal(repairCalls, 0, 'no self-repair prompt may trigger a re-run of an unknown op')
    assert.equal(planCalls, 1, 'no replanning happened')
    assert.ok(!events.some((e) => e.event === 'completed'), 'must not be reported as success')
  } finally {
    ;(providerManager as any).generateResilientCompletion = realGen
  }
})

test('Python sidecar: real FastAPI app dedups op ids end-to-end (skips if python missing)', async (t) => {
  const script = `
import json
from fastapi.testclient import TestClient
import desktop_agent.main as m

c = TestClient(m.app)

# health exposes a per-process instance id
h = c.get('/health').json()
assert isinstance(h.get('instance_id'), str) and h['instance_id'], h

# 1) first execution runs
r1 = c.post('/execute', json={'tool': 'resetNewsCache', 'args': {}, 'op_id': 'op_py_1'})
j1 = r1.json()
assert r1.status_code == 200 and j1['ok'] is True, j1
assert j1['deduplicated'] is False and j1['op_id'] == 'op_py_1', j1
assert j1['status'] == 'completed' and j1['instance_id'] == h['instance_id'], j1

# 2) duplicate op id replays the ORIGINAL result, does not execute again
r2 = c.post('/execute', json={'tool': 'resetNewsCache', 'args': {}, 'op_id': 'op_py_1'})
j2 = r2.json()
assert j2['deduplicated'] is True, j2
assert j2['ok'] is True and j2['result'] == j1['result'], (j1, j2)

# 3) in-progress duplicate is refused, not executed
assert m.claim_operation('op_py_2', 'resetNewsCache') is None
r3 = c.post('/execute', json={'tool': 'resetNewsCache', 'args': {}, 'op_id': 'op_py_2'})
j3 = r3.json()
assert j3['deduplicated'] is True and j3['status'] == 'in_progress' and j3['ok'] is False, j3

# 4) status endpoint for reconciliation
s = c.get('/operations/op_py_1').json()
assert s['found'] is True and s['status'] == 'completed' and s['result'] == j1['result'], s
assert c.get('/operations/op_never').json()['found'] is False

# 5) legacy callers without op_id keep working
r4 = c.post('/execute', json={'tool': 'resetNewsCache', 'args': {}})
assert r4.status_code == 200 and r4.json()['ok'] is True, r4.text

# 6) failed outcomes dedup too (unknown tool, recorded before claim)
r5 = c.post('/execute', json={'tool': 'definitelyNotATool', 'args': {}, 'op_id': 'op_py_3'})
assert r5.json()['status'] == 'failed', r5.text
r6 = c.post('/execute', json={'tool': 'definitelyNotATool', 'args': {}, 'op_id': 'op_py_3'})
j6 = r6.json()
assert j6['deduplicated'] is True and j6['ok'] is False, j6

# 7) tiered retention (review finding P1-3a)
import desktop_agent.operations as ops

ops.reset_registry()
assert ops.last_eviction_at() is None, 'fresh registry has no watermark'

# 7a) tier-1 overflow compacts into TOMBSTONES, does NOT stamp the watermark
assert m.claim_operation('op_ev_1', 'resetNewsCache') is None
m.record_result('op_ev_1', 'completed', result={'v': 1})
ops.MAX_FINISHED_RECORDS = 1  # shrink tier 1 to force compaction
m.record_result('op_ev_2', 'completed', result={'v': 2})
m.record_result('op_ev_3', 'completed', result={'v': 3})
ops.MAX_FINISHED_RECORDS = 1000
stats = ops.registry_stats()
assert stats['tombstones'] >= 2, stats
assert stats['last_eviction_at'] is None, ('tier-1 compaction is NOT eviction', stats)

# tombstoned outcome is still authoritative on the status endpoint
s1 = c.get('/operations/op_ev_1').json()
assert s1['found'] is True and s1['status'] == 'completed' and s1['evicted'] is True, s1

# 7b) duplicate op id after tier-1 eviction: dedup replay, NOT re-execution.
# The tombstone keeps only the STATUS — the payload was compacted away.
r7 = c.post('/execute', json={'tool': 'resetNewsCache', 'args': {}, 'op_id': 'op_ev_1'})
j7 = r7.json()
assert j7['deduplicated'] is True and j7['evicted'] is True and j7['ok'] is True, j7
assert j7['status'] == 'completed' and j7['result'] is None, j7

# 7c) tier-2 overflow (tombstone dropped) stamps the watermark; record forgotten
ops.MAX_TOMBSTONES = 0
m.record_result('op_ev_4', 'completed', result={'v': 4})  # forces tombstone flush
ops.MAX_TOMBSTONES = 5000
stats2 = ops.registry_stats()
assert stats2['last_eviction_at'] is not None, ('only a full drop stamps the watermark', stats2)
assert m.get_operation('op_ev_1') is None, 'op_ev_1 was fully forgotten'
s_miss = c.get('/operations/op_ev_1').json()
assert s_miss['found'] is False, s_miss
assert isinstance(s_miss['last_eviction_at'], (int, float)), ('miss MUST carry the watermark', s_miss)

# 7d) status endpoint for an op never seen, with a non-null watermark: the
# watermark exists but predates nothing — bridge must compare it to dispatch.
s_never = c.get('/operations/op_never_2').json()
assert s_never['found'] is False and s_never['last_eviction_at'] is not None, s_never

print('PY_E2E_OK')
`
  const { spawnSync } = await import('node:child_process')
  const probe = spawnSync('python', ['--version'], { encoding: 'utf8' })
  if (probe.error || probe.status !== 0) {
    t.skip('python unavailable — skipping real-sidecar end-to-end dedup test')
    return
  }
  const run = spawnSync('python', ['-c', script], { encoding: 'utf8', cwd: process.cwd(), timeout: 120_000 })
  const output = `${run.stdout || ''}${run.stderr || ''}`
  assert.equal(run.status, 0, `python e2e failed:\n${output}`)
  assert.match(output, /PY_E2E_OK/)
})
