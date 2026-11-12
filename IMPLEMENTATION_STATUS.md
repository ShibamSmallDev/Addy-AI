# Addy-AI — Implementation Status (Phase 0: Baseline Audit)

**Audit date:** 11 November 2026
**Auditor:** Lead implementation agent (MiMo-V2.6-Flash)
**Scope:** Read-only baseline audit. No application source code was modified.

---

## 1. Current repository state

| Item | Value |
|---|---|
| Branch | `main` (in sync with `origin/main`) |
| Commit | `039388b` — *refactor: remove avatar engine, legacy providers and task classifier; add task manager and tests* (2026-11-11) |
| Remote | `https://github.com/ShibamSmallDev/Addy-AI.git` |
| Tracked files | 245 |
| Uncommitted changes | None tracked. 11 untracked scratch files only (`tmp_*.py`, `_fps_page.html`) — intentionally excluded from the last commit |
| Runtime stack | Node/TypeScript (Express + `ws` + React 19 + Vite), Electron shell, Python FastAPI desktop-agent sidecar (`127.0.0.1:8765`), SQLite via `sql.js` (`addy-ai.db`) |
| Last commit content | Deleted the 3D/Live2D avatar system, `LocalProvider`, `OpenRouterProvider`, `TaskClassifier`, `WorkspaceWatcher`, `specialist-registry`, `BrowserAgent`/`CronPanel`/`HolographicProjector`/`AvatarLab` UI and `public/models/addy.glb`; added `agent/task-manager.ts` and 3 new test files |

---

## 2. Architecture overview

``` text
PRESENTATION
  src/App.tsx, src/components/*, src/lib/*        React 19 UI (chat, settings, visualizer)
  electron/main.cjs, electron/preload.cjs         Desktop shell (contextIsolation ON,
                                                   nodeIntegration OFF, narrow contextBridge API)
        │  WebSocket events + HTTP routes
COGNITIVE
  providers/ProviderManager.ts, GeminiProvider.ts Provider abstraction (single provider: 'gemini')
  agent/loop.ts                                   ReAct planner + executor + self-healing retries
  memory/ (store, retriever, embeddings, curator) Multi-tier memory, semantic dedup, consolidation
  vault.ts, SOUL.md, soul.ts                      Identity / system-prompt context
        │  plan steps (tool + args)
ORCHESTRATION
  agent/task-manager.ts                           In-memory task lifecycle (queued→running→→terminal)
  server.ts (4,048 lines, 69 HTTP routes)         API routes, WebSocket broadcast, agent_run tool
  server_cron.ts, server_proactive.ts             Scheduled jobs, proactive daemon (quiet hours, cooldowns)
  orchestration/AgentRegistry.ts, AgentExecutor.ts OpenCode agent registry
        │  callDesktopAgent(tool, args)  [server.ts:1341]
EXECUTION & SECURITY
  execution/permission-service.ts                 DefaultPermissionService (13 categories, workspace
                                                   boundary, terminal command classification)
  execution/execution-service.ts, mcp-service.ts   OpenCode execution engine + MCP (permission-wired)
  desktop_agent/*.py (25 tool modules, registry)  Python sidecar: mouse/keyboard/browser/files/
                                                   system tools; two-step power-action confirmation
        │
PERSISTENCE
  database/schema.ts (sql.js)                     tables: conversations, messages, memories, settings
  server_phasex.ts                                phasex_sessions / phasex_messages / phasex_tool_calls
  files: memories.json, proactive_*.json, addy-ai.db
```

**Two execution paths exist:**
1. **OpenCode path** — `OpenCodeExecutionService` / `McpService` → **permission-checked** via `DefaultPermissionService`.
2. **Desktop-agent path** — `callDesktopAgent()` → HTTP POST to Python sidecar → **allow-list only** (`DESKTOP_TOOLS` set at `server.ts:1675`), **does not consult `DefaultPermissionService`**.

---

## 3. Existing implemented features (verified present)

