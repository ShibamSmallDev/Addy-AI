/**
 * Autonomous agent task lifecycle.
 *
 * Wraps the existing ReAct `AgentLoop` with an explicit task lifecycle
 * (queued → running → completed | failed | aborted), a background (never
 * blocking) runner, a progress/cue stream, and abort that propagates through
 * every long-running stage and desktop action.
 *
 * This is a thin orchestration layer — it reuses the loop and the caller's tool
 * executor verbatim. No new autonomous-agent subsystem.
 */

import { AgentLoop, type AgentState, type ToolExecutionResult } from './loop'
import { getGeminiApiKey } from '../server_paths'

export type AgentTaskStatus = 'queued' | 'running' | 'completed' | 'failed' | 'aborted'

export interface AgentTaskRecord {
  taskId: string
  goal: string
  status: AgentTaskStatus
  createdAt: number
  startedAt?: number
  finishedAt?: number
  stepsDone: number
  stepsTotal: number
  summary?: string
  error?: string
  /** True once an abort has been requested (used to distinguish aborted vs failed). */
  abortRequested: boolean
}

export interface AgentProgress {
  taskId: string
  status: AgentTaskStatus
  event: string
  spokenCue?: string
  stepIndex?: number
  stepsDone?: number
  stepsTotal?: number
  summary?: string
  error?: string
}

export type ToolExec = (
  tool: string,
  args: Record<string, unknown>
) => Promise<ToolExecutionResult>

export type LoopEvent = { type: string; data?: any; spokenCue?: string }

/** Minimal surface the task manager needs from a loop (real AgentLoop satisfies it). */
export interface ManagedLoop {
  run(): Promise<AgentState>
  abort(): void
  isAborted(): boolean
  getState(): AgentState
}

export type LoopFactory = (
  goal: string,
  onEvent: (e: LoopEvent) => void,
  exec: ToolExec
) => ManagedLoop

const defaultLoopFactory: LoopFactory = (goal, onEvent, exec) =>
  new AgentLoop(goal, getGeminiApiKey() || '', onEvent as any, exec)

export class AgentTaskManager {
  private tasks = new Map<string, AgentTaskRecord>()
  private loops = new Map<string, ManagedLoop>()

  constructor(
    private exec: ToolExec,
    private onProgress: (p: AgentProgress) => void = () => {},
    private loopFactory: LoopFactory = defaultLoopFactory
  ) {}

  start(goal: string): AgentTaskRecord {
    if (!getGeminiApiKey()) throw new Error('No Gemini API key configured')
    const trimmed = (goal || '').trim()
    if (!trimmed) throw new Error('goal is required')

    const taskId = 'agent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)
    const rec: AgentTaskRecord = {
      taskId,
      goal: trimmed,
      status: 'queued',
      createdAt: Date.now(),
      stepsDone: 0,
      stepsTotal: 0,
      abortRequested: false,
    }
    this.tasks.set(taskId, rec)

    // Abort-aware executor: once an abort is requested, no NEW desktop action is
    // launched (in-flight calls finish; the loop halts at the next safe point).
    const wrapped: ToolExec = async (tool, args) => {
      if (rec.abortRequested) return { success: false, error: 'Task aborted' }
      const loop = this.loops.get(taskId)
      if (loop?.isAborted()) return { success: false, error: 'Task aborted' }
      return this.exec(tool, args)
    }

    const loop = this.loopFactory(trimmed, (e) => this.handleEvent(rec, e), wrapped)
    this.loops.set(taskId, loop)

    // Background: never blocks the caller (chat/voice turn returns immediately).
    void (async () => {
      rec.status = 'running'
      rec.startedAt = Date.now()
      try {
        await loop.run()
      } catch (e: any) {
        rec.status = rec.abortRequested ? 'aborted' : 'failed'
        rec.error = e?.message || String(e)
        rec.finishedAt = Date.now()
        this.emit(rec, { event: 'failed', error: rec.error, spokenCue: `Autonomous task failed: ${rec.error}` })
      }
    })()

    return rec
  }

  abort(taskId: string): boolean {
    const rec = this.tasks.get(taskId)
    const loop = this.loops.get(taskId)
    if (!rec || !loop) return false
    if (rec.status === 'completed' || rec.status === 'failed' || rec.status === 'aborted') return false
    rec.abortRequested = true
    loop.abort()
    return true
  }

  get(taskId: string): (AgentTaskRecord & { state?: AgentState }) | undefined {
    const rec = this.tasks.get(taskId)
    if (!rec) return undefined
    const loop = this.loops.get(taskId)
    return { ...rec, state: loop?.getState() }
  }

  list(): AgentTaskRecord[] {
    return [...this.tasks.values()]
  }

  private handleEvent(rec: AgentTaskRecord, event: LoopEvent): void {
    const { type, data } = event

    if (type === 'plan' && Array.isArray(data?.steps)) {
      rec.stepsTotal = data.steps.length
    }
    if (type === 'step-done') {
      rec.stepsDone++
    }

    let summary: string | undefined
    let error: string | undefined

    if (type === 'completed') {
      rec.status = 'completed'
      rec.summary = data?.summary || rec.summary || data?.spokenAnnouncement
      rec.finishedAt = Date.now()
      summary = rec.summary
    } else if (type === 'failed') {
      rec.status = rec.abortRequested ? 'aborted' : 'failed'
      rec.error = data?.error || 'Task failed'
      rec.finishedAt = Date.now()
      error = rec.error
    }

    this.emit(rec, {
      event: type,
      spokenCue: event.spokenCue,
      stepIndex: typeof data?.stepIndex === 'number' ? data.stepIndex : undefined,
      summary,
      error,
    })
  }

  private emit(rec: AgentTaskRecord, extra: { event: string } & Partial<Omit<AgentProgress, "event">>): void {
    this.onProgress({
      taskId: rec.taskId,
      status: rec.status,
      stepsDone: rec.stepsDone,
      stepsTotal: rec.stepsTotal,
      ...extra,
    })
  }
}
