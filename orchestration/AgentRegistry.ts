import { execSync } from 'child_process'

export interface AvailableAgent {
  id: string
  name: string
  command: string
  available: boolean
  version: string | null
}

const KNOWN_AGENTS: Array<{ id: string; name: string; command: string; versionFlag: string }> = [
  { id: 'opencode', name: 'OpenCode', command: 'opencode', versionFlag: '--version' },
  { id: 'claude-code', name: 'Claude Code', command: 'claude', versionFlag: '--version' },
]

export function detectAvailableAgents(): AvailableAgent[] {
  return KNOWN_AGENTS.map(agent => {
    try {
      const output = execSync(agent.command + ' ' + agent.versionFlag, {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true
      })
      return { id: agent.id, name: agent.name, command: agent.command, available: true, version: output.trim() }
    } catch {
      return { id: agent.id, name: agent.name, command: agent.command, available: false, version: null }
    }
  })
}
