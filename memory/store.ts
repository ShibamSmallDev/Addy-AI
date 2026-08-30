import { query, run, saveDatabase } from '../database'
import { v4 as uuid } from 'uuid'
import { computeEmbedding, embedBuffer, bufferToEmbed } from './embeddings'

export type MemoryCategory =
  | 'preference'
  | 'project'
  | 'goal'
  | 'important_event'
  | 'conversation'
  | 'reminder'
  | 'general'
  | 'active_task'
  | 'debug_session'
  | 'decision'
  | 'project_note'
  | 'milestone'
  | 'bug_report'
  | 'session'
  | 'identity'
  | 'relationship'
  | 'emotional'
  | 'behavior'

export interface MemoryRecord {
  id: string
  key: string
  value: string
  category: MemoryCategory
  timestamp: number
  project_path: string
  pinned: number
  embedding?: Buffer | null
  source: string
  status: string
  importance: number
  confidence: number
  last_verified_at?: number
  superseded_by?: string
}

export function storeMemory(
  key: string,
  value: string,
  category: MemoryCategory = 'general',
  projectPath?: string,
  options?: {
    source?: string
    importance?: number
    confidence?: number
  }
): string {
  const id = uuid()
  const ts = Date.now()
  const source = options?.source ?? 'agent_inference'
  const importance = options?.importance ?? 0.5
  const confidence = options?.confidence ?? 0.8

  run(
    `INSERT INTO memories (id, key, value, category, timestamp, project_path, source, status, importance, confidence)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
    [id, key.toLowerCase(), value, category, ts, projectPath || '', source, importance, confidence]
  )
  saveDatabase()
  computeEmbedding(value).then(vec => {
    if (vec.length > 0) {
      run('UPDATE memories SET embedding = ? WHERE id = ?', [embedBuffer(vec), id])
      saveDatabase()

      // Automatic semantic deduplication & conflict resolution
      try {
        const activeCategoryMemories = getMemoriesByCategory(category, projectPath, false)
        for (const existing of activeCategoryMemories) {
          if (existing.id !== id && existing.embedding) {
            const oldVec = bufferToEmbed(existing.embedding)
            const sim = cosineSimilarity(vec, oldVec)
            if (sim >= 0.85) {
              supersedMemory(existing.id, id)
              console.log(`[Memory] Auto-superseded duplicate/conflicting memory (${existing.id}) with new memory (${id}) [Sim: ${sim.toFixed(2)}]`)
            }
          }
        }
      } catch (e) {
        // Non-fatal deduplication error
      }
    }
  })
  return id
}

export function supersedMemory(oldId: string, newId: string): void {
  run(
    `UPDATE memories SET status = 'superseded', superseded_by = ? WHERE id = ?`,
    [newId, oldId]
  )
  saveDatabase()
}

export function getMemoriesByCategory(
  category: MemoryCategory,
  projectPath?: string,
  includeSuperseded = false
): MemoryRecord[] {
  const statusFilter = includeSuperseded ? '' : "AND status = 'active'"
  if (projectPath) {
    return query(
      `SELECT * FROM memories WHERE category = ? AND project_path = ? ${statusFilter} ORDER BY timestamp DESC LIMIT 50`,
      [category, projectPath]
    ) as MemoryRecord[]
  }
  return query(
    `SELECT * FROM memories WHERE category = ? ${statusFilter} ORDER BY timestamp DESC LIMIT 50`,
    [category]
  ) as MemoryRecord[]
}

export async function searchMemories(searchQuery: string, projectPath?: string): Promise<MemoryRecord[]> {
  const queryVec = await computeEmbedding(searchQuery)

  if (queryVec.length > 0) {
    const all = projectPath
      ? query("SELECT * FROM memories WHERE project_path = ? AND status = 'active' ORDER BY timestamp DESC LIMIT 200", [projectPath]) as MemoryRecord[]
      : query("SELECT * FROM memories WHERE status = 'active' ORDER BY timestamp DESC LIMIT 200") as MemoryRecord[]

    const scored = all
      .filter(m => m.embedding)
      .map(m => ({
        memory: m,
        score: cosineSimilarity(queryVec, bufferToEmbed(m.embedding!)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
      .map(e => e.memory)

    if (scored.length >= 5) return scored
  }

  const fallback = projectPath
    ? query(
        `SELECT * FROM memories
         WHERE (key LIKE ? OR value LIKE ?) AND project_path = ? AND status = 'active'
         ORDER BY timestamp DESC LIMIT 20`,
        [`%${searchQuery}%`, `%${searchQuery}%`, projectPath]
      ) as MemoryRecord[]
    : query(
        `SELECT * FROM memories
         WHERE (key LIKE ? OR value LIKE ?) AND status = 'active'
         ORDER BY timestamp DESC LIMIT 20`,
        [`%${searchQuery}%`, `%${searchQuery}%`]
      ) as MemoryRecord[]

  return fallback
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function getProjectMemories(projectPath: string, limit = 100): MemoryRecord[] {
  return query(
    'SELECT * FROM memories WHERE project_path = ? ORDER BY pinned DESC, timestamp DESC LIMIT ?',
    [projectPath, limit]
  ) as MemoryRecord[]
}

export function getPinnedMemories(projectPath?: string): MemoryRecord[] {
  if (projectPath) {
    return query(
      'SELECT * FROM memories WHERE pinned = 1 AND project_path = ? ORDER BY timestamp DESC',
      [projectPath]
    ) as MemoryRecord[]
  }
  return query(
    'SELECT * FROM memories WHERE pinned = 1 ORDER BY timestamp DESC'
  ) as MemoryRecord[]
}

export function pinMemory(id: string): void {
  run('UPDATE memories SET pinned = 1 WHERE id = ?', [id])
  saveDatabase()
}

export function unpinMemory(id: string): void {
  run('UPDATE memories SET pinned = 0 WHERE id = ?', [id])
  saveDatabase()
}

export function getAllMemories(includeSuperseded = false, limit = 1000): MemoryRecord[] {
  const filter = includeSuperseded ? '' : "WHERE status = 'active'"
  return query(
    `SELECT * FROM memories ${filter} ORDER BY pinned DESC, timestamp DESC LIMIT ?`,
    [limit]
  ) as MemoryRecord[]
}

export function deleteMemory(id: string): void {
  run('DELETE FROM memories WHERE id = ?', [id])
  saveDatabase()
}

export function clearMemoriesByCategory(category: MemoryCategory): void {
  run('DELETE FROM memories WHERE category = ?', [category])
  saveDatabase()
}

export function getMemoryCount(): number {
  const result = query('SELECT COUNT(*) as count FROM memories')
  return (result[0] as any)?.count || 0
}

export function getUniqueProjectPaths(): string[] {
  const results = query('SELECT DISTINCT project_path FROM memories WHERE project_path != \'\' ORDER BY project_path')
  return results.map((r: any) => r.project_path)
}
