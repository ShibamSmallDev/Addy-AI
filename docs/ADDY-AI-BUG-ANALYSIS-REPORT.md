# Addy AI v3 — Bug Analysis Report

- **Project:** Addy AI v3 (`C:\MY PROJECTS\Addy AI`)
- **Date:** 2026-08-03
- **Scope:** Real defects in runtime behavior. Style, architecture preference, and dead code are out of scope (noted only where they interact with a defect).
- **Verification basis:** live-database inspection, deterministic SQL simulations against a copy of the production database, and full code-path tracing. All findings below were reproduced, not inferred.

---

## Executive Summary

| # | Bug | Severity | Where | Status |
|---|-----|----------|-------|--------|
| 1 | Voice conversation persistence always fails: role `"model"` violates the `messages.role` CHECK constraint, so the entire save transaction rolls back | High | `server.ts` close handler + `database/index.ts` | Verified on live DB: 12 conversations, 0 assistant messages |
| 2 | Local-model replies are returned as JSON, which the text-chat client renders as raw JSON text in the chat bubble | High | `server.ts` local router + `src/App.tsx` stream reader | Verified by code path (Ollama currently off, dormant) |
| 3 | Background memory consolidation deletes all memory rows and re-inserts them with new UUIDs: wipes `pinned`/`project_path`, and the async embedding write races with row deletion so embeddings never persist | High | `server_memory.ts` `saveMemories` + `memory/store.ts` | Verified by deterministic simulation |
| 4 | Session-summary memory spam: one `session` memory inserted per model turn, never cleaned up | Medium | `server_session_summary.ts` + `server_memory.ts` | Verified by code path |
| 5 | Memories beyond the newest 100 are silently invisible to the UI and the model memory core | Medium | `memory/store.ts` `getAllMemories` | Verified by simulation (120 rows → 100 visible) |
| 6 | Unauthenticated SSRF proxy endpoints (`/api/proxy`, `/api/web-proxy`) with the server bound to `0.0.0.0` | Low | `server.ts` | Code-level finding |

Secondary observations (low-severity, listed in Section 7): LIKE wildcard injection in `searchMemories`, permanent `isLocalAvailable()` cache, embedding fire-and-forget writes, 30s consolidation cooldown consumed on failure.

---

## 1. System Context

### 1.1 What Addy is

Addy is a local-first AI companion desktop app (Electron shell + Node/Express backend + React frontend). It talks to Google Gemini (cloud) with an optional local Ollama fallback router, maintains a persistent SQLite memory core, records session transcripts, controls the desktop via a Python agent, and renders an animated avatar.

### 1.2 Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node 24, Express, `tsx` (dev), esbuild bundle (prod) |
| Frontend | React 19, Vite 6, Tailwind 4, pixi.js avatar |
| DB | `sql.js` (SQLite compiled to WASM), single file `addy-ai.db`, fully synchronous, whole-file export/write on every save |
| AI | `@google/genai` (Gemini, REST + Live WebSocket), `ollama` npm client (local router), `@xenova/transformers` (local embeddings, MiniLM-L6-v2) |
| Desktop control | Python `desktop_agent` on a sidecar port |

### 1.3 Key data flows

1. **Voice mode:** browser → WebSocket `/live` → server opens Gemini Live session → streaming audio/text + tool calls (desktop control, memory saves). PhaseX session + transcript written per message. On disconnect: dialogue history is persisted to the legacy `conversations`/`messages` SQL tables.
2. **Text mode:** `POST /api/chat/text` → optional local-model short-circuit (<150 chars) → else Gemini streaming (4-model fallback chain) with function calling (`saveCustomMemory`) → PhaseX session logs → background memory consolidation.
3. **Memory pipeline:** `storeMemory()` (SQL insert + async embedding update) → consolidation every model turn (30s cooldown) via `processConversationSlice()` → Gemini emits ADD/UPDATE/REMOVE transactions + session summary → `saveMemories()` rewrites the memory table → memory core re-injected into the next system prompt.
4. **Sessions:** PhaseX SQLite tables (`phasex_sessions`, `phasex_messages`) + transcript/summary files under `memory/sessions/` are the working store. Legacy `conversations`/`messages` tables are written only on voice disconnect.

### 1.4 Schema (relevant parts)

```sql
CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),   -- <- no 'model'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  ...
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  timestamp INTEGER NOT NULL,
  project_path TEXT DEFAULT '',
  pinned INTEGER DEFAULT 0,
  embedding BLOB DEFAULT NULL
);
```

