# Addy AI v3 — Over-Engineering Audit

- **Project:** Addy AI v3 (`C:\MY PROJECTS\Addy AI`)
- **Date:** 2026-08-03
- **Scope:** Complexity and dead code only. Correctness bugs, security, and performance are deliberately out of scope (covered by the companion `Addy AI-BUG-ANALYSIS-REPORT.md`).
- **Method:** whole-tree scan (not a diff); every finding verified against actual callers via repository-wide greps, never inferred. A prior audit draft claimed ~2,800 removable lines by counting UI-reachable endpoints as dead; this revision re-checked the frontend and found most of those endpoints are live, so the true number is lower.
- **Nothing was deleted.** This is a ranked list of cuts, biggest first.

## Legend

- `delete` - dead code or speculative feature, replacement is nothing.
- `stdlib` - hand-rolled thing the standard library already ships.
- `native` - dependency doing what the platform already does.
- `yagni` - abstraction with one implementation, feature nobody calls.
- `shrink` - same logic, fewer lines.

---

## Executive Summary

| Cut | What | Verified evidence | Est. lines |
|-----|------|-------------------|-----------|
| 1 | `local-agent.js` (orphaned standalone agent) | zero references in any script/config; only a UI hint string | ~450 |
| 2 | `run_agent.py` (orphaned launcher) | zero references; start scripts spawn `desktop_agent.main` | ~90 |
| 3 | `/api/proxy` scraper endpoint | no UI caller; frontend uses only `/api/web-proxy` | ~88 |
| 4 | `ArtifactPlanner` + 2 artifact routes | only `/api/artifacts/generate` is called by DevPanel | ~130 |
| 5 | `getProjectContext`/`formatProjectContextSummary`/`ProjectContext` | imported in `agent/loop.ts:1`, never invoked | ~72 |
| 6 | `autoCreateMemoryForAction` (7-case switch) | zero callers repo-wide | ~73 |
| 7 | `orchestration/TaskClassifier.ts` | `classifyTask` has zero callers | ~63 |
| 8 | `localClassify` in LocalProvider | sole consumer was the dead TaskClassifier | ~20 |
| 9 | `Live2DRenderer` + RendererManager branch | constructed every mount, always falls back (no model files) | ~60 |
| 10 | `WorkspaceWatcher` | imported at server.ts:47, never instantiated | ~50 |
| 11 | LTM JSON subsystem + its routes | files never written; recall reads an always-empty store | ~45 |
| 12 | `searchToolCalls` | zero callers | ~25 |
| 13 | `getSessionsByDateRange` | imported at server.ts:32, never called | ~20 |
| 14 | `shortTermStore` + accessors | no callers | ~15 |
| 15 | duplicate `cosineSimilarity` | byte-identical copy of `embeddings.ts:30` | ~11 |
| 16 | layer-priority indirection (3 funcs, 1 sort) | single call site | ~8 |
| Deps | `pygetwindow`, `python-multipart` | import-only / unused in FastAPI app | -2 deps |

**net: ~-1,200 lines, -2 Python dependencies.**

---

## 1. `local-agent.js` — orphaned standalone agent (~450 lines)

**Tag:** delete

**What:** A self-contained Node agent at the repo root.

**Evidence:** `Select-String` across all `.bat`, `.json`, `.md`, `.ts`, `.tsx` files finds zero references to `local-agent` except UI hint text in `BrowserAgent.tsx:1127` (`<code>node local-agent.js</code>` in an install-help panel).

**Replacement:** nothing. The server talks to the Python `desktop_agent` sidecar, and the React app talks to the server.

## 2. `run_agent.py` — orphaned launcher (~90 lines)

**Tag:** delete

**What:** Standalone Python entry point at the repo root.

**Evidence:** Only self-reference (line 10). `start-adj.bat` / `start-adj-silent.bat` launch `desktop_agent.main` directly, not this file.

