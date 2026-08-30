# Addy AI Memory System & Bug Report

> Generated from codebase analysis — covers architecture, storage, categorization, recall, summaries, and all known bugs/inconsistencies.

---

## Table of Contents

1. [Memory System Architecture](#1-memory-system-architecture)
2. [Storage: What & Where](#2-storage-what--where)
3. [Categorization: How Types Are Determined](#3-categorization-how-types-are-determined)
4. [Recall System: How Memories Surface at Session Start](#4-recall-system-how-memories-surface-at-session-start)
5. [Session Summary System](#5-session-summary-system)
6. [Text Chat Session Management](#6-text-chat-session-management)
7. [Bug Report](#7-bug-report)
8. [Inconsistencies & Code Smells](#8-inconsistencies--code-smells)
9. [Recommended Fixes](#9-recommended-fixes)
10. [Key File Index](#10-key-file-index)

---

## 1. Memory System Architecture

### Three Memory Layers

| Layer | Storage | Scope | Lifespan |
|-------|---------|-------|----------|
| **Short-Term Memory (STM)** | In-memory `Map<string, Record<string, unknown>>` (`server_phasex.ts:615`) | Per-session scratchpad | Session lifetime |
| **Long-Term Memory (LTM)** | JSON files on disk (`memory/long_term/*.json`) | Preferences, projects, decisions, frequently-referenced items | Forever |
| **Persistent Memory Core** | SQLite `memories` table + `memories.json` fallback | All durable facts about the user | Forever (curated/summarized) |

### Five Pathways for Creating Memories

#### Path A — Voice Session Consolidation (Primary)
1. During voice session, each utterance appended to `dialogueHistory[]` (`server.ts:1773-1778`), capped at 30 exchanges
2. On `turnComplete` from Gemini (`server.ts:2428`), `processConversationSlice(apiKey, dialogueHistory)` is called **fire-and-forget** (`server.ts:2440`)
3. `processConversationSlice` (`server_memory.ts:118-317`) sends the dialogue slice + all current memories to Gemini with a structured schema
4. Gemini returns `MemoryTransaction[]` (ADD / UPDATE / REMOVE) + optional `sessionSummary`
5. Transactions are applied and persisted via `saveMemories()`
6. `memory_sync` WebSocket message pushes new list to frontend (`server.ts:2443`)

#### Path B — Text Chat Consolidation
1. After every `/api/chat/text` response, fire-and-forget `setTimeout` calls `processConversationSlice` with last user+assistant exchange (`server.ts:1296-1308`)
2. Same pipeline as voice mode

#### Path C — `saveCustomMemory` Gemini Function Call (Voice & Text)
1. Gemini calls `saveCustomMemory(category, text)` when it decides something is important
2. Server writes to SQL `memories` table via `storeMemory()` (`server.ts:2495-2500`)
3. Sends `memory_sync` WebSocket to frontend

#### Path D — Manual Entry via UI (MemoryDashboard)
1. User opens MemoryDashboard → clicks "MANUAL SEED" → picks category → writes statement
2. `handleAddManualMemory` (`src/App.tsx:353-367`) → `POST /api/memories`
3. Server creates `Memory` object, persists via `saveMemories()` (dual-write to SQL + JSON)

#### Path E — Automatic Action-Based (`memory/retriever.ts:109-181`)
- `tool_execution` → `project_note`
- `agent_task` → `active_task`
- `file_modification` → `project_note`
- `debug_session` → `debug_session`
- `git_commit` → `milestone`
- `decision` → `decision`
- `bug_report` → `bug_report`

---

## 2. Storage: What & Where

### SQLite Database (`addy-ai.db`)

#### `memories` table (`database/schema.ts:18-26`)
```sql
CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  timestamp INTEGER NOT NULL,
  project_path TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0
);
```

#### Other SQLite tables

| Table | Purpose |
|-------|---------|
| `phasex_sessions` | Session metadata (id, title, start/end time, summary, mode, message/tool count) |
| `phasex_messages` | Session messages (id, session_id, timestamp, role, text, errors, important_decisions, metadata) |
| `phasex_tool_calls` | Tool execution history for audit/debug |
| `settings` | Key-value settings |
| `provider_keys` | Encrypted API keys |
| `conversations` | Legacy conversation storage |
| `messages` | Legacy message storage |

### JSON Fallback Files

| File | Content |
|------|---------|
| `memories.json` | `[{id, category, text, createdAt, updatedAt}]` — dual-written for backward compat |
| `memory/long_term/preferences.json` | Key-value pairs (starts as `{}`) |
| `memory/long_term/projects.json` | Array of project strings (starts as `[]`) |
| `memory/long_term/decisions.json` | Array of decision strings (starts as `[]`) |
| `memory/long_term/frequently_used.json` | Array of frequently referenced items (starts as `[]`) |

### Session Files (`memory/sessions/YYYY-MM-DD/`)

| File | Format | Content |
|------|--------|---------|
| `session-{id}.json` | JSON | Session metadata snapshot |
| `session-{id}.log` | Text | Append-only crash-safe log (`[HH:MM:SS] ROLE: message`) |
| `session-{id}.summary.md` | Markdown | `# Session Summary — {date}\n\n{paragraph}` |
| `session-{id}.transcript.md` | Markdown | Full formatted transcript with timestamps |

### Knowledge Base (`knowledge_base/memory/`)
Static markdown files loaded as system prompt context:
- `people/*.md` — person profiles
- `projects/*.md` — project descriptions
- `events/timeline.md` — event timeline
- `events/self_context_exports.md` — context exports
- `events/flagged_items.md` — flagged items
- `places/*.md` — place descriptions

Loaded by `loadKnowledgeBaseContext()` (`server.ts:949-993`).

---

## 3. Categorization: How Types Are Determined

### TWO Parallel Category Systems — A Critical Inconsistency

#### System A — Server Storage (`memory/store.ts:4-17`)
13 categories optimized for project/development context:
```
preference | project | goal | important_event | conversation | reminder
| general | active_task | debug_session | decision | project_note
| milestone | bug_report
```

#### System B — Frontend UI & Gemini Schema (`src/lib/memoryTypes.ts:3`)
8 categories optimized for personal companionship context:
```
identity | preference | goal | project | relationship | emotional
| behavior | session
```

### Bridging Between Systems

**When saving from System B → System A** (`saveMemories` at `server_memory.ts:42-44`):
```typescript
const validCats = ["preference", "project", "goal", "important_event", "conversation",
                   "reminder", "general", "active_task", "debug_session", "decision",
                   "project_note", "milestone", "bug_report"];
const sqlCat = validCats.includes(m.category) ? m.category : "general";
```
System B categories **NOT in validCats** (fall to `"general"`):
- `identity` → `general`
- `relationship` → `general`
- `emotional` → `general`
- `behavior` → `general`
- `session` → `general`

**When loading System A → System B** (`loadMemories` at `server_memory.ts:12-19`):
```typescript
category: (["identity", "preference", "goal", "project", "relationship",
            "emotional", "behavior", "session"].includes(r.category)
  ? r.category : "general") as Memory["category"],
```
System A categories **not in System B list** (fall to `"general"`):
- `important_event` → `general`
- `conversation` → `general`
- `reminder` → `general`
- `active_task` → `general`
- `debug_session` → `general`
- `decision` → `general`
- `project_note` → `general`
- `milestone` → `general`
- `bug_report` → `general`

### How Gemini Determines Categories

In `processConversationSlice` (`server_memory.ts:171`), Gemini receives System B enum:
```
enum: ["identity", "preference", "goal", "project", "relationship",
       "emotional", "behavior", "session"]
```

Category meanings:
- **identity** — name, nick, profession, background
- **preference** — likes, dislikes, games, movies
- **goal** — active goals & aspirations
- **project** — ongoing projects & ecosystems
- **relationship** — key people & relationships
- **emotional** — emotional highlights & milestones
- **behavior** — observed traits & behavioral tendencies
- **session** — previous session summary

### Memory Curator Categorization (`memory/curator/MemoryCurator.ts`)

- Groups memories by **System A** category for consolidation
- Categories with >10 entries get consolidated via Gemini summarization
- Scheduled every 6 hours via `startCurationScheduler()` (line 17)

---

## 4. Recall System: How Memories Surface at Session Start

### Complete Prompt Layering

At session start, the system prompt is built in this order:

```
[1] Base Personality       — getBaseSystemPrompt()     (server.ts:996-1046)
[2] Custom Prompt          — custom_prompt.txt          (server.ts:999)
[3] Knowledge Base         — knowledge_base/ markdown   (server.ts:1000)
[4] Addy PERSISTENT MEMORY CORE — formatSystemInstructionsWithMemories()
    ├── Previous Session Summary (session category)
    ├── Identity (identity)
    ├── Preferences (preference)
    ├── Goals (goal)
    ├── Projects (project)
    ├── Relationships (relationship)
    ├── Emotional Milestones (emotional)
    └── Behaviors (behavior)
[5] RECALL CONTEXT         — formatRecallPrompt()       (server.ts:1741)
    ├── PREVIOUS SESSION SUMMARY
    ├── USER PREFERENCES
    ├── ACTIVE PROJECTS
    ├── PREVIOUS DECISIONS
    ├── FREQUENTLY REFERENCED
    ├── Active Project
    └── Workspace
[6] Contextual Memories    — text chat only, per-query  (server.ts:1154-1156)
```

### `buildRecallContext()` (`server_phasex.ts:665-706`)

```typescript
interface RecallContext {
  session: {
    lastSessionSummary: string | null;   // From phasex_sessions (last CLOSED session)
    lastSessionId: string | null;
    lastSessionTime: number | null;
  };
  longTerm: {
    preferences: Record<string, string>;  // From LTM JSON files
    projects: string[];
    decisions: string[];
    frequentlyReferenced: string[];
  };
  activeProject: string | null;
  workspace: string | null;
  unfinishedTasks: string[];               // Always [] — not populated
  recentConversation: { role: string; text: string }[];  // Last 5 messages
}
```

### `formatRecallPrompt()` (`server_phasex.ts:708-743`)

Generates:
```
=== PREVIOUS SESSION SUMMARY ===
{paragraph}
[Previous session: {id}]

=== USER PREFERENCES ===
{key}: {value}

=== ACTIVE PROJECTS ===
  - {project}

=== PREVIOUS DECISIONS ===
  - {decision}

=== FREQUENTLY REFERENCED ===
  - {item}

[Active project: {project}]
[Workspace: {workspace}]
```

### Two "Previous Session" Sources

| Source | Used By | Content |
|--------|---------|---------|
| `phasex_sessions.summary` | `buildRecallContext` | Auto-generated summary from `closeSession` or `generateSessionSummary` |
| "session" category memories | `formatSystemInstructionsWithMemories` | Summary stored as a memory via `refreshSessionDocuments` |

**These can drift out of sync** — if `closeSession` is called without `refreshSessionDocuments`, or if a session crashes before closing.

---

## 5. Session Summary System

### Two Creation Paths

#### Path 1 — Incremental (Mid-Session): `refreshSessionDocuments` (`server_session_summary.ts:63-108`)

**Triggered**: Every `turnComplete` during voice sessions (`server.ts:2453-2455`), fire-and-forget.

**Pipeline**:
1. `generateSessionSummary()` sends ALL session messages (up to 1000) to Gemini 2.5 Flash with prompt:
   > "Summarize this conversation session in 3-6 sentences: what was discussed, what was accomplished or decided, and anything left unfinished or that should be picked up next time. Write it as a natural paragraph, third person, no headers."
2. Gemini returns a paragraph (3-6 sentences)
3. Writes/overwrites `.summary.md` file
4. Updates SQL `phasex_sessions.summary` column
5. Refreshes `.transcript.md` document
6. Stores summary as a memory via `storeMemory()` with `category: "conversation"` — capped to 500 chars
7. Sends `summary_refresh` WebSocket message to frontend

#### Path 2 — Finalization (Session Close): `closeSession` (`server_phasex.ts:326-350`)

**Triggered**: Voice `onclose` fires (`server.ts:2601`) or `POST /api/phasex/sessions/:id/close`.

**Pipeline**:
1. Updates SQL `end_time` and `summary`
2. If summary provided, writes `.summary.md`
3. Calls `writeTranscriptDoc()` for final `.transcript.md`
4. Updates JSON snapshot + appends end marker to `.log`
5. Cleans up `_sessionDateDirs` map

### Where Session Files Live

```
memory/sessions/2026-07-22/
  session-ses_1712345678901_abc123.json
  session-ses_1712345678901_abc123.log
  session-ses_1712345678901_abc123.summary.md
  session-ses_1712345678901_abc123.transcript.md
```

### Orphan Reaper (`reapOrphanedSessions()`, `server_phasex.ts:386-410`)

On server startup, closes any sessions with `end_time IS NULL`:
```sql
UPDATE phasex_sessions SET end_time = start_time WHERE end_time IS NULL
```
Calls `writeTranscriptDoc()` for each orphan. Does NOT generate a summary for orphans — they keep whatever the last incremental summary was.

---

## 6. Text Chat Session Management

### Session ID Persistence

- `activeSessionId` stored in `localStorage` under `adj_active_text_session_id`
- Restored on mount (`src/App.tsx:556-558`)
- Synced to localStorage on every change (`src/App.tsx:560-565`)
- Server stores session in SQLite with `mode: "text"`

### Session Flow

```
Page Load
  ├── activeSessionId loaded from localStorage
  ├── useEffect([]) → loadSessionMessages(activeSessionId)
  └── User opens chat panel → refreshSessions() → fetches session list

User Sends Message
  ├── POST /api/chat/text with { messages, sessionId: activeSessionId }
  ├── Server checks getSession(clientSessionId)
  │   ├── Exists → uses it
  │   └── Not found → runs getCurrentSessionId() || createSession()
  ├── Response has X-Session-Id header
  └── Frontend updates activeSessionId from header

New Session Button (handleNewSession)
  ├── setChatMessages([])
  ├── POST /api/phasex/sessions { mode: "text" }
  └── setActiveSessionId(session.id)
```

### Voice vs Text Session Inconsistency

| | Voice | Text Chat |
|---|---|---|
| **New session on connect?** | Yes — `createSession({mode:"voice"})` at line 1735 | No — resumes from localStorage |
| **Session ID storage** | Not persisted | `localStorage.setItem("adj_active_text_session_id", ...)` |
| **User experience** | Fresh session every voice connect | Continuity across page refreshes |

---

## 7. Bug Report

### 🔴 CRITICAL

#### BUG-1: MemoryDashboard Crashes on Unknown Categories (MemoryDashboard.tsx:312-314)

**Root Cause**: Server stores memories with System A categories (13 types). Frontend's `categoryConfig` has only System B categories (8 types). When a memory with category `"general"`, `"conversation"`, `"important_event"`, etc. is returned from the API, `categoryConfig[m.category]` is `undefined` and `cfg.icon` throws TypeError.

**Fix Applied**: Added null guard at line 314 — `if (!cfg) { console.warn(...); return null; }`.

**Still Broken Downstream**: `saveCustomMemory` (server.ts:1246-1249) maps System B categories to System A via `validCats`, but 5/8 System B categories (`identity`, `relationship`, `emotional`, `behavior`, `session`) are NOT in `validCats` → all fall to `"general"`. Semantic meaning is lost.

#### BUG-2: SessionManagerPanel Crash on Missing Session Property (SessionManagerPanel.tsx:116)

**Root Cause**: `recall?.session.lastSessionSummary` — if `recall.session` is `undefined` (e.g., malformed API response), accessing `.lastSessionSummary` throws TypeError.

**Fix Applied**: Changed to `recall?.session?.lastSessionSummary` with optional chaining on `session`.

#### BUG-3: Summary Memory Stored as `"conversation"` — Never Displayed in UI (server_session_summary.ts:89)

**Root Cause**: `refreshSessionDocuments` stores the summary as `storeMemory(..., "conversation" as any, ...)`. The frontend's `categoryConfig` has no `"conversation"` key → summary memory is stored in SQL but never rendered in the MemoryDashboard.

### 🟠 MAJOR

#### BUG-4: `saveCustomMemory` Category Mapping is Lossy (server.ts:1246-1249)

File: `server.ts`
Lines: 1246-1249
```typescript
const validCats = ["preference", "project", "goal", "important_event", "conversation",
                   "reminder", "general", "active_task", "debug_session", "decision",
                   "project_note", "milestone", "bug_report"];
const sqlCat = validCats.includes(category) ? category : "general";
```

**Impact**: Gemini's `saveCustomMemory` function call uses System B enum (`identity`, `preference`, `goal`, `project`, `relationship`, `emotional`, `behavior`). `identity`, `relationship`, `emotional`, `behavior` are NOT in `validCats` → all stored as `"general"`. **5/8 categories lose their semantic meaning.**

#### BUG-5: Text Chat Session Auto-Resume Confuses Users (src/App.tsx:556-587)

**Root Cause**: `activeSessionId` is loaded from localStorage and that session's messages are loaded on mount. Users expect a fresh session each time they open the chat tab or refresh the page. No "new session on login" toggle exists.

**Impact**: Old messages always appear. User must manually click "NEW" to start a fresh session.

#### BUG-6: `loadSessionMessages` Fails Silently (src/App.tsx:568-581)

```typescript
const res = await fetch(`/api/phasex/sessions/${sessionId}`);
if (!res.ok) return;  // ← No error state, no toast
```

**Impact**: If the session no longer exists (deleted, DB reset), the user sees an empty chat with no error message or fallback.

#### BUG-7: Race Condition on Mount (src/App.tsx:584-587 and 598)

Two `useEffect([])` hooks fire simultaneously on mount:
1. `if (activeSessionId) loadSessionMessages(activeSessionId)` — loads persisted session
2. `if (isTextChatOpen) refreshSessions()` — fetches session list

If `isTextChatOpen` is true (chat was open before refresh), both run concurrently. Session list could populate before/after messages, causing UI flicker.

#### BUG-8: Text Chat Missing `apiVersion: "v1alpha"` (server.ts:1173-1176)

Voice path correctly uses `apiVersion: "v1alpha"` (line 1718) for proactive audio support. Text chat `GoogleGenAI` constructor doesn't have it — inconsistent, though text doesn't use audio.

#### BUG-9: History Includes Placeholder Model Message in Edge Cases (src/App.tsx:614)

In `sendTextChat`, a placeholder model message `{ role: "model", text: "" }` is added to React state before response. While it's not included in the POST body (only `updatedMessages` which ends with user message), if the component re-renders between state updates, there's a slim race where the model message is included.

### 🟡 MINOR

#### BUG-10: `_currentSessionId` In-Memory Only (server_phasex.ts:435-443)

Rest on server restart. Text chat fallback (server.ts:1129-1131) uses it, but client always sends `sessionId` so rarely triggered.

#### BUG-11: Mixed-Mode Sessions in Text Chat List (src/App.tsx:595)

```typescript
data.filter((s: any) => s.mode === "text" || s.mode === "mixed")
```
Voice-created sessions with `mode: "mixed"` appear in text chat list — potentially confusing.

---

## 8. Inconsistencies & Code Smells

### Cat-1: Dual Category Systems (Most Consequential)
Two incompatible `MemoryCategory` types exist. Changes to one require coordinated changes to the other — currently not done.

### Cat-2: Voice vs Text Session Behavior
- Voice: always creates new session
- Text: always resumes old session
- No unified session lifecycle policy

### Cat-3: Summary Storage in Two Places
1. `phasex_sessions.summary` column
2. `memories` table as category `"conversation"`
These can diverge if one path fails silently.

### Cat-4: `refreshSessionDocuments` vs `closeSession` Race
If the user sends a voice message WHILE `refreshSessionDocuments` is running (it's async fire-and-forget), a subsequent `turnComplete` could trigger a second concurrent call. No mutex/lock on the summary file write.

### Cat-5: LTM Files Start Empty
`memory/long_term/*.json` are initialized as `{}` / `[]` and never populated by any automated process. They must be manually filled or populated via the LTM API (`POST /api/phasex/ltm/:category`). The recall system reads them, but they're always empty in practice.

### Cat-6: Orphan Reaper Doesn't Generate Summaries
`reapOrphanedSessions()` closes crash-leftover sessions but does NOT generate a summary for them. They keep whatever the last incremental summary was, which could be empty.

### Cat-7: `unfinishedTasks` Always Empty
`buildRecallContext` returns `unfinishedTasks: []` (line 703) — never populated. The field exists in the type but has no implementation feeding it.

---

## 9. Recommended Fixes

### Priority 1: Category System Overhaul
**Option A** — Expand frontend to handle all 13 server categories:
- Add `conversation`, `general`, `important_event`, `reminder`, `active_task`, `debug_session`, `decision`, `project_note`, `milestone`, `bug_report` to `categoryConfig` in `MemoryDashboard.tsx`
- Add color/icon mappings for each

**Option B** — Constrain server to frontend's 8 categories:
- Change `MemoryCategory` in `memory/store.ts` to match `src/lib/memoryTypes.ts`
- Migrate existing data
- Update `validCats` in both `saveCustomMemory` paths

### Priority 2: New Session on Login Option
- Add `startNewTextSessionOnMount: boolean` setting (default `false`)
- When enabled, clear `adj_active_text_session_id` from localStorage on mount and create new session

### Priority 3: Fix `saveCustomMemory` Mapping
- Add reverse mapping from System B → System A in both voice and text paths:
  ```typescript
  const categoryMap: Record<string, string> = {
    identity: "general",
    preference: "preference",
    goal: "goal",
    project: "project",
    relationship: "general",
    emotional: "general",
    behavior: "general",
  };
  ```

### Priority 4: Add Error Handling to `loadSessionMessages`
- Show inline error message when session fetch fails
- Clear `activeSessionId` from localStorage if session returns 404

### Priority 5: Fix Summary Memory Category
- Change `storeMemory(..., "conversation"...)` to `"session"` in `server_session_summary.ts:89` (assuming System B categories)
- Or add `"conversation"` to the frontend's `categoryConfig`

### Priority 6: Synchronize Session Loading
- Combine the two mount `useEffect` hooks into one with proper async sequencing
- Or use `useLayoutEffect` for the message load

### Priority 7: Add `apiVersion: "v1alpha"` to Text Chat
- Mirror the voice path's `GoogleGenAI` constructor options

---

## 10. Key File Index

| File | Purpose | Key Lines |
|------|---------|-----------|
| `server.ts` | Main server: memory endpoints, consolidation triggers | 835-874 (REST API), 1116-1315 (text chat), 1732-1742 (voice recall), 2440-2455 (turnComplete), 2483-2526 (saveCustomMemory voice) |
| `server_memory.ts` | Memory core: load/save/consolidate/format | 10-29 (loadMemories), 31-63 (saveMemories), 66-113 (formatSystemInstructions), 118-317 (processConversationSlice) |
| `server_phasex.ts` | Sessions, LTM, recall, transcripts | 120-187 (init tables), 256-299 (createSession), 326-350 (closeSession), 357-380 (writeTranscriptDoc), 386-410 (orphan reaper), 435-443 (currentSessionId), 445-502 (logMessage), 665-706 (buildRecallContext), 708-743 (formatRecallPrompt) |
| `server_session_summary.ts` | Summary generation | 23-57 (generateSessionSummary), 63-108 (refreshSessionDocuments) |
| `memory/store.ts` | SQLite memory CRUD + types | 4-17 (MemoryCategory), 19-27 (MemoryRecord), 29-41 (storeMemory), 56-71 (searchMemories), 102-125 (getAll/pin/delete/count) |
| `memory/retriever.ts` | Retrieval + action memories | 24-36 (getProjectContext), 85-107 (getRelevantProjectMemories), 109-181 (autoCreateMemoryForAction) |
| `memory/curator/MemoryCurator.ts` | Scheduled consolidation (6h) | 17-23 (scheduler), 32-62 (runCuration), 81-116 (consolidateMemories), 118-141 (llmConsolidate) |
| `database/schema.ts` | SQL table definitions | 18-26 (memories table) |
| `database/index.ts` | SQLite wrapper | 29-53 (initDatabase), 60-73 (run/saveDatabase), 80-90 (query) |
| `src/lib/memoryTypes.ts` | Frontend memory types | 1-7 (Memory interface), 11-16 (MemoryTransaction) |
| `src/lib/settingsStore.ts` | Settings persistence | 13-35 (AdjSettings interface + defaults) |
| `src/App.tsx` | Frontend state + session management | 263-264 (memories state), 335-351 (fetch on mount), 353-367 (manual add), 369-381 (delete), 556-587 (activeSessionId), 600-603 (handleSelectSession), 606-660 (sendTextChat), 697-710 (handleNewSession) |
| `src/components/MemoryDashboard.tsx` | Frontend memory UI panel | 44-93 (categoryConfig), 205-224 (manual entry form), 262-290 (tab selector), 292-354 (memory list cards) |
| `src/components/TextChatPanel.tsx` | Frontend text chat UI | 47-60 (props), 117-348 (component) |
| `src/components/SessionManagerPanel.tsx` | Frontend session UI | 40-46 (state), 59-64 (fetchRecall), 66-71 (useEffect), 115-124 (recall bar) |
| `knowledge_base/memory/` | Static person/project/event profiles | Loaded via loadKnowledgeBaseContext() |
