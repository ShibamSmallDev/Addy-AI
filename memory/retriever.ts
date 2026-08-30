import {
  searchMemories,
  getMemoriesByCategory,
  getAllMemories,
  storeMemory,
  getProjectMemories,
  getPinnedMemories,
  cosineSimilarity,
  type MemoryRecord,
  type MemoryCategory,
} from './store'

const LAYER_PRIORITY: Record<string, number> = {
  semantic: 4,
  procedural: 3,
  episodic: 2,
  working: 1,
}

function memoryLayer(category: string): string {
  if (['active_task', 'debug_session'].includes(category)) return 'working'
  if (['session', 'conversation', 'important_event'].includes(category)) return 'episodic'
  if (['preference', 'identity', 'relationship', 'goal', 'decision'].includes(category)) return 'semantic'
  if (['behavior', 'project_note', 'milestone', 'bug_report', 'project'].includes(category)) return 'procedural'
  return 'episodic'
}

function layerRank(category: string): number {
  return LAYER_PRIORITY[memoryLayer(category)] || 0
}

export interface ProjectContext {
  projectPath: string
  activeTasks: MemoryRecord[]
  recentDebugSessions: MemoryRecord[]
  recentDecisions: MemoryRecord[]
  recentCommits: MemoryRecord[]
  projectGoals: MemoryRecord[]
  importantNotes: MemoryRecord[]
  milestones: MemoryRecord[]
  pinned: MemoryRecord[]
}

export function getProjectContext(projectPath: string): ProjectContext {
  return {
    projectPath,
    activeTasks: getMemoriesByCategory('active_task', projectPath),
    recentDebugSessions: getMemoriesByCategory('debug_session', projectPath).slice(0, 5),
    recentDecisions: getMemoriesByCategory('decision', projectPath).slice(0, 5),
    recentCommits: getMemoriesByCategory('milestone', projectPath).slice(0, 10),
    projectGoals: getMemoriesByCategory('goal', projectPath).slice(0, 3),
    importantNotes: getMemoriesByCategory('project_note', projectPath).slice(0, 5),
    milestones: getMemoriesByCategory('milestone', projectPath).slice(0, 5),
    pinned: getPinnedMemories(projectPath),
  }
}

export function formatProjectContextSummary(projectPath: string): string {
  const ctx = getProjectContext(projectPath)
  const lines: string[] = ['Project: ' + (projectPath.split(/[\\/]/).pop() || projectPath)]

  if (ctx.activeTasks.length > 0) {
    lines.push('')
    lines.push('Active Tasks:')
    for (const t of ctx.activeTasks) {
      lines.push('  - ' + t.value)
    }
  }

  if (ctx.recentDecisions.length > 0) {
    lines.push('')
    lines.push('Recent Decisions:')
    for (const d of ctx.recentDecisions) {
      lines.push('  - ' + d.value)
    }
  }

  if (ctx.recentDebugSessions.length > 0) {
    lines.push('')
    lines.push('Recent Debug Sessions:')
    for (const d of ctx.recentDebugSessions) {
      lines.push('  - ' + d.value)
    }
  }

  if (ctx.milestones.length > 0) {
    lines.push('')
    lines.push('Milestones:')
    for (const m of ctx.milestones) {
      lines.push('  - ' + m.value)
    }
  }

  if (ctx.pinned.length > 0) {
    lines.push('')
    lines.push('Pinned:')
    for (const p of ctx.pinned) {
      lines.push('  - ' + p.value)
    }
  }

  return lines.join('\n')
}