**Replacement:** nothing.

## 3. `/api/proxy` — the regex scraper endpoint (~88 lines)

**Tag:** delete

**What:** `GET /api/proxy?url=...` fetches a page and regex-extracts titles/headings/links/paragraphs/buttons.

**Evidence:** No `fetch('/api/proxy')` anywhere in `src/`. The frontend's browser tooling uses `/api/web-proxy` (the iframe-able HTML proxy at `BrowserAgent.tsx:609`) and `/api/youtube-search` (`BrowserAgent.tsx:197`). `/api/proxy` exists only as a route definition (server.ts:1426). Note it is also the SSRF concern from the bug report, so cutting it removes the endpoint entirely.

**Replacement:** nothing.

## 4. `ArtifactPlanner` + `/api/artifacts/plan` + `/api/artifacts/generate-from-spec` (~130 lines)

**Tag:** yagni

**What:** The "generate from structured spec" path: `ArtifactSpec`/`ArtifactSection` types, `ArtifactPlanner.ts` (~4 KB), and two server routes that feed it.

**Evidence:** DevPanel calls `/api/artifacts` and `/api/artifacts/generate` only. No frontend code calls `/api/artifacts/plan` or `/api/artifacts/generate-from-spec`.

**Replacement:** keep `ArtifactManager` + the five `generators/` and the `/api/artifacts/generate` route (that path is genuinely UI-reachable); delete the spec/planner path only. This keeps `pdfkit`, `docx`, `exceljs`, `pptxgenjs`, `archiver` as still-used deps.

## 5. `getProjectContext` / `formatProjectContextSummary` / `ProjectContext` (~72 lines)

**Tag:** delete

**What:** `memory/retriever.ts:32-103` - a context object builder and its markdown formatter.

**Evidence:** The only import is `agent/loop.ts:1`, and `loop.ts` never calls either function (only `storeMemory` is used at loop.ts:243). The export block in retriever.ts also re-exports `getMemoriesByCategory`, which becomes import-cleanup once these die.

**Replacement:** nothing; `getRelevantProjectMemories` (the live path) is unaffected.

## 6. `autoCreateMemoryForAction` (~73 lines)

**Tag:** delete

**What:** `memory/retriever.ts:138-210` - a 7-case switch that auto-creates memories for `tool_execution`, `agent_task`, `file_modification`, `debug_session`, `git_commit`, `decision`, `bug_report`.

**Evidence:** Zero callers in the entire repository. A preview of an "action memories" feature that was never wired.

**Replacement:** nothing.

## 7. `orchestration/TaskClassifier.ts` (~63 lines)

**Tag:** delete

**What:** `classifyTask` - classifies a task as multi-file/single-file/reasoning/research via local model first, cloud fallback.

**Evidence:** `classifyTask` appears nowhere except its own definition (TaskClassifier.ts:16). `/api/orchestration/delegate` calls `delegateToAgent` directly (server.ts:661-666). The classifier was added as a Phase 3 "local-first" rework but nothing ever invoked it.

**Replacement:** nothing. `AgentRegistry` + `AgentExecutor` stay - both are used by the live `/api/orchestration/*` routes.

## 8. `localClassify` (~20 lines)

**Tag:** delete

**What:** `providers/LocalProvider.ts:46-65` - JSON-mode classification call into Ollama.

**Evidence:** Sole consumer was `TaskClassifier` (finding 7). With it gone, `localChat` and `localSummarize` remain (used by the chat router and content filter respectively).

**Replacement:** nothing.

## 9. `Live2DRenderer` + RendererManager branch (~60 lines)

**Tag:** delete

**What:** `src/avatar/renderer/Live2DRenderer.ts` (~2.3 KB) - a Live2D renderer that always degrades to PixiJS. `RendererManager.ts:9` unconditionally constructs it, checks availability, and swaps to `PixiJSRenderer` on failure.