| Roadmap area | Status | Evidence |
|---|---|---|
| Provider abstraction + model fallback + capacity-error short-circuit | Implemented (base) | `providers/ProviderManager.ts:105-136` throws typed `'AI provider unavailable'` at this layer |
| Gemini key pool with credential/quota error classification | Implemented | `tests/gemini-key-pool.test.ts` (passing) |
| ReAct planner with retries + self-healing re-planning + verification summary | Implemented (base) | `agent/loop.ts:244-332`, `MAX_RETRIES=3` |
| Task lifecycle: queued/running/completed/failed/aborted, background runner, progress WS events | Implemented (in-memory) | `agent/task-manager.ts` |
| Cancellation: abort flag checked between steps; executor refuses new desktop actions post-abort; terminal abort is a no-op | Implemented (base) | `tests/agent-task-manager.test.ts` (4 abort tests, passing) |
| Permission service: 13 categories, trusted-workspace boundary, path-traversal denial, terminal command classification, SYSTEM_CHANGE always denied | Implemented (base) | `execution/permission-service.ts`, `tests/permission.test.ts` (10 tests, passing) |
| MCP service with permission enforcement | Implemented | `tests/mcp.test.ts` (passing) |
| Proactive daemon: quiet hours, per-source config, idle/busy speech suppression | Implemented | `server_proactive.ts`, `tests/proactive.test.ts` (passing) |
| Memory: immediate extraction, recall timeline, consolidation queue, semantic dedup, curator decay | Implemented | `memory/*`, `tests/memory_and_desktop.test.ts` (passing) |
| Electron basics: `contextIsolation: true`, `nodeIntegration: false`, narrow preload (`isDesktop`, `getScreenStream` only — no raw `ipcRenderer`), window-open → external browser, media permission handler | Implemented | `electron/main.cjs:188-233`, `electron/preload.cjs` |
| Desktop-agent endpoint allow-list (blocks private handlers e.g. `_cancelPowerTimer`) | Implemented | `server.ts:1668-1677` |
| Two-step power-action confirmation (single-use token) in Python sidecar | Implemented | `desktop_agent/tools_confirmation.py`, `tools_pc.py` |
| Skills as context documents | Implemented (simple form) | 10 markdown files in `skills/`, loaded via `vault.loadAllSkillsContext` |
| Test suite | Implemented (partial coverage) | 10 test files, **67/67 passing** |

---

## 4. Partially implemented features

| Roadmap item | What exists | What is missing |
|---|---|---|
| **3.1 Explicit planning failures** | ~~`ProviderManager.chat()` throws a real error~~ **→ P1-1 + P1-2 done:** typed `ProviderFailureError` propagates; `PlanValidationError` (distinct type) validates structure, step types, tool names against the real registry, required args/types against the real Gemini declarations; bounded explicit replan (2 attempts); generic `searchFiles` fallback **removed** | ✅ **FULLY ADDRESSED for roadmap 3.1.** Remaining adjacent hardening (not 3.1): self-heal fix suggestions now validated against the registry too; plan-step *runtime* failures remain governed by the existing retry loop (P1-5/P1-6 scope) |
| **3.2 Desktop-agent retry safety** | Single automatic re-spawn retry, watchdog heartbeat every 10 s, 60 s timeout | **No operation ID** on requests; retry fires after *any* error **including `AbortError` timeout** (`server.ts:1385-1396`) → blind duplicate risk for non-idempotent actions; no `execution_unknown` outcome; no per-operation-type retry policy; no correlation ID capture |
| **3.3 Execution locks** | Python `registry.py` uses a `threading.Lock` for its tool registry only | No desktop-input lock, no browser-session lock, no file/workspace locks, no lock ordering policy, no "waiting for resource" status |
| **3.4 Deterministic cancellation** | Abort flag in loop + `abortRequested` guard in task manager; covered by 4 tests | Terminal states not immutable (`handleEvent` can overwrite `completed` by a late event); no cancellation tests for shutdown / queued-never-started tasks; tools that cannot be interrupted are undefined |
| **4.x Durable task engine** | Task lifecycle works in memory | No `tasks` / `task_steps` / `task_events` tables; no checkpoints; no crash recovery; all task state lost on restart (SQL schema is conversations/messages/memories/settings only) |
| **5.x Permission system** | `DefaultPermissionService` with 13 categories + tests; **P1-4 done:** desktop path now enforced through it (unknown tools fail closed; DENY/ASK-without-approval never reach Python); action+target-bound grants (`once`/`session`); HTTP grant/revoke/check endpoints | Missing categories (browser nav/form submit, messages/email, purchases, power) still roadmap P3; no audit log; no approval UI / grant revocation UI; `server.ts:1535` comment to be corrected |
| **5.4 Electron hardening** | Isolation flags, narrow preload, window-open handler, permission handler | No CSP (`index.html` has no `Content-Security-Policy` meta); no `will-navigate` restriction; `sandbox` not explicitly set (relies on Electron default); no IPC validation because no IPC is used yet; no automated security checks |
| **6.x Memory 2.0** | Schema already has `source`, `importance`, `confidence`, `status`, `last_verified_at`, `superseded_by`, `project_path`, `pinned` columns | No episodic/semantic/procedural/project categories in use; no retrieval-before-planning hook into `agent/loop.ts`; no project snapshot / "Continue project" workflow |
| **7.x Skills 2.0** | 10 markdown skill documents | No manifest format, versions, declared tools/permissions, validation, or registry; skills are prompt text only |
| **8.x Evidence-based verification** | Verification gate re-prompts the model for a summary (`loop.ts:334-356`) | Model is sole judge; no evidence gathering (file existence, test results, tool-output checks); no completion classification (completed/partial/blocked/uncertain) |
| **9.x Avatar / presentation** | **Removed in commit `039388b`** (roadmap §9 wants a presentation abstraction rebuilt later) | No presentation-state interface exists today; roadmap character-consistency work not started |
| **11.x Proactive** | Daemon, quiet hours, cooldowns, suppression rules, tests | No per-category dismissal memory, no batching, no global pause switch in UI (config file exists), no "explain why" surfacing |
| **12.x Observability** | `logCommand` / `logError`, WS event streams, provider stats endpoint | No structured logs, no correlation IDs, no log rotation, no Control Center, no diagnostic export |
| **13.x Repository hygiene** | `.env*` gitignored and untracked; no secrets in tracked tree (verified by pattern scan) | Duplicate `"description"` key in `package.json` (lines 4 and 57 — esbuild warns); lockfile root still lists removed deps (`three`, `pixi.js`, `ollama`, `@types/three`) and `react ^19.0.1` vs `package.json ^19.2.1`; **PyInstaller output tracked** (`agent_build/**` incl. `.exe`/`.pkg`); `.claude/settings.local.json` tracked; docs (`TODO.md`, `TODO_3D_MODEL.md`) contain stale avatar references |
| **14.x Testing & CI** | 67 unit tests passing; `lint` = `tsc --noEmit` | **No `.github/workflows` at all**; no Python tests for `desktop_agent/`; no integration/E2E tests; no lint/format tool beyond `tsc`; no coverage reporting |

