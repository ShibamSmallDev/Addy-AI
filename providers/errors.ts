/**
 * Typed provider failure for the agent loop.
 *
 * A provider outage must be visible as a provider outage — never silently
 * converted into an empty completion string that later looks like a valid
 * (but empty) model response. `AgentLoop` uses this to fail a task with an
 * explicit, classified reason instead of falling back to a fake plan.
 *
 * Classification reuses the existing message-based helpers in `server_paths`
 * (`isKeyError`, `isCapacityError`) so we have one source of truth for what
 * counts as a credential, quota, or capacity problem.
 */

import { isCapacityError, isKeyError } from '../server_paths'

export type ProviderFailureKind =
  | 'rate_limit'
  | 'auth'
  | 'capacity'
  | 'timeout'
  | 'unavailable'

export type ProviderPhase = 'planning' | 'self_repair' | 'summary'

/**
 * Classify a provider error message into a stable kind.
 *
 * Order matters: rate-limit patterns are checked before the broader
 * credential pattern (`isKeyError` also matches 429/quota wording).
 */
export function classifyProviderFailure(err: unknown): ProviderFailureKind {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase()
  if (/429|too many requests|rate limit|resource_exhausted|\bquota\b/.test(msg)) return 'rate_limit'
  if (isKeyError(err)) return 'auth'
  if (isCapacityError(err)) return 'capacity'
  if (/timeout|timed out|aborterror|aborted/.test(msg)) return 'timeout'
  return 'unavailable'
}

/** Human-readable label used in user-facing task errors. */
export const PROVIDER_KIND_LABEL: Record<ProviderFailureKind, string> = {
  rate_limit: 'rate limit exceeded',
  auth: 'authentication failed',
  capacity: 'provider at capacity',
  timeout: 'request timed out',
  unavailable: 'provider unavailable',
}

export class ProviderFailureError extends Error {
  readonly kind: ProviderFailureKind
  readonly phase: ProviderPhase
  /** Original provider error message, preserved for diagnostics. */
  readonly cause: string

  constructor(kind: ProviderFailureKind, phase: ProviderPhase, cause: string) {
    super(`Provider failure during ${phase}: ${PROVIDER_KIND_LABEL[kind]} — ${cause}`)
    this.name = 'ProviderFailureError'
    this.kind = kind
    this.phase = phase
    this.cause = cause
  }

  static from(err: unknown, phase: ProviderPhase): ProviderFailureError {
    if (err instanceof ProviderFailureError) return err
    const cause = String((err as any)?.message ?? err ?? 'unknown provider error')
    return new ProviderFailureError(classifyProviderFailure(err), phase, cause)
  }
}
