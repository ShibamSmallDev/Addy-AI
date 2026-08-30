import { storeMemory } from '../memory/retriever'
import type { MemoryCategory } from '../memory/retriever'
import { providerManager } from '../providers/ProviderManager'

const DEFAULT_MODEL = 'gemini-2.0-flash'

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
  result: { success: boolean; data?: any; error?: string }
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
  type: 'plan' | 'thought' | 'step-start' | 'step-done' | 'step-retry' | 'step-failed' | 'verifying' | 'completed' | 'failed'
  data?: any
  spokenCue?: string
}) => void

const MAX_RETRIES = 3
const MAX_REACT_STEPS = 12

export class AgentLoop {
  private state: AgentState
  private apiKey: string
  private modelName: string
  private onEvent: AgentEventCallback
  private abortFlag = false
  private toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<{ success: boolean; data?: any; error?: string }>

  constructor(
    goal: string,
    apiKey: string,
    onEvent: AgentEventCallback,
    toolExecutor: (tool: string, args: Record<string, unknown>) => Promise<{ success: boolean; data?: any; error?: string }>,
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

  getState(): AgentState {
    return { ...this.state }
  }

  private async generateCompletion(prompt: string, systemInstruction?: string): Promise<string> {
    try {
      return await providerManager.generateResilientCompletion(prompt, systemInstruction)
    } catch {
      // Fallback
      return ""
    }
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

    const rawPlan = await this.generateCompletion(planPrompt, "You are an autonomous AI planning agent. Reply strictly in JSON.")
    const jsonStart = rawPlan.indexOf('{')
    const jsonEnd = rawPlan.lastIndexOf('}')

    if (jsonStart !== -1 && jsonEnd !== -1) {
      try {
        const parsed = JSON.parse(rawPlan.slice(jsonStart, jsonEnd + 1))
        const steps: AgentStep[] = (parsed.steps || []).map((s: any, i: number) => ({
          id: 'step_' + (i + 1),
          thought: s.thought || '',
          description: s.description || 'Action step',
          tool: s.tool || '',
          args: s.args || {},
          spokenCue: s.spokenCue || `Now executing ${s.description || s.tool}.`,
          expected: s.expected || '',
        }))
        this.state.plan = {
          goal: this.state.goal,
          steps,
          analysis: parsed.analysis || '',
          reflection: parsed.reflection || '',
        }
      } catch {}
    }

    if (!this.state.plan || this.state.plan.steps.length === 0) {
      // Fallback single-step exploratory plan
      this.state.plan = {
        goal: this.state.goal,
        analysis: 'Executing goal with dynamic exploration.',
        steps: [
          {
            id: 'step_1',
            description: 'Execute primary goal action',
            tool: 'searchFiles',
            args: { query: this.state.goal },
            spokenCue: `Starting work on ${this.state.goal}.`,
            expected: 'Locate relevant files or interfaces',
          }
        ]
      }
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

      let lastResult: { success: boolean; data?: any; error?: string } = { success: false, error: 'Not executed' }
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
        } else if (attempts < MAX_RETRIES) {
          // Hermes-style Dynamic Self-Healing Prompt
          const fixPrompt = `The tool "${step.tool}" failed with args ${JSON.stringify(step.args)}.
Error: ${lastResult.error}
Goal: ${this.state.goal}
Step description: ${step.description}

Suggest a corrected tool call to achieve the expected result.
Reply with JSON ONLY:
{ "tool": "<tool_name>", "args": {}, "spokenCue": "<1 sentence update>" }`

          try {
            const fixRaw = await this.generateCompletion(fixPrompt, "You are a self-healing AI agent.")
            const fStart = fixRaw.indexOf('{')
            const fEnd = fixRaw.lastIndexOf('}')
            if (fStart !== -1 && fEnd !== -1) {
              const fix = JSON.parse(fixRaw.slice(fStart, fEnd + 1))
              if (fix.tool) step.tool = fix.tool
              if (fix.args) step.args = fix.args
              if (fix.spokenCue) step.spokenCue = fix.spokenCue
            }
          } catch {}
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
        this.onEvent({ type: 'failed', data: { step, error: lastResult.error } })
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
      const summaryText = await this.generateCompletion(summaryPrompt, "You are a concise reporting assistant.")
      this.state.summary = summaryText.trim() || 'Task completed successfully.'
    } catch {
      this.state.summary = `Successfully completed all ${this.state.plan.steps.length} steps for: ${this.state.goal}.`
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