---

## 5. Missing features (not started)

- Typed provider outcome model (`success | timeout | rate_limit | invalid_response | auth | provider_failure`) at the agent-loop boundary
- Operation IDs, idempotency keys, `execution_unknown` outcome for desktop-agent requests
- Desktop-input / browser-session / resource locks and queueing
- SQLite task journal, append-only event table, step records, checkpoints, crash recovery, resume/retry flows, task-history UI
- Central unified permission policy covering all 18 roadmap categories, approval UI, audit log with redaction and export
- Electron IPC layer with sender/payload validation (no IPC exists today), CSP, navigation restrictions, security regression tests
- Memory categories (episodic/semantic/procedural/project), provenance-driven retrieval before planning, project snapshots, "Continue project"
- Skill manifests, registry, versioning, declared tool/permission enforcement
- Evidence-based verification pipeline and completion classification
- Presentation-state abstraction and avatar renderer boundary (currently no avatar at all)
- Voice turn detection / barge-in guarantees (not inspected in depth — **unverified**, do not assume)
- Structured cross-process logging, correlation IDs, Control Center, provider-health UI, redacted diagnostics
- CI workflows, Python test harness, integration/E2E suites, release/rollback process

---

## 6. Confirmed defects and risks

### Confirmed defects (evidence-backed)

| # | Defect | Location |
|---|---|---|
| D1 | ~~Provider failure silently converted to `""`, then to a fake plan~~ | ✅ **FIXED (Phase 1, P1-1, verified 11 Nov 2026)** — `agent/loop.ts` + new `providers/errors.ts`; regression tests in `tests/agent-provider-failure.test.ts` |
| D2 | ~~Malformed plan JSON swallowed by empty `catch {}`~~ | ✅ **FIXED (Phase 1, P1-2, verified 11 Nov 2026)** — `agent/plan-validator.ts` (`parsePlanJson` → typed `malformed_json`); bounded replan then explicit failure |
| D3 | ~~Unconditional generic `searchFiles` fallback plan runs regardless of the goal~~ | ✅ **FIXED (Phase 1, P1-2, verified 11 Nov 2026)** — fallback deleted; invalid plans fail the task with zero tool executions (regression tests assert this) |
| D4 | ~~Plan steps not validated: empty or unknown `tool` names accepted~~ | ✅ **FIXED (Phase 1, P1-2, verified 11 Nov 2026)** — validated against `DESKTOP_TOOLS` + real Gemini declarations (`tools/desktop-tools.ts`, moved verbatim from server.ts); self-heal fix suggestions validated too |
| D5 | ~~Blind retry after timeout/unreachable error — non-idempotent actions (send message, delete file, submit form) can double-execute~~ | ✅ **FIXED (Phase 1, P1-3, verified 11 Nov 2026; eviction edge case fixed same day, see P1-3a below)** — retry moved into `tools/desktop-agent-client.ts`: re-dispatch ONLY when the request is *proven* never executed (connect-time failure, or unchanged+reachable sidecar with no registry entry **AND** an eviction watermark proving nothing was forgotten since this dispatch), always with the SAME op ID, exactly once; ambiguous outcomes — including a registry miss caused by bounded-retention eviction — → `execution_unknown`, never retried; agent-loop also refuses to re-run `execution_unknown`/`cancelled` steps |
| D6 | ~~Desktop-agent requests carry no operation/correlation ID~~ | ✅ **FIXED (Phase 1, P1-3, verified 11 Nov 2026)** — unique `op_id` on every `/execute` (Node → pydantic → registry → responses → logs); sidecar claims it before dispatch and dedupes duplicates (`desktop_agent/operations.py`); `GET /operations/{op_id}` reconciliation endpoint; explicit outcomes `completed\|failed\|cancelled\|execution_unknown` returned by `callDesktopAgent` |
| D7 | Desktop tool execution path bypasses `DefaultPermissionService` (allow-list only); misleading comment at `server.ts:1535` | ✅ **FIXED (Phase 1, P1-4, verified 11 Nov 2026)** — `callDesktopAgent` now enforces `DefaultPermissionService` at the execution boundary (unknown tools fail closed; DENY/ASK-without-approval never reach Python); tool→category+resource mapping in `tools/desktop-permission.ts`; approval grants are action+target-bound and scope-aware (`once`/`session`); HTTP endpoints `/api/permissions/{grant,revoke,check}`; outcome/opId preserved | `server.ts`, `execution/permission-service.ts`, `execution/types.ts`, new `tools/desktop-permission.ts`, new `tests/desktop-permission.test.ts` |
| D8 | Duplicate `"description"` key in `package.json` | `package.json:4` and `:57` |
| D9 | Lockfile root out of sync with `package.json` (stale `three`/`pixi.js`/`ollama`/`@types/three`, `react ^19.0.1` vs `^19.2.1`) — `npm ci --dry-run` exits 0 today but plans removals; a clean-install run must be verified before trusting it | `package-lock.json` root package entry |
| D10 | Generated PyInstaller artifacts tracked in git, incl. `agent_build/desktop_agent/myraa-agent.exe` | `git ls-files agent_build/**` |
| D11 | `.claude/settings.local.json` tracked (machine-specific settings) | `git ls-files` |
| D12 | No CSP in `index.html`; no `will-navigate` guard in Electron main | `index.html`, `electron/main.cjs` |
| D13 | No CI workflows despite test script existing | no `.github/` directory |

