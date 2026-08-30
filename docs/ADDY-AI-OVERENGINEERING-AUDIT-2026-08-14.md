# Addy AI v3 — Over-Engineering Audit (2026-08-14)

- **Project:** Addy AI v3 (`C:\MY PROJECTS\Addy AI`)
- **Date:** 2026-08-14
- **Scope:** Complexity and dead code only. Correctness bugs, security, and performance are deliberately out of scope.
- **Method:** whole-tree scan (not a diff); every finding verified against actual callers via repo-wide greps, never inferred. The complete UI-reachable endpoint list was extracted from `src/` and used to determine what is genuinely live. A prior audit (`Addy AI-OVERENGINEERING-AUDIT.md`, 2026-08-03) still applies and is largely unfixed; its findings are folded in and re-verified below. The one large subsystem it missed — the `execution/` engine — is finding 1.
- **Nothing was deleted.** This is a ranked list of cuts, biggest first.

## Legend

- `delete` - dead code or speculative feature, replacement is nothing.
- `stdlib` - hand-rolled thing the standard library already ships.
- `native` - dependency doing what the platform already does.
- `yagni` - abstraction with one implementation, feature nobody calls.
- `shrink` - same logic, fewer lines.

## Live surface (verified)

The React app calls exactly these endpoints — anything served by the backend but absent from this list is UI-dead:

`/api/agent-health`, `/api/agent/start`, `/api/artifacts`, `/api/artifacts/generate`,
`/api/chat/text`, `/api/config`, `/api/config/apikey`, `/api/image/generate`,
`/api/memories`, `/api/models`, `/api/orchestration/agents`, `/api/orchestration/delegate`,
`/api/phasex/sessions`, `/api/ping`, `/api/prompt`, `/api/providers`,
`/api/providers/health`, `/api/providers/model`, `/api/providers/switch`,
`/api/settings`, `/api/terminal/execute`, `/api/workspace/detect`,
`/api/workspace/editors`, `/api/workspace/recent`

## Executive summary

| Cut | What | Verified evidence | Est. lines |
|-----|------|-------------------|-----------|
| 1 | `execution/` engine + `/api/execution/*` routes + boot spawn | no UI caller; UI surface list above has zero execution endpoints | ~1,654 src + 535 test |
| 2 | `local-agent.js` (orphaned standalone agent) | only self/UI-hint references | ~450 |
| 3 | `src/lib/desktop/ActionPlanner.ts` | zero importers; `DesktopDispatcher` is live | ~226 |
| 4 | `wake-harness.ts` + `smoke-execution.ts` + `probe.ts` | orphan dev harnesses, no importers | ~260 |
| 5 | `Live2DRenderer` + RendererManager live2d branch | always falls back; `public/` ships no model | ~90 |
| 6 | `TaskClassifier` + `localClassify` | `classifyTask` zero callers; localClassify's only consumer | ~84 |
| 7 | `ArtifactPlanner` + `/api/artifacts/plan` + `generate-from-spec` | UI calls only `/api/artifacts` + `/api/artifacts/generate` | ~130 |
| 8 | `server_transcripts.ts` | no reader of transcript files; PhaseX vault sessions duplicate | ~174 |
| 9 | `/api/proxy` regex scraper | no frontend caller (UI uses `/api/web-proxy`) | ~88 |
| 10 | `run_agent.py` | orphan launcher, self-ref only | ~90 |
| 11 | `ProviderManager.chat()` + unused fallback names | zero chat callers; config/status only | ~70 |
| 12 | LTM JSON subsystem + routes | no UI caller; internal reads hit empty store | ~45 |
| 13 | `getProjectContext` family | imported at agent/loop.ts:1, never invoked | ~60 |
| 14 | `WorkspaceWatcher` | imported server.ts:49, never instantiated | ~50 |
| 15 | `searchToolCalls` + `getSessionsByDateRange` | zero callers / import-only | ~45 |
| 16 | `@xenova/transformers` for embeddings | GoogleGenAI SDK already provides embeddings | ~8 + dep |
| 17 | `uuid` dependency | Node ships `crypto.randomUUID` | 2 sites + dep |
| 18 | duplicate `cosineSimilarity` | byte-identical copy in `memory/store.ts` | ~11 |
| 19 | `LAYER_PRIORITY` + `layerRank` indirection | feeds one sort + one tag | ~8 |
| 20 | `pygetwindow` + `python-multipart` | pygetwindow now comment-only; multipart unused | -2 deps |

**net: ~-4,000 lines (incl. tests), -5 dependencies.**

---

## 1. `execution/` engine — UI-dead subsystem (~1,654 lines + 535 test lines)

**Tag:** delete

