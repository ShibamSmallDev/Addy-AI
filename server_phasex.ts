/**
 * Phase X — Persistent Conversation & Session Memory Subsystem.
 *
 * Provides:
 *   - Session management (auto-create, list, resume, search, navigate)
 *   - Crash-safe message logging (append-only log + SQLite)
 *   - Tool call memory
 *   - Memory layers (STM ↔ Session ↔ LTM)
 *   - Immediate recall context builder
 *
 * File structure under DATA_DIR:
 *   memory/
 *     sessions/
 *       YYYY-MM-DD/
 *         session-{id}.json      # Full session snapshot (for backup / portability)
 *         session-{id}.log       # Append-only message log (crash-safe)
 *     summaries/
 *       session-{id}.json        # Auto-generated session summary
 *     long_term/
 *       preferences.json
 *       projects.json
 *       decisions.json
 *       frequently_used.json
 */

import * as fs from "fs";
import * as path from "path";
import { run, query, saveDatabase } from "./database";
import { MEMORY_ROOT } from "./server_paths";

function queryOne(sql: string, params?: any[]): any | null {
  const results = query(sql, params);
  return results.length > 0 ? results[0] : null;
}
import { DATA_DIR } from "./server_paths";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PhaseXSession {
  id: string;
  title: string;
  startTime: number;
  endTime: number | null;
  workspace: string | null;
  activeProject: string | null;
  mode: "voice" | "text" | "mixed";
  messageCount: number;
  toolCallCount: number;
  summary: string | null;
  metadata: Record<string, unknown>;
}

export interface PhaseXMessage {
  id: string;
  sessionId: string;
  timestamp: number;
  role: "user" | "Addy";
  text: string;
  toolCalls: PhaseXToolCall[];
  errors: string[];
  importantDecisions: string[];
  metadata: Record<string, unknown>;
}

export interface PhaseXToolCall {
  id: string;
  sessionId: string;
  messageId: string | null;
  toolName: string;
  parameters: Record<string, unknown>;
  result: unknown;
  executionTimeMs: number;
  success: boolean;
  timestamp: number;
}

