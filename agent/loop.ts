import { storeMemory } from '../memory/retriever'
import type { MemoryCategory } from '../memory/retriever'
import { providerManager } from '../providers/ProviderManager'
import { ProviderFailureError, type ProviderPhase } from '../providers/errors'
import { parsePlanJson, validatePlan, PlanValidationError, isPlainObject } from './plan-validator'
import { DESKTOP_TOOLS } from '../tools/desktop-tools'
import type { ExecutionOutcome } from '../tools/desktop-agent-client'

const DEFAULT_MODEL = 'gemini-2.0-flash'

/**
 * Result of one tool execution. `outcome`/`opId` are set by bridges that can
 * report an explicit execution status (P1-3): `execution_unknown` and
 * `cancelled` results must NEVER be retried — re-dispatching an operation
 * whose execution status is unknown could repeat non-idempotent side effects.
 */
export interface ToolExecutionResult {
  success: boolean
  data?: any
  error?: string
  outcome?: ExecutionOutcome
  opId?: string
}

export interface AgentStep {
  id: string
  description: string
  tool: string
  args: Record<string, unknown>
  thought?: string
  expected?: string
  spokenCue?: string
}

export interface AgentPlan {
  goal: string
  steps: AgentStep[]
  analysis: string
  reflection?: string
}

export interface AgentStepResult {
  step: AgentStep
  result: ToolExecutionResult
  attempts: number
  error?: string
  spokenSummary?: string
}

export type AgentStatus = 'planning' | 'executing' | 'verifying' | 'completed' | 'failed'

export interface AgentState {
  goal: string
  plan: AgentPlan | null
  status: AgentStatus
  currentStepIndex: number
  stepResults: AgentStepResult[]
  summary?: string
  spokenAnnouncement?: string
}

export type AgentEventCallback = (event: {
  type: 'plan' | 'plan-rejected' | 'thought' | 'step-start' | 'step-done' | 'step-retry' | 'step-failed' | 'verifying' | 'completed' | 'failed'
  data?: any
  spokenCue?: string
}) => void

const MAX_RETRIES = 3
const MAX_REACT_STEPS = 12
/** Planning attempts: 1 initial + 1 bounded, explicit replan. Never endless. */
const MAX_PLAN_ATTEMPTS = 2

export class AgentLoop {
  private state: AgentState
  private apiKey: string
  private modelName: string
  private onEvent: AgentEventCallback
  private abortFlag = false
  private toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>

  constructor(
    goal: string,
    apiKey: string,
    onEvent: AgentEventCallback,
    toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<ToolExecutionResult>,
    modelName?: string
  ) {
    this.state = {
      goal,
      plan: null,
      status: 'planning',
      currentStepIndex: 0,
      stepResults: [],
    }
    this.apiKey = apiKey
    this.modelName = modelName || DEFAULT_MODEL
    this.onEvent = onEvent
    this.toolExecutor = toolExecutor
  }

  abort() {
    this.abortFlag = true
  }

  isAborted(): boolean {
    return this.abortFlag
  }

  getState(): AgentState {
    return { ...this.state }
  }

  private async generateCompletion(prompt: string, systemInstruction?: string, phase: ProviderPhase = 'planning'): Promise<string> {
    // Provider failures are typed and propagated — never swallowed into an
    // empty string that would later be mistaken for a valid model response.
    let raw: string
    try {
      raw = await providerManager.generateResilientCompletion(prompt, systemInstruction)
    } catch (err) {
      throw ProviderFailureError.from(err, phase)
    }
    if (typeof raw !== 'string') {
      throw new ProviderFailureError('unavailable', phase, 'provider returned a non-string completion')
    }
    return raw
  }

  /**
   * Explicit, goal-aware replan request: tells the model exactly why its plan
   * was rejected (typed kind + concrete details) and to keep the SAME goal.
   * Bounded — only ever called by the MAX_PLAN_ATTEMPTS loop.
   */
  private buildReplanPrompt(basePrompt: string, error: PlanValidationError, previousRaw: string): string {
    return `${basePrompt}

Your previous plan was REJECTED before execution — it failed validation and NO tool has run:
${error.details.map((d) => `  - ${d}`).join('\n')}

Previous response (truncated): ${previousRaw.slice(0, 1200)}

Fix exactly these problems while keeping the same goal. Tool names must come from the list above and every argument must match the tool's declared schema. Reply with ONE corrected JSON plan in the exact schema requested.`
  }

