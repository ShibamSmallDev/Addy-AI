/**
 * Plan validation for the autonomous agent loop (roadmap 3.1).
 *
 * Model output is untrusted input: every plan is validated in full BEFORE any
 * tool executes. Validation uses the REAL tool registry and the REAL Gemini
 * function declarations (moved verbatim to `tools/desktop-tools.ts`) — this
 * module does not invent a parallel tool list or schema source.
 *
 * `PlanValidationError` is deliberately distinct from `ProviderFailureError`
 * (providers/errors.ts): "the model gave us an unusable plan" is not "the
 * provider could not be reached".
 */

import {
  DESKTOP_TOOLS,
  DESKTOP_FUNCTION_DECLARATIONS,
  REACH_FUNCTION_DECLARATIONS,
} from '../tools/desktop-tools'

export type PlanFailureKind =
  | 'malformed_json'
  | 'invalid_structure'
  | 'empty_plan'
  | 'unknown_tool'
  | 'invalid_args'

export class PlanValidationError extends Error {
  readonly kind: PlanFailureKind
  /** Specific problems — fed back into a bounded replan and to the user. */
  readonly details: string[]

  constructor(kind: PlanFailureKind, details: string[]) {
    super(`Plan validation failed (${kind}): ${details.join('; ')}`)
    this.name = 'PlanValidationError'
    this.kind = kind
    this.details = details
  }
}

export interface PlanStepDraft {
  tool: string
  args: Record<string, unknown>
  description: string
  thought: string
  spokenCue: string
  expected: string
}

export interface ValidatedPlan {
  steps: PlanStepDraft[]
  analysis: string
  reflection: string
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

// --- Existing Gemini function declarations, indexed by tool name -----------

interface ParamSchema {
  type?: string
  properties?: Record<string, ParamSchema>
  required?: string[]
  items?: unknown
  [key: string]: unknown
}

interface ToolDeclaration {
  name: string
  parameters?: ParamSchema
}

const DECLARATION_INDEX: Map<string, ParamSchema> = (() => {
  const index = new Map<string, ParamSchema>()
  const all = [
    ...(REACH_FUNCTION_DECLARATIONS as unknown as ToolDeclaration[]),
    ...(DESKTOP_FUNCTION_DECLARATIONS as unknown as ToolDeclaration[]),
  ]
  for (const decl of all) {
    if (decl?.name && decl.parameters && !index.has(decl.name)) {
      index.set(decl.name, decl.parameters)
    }
  }
  return index
})()

/** true = matches, false = does not match, null = no declared type to enforce. */
function typeMatches(expected: string | undefined, value: unknown): boolean | null {
  if (!expected) return null
  switch (expected) {
    case 'STRING':
      return typeof value === 'string'
    case 'NUMBER':
      return typeof value === 'number' && Number.isFinite(value)
    case 'INTEGER':
      return typeof value === 'number' && Number.isInteger(value)
    case 'BOOLEAN':
      return typeof value === 'boolean'
    case 'ARRAY':
      return Array.isArray(value)
    case 'OBJECT':
      return isPlainObject(value)
    default:
      return null // TYPE_UNSPECIFIED / unknown future types: nothing to enforce
  }
}

// --- Parsing ----------------------------------------------------------------

/**
 * Extract and parse the JSON plan object from a model response.
 * Throws `PlanValidationError('malformed_json')` for empty or unparseable output.
 */
export function parsePlanJson(raw: string): unknown {
  if (typeof raw !== 'string' || !raw.trim()) {
    throw new PlanValidationError('malformed_json', ['model returned an empty response'])
  }
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new PlanValidationError('malformed_json', ['response contains no JSON object'])
  }
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch (e) {
    throw new PlanValidationError('malformed_json', [
      `response is not valid JSON: ${String((e as Error)?.message ?? e).slice(0, 120)}`,
    ])
  }
}

// --- Validation --------------------------------------------------------------