**What:** The entire `execution/` tree — `opencode-adapter.ts` (480), `execution-service.ts` (312), `types.ts` (266), `opencode-process.ts` (206), `mcp-service.ts` (106), `permission-service.ts` (94), `opencode-config.ts` (53), `specialist-registry.ts` (52), `code-intelligence-service.ts` (35), `workspace-context.ts` (27), `agent-registry.ts` (12), `index.ts` (11) — plus the 14 routes `/api/execution/*` in server.ts (846-960) and the boot-time spawn of the OpenCode subprocess (server.ts:3329 `executionService.start()`). The five test files (adapter/execution/failure/mcp/permission, 535 lines) test only this tree.

**Evidence:** The complete UI endpoint list above contains zero `/api/execution` callers (no `api/execution`, `git-status`, `lsp`, `mcp` anywhere in `src/`). The only non-route consumers are dev harnesses `probe.ts` and `smoke-execution.ts` (finding 4) and the tests. The OpenCode subprocess spawned on `:4096` at every boot is health-checked and auto-restarted to serve endpoints nobody calls.

**Replacement:** nothing. Delegated coding is already covered by the live `/api/orchestration/delegate` (AgentExecutor) and `/api/agent/start` (agent/loop.ts), both of which use `@google/genai` directly.

## 2. `local-agent.js` — orphaned standalone agent (~450 lines)

**Tag:** delete

**What:** A self-contained Node agent at the repo root.

**Evidence:** References are its own comments (`local-agent.js:7,10`) and the prior audit doc. The UI hint string cited in the Aug 3 audit is gone from `BrowserAgent.tsx`.

**Replacement:** nothing. The server talks to the Python `desktop_agent` sidecar; the React app talks to the server.

## 3. `src/lib/desktop/ActionPlanner.ts` (~226 lines)

**Tag:** delete

**What:** An action-planning module under `src/lib/desktop/`.

**Evidence:** Repo-wide grep finds no importer. `DesktopDispatcher` (the live path, used by `DesktopPanel.tsx`) imports only from itself.

**Replacement:** nothing.

## 4. `wake-harness.ts` + `smoke-execution.ts` + `probe.ts` (~260 lines)

**Tag:** delete

**What:** Three root-level dev harnesses: `wake-harness.ts` (173, wake-word test), `smoke-execution.ts` (53, execution smoke test), `probe.ts` (34, SDK probe).

**Evidence:** No imports anywhere outside themselves and docs. `smoke-execution`/`probe` exist only to exercise the subsystem in finding 1.

**Replacement:** nothing (move into `tests/` if the smoke coverage is wanted before deleting finding 1).

## 5. `Live2DRenderer` + RendererManager live2d branch (~90 lines)

**Tag:** delete

**What:** `src/avatar/renderer/Live2DRenderer.ts` — a Live2D renderer that always degrades to PixiJS. `RendererManager.ts:9` unconditionally constructs it, checks availability, and swaps on failure.

**Evidence:** The failure path is guaranteed: `public/` contains only `placeholder-girl.html` — no `models/Addy/Addy.model3.json`, no `live2dcubismcore.min.js`. `checkModelExists` and `loadCoreEngine` always fail.

**Replacement:** instantiate `PixiJSRenderer` directly in `RendererManager`; delete Live2D class + stale exports.

## 6. `TaskClassifier` + `localClassify` (~84 lines)

**Tag:** delete

**What:** `orchestration/TaskClassifier.ts` (`classifyTask`, ~64) and `providers/LocalProvider.ts:46-65` (`localClassify`, ~20).

**Evidence:** `classifyTask` appears nowhere except its own definition. `/api/orchestration/delegate` calls `delegateToAgent` directly. `localClassify`'s sole consumer was `TaskClassifier`.

**Replacement:** nothing. `AgentRegistry` + `AgentExecutor` stay (live routes).

## 7. `ArtifactPlanner` + `/api/artifacts/plan` + `generate-from-spec` (~130 lines)

**Tag:** yagni

**What:** The "generate from structured spec" path: `ArtifactSpec`/`ArtifactSection` types, `ArtifactPlanner.ts`, and server routes at server.ts:985,998.

**Evidence:** UI list shows only `/api/artifacts` and `/api/artifacts/generate`.

**Replacement:** keep `ArtifactManager` + the five `generators/` and `/api/artifacts/generate`; delete the spec/planner path only. Keeps `pdfkit`, `docx`, `exceljs`, `pptxgenjs`, `archiver` as still-used deps.

## 8. `server_transcripts.ts` (~174 lines)

**Tag:** yagni

**What:** A session-transcript archive (`transcripts/<date>/session-*.json|md` + `index.json`) written on every live session close.

**Evidence:** No UI or API consumer reads these files. PhaseX already archives every session in the vault (`memory/sessions/<date>/session-*.json` + `.log` with full USER:/ADDY: dialogue). `formatSessionSummary` (server.ts:3132) exists only to feed the PhaseX session summary, which the PhaseX flow already produces.