### Suspected risks (unverified — label as such)

| # | Risk | Why suspected |
|---|---|---|
| R1 | Task terminal states not immutable: `AgentTaskManager.handleEvent` sets `status` unconditionally, so a late event could overwrite `completed` | `agent/task-manager.ts:146-178` — no terminal-state guard; not covered by tests |
| R2 | Two concurrent tasks can both drive mouse/keyboard (no desktop lock) | No lock implementation found anywhere |
| R3 | Voice/chat/task state contradictions (barge-in, overlapping speech) | Not inspected in depth — **unverified** |
| R4 | `server.ts` at 4,048 lines is a change-risk hotspot (routes, agent loop, sidecar lifecycle, WS in one file) | Structural observation |
| R5 | Python sidecar has zero tests; OCR/browser/fallback chains untested | No `test_*.py` outside `node_modules` |

---

## 7. Exact test/build results

All commands run from `C:\MY PROJECTS\Addy AI` on 11 Nov 2026.

| Check | Command | Result |
|---|---|---|
| Type check | `npm run lint` (`tsc --noEmit`) | ✅ **PASS** — no output, exit 0 |
| Unit tests | `npm test` (`tsx --test --test-force-exit tests/*.test.ts`) | ✅ **PASS** — `tests 114 / pass 114 / fail 0 / skipped 0` (latest, after P1-4) |
| Production build | `npm run build` (`vite build` + esbuild bundle) | ✅ **PASS** — `dist/assets/index-*.js 521.90 kB` (5.97 s), `dist/server.cjs 382.7 kb` (65 ms). ⚠️ Warnings: chunk >500 kB; duplicate `description` key (D8) |
| Lockfile sanity | `npm ci --dry-run` | ✅ exit 0 (dry run only; node_modules untouched). Plans removal of stale packages (D9) |
| Python tests | *(none exist for project code)* | ⚠️ **NOT RUN** — no test files in `desktop_agent/` |
| Lint (ESLint/prettier) | *(not configured)* | ⚠️ **DOES NOT EXIST** — `lint` script is `tsc --noEmit` |
| CI | *(no workflows)* | ⚠️ **DOES NOT EXIST** |
| Secret scan (tracked tree) | `git grep` for key patterns on `origin/main` | ✅ clean — only fake `AIzaTESTKEY_*` placeholders in `tests/gemini-key-pool.test.ts` |

Test files: `adapter`, `agent-loop-integration`, `agent-task-manager`, `execution`, `failure`, `gemini-key-pool`, `memory_and_desktop`, `mcp`, `permission`, `proactive` (all passing).

---

## 8. Dependencies between implementation tasks