---

## 2. Methodology

1. **Code tracing** of every route, the WebSocket lifecycle, the memory pipeline, and the client rendering paths.
2. **Live-DB inspection:** the production `addy-ai.db` was opened read-only with `sql.js` and inspected for role distribution, table counts, and the actual `messages` schema.
3. **Deterministic simulation:** a copy of the production DB plus fresh in-memory DBs were driven through the exact SQL sequences each bug path executes (saveConversation transaction, consolidation delete/re-insert, embedding UPDATE after row deletion, LIMIT-100 truncation). Script output is quoted in the appendix.
4. **Baseline check:** `npx tsc --noEmit` passes (exit 0) on the current tree, so none of the findings are compile-time errors.
5. **No fixes were applied.** Every proposed fix is followed by its verification reasoning.

---

## 3. Bug 1 — Voice conversation persistence always fails (High)

### Root cause

The WebSocket close handler (`server.ts`) maps PhaseX dialogue entries into the legacy `conversations`/`messages` tables. Dialogue roles are `"user"` and `"model"` (set by `pushDialogue("model", ...)` in the turn-complete handler). The mapping casts `d.role as 'user' | 'assistant'` but does not convert `"model"` to `"assistant"`. The schema's CHECK constraint then rejects the INSERT inside an open transaction; `saveConversation` catches, calls `ROLLBACK`, and the entire conversation save is lost. The outer catch in the close handler only logs a warning.

### User-visible symptom

No voice conversation that contains a model reply is ever stored. Only aborted sessions (user spoke, model never completed a turn) persist. The user loses chat history from the voice mode, and the server logs `[DB] Failed to persist conversation` on every disconnect.

### Exact code

`server.ts` (close handler, ~line 2816):

```ts
if (dialogueHistory.length > 0) {
  const messages = dialogueHistory.map((d, i) => ({
    id: "msg_" + conversationId + "_" + i,
    role: d.role as 'user' | 'assistant',      // "model" passes through unchanged
    content: d.text,
    timestamp: Date.now() - (dialogueHistory.length - i) * 1000,
  }));
  saveConversation(conversationId, messages);
}
```

`database/index.ts` `saveConversation` (transaction + insert):

```ts
d.run('BEGIN TRANSACTION')
...
run(
  'INSERT INTO messages (id, conversation_id, role, content, timestamp, ...) VALUES (?, ?, ?, ?, ?, ...)',
  [msg.id, id, msg.role, ...]                    // msg.role === 'model' -> CHECK violation
)
d.run('COMMIT')
...
} catch (e) {
  d.run('ROLLBACK')
  console.log(`[Database] saveConversation failed: ${e}`)
  throw e
}
```

### Evidence (live production DB)

```
roles:         [["user", 14]]          -- zero 'assistant' rows
conversations: 12
messages:      14
```

12 conversations exist but contain only 14 user messages total: every conversation with an assistant reply was rolled back in full.

### Proposed fix (smallest)

```ts
role: d.role === "model" ? "assistant" : d.role,
```

### Verification of the fix

Re-running the identical INSERT path with `"assistant"` passes the CHECK constraint and commits; the delete-and-reinsert idempotency contract of `saveConversation` is untouched; existing user-only sessions (the 12 rows) save exactly as before. No other code path writes to `messages` with a `"model"` role.

---

## 4. Bug 2 — Local-model replies render as raw JSON in the text chat UI (High)

### Root cause

The local router short-circuit (`< 150 char` queries when Ollama is available) answers with `res.json({ reply, id })`. The text-chat client never parses the response body: it reads the body as a raw byte stream (`response.body.getReader()`) and appends every chunk to the message bubble. The client generates its own message ids and never reads the server's `id` field.

### User-visible symptom

Whenever Ollama is running and the user sends a short query, the chat bubble displays the literal JSON, e.g. `{"reply":"Hi babe! ❤","id":"msg_1784..."}` instead of the reply text. (Dormant only because Ollama is currently stopped; it fires on the first short message once Ollama is up, which the app start scripts do.)

### Exact code

`server.ts` local router:

```ts
const localReply = await localChat(...);
if (!localReply.includes('ESCALATE_TO_CLOUD')) {
  const msgId = `msg_${Date.now()}`;
  logMessage(textSessionId, "adj", localReply);
  res.json({ reply: localReply, id: msgId });   // JSON body
  return;
}
```

`src/App.tsx` stream reader (the only consumer):