  async run(): Promise<AgentState> {
    this.state.status = 'planning'
    const initialAnnouncement = `I'm analyzing the goal: "${this.state.goal}". Preparing the execution strategy.`
    this.onEvent({ 
      type: 'plan', 
      data: { status: 'planning' },
      spokenCue: initialAnnouncement
    })

    const toolsList = [
      '  desktopBrowserOpen(url) - Open URL in Microsoft Edge',
      '  desktopBrowserSearch(query, engine) - Search web / Twitter / YouTube',
      '  desktopBrowserGetSemanticTree() - Extract interactive element IDs ([1] Button, [2] Textbox)',
      '  desktopBrowserClick(id, selector, text, role, name) - Click element by ID or selector',
      '  desktopBrowserType(id, selector, text, clear, submit) - Type text into field',
      '  desktopBrowserFillForm(fields, submit) - Fill full form in 1 step',
      '  desktopBrowserExtractText(maxChars) - Extract clean article text & thread content',
      '  desktopBrowserScreenshot(fullPage) - Capture web screenshot',
      '  openApplication(name) - Launch desktop app (VS Code, Discord, Edge, etc.)',
      '  closeApplication(name) - Close application',
      '  locateElement(label) - Find UI element text on screen',
      '  mouseMove(x, y, smooth) - Precision mouse move',
      '  mouseClick(x, y, button, smooth) - Precision mouse click',
      '  typeText(text, targetWindow) - Hardware Unicode text typing',
      '  pressKeyCombination(modifiers, key) - Press hotkey like Ctrl+Shift+P',
      '  createFile(path, content) - Create file',
      '  readFile(path) - Read file contents',
      '  writeCodeFile(path, content) - Write code file',
      '  searchFiles(directory, query) - Search files',
      '  readWebpage(url) - Extract clean article markdown text from any web URL',
      '  youtubeTranscript(url) - Extract full transcript and subtitles from a YouTube video',
      '  youtubeSearch(query) - Search YouTube for video titles and URLs',
      '  githubRepo(repo) - Inspect GitHub repository metadata, README, and tree',
      '  githubIssues(repo, state) - Read issues from a GitHub repository',
      '  readPdf(path) - Extract text content from local PDF file',
      '  getClipboard() - Read text from system clipboard',
      '  copySelected() - Copy highlighted/selected content to clipboard',
      '  pasteClipboard() - Paste clipboard text into current active application',
      '  listWindows() - List all visible open desktop windows with titles and process names',
      '  getActiveWindow() - Get metadata for current active foreground window',
      '  focusWindow(title, process, pid) - Bring window to foreground and focus it',
      '  snapWindow(zone, title) - Snap window to left, right, top, bottom, or maximize',
      '  switchApplication(name) - Switch window focus to named app',
      '  minimizeWindow(title) - Minimize application window',
      '  maximizeWindow(title) - Maximize application window',
      '  openFolder(path) - Open local directory in Windows File Explorer',
      '  listFiles(directory) - List contents of local directory',
      '  setVolume(level) - Adjust system master volume (0-100)',
      '  volumeUp() - Increase system audio volume',
      '  volumeDown() - Decrease system audio volume',
      '  mediaPlayPause() - Toggle play/pause for system media (Spotify, YouTube, browser)',
      '  showDesktopNotification(title, message) - Display native Windows desktop notification',
      '  speakText(text, wait) - Speak aloud to the user using Windows speech synthesis (SAPI)',
      '  fetchAINews(limit, unread_only) - Fetch breaking AI tech news stories from Hacker News and RSS',
      '  checkEmails(limit, folder, unread_only) - Check unread emails via secure local IMAP',
      '  checkWhatsAppMessages(headless, timeout) - Inspect WhatsApp Web for unread messages via Edge profile',
      '  takeScreenshot() - Capture desktop screenshot',
      '  systemInfo() - Get system specifications',
    ]

    const planPrompt = `You are Addy, an elite autonomous AI companion and coding agent with Hermes-style reflection and OpenClaw execution patterns.

Goal: "${this.state.goal}"

Available tools:
${toolsList.join('\n')}

Plan the optimal, minimal sequence of steps to accomplish this goal.
For each step, include:
- "thought": internal Hermes reflection on why this step is chosen and potential edge cases.
- "description": concise description of the action.
- "tool": exact tool name from the list.
- "args": JSON object of arguments.
- "spokenCue": a natural 1-sentence spoken update Addy can say to the user before doing this action.
- "expected": what constitutes success.

Respond ONLY with valid JSON:
{
  "analysis": "1-2 sentence breakdown of the task",
  "reflection": "strategic approach",
  "steps": [
    {
      "thought": "...",
      "description": "...",
      "tool": "...",
      "args": {},
      "spokenCue": "...",
      "expected": "..."
    }
  ]
}`

    // Planning must fail loudly: a provider outage is reported as a failed
    // task with a typed reason (P1-1), and a plan that fails validation is
    // rejected BEFORE any tool runs — there is no generic fallback plan.
    let lastPlanError: PlanValidationError | null = null
    let lastRawPlan = ''

    for (let attempt = 0; attempt < MAX_PLAN_ATTEMPTS; attempt++) {
      const isReplan = attempt > 0
      const prompt = isReplan ? this.buildReplanPrompt(planPrompt, lastPlanError!, lastRawPlan) : planPrompt
      const system = isReplan
        ? "You are an autonomous AI planning agent correcting a rejected plan. Reply strictly in JSON."
        : "You are an autonomous AI planning agent. Reply strictly in JSON."

      let raw: string
      try {
        raw = await this.generateCompletion(prompt, system, 'planning')
      } catch (err) {
        // P1-1 path: provider outage fails the task typed — including during a replan.
        const failure = ProviderFailureError.from(err, 'planning')
        this.state.status = 'failed'
        this.onEvent({
          type: 'failed',
          data: { phase: 'planning', kind: failure.kind, error: failure.message },
          spokenCue: `I could not build a plan: ${failure.message}`,
        })
        return this.state
      }
      lastRawPlan = raw

      try {
        const parsed = parsePlanJson(raw)
        const validated = validatePlan(parsed) // validates ALL steps or throws
        this.state.plan = {
          goal: this.state.goal,
          steps: validated.steps.map((s, i) => ({ id: 'step_' + (i + 1), ...s })),
          analysis: validated.analysis,
          reflection: validated.reflection,
        }
        lastPlanError = null
        break
      } catch (err) {
        if (!(err instanceof PlanValidationError)) throw err // unexpected — surface it
        lastPlanError = err
        this.onEvent({
          type: 'plan-rejected',
          data: { attempt: attempt + 1, kind: err.kind, details: err.details },
          spokenCue:
            attempt + 1 < MAX_PLAN_ATTEMPTS
              ? `My draft plan was rejected (${err.kind}). Re-planning against the original goal.`
              : undefined,
        })
      }
    }

    if (!this.state.plan) {
      // Every attempt was rejected: fail with a useful explanation. The old
      // generic `searchFiles` fallback is gone — it never matched the goal.
      const failure = lastPlanError!
      this.state.status = 'failed'
      this.onEvent({
        type: 'failed',
        data: { phase: 'planning', kind: failure.kind, error: failure.message, details: failure.details },
        spokenCue: `I could not produce a valid plan: ${failure.details[0] || failure.message}`,
      })
      return this.state
    }

    this.onEvent({ 
      type: 'plan', 
      data: this.state.plan,
      spokenCue: `I've prepared a ${this.state.plan.steps.length}-step plan to ${this.state.goal}. Starting execution now.`
    })
    this.state.status = 'executing'

    // --- Dynamic ReAct Execution Loop ---
    for (let i = 0; i < this.state.plan.steps.length; i++) {
      if (this.abortFlag) {
        this.state.status = 'failed'
        this.onEvent({ type: 'failed', data: { error: 'Aborted by user' }, spokenCue: "Task execution was aborted." })
        return this.state
      }

      const step = this.state.plan.steps[i]!
      this.state.currentStepIndex = i

      if (step.thought) {
        this.onEvent({ type: 'thought', data: { thought: step.thought, stepIndex: i } })
      }

      this.onEvent({ 
        type: 'step-start', 
        data: step,
        spokenCue: step.spokenCue || `Executing step ${i + 1}: ${step.description}.`
      })

      let lastResult: ToolExecutionResult = { success: false, error: 'Not executed' }
      let attempts = 0
      let stepPassed = false

      while (attempts <= MAX_RETRIES && !stepPassed) {
        if (this.abortFlag) break
        attempts++

        if (attempts > 1) {
          this.onEvent({ 
            type: 'step-retry', 
            data: { ...step, attempt: attempts },
            spokenCue: `Step had an issue; attempting automated self-repair for step ${i + 1}.`
          })
        }

        try {
          lastResult = await this.toolExecutor(step.tool, step.args)
        } catch (e: any) {
          lastResult = { success: false, error: e.message }
        }

        if (lastResult.success) {
          stepPassed = true
        } else if (lastResult.outcome === 'execution_unknown' || lastResult.outcome === 'cancelled') {
          // P1-3: an operation whose execution status is unknown (or that was
          // cancelled) must NEVER be blindly retried — re-dispatching could
          // repeat a non-idempotent side effect. Halt the retry loop; the
          // generic failure path below reports the uncertainty (with the
          // operation ID) and fails the task.
          console.warn(
            `[AgentLoop] Step ${i + 1} (${step.tool}) outcome=${lastResult.outcome} op=${lastResult.opId || 'n/a'} — not retrying (unsafe to re-execute)`
          )
          break
        } else if (attempts < MAX_RETRIES) {
          // Hermes-style Dynamic Self-Healing Prompt
          const fixPrompt = `The tool "${step.tool}" failed with args ${JSON.stringify(step.args)}.
Error: ${lastResult.error}
Goal: ${this.state.goal}
Step description: ${step.description}

Suggest a corrected tool call to achieve the expected result.
Reply with JSON ONLY:
{ "tool": "<tool_name>", "args": {}, "spokenCue": "<1 sentence update>" }`

          let fixRaw: string | null = null
          try {
            fixRaw = await this.generateCompletion(fixPrompt, "You are a self-healing AI agent.", 'self_repair')
          } catch (err) {
            // Self-repair is best-effort: a provider failure here is observable
            // (logged with its typed kind) and the retry loop continues with the
            // original step — never silently swallowed, never faked as a fix.
            const failure = ProviderFailureError.from(err, 'self_repair')
            console.warn(`[AgentLoop] Self-repair suggestion unavailable (step ${i + 1}): ${failure.message}`)
          }

          if (fixRaw !== null) {
            // Malformed or unsafe repair suggestions are rejected explicitly —
            // never applied silently, never treated as a provider failure.
            const fStart = fixRaw.indexOf('{')
            const fEnd = fixRaw.lastIndexOf('}')
            if (fStart === -1 || fEnd === -1 || fEnd <= fStart) {
              console.warn(`[AgentLoop] Malformed self-repair response ignored (step ${i + 1}): no JSON object`)
            } else {
              try {
                const fix = JSON.parse(fixRaw.slice(fStart, fEnd + 1))
                const fixToolOk =
                  isPlainObject(fix) &&
                  typeof (fix as any).tool === 'string' &&
                  DESKTOP_TOOLS.has((fix as any).tool) &&
                  ((fix as any).args === undefined || (fix as any).args === null || isPlainObject((fix as any).args))
                if (fixToolOk) {
                  if ((fix as any).args) step.args = (fix as any).args
                  step.tool = (fix as any).tool
                  if (typeof (fix as any).spokenCue === 'string') step.spokenCue = (fix as any).spokenCue
                } else {
                  console.warn(
                    `[AgentLoop] Rejected self-repair suggestion (step ${i + 1}): unknown tool '${String((fix as any)?.tool)}' or invalid args`
                  )
                }
              } catch {
                console.warn(`[AgentLoop] Malformed self-repair response ignored (step ${i + 1}): invalid JSON`)
              }
            }
          }
        }
      }

      this.state.stepResults.push({ step, result: lastResult, attempts })

      if (!lastResult.success) {
        this.onEvent({ 
          type: 'step-failed', 
          data: { step, result: lastResult, attempts },
          spokenCue: `Step ${i + 1} failed: ${lastResult.error || 'unknown error'}. Halting task execution.`
        })
        this.state.status = 'failed'
        this.onEvent({
          type: 'failed',
          data: { step, error: lastResult.error, outcome: lastResult.outcome, opId: lastResult.opId },
        })
        return this.state
      }

      this.onEvent({ 
        type: 'step-done', 
        data: { step, result: lastResult, attempts },
        spokenCue: `Step ${i + 1} completed successfully.`
      })
    }

    // --- OpenClaw Verification Gate ---
    this.state.status = 'verifying'
    this.onEvent({ 
      type: 'verifying', 
      spokenCue: "All steps executed. Running final verification and synthesizing results." 
    })

    const summaryPrompt = `Summarize the outcome of this autonomous task in 2 clear sentences:
Goal: "${this.state.goal}"
Steps:
${this.state.plan.steps.map((s, idx) => {
  const r = this.state.stepResults[idx]
  return `  - ${s.description}: ${r?.result.success ? 'SUCCESS' : 'FAILED'}`
}).join('\n')}

Synthesize the final result and provide a natural spoken summary for Addy.`

    try {
      const summaryText = (await this.generateCompletion(summaryPrompt, "You are a concise reporting assistant.", 'summary')).trim()
      // Empty model output must not masquerade as a generated summary.
      this.state.summary = summaryText || `All ${this.state.plan.steps.length} steps executed; the model returned no summary text.`
    } catch (err) {
      const failure = ProviderFailureError.from(err, 'summary')
      console.warn(`[AgentLoop] Summary generation unavailable: ${failure.message}`)
      this.state.summary = `All ${this.state.plan.steps.length} steps executed successfully for: ${this.state.goal}. Model summary unavailable (${failure.kind}).`
    }

    this.state.status = 'completed'
    this.state.spokenAnnouncement = this.state.summary

    // Store in persistent memory
    storeMemory(
      'task_' + Date.now(),
      `Autonomous Task: ${this.state.goal.slice(0, 100)} -- ${this.state.summary.slice(0, 200)}`,
      'active_task' as MemoryCategory
    )

    this.onEvent({ 
      type: 'completed', 
      data: this.state,
      spokenCue: this.state.summary
    })

    return this.state
  }
}