``` text
P1-A typed provider failures (loop.ts)
   └─► P1-B plan validation + explicit bounded fallback (needs A: error must surface first)
P1-C operation IDs + safe retry / execution_unknown (server.ts callDesktopAgent)   [independent of A/B]
   └─► P2 crash recovery & resume (Phase 2 needs C: never resume an unknown outcome)
P1-D execution locks (desktop/browser)                                             [independent of A/B/C]
P1-E cancellation determinism + immutable terminal states                          [needs nothing; feeds P2]
P2  SQLite task journal (depends on E for stable states, on C for outcome types)
P3  Central permission enforcement on desktop path (depends on C for correlation/audit IDs)
   └─► any new powerful tools (gated by P3)
P4  Memory retrieval-before-planning (depends on A/B so planning failures don't poison retrieval)
P5  Evidence-based verification (depends on A/B/C so failures are honest)
CI  (depends only on tests existing — can start immediately after P1)
```

---

## 9. First five recommended implementation tasks

1. **[P1-A] Typed provider failures in `AgentLoop`** — ✅ **DONE & VERIFIED (see §10, P1-1)**
2. **[P1-B] Plan validation + explicit fallback** — ✅ **DONE & VERIFIED (see §10, P1-2)**
3. **[P1-C] Operation IDs + non-idempotent retry guard** — ✅ **DONE & VERIFIED (see §10, P1-3)**
4. **[P1-D] Desktop/browser execution lock** — introduce a single desktop-input lock (mouse/keyboard/active-window) and a browser-session lock with acquire-timeout, release-in-`finally`, and a "waiting for resource" task status; queue conflicting tasks, allow independent tasks to run concurrently. *Tests: second task queues; cancellation while waiting releases cleanly; executor failure does not leave the lock held.*
5. **[P1-E] Cancellation determinism hardening** — make terminal states immutable in `AgentTaskManager.handleEvent` (guard against post-terminal overwrites, R1), define behavior for queued-but-never-started aborts, and add tests for cancellation during shutdown and while waiting for a lock. *Tests: exactly one terminal state; no success event after abort.*

> Suggested first PR (per roadmap §18): tasks 1–2 + 3 together under
> `fix(agent): make execution failures and retries deterministic` — keep it narrow; no SQLite, no UI changes.

---

## 10. Phase 1 task tracker

| Task ID | Description | Status | Dependencies | Files changed | Tests run | Date updated |
|---|---|---|---|---|---|---|
| P1-1 | Typed provider failures in `agent/loop.ts` | **verified** | — | `agent/loop.ts`, new `providers/errors.ts`, new `tests/agent-provider-failure.test.ts` | `npm run lint` PASS; `npm test` PASS 73/73 (67 prior + 6 new); new file isolated run 6/6 PASS | 2026-11-11 |
| P1-2 | Plan validation + explicit goal-aware fallback | **verified** | P1-1 | `agent/loop.ts`, new `agent/plan-validator.ts`, new `tools/desktop-tools.ts` (moved verbatim from `server.ts`), `server.ts` (−1062/+1 import), `tests/agent-plan-validation.test.ts` (new), `tests/agent-loop-integration.test.ts` + `tests/agent-provider-failure.test.ts` (demoTool→readFile adaptation) | `npm run lint` PASS; focused `tests/agent-plan-validation.test.ts` PASS 13/13; `npm test` PASS **86/86**; `npm run build` PASS | 2026-11-11 |
| P1-3 | Operation IDs + safe retry (desktop-agent path) | **verified** (incl. review fix P1-3a: eviction-safe reconciliation) | P1-2 (per user-approved order) | new `tools/desktop-agent-client.ts`, `server.ts` (callDesktopAgent rewrite, instance-id tracking, executor + route outcome propagation), `agent/loop.ts` (no-retry guard + `ToolExecutionResult`), `agent/task-manager.ts` (`ToolExec` type), new `desktop_agent/operations.py` (tiered: full → tombstone → watermark), `desktop_agent/main.py` (additive op_id/status/dedup/`/operations/{op_id}` + `evicted`/`last_eviction_at`), new `tests/desktop-agent-client.test.ts` | `npm run lint` PASS; focused `tests/desktop-agent-client.test.ts` PASS **19/19**; `npm test` PASS **105/105**; `npm run build` PASS (only pre-existing D8 warning); `python -m py_compile` PASS; `desktop_agent.main` import smoke PASS | 2026-11-11 |
| P1-4 | Fix D7: permission enforcement at desktop execution boundary | **verified** | P1-3 | `server.ts` (callDesktopAgent permission gate + unknown-tool fail-closed + HTTP 403 + grant/revoke/check endpoints), `execution/permission-service.ts` (DESKTOP_CONTROL category + action+target-bound grants), `execution/types.ts` (category + PermissionService grant methods), new `tools/desktop-permission.ts`, new `tests/desktop-permission.test.ts` | `npm run lint` PASS; `tests/desktop-permission.test.ts` PASS 9/9; `npm test` PASS **114/114**; `npm run build` PASS | 2026-11-11 |
| P1-5 | Desktop/browser execution locks | not_started | P1-4 | — | — | 2026-11-11 |
| P1-6 | Cancellation determinism hardening | not_started | P1-5 | — | — | 2026-11-11 |

### P1-1 record (verified)

