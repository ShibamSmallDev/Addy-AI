import initSqlJs from 'sql.js'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'fs'
import { SCHEMA } from './schema'

let db: any = null
let dbPath: string = ''

export type Conversation = {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
}

export type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
  pinned?: boolean
  preferredProvider?: string
  executionProvider?: string
  model?: string
  modelSource?: string
}

export async function initDatabase(dataDir?: string): Promise<void> {
  const SQL = await initSqlJs()
  const dir = dataDir || join(process.cwd(), 'data')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  dbPath = join(dir, 'addy-ai.db')
  const bakPath = dbPath + '.bak'

  if (!existsSync(dbPath) && existsSync(bakPath)) {
    console.log('[Database] Primary DB missing, restoring from backup')
    copyFileSync(bakPath, dbPath)
  }

  if (existsSync(dbPath)) {
    let buffer = readFileSync(dbPath)
    if (!isValidSqlite(buffer) && existsSync(bakPath) && isValidSqlite(readFileSync(bakPath))) {
      console.log('[Database] Primary DB corrupted, restoring from backup')
      copyFileSync(bakPath, dbPath)
      buffer = readFileSync(dbPath)
    }
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run('PRAGMA foreign_keys = ON')
  exec(SCHEMA)
  try { db.run('ALTER TABLE memories ADD COLUMN project_path TEXT DEFAULT \'\'') } catch {}
  try { db.run('ALTER TABLE memories ADD COLUMN pinned INTEGER DEFAULT 0') } catch {}
  try { db.run('CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project_path)') } catch {}
  try { db.run('ALTER TABLE messages ADD COLUMN preferredProvider TEXT') } catch {}
  try { db.run('ALTER TABLE messages ADD COLUMN executionProvider TEXT') } catch {}
  try { db.run('ALTER TABLE messages ADD COLUMN model TEXT') } catch {}
  try { db.run('ALTER TABLE messages ADD COLUMN modelSource TEXT') } catch {}
  try { db.run('ALTER TABLE messages ADD COLUMN pinned INTEGER DEFAULT 0') } catch {}
  try { db.run('ALTER TABLE memories ADD COLUMN embedding BLOB DEFAULT NULL') } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN source TEXT DEFAULT 'agent_inference'") } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN status TEXT DEFAULT 'active'") } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN importance REAL DEFAULT 0.5") } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN confidence REAL DEFAULT 0.8") } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN last_verified_at INTEGER DEFAULT NULL") } catch {}
  try { db.run("ALTER TABLE memories ADD COLUMN superseded_by TEXT DEFAULT NULL") } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status)") } catch {}
  try { db.run("CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category)") } catch {}

  saveDb()

  // Periodic flush safety net
  setInterval(() => {
    try { flushDatabase(); } catch {}
  }, 30_000);

  // Clean shutdown handlers to ensure dirty writes are flushed before process exit
  const onExit = () => {
    try { flushDatabase(); } catch {}
  }
  process.on('beforeExit', onExit)
  process.on('SIGINT', onExit)
  process.on('SIGTERM', onExit)
}

function exec(sql: string) {
  getDb().exec(sql)
}

export function run(sql: string, params?: any[]) {
  getDb().run(sql, params)
}

function getDb(): any {
  if (!db) throw new Error('Database not initialized. Call initDatabase() first.')
  return db
}

let saveTimeout: NodeJS.Timeout | null = null

export function saveDatabase(force = false) {
  if (force) {
    flushDatabase()
    return
  }
  if (!saveTimeout) {
    saveTimeout = setTimeout(() => {
      saveTimeout = null
      flushDatabase()
    }, 1_000)
  }
}

export function flushDatabase() {
  if (saveTimeout) {
    clearTimeout(saveTimeout)
    saveTimeout = null
  }
  if (db) {
    try {
      const data = Buffer.from(db.export())
      const tmpPath = dbPath + '.tmp'
      writeFileSync(tmpPath, data)
      if (existsSync(dbPath)) {
        try { renameSync(dbPath, dbPath + '.bak') } catch {}
      }
      renameSync(tmpPath, dbPath)
    } catch (e) {
      console.error('[Database] flushDatabase failed:', e)
    }
  }
}

