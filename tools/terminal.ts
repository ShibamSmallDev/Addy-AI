import { spawn, type ChildProcess } from 'child_process'

const activeProcesses = new Map<string, ChildProcess>()
const COMMAND_TIMEOUT = 30_000

const SAFE_COMMANDS = [
  /^npm\s+(run|install|test|build|start|ls|list)\b/,
  /^git\s+(status|diff|log|add|commit|push|pull|clone|checkout|branch|merge|stash)\b/,
  /^node\s+/,
  /^npx\s+/,
  /^tsc\b/,
  /^echo\s+/,
  /^ls\b/,
  /^dir\b/,
  /^pwd\b/,
  /^cat\s+/,
  /^type\s+/,
  /^mkdir\s+/,
  /^cd\s+/,
  /^pip\s+/,
  /^python\s+/,
]

const BLOCKED_COMMANDS = [
  /rm\s+-rf/i,
  /del\s+\/[sf]/i,
  /format\s+/i,
  /mkfs\b/i,
  /dd\s+if=/i,
  /shutdown/i,
  /reboot/i,
  /:(){ :|:& };:/,
]

interface CommandResult {
  allowed: boolean
  blocked: boolean
  requiresApproval: boolean
}

function classifyCommand(command: string): CommandResult {
  const trimmed = command.trim()

  for (const pattern of BLOCKED_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { allowed: false, blocked: true, requiresApproval: false }
    }
  }

  for (const pattern of SAFE_COMMANDS) {
    if (pattern.test(trimmed)) {
      return { allowed: true, blocked: false, requiresApproval: false }
    }
  }

  return { allowed: false, blocked: false, requiresApproval: true }
}

export interface TerminalOutput {
  type: 'stdout' | 'stderr'
  data: string
}

export interface TerminalExit {
  exitCode: number | null
  signal: string | null
  error?: string
}

export async function executeCommand(
  command: string,
  cwd?: string,
): Promise<{ output: TerminalOutput[]; exit: TerminalExit }> {
  const trimmed = command.trim()
  if (!trimmed) {
    return { output: [], exit: { exitCode: null, signal: null, error: 'No command provided' } }
  }

  const classification = classifyCommand(trimmed)
  if (classification.blocked) {
    return { output: [], exit: { exitCode: null, signal: null, error: 'Command blocked: not permitted' } }
  }

  return new Promise((resolve) => {
    const output: TerminalOutput[] = []
    const socketId = 'exec_' + Date.now()

    killProcess(socketId)

    const parts = command.split(/\s+/)
    const cmd = parts[0]!
    const args = parts.slice(1)

    let proc: ChildProcess
    try {
      proc = spawn(cmd, args, { cwd, windowsHide: true, env: { ...process.env } })
    } catch (err: any) {
      resolve({ output, exit: { exitCode: null, signal: null, error: err.message } })
      return
    }

    activeProcesses.set(socketId, proc)

    const timeout = setTimeout(() => {
      try { proc.kill('SIGTERM') } catch {}
      output.push({ type: 'stderr', data: '\n[Addy] Command timed out after ' + (COMMAND_TIMEOUT / 1000) + 's\n' })
    }, COMMAND_TIMEOUT)

    proc.stdout?.on('data', (data: Buffer) => {
      output.push({ type: 'stdout', data: data.toString() })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      output.push({ type: 'stderr', data: data.toString() })
    })

    proc.on('error', (err) => {
      clearTimeout(timeout)
      activeProcesses.delete(socketId)
      resolve({ output, exit: { exitCode: null, signal: null, error: err.message } })
    })

    proc.on('close', (exitCode, signal) => {
      clearTimeout(timeout)
      activeProcesses.delete(socketId)
      resolve({ output, exit: { exitCode, signal } })
    })
  })
}

export function killProcess(socketId: string): boolean {
  const proc = activeProcesses.get(socketId)
  if (!proc || proc.killed) return false
  try { proc.kill('SIGTERM') } catch {}
  activeProcesses.delete(socketId)
  return true
}

export function isRunning(socketId: string): boolean {
  const proc = activeProcesses.get(socketId)
  return !!proc && !proc.killed
}

export function classifyAndCheck(command: string): { safe: boolean; blocked: boolean; requiresApproval: boolean } {
  const result = classifyCommand(command)
  return { safe: result.allowed, blocked: result.blocked, requiresApproval: result.requiresApproval }
}