- **Objective:** a provider failure fails the task with a typed reason; never `""`, never a fake plan, never a tool side effect.
- **Changes:** `generateCompletion()` now throws `ProviderFailureError` (kind classified via existing `isKeyError`/`isCapacityError` helpers — single source of truth); planning failure → `failed` state + `failed` event with `phase`/`kind`, returns before any plan or tool runs; self-repair provider failure → `console.warn` with typed kind (retry continues with original step, behavior preserved); summary provider failure → explicit "model summary unavailable (kind)" text instead of a fabricated success sentence.
- **Acceptance criteria:** provider outage visible as provider failure ✅; no unintended fallback tool executed ✅; user receives useful explanation + task is failed (safe retry path = `agent_run` again) ✅; existing 67 tests still pass ✅.

### P1-2 record (verified)

- **Objective:** no tool ever executes from an invalid plan; malformed/empty/incomplete model output produces a typed `PlanValidationError` (distinct from `ProviderFailureError`); invalid plans get ONE bounded, explicit, goal-aware replan or fail with concrete reasons; the generic `searchFiles` fallback is gone.
- **Single-source decision (no parallel registry):** `DESKTOP_TOOLS`, `REACH_TOOLS`, `REACH_FUNCTION_DECLARATIONS`, `DESKTOP_FUNCTION_DECLARATIONS` moved **verbatim** from `server.ts` (lines 119–1180) into `tools/desktop-tools.ts` — verified byte-identical except the 4 `const`→`export const` prefixes. `server.ts` now imports them (+1/−1062 lines, verified via `git diff --numstat` and `Compare-Object`). Validation uses these real declarations; no schema was invented. (8 browser-alias tools have no Gemini declaration — they get structural validation only, documented in code.)
- **Validation coverage:** malformed/empty JSON · non-object plan · missing/non-array steps · empty plan · step not an object · missing/empty tool name · unknown tool (against `DESKTOP_TOOLS`) · non-object args · missing required args · wrong arg types · unknown arg keys. All problems across all steps are collected and thrown as ONE error — a partially valid plan is never returned.
- **Bounded replan:** `MAX_PLAN_ATTEMPTS = 2` (1 initial + 1 explicit replan containing the typed kind, concrete details, the truncated previous response, and the unchanged original goal). After exhaustion → task `failed` with details; no fallback plan.
- **Self-heal hardening:** malformed fix JSON → explicit warn (not mislabeled as provider failure); fix suggestions with unknown tools or invalid args are rejected with a warn instead of being applied.
- **Disclosed test adaptations (2 files):** `demoTool` (never a real tool) replaced with `readFile` + schema-valid args in `tests/agent-loop-integration.test.ts` and `tests/agent-provider-failure.test.ts` — self-heal intent, assertions and counts preserved (fail→repair→succeed flow unchanged; only tool name/args adapted to pass real validation). All other existing tests untouched.
- **Acceptance criteria:** invalid plans → zero tool executions (3 regression tests) ✅; bounded replan proven by exact plan-call counts (1 when valid, 2 when corrected, 2 when exhausted) ✅; provider outage during replan still typed P1-1 failure ✅; `searchFiles` fallback absent ✅; lint/build/full suite green ✅.

### P1-3 record (verified)