function isValidSqlite(buffer: Buffer): boolean {
  return buffer.length >= 16 && buffer.slice(0, 16).toString('latin1') === 'SQLite format 3\u0000'
}

function saveDb() {
  saveDatabase(false)
}

export function query(sql: string, params?: any[]): any[] {
  const d = getDb()
  const stmt = d.prepare(sql)
  if (params) stmt.bind(params)
  const results: any[] = []
  while (stmt.step()) {
    results.push(stmt.getAsObject())
  }
  stmt.free()
  return results
}

function queryOne(sql: string, params?: any[]): any | null {
  const results = query(sql, params)
  return results.length > 0 ? results[0] : null
}

export function saveConversation(id: string, messages: Message[]) {
  const now = Date.now()
  const d = getDb()

  try {
    d.run('BEGIN TRANSACTION')
    const existing = queryOne('SELECT id FROM conversations WHERE id = ?', [id])
    if (!existing) {
      run(
        'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
        [id, messages[0]?.content?.slice(0, 60) || 'Conversation', now, now]
      )
    } else {
      run('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, id])
    }

    run('DELETE FROM messages WHERE conversation_id = ?', [id])
    for (const msg of messages) {
      // Dialogue roles are 'user' | 'Addy'; persist Addy as assistant (schema CHECK)
      const role = msg.role === 'user' ? 'user' : 'assistant'
      run(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp, preferredProvider, executionProvider, model, modelSource, pinned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [msg.id, id, role, msg.content, msg.timestamp, msg.preferredProvider || null, msg.executionProvider || null, msg.model || null, msg.modelSource || null, msg.pinned ? 1 : 0]
      )
    }

    d.run('COMMIT')
    saveDb()
  } catch (e) {
    d.run('ROLLBACK')
    console.log(`[Database] saveConversation failed: ${e}`)
    throw e
  }
}

export function getConversation(id: string): Conversation | null {
  const conv = queryOne('SELECT * FROM conversations WHERE id = ?', [id])
  if (!conv) return null

  const messages = query(
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
    [id]
  )

  return {
    id: conv.id,
    title: conv.title,
    messages: messages.map((m: any) => ({
      id: m.id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      timestamp: m.timestamp,
      pinned: m.pinned === 1,
    })),
    createdAt: conv.created_at,
    updatedAt: conv.updated_at
  }
}

export function getAllConversations(): Array<{ id: string; title: string; updatedAt: number; providerInfo?: string }> {
  try {
    return query(
      `SELECT c.id, c.title, c.updated_at AS updatedAt,
         (SELECT json_object('preferredProvider', m.preferredProvider, 'executionProvider', m.executionProvider, 'model', m.model, 'modelSource', m.modelSource)
          FROM messages m
          WHERE m.conversation_id = c.id AND m.role = 'assistant' AND m.preferredProvider IS NOT NULL
          ORDER BY m.timestamp DESC LIMIT 1) AS providerInfo
        FROM conversations c ORDER BY c.updated_at DESC`
    )
  } catch {
    return query(
      'SELECT id, title, updated_at AS updatedAt FROM conversations ORDER BY updatedAt DESC'
    )
  }
}

export function updateConversationTitle(id: string, title: string) {
  run('UPDATE conversations SET title = ? WHERE id = ?', [title, id])
  saveDb()
}

export function deleteConversation(id: string) {
  run('DELETE FROM messages WHERE conversation_id = ?', [id])
  run('DELETE FROM conversations WHERE id = ?', [id])
  saveDb()
}

export function getSetting(key: string): string | null {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key])
  return row?.value || null
}

export function setSetting(key: string, value: string) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
  saveDb()
}