export async function getRelevantProjectMemories(context: string, projectPath: string, maxChars = 4000): Promise<string> {
  const searchResults = await searchMemories(context, projectPath)
  const pinned = getPinnedMemories(projectPath)
  const recent = getProjectMemories(projectPath, 30)

  const all = [...pinned, ...searchResults, ...recent]
  const seen = new Set<string>()
  const now = Date.now()
  const DAY_MS = 86400000

  const scoredMemories = all
    .filter((m) => {
      if (seen.has(m.id)) return false
      seen.add(m.id)
      return true
    })
    .map((m) => {
      const daysOld = Math.max(0, (now - m.timestamp) / DAY_MS)
      const recencyDecay = Math.exp(-daysOld / 14) // 14-day half-life decay
      const importanceScore = (m.importance ?? 0.5) * 0.4
      const pinnedBonus = m.pinned ? 2.0 : 0.0
      const layerBonus = (layerRank(m.category) / 4) * 0.3
      const totalScore = pinnedBonus + importanceScore + recencyDecay + layerBonus
      return { memory: m, score: totalScore }
    })
    .sort((a, b) => b.score - a.score)
    .map(sm => sm.memory)

  if (scoredMemories.length === 0) return ''

  // Hierarchical grouping
  const identityList: string[] = []
  const activeTaskList: string[] = []
  const relevantList: string[] = []

  for (const m of scoredMemories) {
    const layer = memoryLayer(m.category)
    const tag = m.pinned ? '📌 ' : ''
    const itemStr = `  ${tag}[${layer}/${m.category}] ${m.value}`

    if (m.category === 'identity' || m.category === 'preference') {
      identityList.push(itemStr)
    } else if (m.category === 'active_task' || m.category === 'debug_session') {
      activeTaskList.push(itemStr)
    } else {
      relevantList.push(itemStr)
    }
  }

  const outputSections: string[] = []
  if (identityList.length > 0) {
    outputSections.push('Core Identity & User Preferences:\n' + identityList.slice(0, 5).join('\n'))
  }
  if (activeTaskList.length > 0) {
    outputSections.push('Active Tasks & Debug Context:\n' + activeTaskList.slice(0, 5).join('\n'))
  }
  if (relevantList.length > 0) {
    outputSections.push('Relevant Project Memories:\n' + relevantList.slice(0, 10).join('\n'))
  }

  let finalOutput = outputSections.join('\n\n')
  if (finalOutput.length > maxChars) {
    finalOutput = finalOutput.slice(0, maxChars) + '\n  ... [memories truncated to fit budget]'
  }

  return finalOutput
}

export function autoCreateMemoryForAction(
  actionType: string,
  details: { tool?: string; command?: string; filePath?: string; result?: string; error?: string },
  projectPath?: string
): void {
  const ts = new Date()
  const timeStr = ts.toLocaleTimeString()
  const dateStr = ts.toLocaleDateString()

  switch (actionType) {
    case 'tool_execution':
      if (details.tool) {
        storeMemory(
          'tool_' + details.tool + '_' + dateStr,
          'Used tool "' + details.tool + '" at ' + timeStr + (details.result ? ': ' + details.result.slice(0, 100) : ''),
          'project_note',
          projectPath
        )
      }
      break
    case 'agent_task':
      storeMemory(
        'agent_task_' + Date.now(),
        'Agent task completed at ' + timeStr + ': ' + (details.result?.slice(0, 200) || 'See conversation'),
        'active_task',
        projectPath
      )
      break
    case 'file_modification':
      if (details.filePath) {
        const fileName = details.filePath.split(/[\\/]/).pop() || details.filePath
        storeMemory(
          'file_modified_' + fileName + '_' + dateStr,
          'Modified ' + fileName + ' at ' + timeStr,
          'project_note',
          projectPath
        )
      }
      break
    case 'debug_session':
      storeMemory(
        'debug_' + Date.now(),
        'Debug session at ' + timeStr + ': ' + (details.result?.slice(0, 200) || details.error?.slice(0, 200) || 'Investigation in progress'),
        'debug_session',
        projectPath
      )
      break
    case 'git_commit':
      storeMemory(
        'commit_' + Date.now(),
        'Git commit at ' + timeStr + ': ' + (details.result?.slice(0, 200) || details.command || 'Commit created'),
        'milestone',
        projectPath
      )
      break
    case 'decision':
      storeMemory(
        'decision_' + Date.now(),
        'Decision: ' + (details.result?.slice(0, 200) || details.command || 'See conversation'),
        'decision',
        projectPath
      )
      break
    case 'bug_report':
      storeMemory(
        'bug_' + Date.now(),
        'Bug: ' + (details.result?.slice(0, 200) || details.error?.slice(0, 200) || 'See conversation'),
        'bug_report',
        projectPath
      )
      break
  }
}

export {
  storeMemory,
  supersedMemory,
  getMemoriesByCategory,
  searchMemories,
  getAllMemories,
  deleteMemory,
  clearMemoriesByCategory,
  getMemoryCount,
  getProjectMemories,
  getPinnedMemories,
  pinMemory,
  unpinMemory,
  getUniqueProjectPaths,
  cosineSimilarity,
} from './store'
export type { MemoryCategory, MemoryRecord } from './store'