**Replacement:** delete the transcript write path; use `phasex_sessions.summary` for the summary string. This also removes the third of three summary writers (transcript.summary, phasex_sessions.summary, vault `.summary.md`).

## 9. `/api/proxy` — regex scraper (~88 lines)

**Tag:** delete

**What:** `GET /api/proxy?url=...` fetches a page and regex-extracts titles/headings/links/paragraphs/buttons.

**Evidence:** No frontend caller; the browser tooling uses `/api/web-proxy`. Also removes the SSRF surface noted in the bug report.

**Replacement:** nothing.

## 10. `run_agent.py` (~90 lines)

**Tag:** delete

**What:** Standalone Python entry point at the repo root.

**Evidence:** Only self-reference (line 10). No start scripts reference it.

**Replacement:** nothing (launch `desktop_agent.main` directly).

## 11. `ProviderManager.chat()` + unused fallback names (~70 lines)

**Tag:** shrink

**What:** `providers/ProviderManager.ts:64-136` — a model-level + cross-provider auto-failover `chat()` chain, plus `FALLBACK_CHAIN` entries `'openai'`, `'anthropic'`, `'ollama'` that are never registered.

**Evidence:** server.ts uses `providerManager` only for `registerProvider`/`init`/status/switch routes (505-550, 729-740). Zero call sites for `providerManager.chat()`. The only `getActiveProvider` caller was the dead `TaskClassifier` (finding 6). Chat endpoints call `GeminiProvider`/`OpenRouterProvider` directly.

**Replacement:** keep register/status/switch; delete `chat()` and the unregistered fallback names (~70 lines). Also collapses the third of three model-fallback loops (see finding 12 note).

## 12. LTM JSON subsystem + `/api/phasex/ltm` routes (~45 lines)

**Tag:** delete

**What:** `getLongTerm`/`setLongTerm`/`addLongTermEntry` (server_phasex.ts:665-711) + GET/POST `/api/phasex/ltm/:category` (server.ts:621-632).

**Evidence:** No UI caller (UI list has only `/api/phasex/sessions`). The internal reads in `buildRecallContext` (server_phasex.ts:708-711) always hit an empty/absent store.

**Replacement:** delete routes + accessors; recall returns the same empty sections it returns today.

## 13. `getProjectContext` / `formatProjectContextSummary` / `ProjectContext` (~60 lines)

**Tag:** delete

**What:** memory/retriever.ts:44-103 — context object builder and markdown formatter.

**Evidence:** Only import is `agent/loop.ts:1`; `loop.ts` never calls either (only `storeMemory` is used). The live path is `getRelevantProjectMemories`.

**Replacement:** nothing; drop the unused imports in `loop.ts`.

## 14. `WorkspaceWatcher` (~50 lines)

**Tag:** delete

**What:** workspace/WorkspaceWatcher.ts — a file watcher class with change/create/delete events.

**Evidence:** Imported at server.ts:49 alongside the workspace helpers; grep shows no instantiation anywhere. Live `/api/workspace/*` routes use `detectProject`, `findRecentProjects`, `detectEditors`, `openInEditor`.

**Replacement:** nothing (unused type exports go with it).

## 15. `searchToolCalls` + `getSessionsByDateRange` (~45 lines)

**Tag:** delete

**What:** server_phasex.ts:617 (`searchToolCalls`) and server_phasex.ts:783 (`getSessionsByDateRange`).

**Evidence:** `searchToolCalls` zero callers; `getSessionsByDateRange` imported at server.ts:34, never invoked.

**Replacement:** nothing.

## 16. `@xenova/transformers` for embeddings (~8 lines + 60 MB dep)

**Tag:** native

**What:** memory/embeddings.ts — loads a local ONNX MiniLM pipeline for `computeEmbedding`.

**Evidence:** The app already depends on `@google/genai` and sends every chat/memory to Gemini with the same key; the SDK exposes `models.embedContent`. A 60 MB ONNX runtime + runtime model download exists for one function. (Tradeoff: local = offline + free; if offline embeddings are a hard requirement, keep it — otherwise the API call is strictly simpler.)

**Replacement:** `ai.models.embedContent` via the existing SDK.

## 17. `uuid` dependency

**Tag:** stdlib

**What:** `import { v4 as uuid } from 'uuid'` at artifacts/ArtifactManager.ts:4 and memory/store.ts:2.

**Evidence:** Node ≥19 ships `crypto.randomUUID()`. Two call sites.

**Replacement:** `randomUUID()` from `node:crypto`; drop the dep.

## 18. Duplicate `cosineSimilarity` (~11 lines)

**Tag:** stdlib/shrink

**What:** memory/store.ts:138 — byte-identical copy of memory/embeddings.ts:30.