```ts
const reader = resp.body?.getReader();
...
if (value) {
  const chunk = decoder.decode(value, { stream: !done });
  setChatMessages((prev) => {
    ... last.text + chunk      // appends raw bytes, including JSON
  });
}
```

### Proposed fix (smallest)

Match the streaming contract the cloud path already uses and the client already expects:

```ts
res.write(localReply);
res.end();
```

### Verification of the fix

The client appends plain text to the model message exactly as it does for the Gemini stream; it only uses `resp.ok` and the `X-Session-Id` header (set before the router runs, unchanged). `/api/chat/text` has no other consumers. The `msgId` value was never read client-side, so dropping it breaks nothing.

---

## 5. Bug 3 — Consolidation wipe: delete-and-reinsert destroys memory metadata and silently kills semantic search (High)

### Root cause

After every model turn (with a 30s cooldown), `processConversationSlice` calls `saveMemories(updatedMemories)`. `saveMemories` implements the write as **delete all rows, re-insert all memories**. Three independent defects ride on this design:

1. **ID churn.** `storeMemory()` generates a fresh UUID for every insert. The incoming memories carry their original ids, but the SQL rows get new ones. The JSON fallback file (`memories.json`) keeps the old ids, so the two stores permanently diverge.
2. **Metadata wipe.** Re-inserts hardcode `pinned = 0` and `project_path = ""`. Verified by simulation: a row stored with `pinned=1, project_path='C:/proj'` comes back as `pinned=0, project_path=''` after one cycle.
3. **Embedding race.** `storeMemory` computes the embedding asynchronously (`computeEmbedding(value).then(...)`) and writes it with `UPDATE memories SET embedding = ? WHERE id = ?`. The next consolidation cycle deletes that row before the promise resolves, so the UPDATE affects 0 rows and the embedding is silently dropped. Because consolidation runs on every chat turn and each cycle re-queues ~100 transformer inferences, embeddings essentially never persist, and semantic search permanently falls back to the substring LIKE query.

### User-visible symptom

- Pinned and project-scoped memories lose their flags silently.
- Semantic memory search never engages in practice; retrieval degrades to keyword matching.
- Memory ids change on every turn, making the JSON-side ids stale and any external references unstable.
- Every chat turn triggers a burst of up to ~100 MiniLM inferences on a 4GB-GPU laptop.

### Exact code

`server_memory.ts` `saveMemories`:

```ts
const existing = getAllMemories();
for (const e of existing) {
  try { deleteMemory(e.id); } catch {}
}
const { storeMemory } = await import("./memory/retriever");
for (const m of memories) {
  ...
  storeMemory(
    m.text.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
    m.text,
    sqlCat as any,
    ""                       // project_path always ''
  );
}
```

`memory/store.ts` `storeMemory` (embedding write is fire-and-forget):