**Evidence:** The failure path is guaranteed: `console.warn("[Live2DRenderer] Addy model files not found at", MODEL_PATH)` and "Cubism Core not loaded" are the only possible outcomes (no Live2D model assets ship in the repo - the avatar renders from video/Pixi). The class is never used successfully.

**Replacement:** instantiate `PixiJSRenderer` directly in `RendererManager`; delete the Live2D class, its `IRenderer`-conformance scaffolding if unused elsewhere, and the stale exports in `renderer/index.ts` / `avatar/index.ts`.

## 10. `WorkspaceWatcher` (~50 lines)

**Tag:** delete

**What:** `workspace/WorkspaceWatcher.ts` - a chokidar-style file watcher class with change/create/delete events.

**Evidence:** server.ts:47 imports it alongside the workspace helpers; grep shows no `new WorkspaceWatcher` / instantiation anywhere. The live `/api/workspace/*` routes use `detectProject`, `findRecentProjects`, `detectEditors`, `openInEditor` - not the watcher.

**Replacement:** nothing (the watcher's two unused type exports go with it).

## 11. LTM JSON subsystem + `/api/phasex/ltm` routes (~45 lines + 4 files)

**Tag:** delete

**What:** `memory/long_term/decisions.json`, `frequently_used.json`, `preferences.json`, `projects.json` (all empty), plus `getLongTerm`/`setLongTerm`/`addLongTermEntry` in `server_phasex.ts` and the GET/POST `/api/phasex/ltm/:category` routes in server.ts:449-454.

**Evidence:** The files are never written: the only writers are the LTM routes and `addLongTermEntry`, and neither has a frontend caller (no `api/phasex/ltm` anywhere in `src/`). `buildRecallContext` reads the store, which is permanently empty - the fallback behavior (`[]`/`{}`) is already the only observable behavior.

**Replacement:** delete routes + accessors + files; `buildRecallContext` returns empty long-term sections exactly as it does today.

## 12. `searchToolCalls` (~25 lines)

**Tag:** delete

**What:** `server_phasex.ts:589` - tool-call history search by tool name.

**Evidence:** Zero callers (definition only).

**Replacement:** nothing.

## 13. `getSessionsByDateRange` (~20 lines)

**Tag:** delete

**What:** `server_phasex.ts:750` - date-range session query.

**Evidence:** Imported at server.ts:32, never invoked (the session list route uses `listSessions`).

**Replacement:** nothing.

## 14. `shortTermStore` + accessors (~15 lines)

**Tag:** delete

**What:** `server_phasex.ts:616-631` - in-memory `Map` short-term memory with set/get/clear exports.

**Evidence:** No external callers; internal use only.

**Replacement:** nothing.

## 15. Duplicate `cosineSimilarity` (~11 lines)

**Tag:** stdlib/shrink

**What:** `memory/store.ts:109-119` - byte-identical copy of `memory/embeddings.ts:30-40`.

**Evidence:** Both bodies are the same dot-product/norm implementation.

**Replacement:** delete the store copy, import from `./embeddings` (store.ts already imports `embedBuffer`/`bufferToEmbed` from there).

## 16. Layer-priority indirection (~8 lines)

**Tag:** shrink

**What:** `memory/retriever.ts:13-18, 28-30` - `LAYER_PRIORITY` map + `memoryLayer()` classifier + `layerRank()` wrapper used in exactly one sort (getRelevantProjectMemories:118-123) and one display tag.

**Replacement:** keep `memoryLayer` (it is the feature's display vocabulary), inline `PRIORITY[memoryLayer(m.category)] || 0` in the comparator, delete `LAYER_PRIORITY`/`layerRank`.

## 17. `pygetwindow` dependency

**Tag:** delete (native)

**What:** `desktop_agent/tools_windows.py:4` imports it; nothing ever calls `getWindowsWithTitle` or any pygetwindow API.

**Evidence:** repo-wide grep of `pygetwindow|getWindowsWithTitle` returns exactly one match - the import line. `pyautogui` (already a dependency) owns window operations and is what the file actually uses (with win32gui for the foreground window).

**Replacement:** remove the import and the requirements.txt entry.

## 18. `python-multipart` dependency

**Tag:** delete (native)

**What:** requirements.txt entry for multipart form parsing.

**Evidence:** No `File(...)`, `Form(...)`, `UploadFile`, or multipart endpoint exists in the FastAPI app (grep across `desktop_agent/*.py`).

**Replacement:** remove the requirements.txt entry.

---

## Checked and deliberately NOT cut (UI-reachable or otherwise live)

These were candidates that greps cleared - do not suggest cutting them:

- `providers/` (ProviderManager, GeminiProvider, OpenRouterProvider): behind `/api/providers*` routes called by DevPanel/SettingsPanel; LocalProvider functions are live (finding 8 removed only `localClassify`).
- `orchestration/AgentRegistry` + `AgentExecutor`: `/api/orchestration/agents` and `/api/orchestration/delegate` are called by DevPanel.
- `agent/loop.ts`: `/api/agent/start` + `/api/agent/:id` + `/api/agent/:id/abort` are called by DevPanel.
- `workspace/` detection/launcher helpers: `/api/workspace/detect|recent|editors` called by DevPanel.
- `artifacts/generators/*` + `archiver`: `/api/artifacts/generate` is called by DevPanel; `archiver` is imported dynamically in `zip.ts`.
- `/api/terminal/*`, `/api/image/generate`, `/api/youtube-search`, `/api/web-proxy`: all called by DevPanel/BrowserAgent.
- `/api/desktop/*` + Python tool modules: called by DesktopPanel/server desktop flows.
- `memory/curator/`, `server_transcripts`, `server_session_summary`, `server_phasex`: wired into startup/route logic.
- npm deps `pdfkit`, `docx`, `exceljs`, `pptxgenjs`, `uuid`, `pixi.js`, `motion`, `lucide-react`: all have at least one real import site.

## Execution order

1. Findings 1-3 (orphaned files + proxy): pure deletions, no import cleanup.
2. Findings 5-6, 12-15 (retriever/phasex/store dead code): delete, then drop the now-unused imports in `agent/loop.ts` and the re-export block.
3. Findings 7-8 (TaskClassifier + localClassify): delete together, verify `LocalProvider` still exports what server.ts imports.
4. Findings 9-10 (renderer + watcher): touch `RendererManager`/`AvatarCanvas` and the workspace import line.
5. Finding 4 (artifact planner path) and finding 11 (LTM subsystem): route-level deletions, run `tsc --noEmit` after.
6. Findings 16-18 (shrink + Python deps): trivial.

## Verification after each step

- `npm run lint` (`tsc --noEmit`) passes - the repo currently compiles clean.
- `start-adj.bat` boots and `/api/ping` answers.
- DevPanel loads without console errors (it exercises most of the kept surface).
- Python agent: `python -m desktop_agent.main` still starts, window tools still work after the pygetwindow removal.

## Appendix: grep evidence (abbreviated)

```
local-agent        -> BrowserAgent.tsx:1127-1128 (UI text only)
run_agent          -> run_agent.py:10 (self)
/api/proxy         -> server.ts:1426 (route definition only)
classifyTask       -> orchestration/TaskClassifier.ts:16 (definition only)
autoCreateMemoryForAction -> memory/retriever.ts:138 (definition only)
getProjectContext/formatProjectContextSummary -> agent/loop.ts:1 (import only)
searchToolCalls    -> server_phasex.ts:589 (definition only)
getSessionsByDateRange -> server.ts:32 (import only)
WorkspaceWatcher   -> server.ts:47 (import only)
pygetwindow        -> desktop_agent/tools_windows.py:4 (import only)
multipart          -> (no matches in desktop_agent/*.py)
```
