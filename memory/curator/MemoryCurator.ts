import { getAllMemories, getProjectMemories, storeMemory, deleteMemory, getMemoryCount, getUniqueProjectPaths } from '../store'
import type { MemoryRecord, MemoryCategory } from '../store'
import { generateContentWithFallback } from '../../providers/GeminiProvider'

export interface CurationReport {
  ranAt: number
  totalMemoriesBefore: number
  totalMemoriesAfter: number
  consolidated: number
  deleted: number
  errors: string[]
}

const CURATION_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastCurationTime = 0
let curationTimer: ReturnType<typeof setInterval> | null = null

export function startCurationScheduler(): void {
  if (curationTimer) return
  curationTimer = setInterval(() => {
    runCuration().catch(e => console.error('[Curator] Scheduled curation failed:', e))
  }, CURATION_INTERVAL_MS)
  console.log('[Curator] Scheduler started (every ' + (CURATION_INTERVAL_MS / 60000) + ' min)')
}

export function stopCurationScheduler(): void {
  if (curationTimer) {
    clearInterval(curationTimer)
    curationTimer = null
  }
}

export async function runCuration(): Promise<CurationReport> {
  const report: CurationReport = {
    ranAt: Date.now(),
    totalMemoriesBefore: 0,
    totalMemoriesAfter: 0,
    consolidated: 0,
    deleted: 0,
    errors: [],
  }

  try {
    report.totalMemoriesBefore = getMemoryCount()
    const projectPaths = getUniqueProjectPaths()

    for (const projectPath of projectPaths) {
      await curateProjectMemories(projectPath, report)
    }

    const globalMemories = getAllMemories().filter(m => !m.project_path && m.status !== 'superseded')
    if (globalMemories.length > 20) {
      await consolidateMemories(globalMemories, 'general', null, report)
    }

    // Decay & Garbage Collection: archive low-importance working memories older than 30 days
    await runMemoryDecay(report)

    // Automatically purge empty/abandoned 0-message sessions across disk & database
    try {
      const { deleteEmptySessions } = await import('../../server_phasex')
      deleteEmptySessions(60000)
    } catch {}

    report.totalMemoriesAfter = getMemoryCount()
  } catch (e: any) {
    report.errors.push(e.message)
  }

  lastCurationTime = report.ranAt
  return report
}

async function runMemoryDecay(report: CurationReport): Promise<void> {
  try {
    const { run } = await import('../../database')
    const THIRTY_DAYS_AGO = Date.now() - 30 * 86400000
    // Archive unpinned memories older than 30 days with low importance (<0.3)
    run(
      `UPDATE memories SET status = 'archived' WHERE pinned = 0 AND status = 'active' AND timestamp < ? AND (importance < 0.3 OR category IN ('active_task', 'debug_session'))`,
      [THIRTY_DAYS_AGO]
    )
  } catch (e: any) {
    report.errors.push('Decay cleanup error: ' + e.message)
  }
}

async function curateProjectMemories(projectPath: string, report: CurationReport): Promise<void> {
  const memories = getProjectMemories(projectPath, 200)
  const byCategory = new Map<MemoryCategory, MemoryRecord[]>()
  for (const m of memories) {
    if (m.pinned) continue
    if (m.status === 'superseded') continue
    const list = byCategory.get(m.category) || []
    list.push(m)
    byCategory.set(m.category, list)
  }

  for (const [category, group] of byCategory) {
    if (group.length > 10) {
      await consolidateMemories(group, category, projectPath, report)
    }
  }
}

async function consolidateMemories(
  memories: MemoryRecord[],
  category: MemoryCategory,
  projectPath: string | null,
  report: CurationReport
): Promise<void> {
  const groups = new Map<string, MemoryRecord[]>()
  for (const m of memories) {
    const prefix = m.key.slice(0, 40).toLowerCase()
    const list = groups.get(prefix) || []
    list.push(m)
    groups.set(prefix, list)
  }

  for (const [, group] of groups) {
    if (group.length <= 3) continue
    group.sort((a, b) => b.timestamp - a.timestamp)
    const survivor = group[0]
    const duplicates = group.slice(1)

    if (group.length > 5) {
      try {
        const consolidated = await llmConsolidate(group, category)
        if (consolidated && consolidated !== survivor.value) {
          storeMemory(survivor.key, consolidated, category, projectPath || undefined)
          report.consolidated++
        }
      } catch {}
    }

    for (const dup of duplicates) {
      deleteMemory(dup.id)
      report.deleted++
    }
  }
}

async function llmConsolidate(
  group: MemoryRecord[],
  category: MemoryCategory
): Promise<string | null> {
  const items = group.map(m =>
    '- [' + new Date(m.timestamp).toLocaleDateString() + '] ' + m.key + ': ' + m.value
  ).join('\n')

  const prompt = 'Consolidate these ' + category + ' memories into a single concise summary. Preserve important details and dates. Omit redundancies.\n\n' + items + '\n\nSummary:'

  try {
    const { providerManager } = await import('../../providers/ProviderManager')
    const response = await providerManager.generateResilientCompletion(prompt, 'You are a memory consolidation engine.')
    return response.trim() || null
  } catch {
    return null
  }
}

export function getCurationStatus(): { lastRun: number; interval: number } {
  return { lastRun: lastCurationTime, interval: CURATION_INTERVAL_MS }
}