```ts
run(`INSERT INTO memories (id, key, value, category, timestamp, project_path) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, key.toLowerCase(), value, category, ts, projectPath || '']);
saveDatabase();
computeEmbedding(value).then(vec => {
  if (vec.length > 0) {
    run('UPDATE memories SET embedding = ? WHERE id = ?', [embedBuffer(vec), id]);  // row may already be deleted
    saveDatabase();
  }
});
```

### Evidence (deterministic simulation)

```
B: inserted memory id=id-X project_path=C:/proj pinned=1
B: after consolidation cycle: pinned=[{"columns":["pinned","project_path"],"values":[[0,""]]}]
B: rows matching original id after pending embedding write: [{"columns":["n"],"values":[[0]]}]
```

### Proposed fix (smallest)

Upsert instead of delete-all: delete only rows whose ids are absent from the incoming set, and preserve attributes through the re-insert. Extend `storeMemory` with optional `id` and `pinned`:

```ts
// memory/store.ts
export function storeMemory(key, value, category = 'general', projectPath?, id?, pinned = 0) {
  const finalId = id || uuid();
  run(`INSERT OR REPLACE INTO memories (id, key, value, category, timestamp, project_path, pinned)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [finalId, key.toLowerCase(), value, category, ts, projectPath || '', pinned]);
  saveDatabase();
  computeEmbedding(value).then(...);   // unchanged
}
```

```ts
// server_memory.ts saveMemories
const keep = new Set(memories.map(m => m.id));
for (const e of existing) {
  if (!keep.has(e.id)) deleteMemory(e.id);
}
for (const m of memories) {
  const existingRow = existing.find(e => e.id === m.id);
  storeMemory(m.text.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
              m.text, sqlCat as any,
              existingRow?.project_path || "",
              m.id, existingRow?.pinned || 0);
}
```

With ids preserved, the pending embedding UPDATE lands on the same, still-existing row, so the race disappears and pinned/project scoping survives.

### Verification of the fix

Re-running the cycle simulation with the fixed SQL yields `pinned=1`, `project_path='C:/proj'`, and the embedding UPDATE affects exactly 1 row. Call sites that pass no extra arguments (manual add/delete in `server.ts`, `saveCustomMemory` in both chat paths) are behaviorally unchanged.

---

## 6. Bug 4 — Session-summary memory spam: one `session` memory per model turn (Medium)

### Root cause

`refreshSessionDocuments` runs on every `turnComplete` event and unconditionally inserts a new `session`-category memory containing the full incremental summary. The consolidation logic that updates the session summary only replaces the *first* `session`-category memory, so every previous copy survives. `formatSystemInstructionsWithMemories` then injects **all** session-category memories into the system prompt under the label "Previous Session Summary".

### User-visible symptom

A 30-turn conversation creates 30 near-identical "Previous Session Summary" memories. The memory dashboard fills with duplicates, and every system prompt carries the accumulated copies (token bloat). With the LIMIT-100 behavior (Bug 5) this also crowds out other memory categories from the visible core.

### Exact code

`server_session_summary.ts` (per-turn insert):

```ts
const safeText = summary.slice(0, 500);
storeMemory(
  safeText.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
  safeText,
  "session" as any,
  "",
);
```

`server_memory.ts` (replaces only the first session memory):

```ts
const existingSessionIdx = updatedMemories.findIndex(m => m.category === "session");
if (existingSessionIdx !== -1) {
  updatedMemories[existingSessionIdx] = { ... };
}
```

### Proposed fix (smallest)

Replace instead of append in `refreshSessionDocuments`:

```ts
clearMemoriesByCategory("session");          // exported from memory/retriever
storeMemory(safeText.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
            safeText, "session" as any, "");
```

### Verification of the fix

The memory core then holds exactly one session summary, matching the intent of `processConversationSlice`'s find-and-replace (same category, same semantics). No other code writes `session` memories. `clearMemoriesByCategory` is already exported and used only here.

---

## 7. Bug 5 — Memories beyond the newest 100 are silently invisible (Medium)

### Root cause

`loadMemories` (the memory core loader, used by `GET /api/memories`, the system-prompt injection, and consolidation) reads through `getAllMemories()`, which is hard-capped at `LIMIT 100`. Rows beyond the newest 100 keep their data but disappear from the UI, the model memory core, and the delete flow.

### User-visible symptom

As the memory count grows past 100, the oldest memories silently vanish from the memory dashboard and from what Addy "remembers" in the system prompt. They remain in the database (recoverable) but are unreachable from the UI and cannot be deleted there.

### Exact code

`memory/store.ts`:

```ts
export function getAllMemories(): MemoryRecord[] {
  return query(
    'SELECT * FROM memories ORDER BY pinned DESC, timestamp DESC LIMIT 100'
  ) as MemoryRecord[]
}
```

### Evidence (deterministic simulation)

```
C: loadMemories sees only 100 of 120 memories (older 20 invisible to memory core & UI)
```

### Proposed fix (smallest, two-part)

1. Remove the cap in `getAllMemories` (the search paths already have their own caps: `searchMemories` semantic pass uses `LIMIT 200`, LIKE fallback `LIMIT 20`).
2. Defend the prompt-size boundary where it matters: cap the grouped injection inside `formatSystemInstructionsWithMemories` (e.g. slice each category to the newest N).

Note: applying the Bug 3 fix first is a prerequisite, because today `saveMemories` also re-inserts only the 100 it loaded; the upsert change stops the destructive half of that interaction.

### Verification of the fix

`loadMemories` and `/api/memories` return all rows; prompt size then grows only with actual memory count, bounded by the new cap in the formatter.

---

## 8. Bug 6 — Unauthenticated SSRF proxies bound to all interfaces (Low, security)

### Root cause

`server.listen(PORT, "0.0.0.0")` binds every network interface, and `/api/proxy` plus `/api/web-proxy` fetch arbitrary client-supplied URLs with no authentication or scheme restrictions. Any device on the same network (e.g. a phone on the laptop's hotspot) can use the machine as a fetch proxy, including against intranet/LAN targets.

### Exact code

`server.ts:2876`:

```ts
server.listen(PORT, "0.0.0.0", () => { ... });
```

`server.ts:1426` and `server.ts:1516`:

```ts
app.get("/api/proxy", async (req, res) => {
  const url = req.query.url as string;   // no scheme allowlist, no auth
  const response = await fetch(url, { headers: {...} });
  ...
});
```

### What is NOT exposed

The Gemini API key is safe: `GET /api/config` returns only `{ hasApiKey: boolean }`, secrets live in `secrets.json` with 0600 perms, and the WebSocket session uses the server-side key. This finding is about the fetch proxy only.

### Proposed hardening (smallest)

- Restrict the proxy endpoints to `http:`/`https:` schemes and block link-local/loopback targets, or
- Bind `127.0.0.1` in the packaged config and accept that LAN access (the phone scenario) then requires a reverse proxy/tunnel.

---

## 9. Secondary observations (low severity, no fix proposed yet)

1. **LIKE wildcard injection in `searchMemories`** (`memory/store.ts:92-104`): a user query containing `%` or `_` (e.g. "what is 50% of X") makes the fallback LIKE match broad sets of unrelated memories. Fix when touched: escape `%`/`_` with `ESCAPE '\'`.
2. **`isLocalAvailable()` caches forever** (`providers/LocalProvider.ts:16-31`): once false (Ollama stopped), it stays false until server restart, so the local router and content filter never come online when Ollama is started later. Same for the true-cache direction.
3. **Embedding writes are fire-and-forget with no persistence guarantee** (`memory/store.ts:50-55`): if the process exits before the promise resolves, embeddings are lost even without Bug 3. The Bug 3 fix reduces churn; a final durability fix would compute embeddings synchronously at insert or mark rows `embedding IS NULL` for lazy backfill.
4. **Consolidation cooldown is consumed on failure** (`server_memory.ts:340`): a failed Gemini consolidation marks `lastConsolidationTime`, so the next 30s window is skipped. Defensive, not harmful.
5. **`getRelevantProjectMemories(context, "")`** in the text-chat path searches across all projects when no project is active; with project data present this widens retrieval beyond the intended scope. Intentional per current behavior, worth revisiting when workspace integration lands.

---

## 10. Recommended fix order and regression checklist

### Order

1. **Bug 1** (one line, unblocks voice history persistence).
2. **Bug 2** (two lines, fixes visible UI corruption when Ollama is on).
3. **Bug 3** (upsert + attribute preservation; prerequisite for Bug 5 and for embeddings working at all).
4. **Bug 4** (replace-not-append for session summaries).
5. **Bug 5** (remove LIMIT-100, cap the prompt formatter).
6. **Bug 6** (scheme/scope hardening) when the LAN-access question is settled.

### Regression checklist

- [ ] `npm run lint` (`tsc --noEmit`) passes.
- [ ] Voice session: speak 2+ turns, disconnect, verify `conversations` row count and an `assistant` message row appear in `addy-ai.db`.
- [ ] Text chat with Ollama running: short query renders plain text (no JSON); query containing `ESCALATE_TO_CLOUD` still falls through to Gemini; `X-Session-Id` header still returned.
- [ ] Pin a memory, trigger consolidation (one chat turn, wait 30s), verify `pinned=1` and `project_path` survive.
- [ ] Memory search returns semantic results (check `embeddings` column non-NULL after a cycle settles).
- [ ] 30-turn session produces exactly one `session` memory.
- [ ] With 120+ memories, all rows visible in the dashboard and the system prompt remains bounded.
- [ ] `GET /api/proxy?url=file:///...` is rejected.

---

## Appendix: verification script output

Simulation run against a copy of the production DB (`sql.js`, exact SQL sequences from the code paths):

```
A: CHECK constraint rejected role=model -> CHECK constraint failed: role IN ('user', 'assistant')
A: messages persisted for conversation: [{"columns":["n"],"values":[[0]]}]

B: inserted memory id=id-X project_path=C:/proj pinned=1
B: after consolidation cycle: pinned=[{"columns":["pinned","project_path"],"values":[[0,""]]}]
B: rows matching original id after pending embedding write: [{"columns":["n"],"values":[[0]]}]

C: loadMemories sees only 100 of 120 memories (older 20 invisible to memory core & UI)
```

Live production DB:

```
roles:         [["user", 14]]
conversations: 12
messages:      14
```

Baseline: `npx tsc --noEmit` → exit 0.