**Evidence:** Same dot-product/norm body.

**Replacement:** delete the copy, import from `./embeddings` (store.ts already imports `embedBuffer`/`bufferToEmbed` from there).

## 19. `LAYER_PRIORITY` + `layerRank` indirection (~8 lines)

**Tag:** shrink

**What:** memory/retriever.ts:13-30 — priority map + classifier + wrapper used in exactly one sort.

**Replacement:** keep `memoryLayer` (display vocabulary), inline `PRIORITY[memoryLayer(m.category)] || 0` in the comparator; delete `LAYER_PRIORITY`/`layerRank`.

## 20. `pygetwindow` + `python-multipart` dependencies

**Tag:** delete

**What:** desktop_agent/requirements.txt entries.

**Evidence:** `pygetwindow` appears only in a comment (tools_windows.py:4); no API is imported or called. No multipart endpoint exists (`File`/`Form`/`UploadFile` absent).

**Replacement:** remove both entries.

---

## Checked and deliberately NOT cut

- `providers/` `GeminiProvider`/`OpenRouterProvider` + `/api/providers*` routes: called by DevPanel/SettingsPanel.
- `orchestration/AgentRegistry` + `AgentExecutor`, `agent/loop.ts`: `/api/orchestration/*` and `/api/agent/*` are UI-called.
- `workspace/` `detectProject`/`findRecentProjects`/`detectEditors`/`openInEditor`: `/api/workspace/*` UI-called (only the watcher is dead, finding 14).
- `artifacts/generators/*` + `ArtifactManager` + `archiver`: `/api/artifacts/generate` is UI-called.
- `tools/terminal.ts`, `tools/image-gen.ts`: `/api/terminal/*`, `/api/image/generate` UI-called.
- `desktop_agent/` Python sidecar: spawned and used by the server's desktop/watchdog flows.
- `memory/curator/`, `memory/retriever.ts` (live paths), `server_session_summary.ts`, `server_phasex.ts` (live paths): wired into startup/route logic.
- `database/`, `vault.ts`, `server_paths.ts`: core, live.
- npm deps `pdfkit`, `docx`, `exceljs`, `pptxgenjs`, `pixi.js`, `motion`, `lucide-react`, `express`, `ws`, `sql.js`, `dotenv`, `ollama` (LocalProvider is live for local-first chat): each has at least one real call site.

## Cross-cutting: three model-fallback loops, one provider

Beyond finding 11, the same Gemini key is wrapped in three parallel fallback systems: the inline `TEXT_CHAT_MODELS` retry loop (server.ts:1537-1660), `GeminiProvider.getFallbackModels()`, and `ProviderManager.chat()`'s model chain. All three exist to answer "what if this model 404s?" — consolidate to one list (e.g. the `ProviderManager` chain) and delete the others (~100 lines). This was the source of the "All models unavailable" failure fixed on 2026-08-14.

## Execution order

1. Finding 1 (execution engine + routes + boot spawn + 5 test files): pure deletion; verify no external client depends on `/api/execution/*`.
2. Findings 2-5, 9-10 (orphans + Live2D): pure deletions.
3. Findings 6, 12-15, 18-19 (phasex/retriever/local dead code): delete, then drop now-unused imports (agent/loop.ts:1, server.ts:34,49).
4. Findings 7, 8, 11-12 (routes + chat chain): route-level deletions; `tsc --noEmit` after.
5. Findings 16-17, 20 (deps): swap + prune `package.json`/`requirements.txt`.

## Verification after each step

- `npm run lint` (`tsc --noEmit`) passes.
- `npm run dev` boots, `/api/ping` answers, live session works end-to-end (transcripts/PhaseX flow in finding 8 must be re-tested).
- DevPanel/SettingsPanel load without console errors.
- Python sidecar: `python -m desktop_agent.main` still starts.

## Appendix: grep evidence (abbreviated)

```
/api/execution         -> (no matches in src/)
api/execution|git|lsp|mcp  -> src/: only /api/agent/*, /api/orchestration/* present
local-agent            -> local-agent.js:7,10 (self) + docs
run_agent              -> run_agent.py:10 (self)
classifyTask           -> orchestration/TaskClassifier.ts (definition only)
ActionPlanner          -> (no importers)
providerManager.chat   -> (no call sites; only register/status/switch in server.ts)
getProjectContext      -> agent/loop.ts:1 (import only)
WorkspaceWatcher       -> server.ts:49 (import only)
searchToolCalls        -> server_phasex.ts:617 (definition only)
getSessionsByDateRange -> server.ts:34 (import only)
pygetwindow            -> desktop_agent/tools_windows.py:4 (comment only)
multipart              -> (no matches in desktop_agent/*.py)
transcript files       -> (no readers in src/ or server)
```