export interface RecallContext {
  session: {
    lastSessionSummary: string | null;
    lastSessionId: string | null;
    lastSessionTime: number | null;
  };
  longTerm: {
    preferences: Record<string, string>;
    projects: string[];
    decisions: string[];
    frequentlyReferenced: string[];
  };
  activeProject: string | null;
  workspace: string | null;
  unfinishedTasks: string[];
  recentConversation: { role: string; text: string }[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// ───────────────────────────────────────────────────────────────────────────
// SESSIONS_DIR holds one folder per day (YYYY-MM-DD), each containing every
// session's .json (metadata), .log (raw timestamped log), .summary.md, and
// .transcript.md files. Actively read/written by createSession / closeSession
// / logMessage and the recall system.
//
// `memory/long_term/` is deprecated scaffolding from an earlier design — the real
// persistent memory store is the SQL `memories` table. LTM files are still
// populated via the /api/phasex/ltm/:category endpoints and read by
// buildRecallContext(), but are not written by the memory consolidation pipeline.
// ───────────────────────────────────────────────────────────────────────────

const MEMORY_DIR = path.join(MEMORY_ROOT, "memory");
const SESSIONS_DIR = path.join(MEMORY_DIR, "sessions");
const LONG_TERM_DIR = path.join(MEMORY_DIR, "long_term");
const LTM_FILES = ["preferences", "projects", "decisions", "frequently_used"] as const;

// ---------------------------------------------------------------------------
// Init — create directories & SQLite tables
// ---------------------------------------------------------------------------

export function initPhaseX(): void {
  for (const dir of [MEMORY_DIR, SESSIONS_DIR, LONG_TERM_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }

  run(`
    CREATE TABLE IF NOT EXISTS phasex_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Session',
      start_time INTEGER NOT NULL,
      end_time INTEGER,
      workspace TEXT,
      active_project TEXT,
      mode TEXT NOT NULL DEFAULT 'mixed',
      message_count INTEGER NOT NULL DEFAULT 0,
      tool_call_count INTEGER NOT NULL DEFAULT 0,
      summary TEXT,
      metadata TEXT DEFAULT '{}'
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS phasex_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'Addy')),
      text TEXT NOT NULL DEFAULT '',
      errors TEXT DEFAULT '[]',
      important_decisions TEXT DEFAULT '[]',
      metadata TEXT DEFAULT '{}',
      FOREIGN KEY (session_id) REFERENCES phasex_sessions(id) ON DELETE CASCADE
    )
  `);

  run(`
    CREATE TABLE IF NOT EXISTS phasex_tool_calls (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      message_id TEXT,
      tool_name TEXT NOT NULL,
      parameters TEXT DEFAULT '{}',
      result TEXT,
      execution_time_ms INTEGER NOT NULL DEFAULT 0,
      success INTEGER NOT NULL DEFAULT 1,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES phasex_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES phasex_messages(id) ON DELETE SET NULL
    )
  `);

  run(`
    CREATE INDEX IF NOT EXISTS idx_phasex_messages_session ON phasex_messages(session_id)
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_phasex_tool_calls_session ON phasex_tool_calls(session_id)
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_phasex_tool_calls_name ON phasex_tool_calls(tool_name)
  `);
  run(`
    CREATE INDEX IF NOT EXISTS idx_phasex_sessions_start ON phasex_sessions(start_time)
  `);

  saveDatabase();

  initLtmFiles();
}

function initLtmFiles(): void {
  for (const name of LTM_FILES) {
    const filePath = path.join(LONG_TERM_DIR, `${name}.json`);
    if (!fs.existsSync(filePath)) {
      const initial = name === "preferences" ? {} : [];
      fs.writeFileSync(filePath, JSON.stringify(initial, null, 2), "utf-8");
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** In-memory map of session ID → session's date folder on disk.
 *
 * Populated at createSession() so all subsequent file writes (session snapshot,
 * log, summary, transcript) land in the same day-folder regardless of what
 * clock-time it is when closeSession() or incremental refreshes run.
 */
const _sessionDateDirs = new Map<string, string>();

export function getSessionDateDir(id: string): string {
  return _sessionDateDirs.get(id) || todayDir();
}

function todayDateStr(ts?: number): string {
  const d = ts ? new Date(ts) : new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayDir(): string {
  const dir = path.join(SESSIONS_DIR, todayDateStr());
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function sessionFilePath(id: string): { json: string; log: string } {
  const dir = _sessionDateDirs.get(id) || todayDir();
  return {
    json: path.join(dir, `session-${id}.json`),
    log: path.join(dir, `session-${id}.log`),
  };
}

export function summaryFilePath(id: string): string {
  const dir = _sessionDateDirs.get(id) || todayDir();
  return path.join(dir, `session-${id}.summary.md`);
}

function transcriptFilePath(id: string): string {
  const dir = _sessionDateDirs.get(id) || todayDir();
  return path.join(dir, `session-${id}.transcript.md`);
}

function generateId(): string {
  return `ses_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

function isoNow(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// Session CRUD
// ---------------------------------------------------------------------------

export function createSession(opts?: {
  workspace?: string;
  activeProject?: string;
  mode?: "voice" | "text" | "mixed";
}): PhaseXSession {
  const id = generateId();
  const now = Date.now();

  // Register the date folder so all files for this session land in the same day-dir
  const dateStr = todayDateStr(now);
  const dateDir = path.join(SESSIONS_DIR, dateStr);
  fs.mkdirSync(dateDir, { recursive: true });
  _sessionDateDirs.set(id, dateDir);

  const session: PhaseXSession = {
    id,
    title: "New Session",
    startTime: now,
    endTime: null,
    workspace: opts?.workspace || null,
    activeProject: opts?.activeProject || null,
    mode: opts?.mode || "mixed",
    messageCount: 0,
    toolCallCount: 0,
    summary: null,
    metadata: {},
  };

  run(
    `INSERT INTO phasex_sessions (id, title, start_time, end_time, workspace, active_project, mode, message_count, tool_call_count, summary, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [session.id, session.title, session.startTime, session.endTime, session.workspace, session.activeProject, session.mode, session.messageCount, session.toolCallCount, session.summary, JSON.stringify(session.metadata)]
  );

  // Note: Initial files are lazily created upon first message/tool to prevent empty file clutter
  saveDatabase();
  return session;

  saveDatabase();
  return session;
}

export function getOrCreateActiveSession(opts?: {
  workspace?: string;
  activeProject?: string;
  mode?: "voice" | "text" | "mixed";
  maxIdleMinutes?: number;
}): PhaseXSession {
  const maxIdleMs = (opts?.maxIdleMinutes || 30) * 60 * 1000;
  const now = Date.now();

  const recent = queryOne(
    `SELECT id FROM phasex_sessions 
     WHERE (end_time IS NULL OR end_time > ?) 
     ORDER BY start_time DESC LIMIT 1`,
    [now - maxIdleMs]
  );

  if (recent) {
    const session = getSession(recent.id);
    if (session) {
      run("UPDATE phasex_sessions SET end_time = NULL WHERE id = ?", [session.id]);
      _currentSessionId = session.id;
      return session;
    }
  }

  return createSession(opts);
}

export function getSession(id: string): PhaseXSession | null {
  const row = queryOne("SELECT * FROM phasex_sessions WHERE id = ?", [id]);
  if (!row) return null;
  return mapRowToSession(row);
}

export function listSessions(limit = 50, offset = 0): PhaseXSession[] {
  const rows = query(
    "SELECT * FROM phasex_sessions ORDER BY start_time DESC LIMIT ? OFFSET ?",
    [limit, offset]
  );
  return rows.map(mapRowToSession);
}

export function searchSessions(query_text: string): PhaseXSession[] {
  const rows = query(
    `SELECT DISTINCT s.* FROM phasex_sessions s
     LEFT JOIN phasex_messages m ON m.session_id = s.id
     WHERE s.title LIKE ? OR s.summary LIKE ? OR m.text LIKE ? OR s.active_project LIKE ?
     ORDER BY s.start_time DESC LIMIT 50`,
    [`%${query_text}%`, `%${query_text}%`, `%${query_text}%`, `%${query_text}%`]
  );
  return rows.map(mapRowToSession);
}

export function closeSession(id: string, summary?: string): void {
  const existing = getSession(id);
  if (!existing || (existing.messageCount === 0 && existing.toolCallCount === 0)) {
    deleteSession(id);
    return;
  }
  // Persist any short-term scratchpad entries as project_note memories
  // so important in-session context isn't silently dropped.
  try {
    const stmData = shortTermStore.get(id);
    if (stmData && Object.keys(stmData).length > 0) {
      const { storeMemory } = require('./memory/store');
      const session = queryOne('SELECT active_project FROM phasex_sessions WHERE id = ?', [id]);
      const projectPath = session?.active_project || '';
      for (const [stmKey, stmVal] of Object.entries(stmData)) {
        // Only persist entries that look like meaningful facts, not internal flags
        if (typeof stmVal === 'string' && stmVal.length > 10 && !stmKey.startsWith('_')) {
          storeMemory(
            `stm_${stmKey}_${Date.now()}`,
            `[Session context] ${stmKey}: ${stmVal}`,
            'active_task',
            projectPath,
            { source: 'agent_inference', importance: 0.3 }
          );
        }
      }
      shortTermStore.delete(id);
      console.log(`[PhaseX] Persisted ${Object.keys(stmData).length} STM entries for session ${id}`);
    }
  } catch (e: any) {
    console.warn('[PhaseX] STM persistence failed:', e.message);
  }

  const now = Date.now();
  run("UPDATE phasex_sessions SET end_time = ?, summary = ? WHERE id = ?", [now, summary || null, id]);

  // Write summary file (plain prose, not JSON)
  if (summary) {
    const sfp = summaryFilePath(id);
    const header = `# Session Summary — ${new Date(now).toLocaleString()}\n\n`;
    fs.writeFileSync(sfp, header + summary + "\n", "utf-8");
  }

  // Write / refresh the full transcript document
  writeTranscriptDoc(id);

  // Update filesystem snapshot
  const session = getSession(id);
  if (session) {
    const files = sessionFilePath(id);
    fs.writeFileSync(files.json, JSON.stringify(session, null, 2), "utf-8");
    fs.appendFileSync(files.log, `---\n# Ended: ${isoNow()}\n`, "utf-8");
  }

  _sessionDateDirs.delete(id);
  saveDatabase();
}

// ---------------------------------------------------------------------------
// Transcript document
// ---------------------------------------------------------------------------

/** Generate or refresh the human-readable transcript document (.transcript.md). */
export function writeTranscriptDoc(sessionId: string): void {
  const session = getSession(sessionId);
  if (!session || (session.messageCount === 0 && session.toolCallCount === 0)) return;
  const messages = getSessionMessages(sessionId, 1000);
  if (messages.length === 0) return;

  const lines: string[] = [
    `# Session Transcript — ${session.title}`,
    `Started: ${new Date(session.startTime).toLocaleString()}`,
    session.endTime
      ? `Ended: ${new Date(session.endTime).toLocaleString()}`
      : "Status: in progress",
    "",
  ];
  for (const m of messages) {
    const time = new Date(m.timestamp).toLocaleTimeString();
    const who = m.role === "user" ? "You" : "Addy";
    // Escape potential markdown formatting in message text
    const safeText = m.text.replace(/[\\`*_{}[\]()#+\-.!]/g, (c) => `\\${c}`);
    lines.push(`**[${time}] ${who}:** ${safeText}`);
  }

  const tfp = transcriptFilePath(sessionId);
  fs.writeFileSync(tfp, lines.join("\n\n"), "utf-8");
}

// ---------------------------------------------------------------------------
// Orphan reaper
// ---------------------------------------------------------------------------

/** Close any sessions left open by a crash / force-quit.
 *
 * Must be called once during server startup, after initPhaseX().
 * For each orphan the most-recent message timestamp is used as end_time,
 * preserving whatever incremental summary is already on disk from
 * turnComplete refreshes.
 */
export function reapOrphanedSessions(): void {
  const orphans = query("SELECT id, start_time FROM phasex_sessions WHERE end_time IS NULL");
  for (const row of orphans) {
    const messages = getSessionMessages(row.id, 1000);
    const lastMsgTime =
      messages.length > 0 ? messages[messages.length - 1].timestamp : Date.now();

    // Re-register the date folder so subsequent writes land in the right place
    const dateStr = todayDateStr(row.start_time);
    const dateDir = path.join(SESSIONS_DIR, dateStr);
    if (fs.existsSync(dateDir)) {
      _sessionDateDirs.set(row.id, dateDir);
    }

    run("UPDATE phasex_sessions SET end_time = ? WHERE id = ?", [lastMsgTime, row.id]);
    // Refresh transcript with the end_time set
    writeTranscriptDoc(row.id);
    console.log(`[PhaseX] Reaped orphan session ${row.id}`);
  }
  deleteEmptySessions(0);
  if (orphans.length > 0) saveDatabase();
}

/** Delete sessions that never accumulated any context (0 messages).
 *
 * Prevents "New Session" rows left behind by a New Chat click, a failed send,
 * or an auto-connected voice socket from cluttering the history. minAgeMs
 * protects a session created moments ago that is about to receive its first
 * message.
 */
export function deleteEmptySessions(minAgeMs = 60000): number {
  const cutoff = Date.now() - minAgeMs;
  const rows = query(
    "SELECT id FROM phasex_sessions WHERE message_count = 0 AND tool_call_count = 0 AND start_time < ?",
    [cutoff]
  );
  let deleted = 0;
  for (const row of rows) {
    deleteSession(row.id);
    deleted++;
  }

  // Also sweep physical session files on disk for 0-message orphans
  try {
    if (fs.existsSync(SESSIONS_DIR)) {
      const dateDirs = fs.readdirSync(SESSIONS_DIR);
      for (const d of dateDirs) {
        const fullDateDir = path.join(SESSIONS_DIR, d);
        if (!fs.statSync(fullDateDir).isDirectory()) continue;
        const files = fs.readdirSync(fullDateDir);
        for (const file of files) {
          if (file.endsWith(".json") && file.startsWith("session-")) {
            const jsonPath = path.join(fullDateDir, file);
            try {
              const content = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
              const msgCount = content.messageCount ?? content.messages?.length ?? 0;
              const toolCount = content.toolCallCount ?? 0;
              const startTime = content.startTime ?? 0;
              if (msgCount === 0 && toolCount === 0 && startTime < cutoff) {
                fs.unlinkSync(jsonPath);
                const baseName = file.replace(/\.json$/, "");
                const logPath = path.join(fullDateDir, `${baseName}.log`);
                const mdPath = path.join(fullDateDir, `${baseName}.transcript.md`);
                const sPath = path.join(fullDateDir, `${baseName}.summary.md`);
                if (fs.existsSync(logPath)) fs.unlinkSync(logPath);
                if (fs.existsSync(mdPath)) fs.unlinkSync(mdPath);
                if (fs.existsSync(sPath)) fs.unlinkSync(sPath);
                deleted++;
              }
            } catch {}
          }
        }
        try {
          if (fs.readdirSync(fullDateDir).length === 0) {
            fs.rmdirSync(fullDateDir);
          }
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn("[PhaseX] Disk sweep error in deleteEmptySessions:", err.message);
  }

  return deleted;
}

function mapRowToSession(row: any): PhaseXSession {
  return {
    id: row.id,
    title: row.title,
    startTime: row.start_time,
    endTime: row.end_time || null,
    workspace: row.workspace || null,
    activeProject: row.active_project || null,
    mode: row.mode,
    messageCount: row.message_count || 0,
    toolCallCount: row.tool_call_count || 0,
    summary: row.summary || null,
    metadata: safeJson(row.metadata, {}),
  };
}

// ---------------------------------------------------------------------------
// Message Logging (crash-safe)
// ---------------------------------------------------------------------------

let _currentSessionId: string | null = null;

export function getCurrentSessionId(): string | null {
  return _currentSessionId;
}

export function setCurrentSessionId(id: string | null): void {
  _currentSessionId = id;
}

export function logMessage(
  sessionId: string,
  role: "user" | "Addy",
  text: string,
  extra?: {
    toolCalls?: PhaseXToolCall[];
    errors?: string[];
    importantDecisions?: string[];
    metadata?: Record<string, unknown>;
  }
): PhaseXMessage {
  const id = `msg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = Date.now();
  const toolCalls = extra?.toolCalls || [];
  const errors = extra?.errors || [];
  const importantDecisions = extra?.importantDecisions || [];

  const msg: PhaseXMessage = {
    id,
    sessionId,
    timestamp: now,
    role,
    text,
    toolCalls,
    errors,
    importantDecisions,
    metadata: extra?.metadata || {},
  };

  // Write to SQLite immediately
  run(
    `INSERT INTO phasex_messages (id, session_id, timestamp, role, text, errors, important_decisions, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [msg.id, msg.sessionId, msg.timestamp, msg.role, msg.text, JSON.stringify(errors), JSON.stringify(importantDecisions), JSON.stringify(msg.metadata)]
  );

  // Append to crash-safe log file
  const files = sessionFilePath(sessionId);
  const logEntry = [
    `[${isoNow()}] ${role.toUpperCase()}: ${text.replace(/\n/g, "\\n")}`,
    ...errors.map((e) => `  ERROR: ${e.replace(/\n/g, "\\n")}`),
    ...importantDecisions.map((d) => `  DECISION: ${d.replace(/\n/g, "\\n")}`),
    ...toolCalls.map((tc) => `  TOOL: ${tc.toolName} (${tc.success ? "OK" : "FAIL"}) ${tc.executionTimeMs}ms`),
    "",
  ].join("\n");

  try {
    fs.appendFileSync(files.log, logEntry, "utf-8");
  } catch {
    // best-effort: crash-safe via SQLite
  }

  // Update message count
  run("UPDATE phasex_sessions SET message_count = message_count + 1 WHERE id = ?", [sessionId]);
  saveDatabase();

  return msg;
}

export function getSessionMessages(sessionId: string, limit = 200, offset = 0): PhaseXMessage[] {
  const rows = query(
    "SELECT * FROM phasex_messages WHERE session_id = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?",
    [sessionId, limit, offset]
  );
  return rows.map(mapRowToMessage);
}

export function getRecentSessionMessages(sessionId: string, limit = 10): PhaseXMessage[] {
  const rows = query(
    "SELECT * FROM phasex_messages WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?",
    [sessionId, limit]
  );
  return rows.map(mapRowToMessage).reverse();
}

function mapRowToMessage(row: any): PhaseXMessage {
  return {
    id: row.id,
    sessionId: row.session_id,
    timestamp: row.timestamp,
    role: row.role,
    text: row.text,
    toolCalls: [], // loaded separately
    errors: safeJson(row.errors, []),
    importantDecisions: safeJson(row.important_decisions, []),
    metadata: safeJson(row.metadata, {}),
  };
}

function safeJson(str: string | undefined, fallback: any): any {
  if (!str) return fallback;
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Tool Call Memory
// ---------------------------------------------------------------------------

export function logToolCall(
  sessionId: string,
  toolName: string,
  parameters: Record<string, unknown>,
  result: unknown,
  executionTimeMs: number,
  success: boolean,
  messageId?: string
): PhaseXToolCall {
  const id = `tc_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = Date.now();

  const tc: PhaseXToolCall = {
    id,
    sessionId,
    messageId: messageId || null,
    toolName,
    parameters,
    result,
    executionTimeMs,
    success,
    timestamp: now,
  };

  run(
    `INSERT INTO phasex_tool_calls (id, session_id, message_id, tool_name, parameters, result, execution_time_ms, success, timestamp)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tc.id, tc.sessionId, tc.messageId || null, tc.toolName, JSON.stringify(parameters), JSON.stringify(result), executionTimeMs, success ? 1 : 0, now]
  );

  run("UPDATE phasex_sessions SET tool_call_count = tool_call_count + 1 WHERE id = ?", [sessionId]);
  saveDatabase();

  return tc;
}

export function getToolCalls(sessionId: string, toolName?: string): PhaseXToolCall[] {
  if (toolName) {
    return query(
      "SELECT * FROM phasex_tool_calls WHERE session_id = ? AND tool_name = ? ORDER BY timestamp DESC",
      [sessionId, toolName]
    ).map(mapRowToToolCall);
  }
  return query(
    "SELECT * FROM phasex_tool_calls WHERE session_id = ? ORDER BY timestamp DESC",
    [sessionId]
  ).map(mapRowToToolCall);
}

export function searchToolCalls(toolName: string, limit = 20): { sessionId: string; toolName: string; success: boolean; timestamp: number }[] {
  return query(
    "SELECT session_id, tool_name, success, timestamp FROM phasex_tool_calls WHERE tool_name = ? ORDER BY timestamp DESC LIMIT ?",
    [toolName, limit]
  );
}

function mapRowToToolCall(row: any): PhaseXToolCall {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id || null,
    toolName: row.tool_name,
    parameters: safeJson(row.parameters, {}),
    result: safeJson(row.result, null),
    executionTimeMs: row.execution_time_ms,
    success: row.success === 1,
    timestamp: row.timestamp,
  };
}

// ---------------------------------------------------------------------------
// Memory Layers
// ---------------------------------------------------------------------------

// --- Short-Term Memory (in-memory, per-session) ---

const shortTermStore = new Map<string, Record<string, unknown>>();

export function setShortTerm(sessionId: string, key: string, value: unknown): void {
  if (!shortTermStore.has(sessionId)) {
    shortTermStore.set(sessionId, {});
  }
  shortTermStore.get(sessionId)![key] = value;
}

export function getShortTerm(sessionId: string, key: string): unknown | undefined {
  return shortTermStore.get(sessionId)?.[key];
}

export function clearShortTerm(sessionId: string): void {
  shortTermStore.delete(sessionId);
}

// --- Long-Term Memory (filesystem) ---

type LtmCategory = typeof LTM_FILES[number];

export function getLongTerm(category: LtmCategory): any {
  const filePath = path.join(LONG_TERM_DIR, `${category}.json`);
  try {
    const data = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(data);
  } catch {
    return category === "preferences" ? {} : [];
  }
}

export function setLongTerm(category: LtmCategory, value: any): void {
  const filePath = path.join(LONG_TERM_DIR, `${category}.json`);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export function addLongTermEntry(category: Exclude<LtmCategory, "preferences">, entry: string): void {
  const data = getLongTerm(category);
  if (Array.isArray(data)) {
    if (!data.includes(entry)) {
      data.push(entry);
      setLongTerm(category, data);
    }
  }
}

// ---------------------------------------------------------------------------
// Immediate Recall
// ---------------------------------------------------------------------------

export function buildRecallContext(currentSessionId: string | null): RecallContext {
  // Get last completed session (ignore placeholder summaries written when
  // summary generation failed; a placeholder must never surface as recall)
  const lastSession = queryOne(
    "SELECT id, summary, end_time FROM phasex_sessions WHERE end_time IS NOT NULL ORDER BY end_time DESC LIMIT 1"
  );
  const lastSessionSummary =
    lastSession?.summary && !/^summary unavailable\.?$/i.test(lastSession.summary.trim())
      ? lastSession.summary
      : null;

  // Get current active session for workspace/project
  const currentSession = currentSessionId ? getSession(currentSessionId) : null;

  const preferences = getLongTerm("preferences") as Record<string, string>;
  const projects = getLongTerm("projects") as string[];
  const decisions = getLongTerm("decisions") as string[];
  const frequentlyReferenced = getLongTerm("frequently_used") as string[];

  // Get recent conversation context (last 10 messages from current or last session)
  let recentConversation: { role: string; text: string }[] = [];
  if (currentSessionId) {
    const recent = getRecentSessionMessages(currentSessionId, 10);
    recentConversation = recent.map((m) => ({ role: m.role, text: m.text }));
  } else if (lastSession) {
    const recent = getRecentSessionMessages(lastSession.id, 10);
    recentConversation = recent.map((m) => ({ role: m.role, text: m.text }));
  }

  return {
    session: {
      lastSessionSummary,
      lastSessionId: lastSessionSummary ? lastSession?.id || null : null,
      lastSessionTime: lastSessionSummary ? lastSession?.end_time || null : null,
    },
    longTerm: {
      preferences,
      projects,
      decisions,
      frequentlyReferenced,
    },
    activeProject: currentSession?.activeProject || null,
    workspace: currentSession?.workspace || null,
    unfinishedTasks: [], // populated by memory curator / future system
    recentConversation,
  };
}

export function formatRecallPrompt(context: RecallContext): string {
  const parts: string[] = [];

  if (context.recentConversation && context.recentConversation.length > 0) {
    const conv = context.recentConversation
      .map((m) => `  ${m.role === "Addy" || m.role === "model" ? "Addy" : "User"}: ${m.text}`)
      .join("\n");
    parts.push(
      `=== RECENT CONVERSATION (ACTIVE DIALOGUE CONTEXT) ===\n` +
      `The user was actively talking with you moments ago before temporarily stopping. Here is the recent exchange:\n` +
      `${conv}\n` +
      `CRITICAL INSTRUCTION: Seamlessly resume and continue from this dialogue context. Do NOT act like you just met or ask generic opening greetings!`
    );
  }

  if (context.session.lastSessionSummary) {
    parts.push(`=== PREVIOUS SESSION SUMMARY ===\n${context.session.lastSessionSummary}`);
  }

  if (context.session.lastSessionId) {
    parts.push(`[Previous session: ${context.session.lastSessionId}]`);
  }

  if (Object.keys(context.longTerm.preferences).length > 0) {
    const prefs = Object.entries(context.longTerm.preferences)
      .map(([k, v]) => `  ${k}: ${v}`)
      .join("\n");
    parts.push(`=== USER PREFERENCES ===\n${prefs}`);
  }

  if (context.longTerm.projects.length > 0) {
    parts.push(`=== ACTIVE PROJECTS ===\n${context.longTerm.projects.map((p) => `  - ${p}`).join("\n")}`);
  }

  if (context.longTerm.decisions.length > 0) {
    parts.push(`=== PREVIOUS DECISIONS ===\n${context.longTerm.decisions.map((d) => `  - ${d}`).join("\n")}`);
  }

  if (context.activeProject) {
    parts.push(`[Active project: ${context.activeProject}]`);
  }

  if (context.workspace) {
    parts.push(`[Workspace: ${context.workspace}]`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Multi-session query
// ---------------------------------------------------------------------------

export function getSessionsByDateRange(startDate: number, endDate: number): PhaseXSession[] {
  const rows = query(
    "SELECT * FROM phasex_sessions WHERE start_time >= ? AND start_time <= ? ORDER BY start_time DESC",
    [startDate, endDate]
  );
  return rows.map(mapRowToSession);
}

export function getSessionsByProject(project: string): PhaseXSession[] {
  const rows = query(
    "SELECT * FROM phasex_sessions WHERE active_project = ? ORDER BY start_time DESC",
    [project]
  );
  return rows.map(mapRowToSession);
}

export function deleteSession(id: string): void {
  run("DELETE FROM phasex_messages WHERE session_id = ?", [id]);
  run("DELETE FROM phasex_tool_calls WHERE session_id = ?", [id]);
  run("DELETE FROM phasex_sessions WHERE id = ?", [id]);
  saveDatabase();

  _sessionDateDirs.delete(id);

  // Remove filesystem files (best-effort)
  try {
    const files = sessionFilePath(id);
    if (fs.existsSync(files.json)) fs.unlinkSync(files.json);
    if (fs.existsSync(files.log)) fs.unlinkSync(files.log);
    const sfp = summaryFilePath(id);
    if (fs.existsSync(sfp)) fs.unlinkSync(sfp);
    const tfp = transcriptFilePath(id);
    if (fs.existsSync(tfp)) fs.unlinkSync(tfp);
  } catch {
    // best-effort
  }
}

// ---------------------------------------------------------------------------
// Session title auto-generation helper (called after a few messages)
// ---------------------------------------------------------------------------

export function autoGenerateTitle(sessionId: string, firstMessages: PhaseXMessage[]): string {
  const firstUserMsg = firstMessages.find((m) => m.role === "user");
  if (!firstUserMsg) return "New Session";

  // Extract first meaningful phrase (up to 60 chars)
  const text = firstUserMsg.text.replace(/[^\w\s]/g, "").trim();
  const title = text.length > 60 ? text.substring(0, 57) + "..." : text;
  if (!title) return "New Session";

  run("UPDATE phasex_sessions SET title = ? WHERE id = ?", [title, sessionId]);
  saveDatabase();
  return title;
}