- **Objective:** every desktop-agent operation carries a unique operation ID end-to-end; outcomes are explicitly classified as `completed | failed | cancelled | execution_unknown`; NO blind retry after an ambiguous timeout; non-idempotent operations are never re-dispatched on an unknown outcome.
- **Protocol (additive, no sidecar rewrite):** `POST /execute` now accepts `op_id` and returns `op_id`, `status (completed|failed|in_progress)`, `deduplicated`, `instance_id`; `/health` reports a per-process `instance_id`; new `GET /operations/{op_id}` returns the recorded outcome for reconciliation. All response fields are defaulted, so legacy callers without `op_id` keep working (tested).
- **Idempotency on the sidecar:** new `desktop_agent/operations.py` — thread-safe, in-memory registry. `/execute` **claims the op ID before dispatch**; a duplicate op ID replays the recorded result (`deduplicated: true`) and never enters the tool handler twice (in-progress duplicates are refused with `status=in_progress`, which the bridge maps to `execution_unknown`). **Tiered bounded retention:** (1) in-progress entries + newest 1000 finished full records (payload intact; in-progress never compacted) → (2) newest 5000 compact **tombstones** (`op_id → status`, payload dropped — a duplicate here still replays its outcome as `evicted: true`, never re-executes) → (3) only a tombstone drop is a true eviction, stamped in a `last_eviction_at` **watermark** (set under the lock *before* the record is removed).
- **Retry decision logic (single place):** new `tools/desktop-agent-client.ts` — pure client + classification, no task manager, no parallel subsystem. Re-dispatch happens ONLY when *proven never executed*: (a) connect-time error codes (`ECONNREFUSED`/`ENOTFOUND`/…) — connection never established; or (b) ambiguous failure → reconciliation shows `not_found` on a **reachable sidecar whose instance ID is unchanged since dispatch** AND whose **eviction watermark** proves no record was forgotten after this dispatch (watermark `null`, or ≤ `dispatchedAt − 2 s` safety margin; the dispatch time is captured before the request goes out; a sidecar build that doesn't report the watermark is treated as unknown). That retry runs exactly once, through `onBeforeRetry` (server re-verifies/respawns the agent), and **preserves the original op ID** so the sidecar dedup registry is a second line of defence. `server.ts`'s old blind `catch → respawn → retry` is gone.
- **Ambiguous outcomes → `execution_unknown`** with the uncertainty explained and the op ID preserved: timeout after dispatch, socket reset mid-request, 5xx, unreadable 200 payload, in-progress duplicate, sidecar restart (new `instance_id` vs. the dispatch-time one), or unreachable-for-reconciliation. Never retried, never marked as a definite failure. `cancelled` is returned only where it can be proven nothing executed (abort before dispatch, or abort + registry miss on an unchanged sidecar).
- **Loop-level guard:** `AgentLoop` breaks its retry/self-heal loop when a step result is `execution_unknown` or `cancelled` (typed through `ToolExec`/`ToolExecutionResult`) — otherwise the generic MAX_RETRIES path would have re-executed the very operation the bridge refused to retry. Failure events now carry `outcome` + `opId`.
- **`execution_unknown` surfaced:** `callDesktopAgent` returns it; `agentTaskManager` propagates it; `/api/desktop/execute` includes `outcome`/`opId` in error JSON; logs contain `op=` / `AGENT_*_UNKNOWN` lines (tested).
- **Exactly-once limitations (explicit, not over-claimed):**
  - The registry is **in-memory only**: a sidecar crash/restart loses it, and the bridge then reports `execution_unknown` (detected via `instance_id` change) — it never assumes a registry miss after restart means "never ran". Exactly-once across crashes is **NOT guaranteed**.
  - It is a **tool-outcome record, not a side-effect journal**: it does not persist external effects (keystrokes, clicks, files). No crash-durable dedup exists today.
  - **Durable dedup (DB-backed operation journal) is a documented follow-up**, deliberately not implemented here (would require DB schema work beyond this task). Documented in `desktop_agent/operations.py` module docstring and `tools/desktop-agent-client.ts` header.
  - ~~A rare false-negative window existed: an evicted-but-same-instance registry miss was treated as "never executed" → false safe-to-retry.~~ **Fixed (review finding P1-3a, verified 11 Nov 2026):** a miss is proof ONLY with supporting evidence — `not_found` + unchanged reachable instance + watermark showing nothing forgotten since this dispatch (else → `execution_unknown`, never retried). A **tombstoned** outcome (`evicted: true`) is still a known outcome: it reconciles and dedups, never re-executes. The bounded guarantee is stated exactly: *an outcome is replayable while it is among the newest 1000 finished full records or 5000 tombstones; beyond that it is `execution_unknown` — never silently "not executed".* In-progress entries are still never compacted.
- **Regression tests (all 8 required + eviction edge cases + extras, `tests/desktop-agent-client.test.ts`, 19 tests):** 1 normal success · 2 definite pre-execution failure (HTTP 422 + protocol `failed`) · 3a timeout-before-execution → proven never executed (retryable) · 3b safe retry executes once with the SAME op ID · 4 timeout-after-execution → reconciled `completed`, no re-execution · 5 duplicate op ID → replayed, 1 execution · 6 non-idempotent unknown outcome → `execution_unknown`, never retried · 7 sidecar restart mid-op → `execution_unknown`, no retry · 8a explicit `reconcileDesktopOperation` + 8b internal reconciliation via the original op ID · **9a completed + tier-1 eviction (tombstone) → reconciles `completed`/`evicted`, no re-execution** · **9b completed + fully forgotten (watermark postdates dispatch) → `execution_unknown`, `onBeforeRetry` never invoked** · **9c explicit reconcile: eviction after dispatch ⇒ `provenNeverExecuted=false`; no dispatch time ⇒ not proven; unreachable status endpoint ⇒ not proven** · **9d duplicate op ID after eviction → dedup replay, executions stays 1** · **9e legitimate safe retry still works when the watermark predates the dispatch** · cancelled-before-dispatch · `isDefinitelyNotExecuted` classification unit test · agent loop never re-runs an `execution_unknown` step (exactly 1 exec, 0 self-repair prompts) · **Python end-to-end against the real FastAPI app** via `TestClient`: dedup + **tier-1 compaction → tombstone recall (`evicted: true`, no watermark), duplicate-after-eviction replay, tier-2 overflow → watermark stamped + `found:false` with watermark on the status endpoint** (skips if python missing).
- **Acceptance criteria:** 8 required scenarios covered and passing ✅; eviction edge cases (completed+eviction, reconciliation after eviction, retry after eviction, duplicate after eviction, genuine safe retry) each have a regression test ✅; no blind retry anywhere (client single-retry-only on proven-never-executed incl. watermark proof; loop-level guard) ✅; op ID propagated Node → Python → response → logs → reconciliation ✅; `cancelled`/`execution_unknown` distinct and explained ✅; permissions untouched (no permission code modified) ✅; no sidecar rewrite, no parallel task manager ✅; lint / focused (19/19) / full suite (**105/105**) / build / py_compile / import smoke all green ✅.

---

### P1-4 record (verified)

- **Objective:** close D7 — every privileged desktop operation passes through `DefaultPermissionService` at the execution boundary; the HTTP, agent-loop, WebSocket, proactive and internal paths can no longer bypass authorization.
- **Single enforcement point:** `callDesktopAgent` in `server.ts`. It is the one function every desktop-agent execution goes through (HTTP route, Gemini chat tool calls, Gemini Live WebSocket, `AgentTaskManager` executor, proactive daemon, plan-time `locateElement`, auto-start toggle, `getActiveWindow`). The permission check runs **before** `ensureDesktopAgent`/dispatch, so a denied or approval-required operation never spawns or touches the Python sidecar. Unknown tools fail closed (`DESKTOP_TOOLS` allow-list + `desktopPermissionFor` returning `null`).
- **Mapping:** new `tools/desktop-permission.ts` — `desktopPermissionFor(tool, args) → { category, resource, operation } | null`. File tools → `FILE_READ`/`FILE_WRITE`/`FILE_DELETE` with the path as resource (so existing trusted-workspace boundary applies); `runPythonScript` → `TERMINAL_EXECUTE` with `operation = "python <path>"` (classified by the existing terminal classifier); everything else (mouse, keyboard, screenshot, browser, windows, clipboard, system info, power/auto-start) → `DESKTOP_CONTROL` (new category, `ALLOW` by default) so existing allowed operations keep working while still flowing through the central service. Power actions retain their Python-side two-step token gate.
- **Approval model (action+target bound):** `DefaultPermissionService` gained `grantApproval`/`revokeApproval`/`hasApproval` with `once` (consumed on first use) and `session` scopes. The grant key is `category|operation|resource`, so a grant for one action/target never covers another (scope enforcement). `checkPermission` upgrades `ASK → ALLOW` only when a matching grant exists. Model-generated reasoning is never treated as approval (no auto-grant anywhere). Grants are not auto-created when the UI is unavailable — `ASK` stays `ASK` and the operation is blocked.
- **HTTP surface:** `/api/desktop/execute` returns 403 for permission denials (with `outcome`/`opId`); new `/api/permissions/{grant,revoke,check}` endpoints expose the approval API. P1-3 operation IDs/outcomes preserved (denials return `outcome: "failed"` with `opId`, never `execution_unknown`).
- **Tests (9 new, `tests/desktop-permission.test.ts`):** file read inside/outside trusted workspace; deleteFile mapping; unknown tool → null; approval required before approval; approved after grant; scope enforcement; once-consumption; revoke.
- **Acceptance criteria:** direct HTTP/agent-loop/WS paths all flow through `callDesktopAgent` and thus the permission gate ✅; denied operation → zero Python executions (permission check precedes dispatch) ✅; approval-required blocked before approval ✅; approved after grant ✅; scope enforced ✅; unknown tool rejected ✅; existing workspace restrictions preserved ✅; existing allowed operations preserved ✅; P1-3 op IDs/outcomes preserved ✅; no parallel permission system (extended `DefaultPermissionService`) ✅; no auto-approval without UI ✅; lint / full suite (114/114) / build green ✅.
- **Unresolved risks:** power actions and auto-start currently map to `DESKTOP_CONTROL` (ALLOW by default) rather than `SYSTEM_CHANGE` (DENY) so the existing two-step token flow keeps working; tightening these to require explicit approval is deferred to Phase 3 (unified permission policy covering all roadmap categories). The in-memory grant store is process-local and lost on restart (consistent with the in-memory operation registry; durable approval persistence is a follow-up). Full end-to-end HTTP/WS integration tests against a running server are not yet in the suite (server startup requires the sidecar/Node 22 environment); enforcement is verified at the component boundary.

---


- [x] Current branch and commit confirmed
- [x] Dependencies installed state recorded (`node_modules` present; `npm ci --dry-run` exit 0)
- [x] Existing tests run and results recorded (67/67 pass)
- [x] Type check, build run and results recorded (both pass, warnings noted)
- [x] Electron BrowserWindow and preload security settings inspected (5.4 base verified)
- [x] Privileged tools mapped to their current permission check (§2 two-path finding, D7)
- [x] Task lifecycle and sidecar request flow mapped (§2, D5/D6)
- [x] Confirmed defects separated from suspected risks (§6)
- [x] Prioritized backlog produced (§9)

**Baseline established. Awaiting approval before Phase 1.**