/**
 * Validate the FULL plan. All problems across all steps are collected, then a
 * single `PlanValidationError` is thrown — a partially valid plan is never
 * returned, so no caller can execute a partially validated plan.
 */
export function validatePlan(parsed: unknown): ValidatedPlan {
  if (!isPlainObject(parsed)) {
    throw new PlanValidationError('invalid_structure', ['plan must be a JSON object'])
  }

  const rawSteps = (parsed as Record<string, unknown>).steps
  if (rawSteps === undefined || rawSteps === null) {
    throw new PlanValidationError('invalid_structure', ["plan has no 'steps' array"])
  }
  if (!Array.isArray(rawSteps)) {
    throw new PlanValidationError('invalid_structure', ["'steps' must be an array"])
  }
  if (rawSteps.length === 0) {
    throw new PlanValidationError('empty_plan', ['plan contains zero steps'])
  }

  const details: string[] = []
  const kinds: PlanFailureKind[] = []
  const fail = (kind: PlanFailureKind, detail: string) => {
    kinds.push(kind)
    details.push(detail)
  }

  const steps: PlanStepDraft[] = []

  rawSteps.forEach((rawStep, i) => {
    const label = `step ${i + 1}`

    if (!isPlainObject(rawStep)) {
      fail('invalid_structure', `${label}: must be a JSON object`)
      return
    }
    const step = rawStep as Record<string, unknown>

    const tool = step.tool
    if (typeof tool !== 'string' || !tool.trim()) {
      fail('invalid_structure', `${label}: missing a tool name`)
      return
    }
    if (!DESKTOP_TOOLS.has(tool)) {
      fail('unknown_tool', `${label}: unknown tool '${tool}'`)
      return
    }

    let args: Record<string, unknown> = {}
    const rawArgs = step.args
    if (rawArgs !== undefined && rawArgs !== null) {
      if (!isPlainObject(rawArgs)) {
        fail('invalid_args', `${label} (${tool}): 'args' must be a JSON object`)
        return
      }
      args = rawArgs
    }

    // Argument checks against the existing Gemini function declaration, when
    // one exists for this tool. (8 browser-alias tools have no declaration —
    // they get structural validation only; schemas are not invented here.)
    const params = DECLARATION_INDEX.get(tool)
    if (params) {
      const properties = isPlainObject(params.properties)
        ? (params.properties as Record<string, ParamSchema>)
        : null
      const required = Array.isArray(params.required)
        ? params.required.filter((r): r is string => typeof r === 'string')
        : []

      for (const req of required) {
        if (!(req in args) || args[req] === undefined || args[req] === null) {
          fail('invalid_args', `${label} (${tool}): missing required argument '${req}'`)
        }
      }
      if (properties) {
        for (const [key, value] of Object.entries(args)) {
          const schema = properties[key]
          if (!schema) {
            fail('invalid_args', `${label} (${tool}): unknown argument '${key}'`)
            continue
          }
          if (typeMatches(schema.type, value) === false) {
            fail(
              'invalid_args',
              `${label} (${tool}): argument '${key}' must be of type ${schema.type}`
            )
          }
        }
      }
    }

    const description =
      typeof step.description === 'string' && step.description.trim()
        ? step.description
        : 'Action step'

    steps.push({
      tool,
      args,
      description,
      thought: typeof step.thought === 'string' ? step.thought : '',
      spokenCue:
        typeof step.spokenCue === 'string' && step.spokenCue.trim()
          ? step.spokenCue
          : `Now executing ${description}.`,
      expected: typeof step.expected === 'string' ? step.expected : '',
    })
  })

  if (details.length > 0) {
    throw new PlanValidationError(kinds[0]!, details)
  }

  return {
    steps,
    analysis: typeof parsed.analysis === 'string' ? parsed.analysis : '',
    reflection: typeof parsed.reflection === 'string' ? parsed.reflection : '',
  }
}
