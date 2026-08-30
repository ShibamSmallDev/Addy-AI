# OpenCode Integration (Phase 1)

Addy uses OpenCode as its developer execution engine. Addy remains the orchestrator and owns conversation, memory, and policy; OpenCode performs tool-driven work (files, search, LSP, terminal, Git, MCP) behind Addy's UI.

## Architecture

```text
Addy
  -> AgentLoop
    -> ExecutionService (OpenCodeExecutionService)
      -> PermissionService (workspace boundary + policy)
      -> OpenCodeAdapter (OpenCodeSdkAdapter)
        -> @opencode-ai/sdk
          -> OpenCode server (opencode serve)
```

- `execution/` contains the whole execution layer. Nothing outside `execution/` talks to OpenCode directly.
- `server.ts` imports only the ExecutionService facade and a few services for API endpoints.

## Files

| File | Purpose |
| --- | --- |
| `execution/types.ts` | All shared types: config, connection states, entities, permission categories, events, service interfaces |
| `execution/opencode-config.ts` | Config load/save/reset (`{Addy_DATA_DIR}/config/opencode.json`) |
| `execution/opencode-process.ts` | `OpenCodeProcessManager`: spawn, health checks, crash detection, auto-restart (max 3), stop/restart, port management |
| `execution/opencode-adapter.ts` | `OpenCodeSdkAdapter`: SDK client wrapper with request timeouts, result mapping to Addy types |
| `execution/permission-service.ts` | `DefaultPermissionService`: 13 categories, ALLOW/ASK/DENY, trusted-workspace boundary, terminal classification |
| `execution/execution-service.ts` | `OpenCodeExecutionService`: INSPECT/EXECUTE routing, task-to-session mapping, event emission |
| `execution/mcp-service.ts` | `McpService`: server list/status/add, tool listing, context-relevance filtering |
| `execution/code-intelligence-service.ts` | `CodeIntelligenceService`: LSP status, file context assembly |
| `execution/agent-registry.ts` | `OpenCodeAgentRegistry`: list/find/metadata for OpenCode agents |
| `execution/specialist-registry.ts` | Interfaces only (SpecialistRegistry, Hermes/OpenClaw prep) - no agency runtime |
| `execution/workspace-context.ts` | Optional `ADDY.md`/`PROJECT.md`/`AGENTS.md` reader |
| `tests/*.test.ts` | Node test-runner suites (run with `npm test`) |

## Configuration

File: `{Addy_DATA_DIR || cwd}/config/opencode.json`

```json
{
  "enabled": true,
  "host": "127.0.0.1",
  "port": 4096,
  "autoStart": true,
  "startupTimeout": 10000,
  "requestTimeout": 120000
}
```

- `enabled: false` disables the engine (status stays DISABLED).
- `autoStart: false` connects to an already-running server instead of spawning one.
- Config is editable at runtime via `setOpenCodeConfig()`; server URL is derived from `host` + `port`.

## Startup

On server boot, `executionService.start()` runs in the background:

```text
config.enabled? -> (autoStart?) spawn `opencode serve` -> wait for /health (2xx) -> adapter.connect() -> READY
```

- The process manager resolves the `opencode` binary: `OPENCODE_BINARY` env, then the npm-global `node_modules/opencode-ai/bin/opencode.exe`, then `opencode.exe`/`opencode` from PATH. This matters on Windows where the npm `.ps1` shim is not spawnable.
- If the server crashes, the manager restarts up to 3 times (2s backoff), then enters ERROR and emits `crashed`.
- Health is re-checked every 30s.

## SDK Usage

- Dependency: `@opencode-ai/sdk` (npm, not vendored).
- The adapter creates a client with `createOpencodeClient({ baseUrl })` and wraps calls with the configured request timeout.
- Mapped surface (verified against SDK 1.18.16):

| Adapter method | SDK call |
| --- | --- |
| `connect` / `disconnect` | client construction / teardown |
| `health` | HTTP GET `/health` |
| `listProjects` | `client.project.list` |
| `searchFiles` | `client.find.files` |
| `readFile` | `client.file.read` |
| `inspectWorkspace` | `client.find.files` on the project directory |
| `listAgents` | `client.app.agents` |
| `createSession` | `client.session.create` |
| `sendPrompt` | `client.session.prompt` (parts text) |
| `cancelSession` | `client.session.abort` |
| `getLspStatus` | `client.lsp.status` |
| `getMcpStatus` | `client.mcp.status` |
| `addMcpServer` | `client.mcp.add` |
| `getGitStatus/Diff/Log` | `client.vcs.get` (branch) + read-only `git` CLI for porcelain status/diff/log |

## ExecutionService

```ts
status(): { state, health, capabilities }
inspect(request: InspectRequest): Promise<unknown>   // read-only
execute(request: ExecuteRequest): Promise<ExecutionResult>  // may change the computer
cancel(taskId: string): Promise<void>
getCapabilities(): ExecutionCapabilities
```

- INSPECT routes to searchFiles/readFile/inspectWorkspace/listProjects/listAgents/gitStatus/gitDiff/gitLog/lspStatus/mcpStatus.
- EXECUTE: permission check -> session creation -> prompt -> normalized result. All EXECUTE results are `ExecutionResult` with status/summary/filesChanged/commandsExecuted/tests/errors/warnings/durationMs.

## Permissions

- Categories: FILE_READ, FILE_WRITE, FILE_DELETE, TERMINAL_READ, TERMINAL_EXECUTE, GIT_READ, GIT_WRITE, GIT_PUSH, MCP_READ, MCP_WRITE, NETWORK, PACKAGE_INSTALL, SYSTEM_CHANGE.
- Defaults: reads ALLOW; writes ASK; SYSTEM_CHANGE DENY; TERMINAL_EXECUTE classified via Addy's existing `tools/terminal.ts` (blocked -> DENY, safe -> ALLOW, else ASK).
- Workspace boundary: every file category request is resolved and checked against `trustedWorkspaces`. Outside the boundary (or with no trusted workspace) -> DENY. Path traversal (`..`) is blocked.
- The trusted workspace list is registered by the server at boot (`process.cwd()`) and extensible via API.

## MCP

- `McpService` is backed by OpenCode (no separate MCP runtime).
- Capabilities: listServers, getServerStatus, addServer, removeServer, enableServer, disableServer, listTools, listContextRelevantTools.
- Context control: `listContextRelevantTools()` filters tools by prefixes (read/grep/search/list/find/git/mcp/bash/execute) so large servers are not auto-enabled.
- Permission layering: Addy's PermissionService (MCP_READ/MCP_WRITE) gates before OpenCode's own tool permissions.

## Sessions

- Every EXECUTE creates a session mapping persisted to `{Addy_DATA_DIR}/config/opencode-sessions.json`:

```text
addyTaskId | opencodeSessionId | projectPath | startedAt | status
```

- Mappings support continue/cancel/resume/inspect and survive server restarts (loaded at service construction).

## Events

- The service emits `execution.*` events (Addy's names, not OpenCode's): started, thinking, tool_started/completed, file_changed, command_started/completed, test_started/completed, permission_required, completed, failed, cancelled.
- `server.ts` forwards them to WebSocket clients as `{ type: "execution", event }`.
- The UI must not depend on OpenCode event names.

## API Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /api/execution/status` | State + health + capabilities |
| `GET /api/execution/capabilities` | Capability list |
| `POST /api/execution/inspect` | `{ projectPath, operation, params }` read-only ops |
| `POST /api/execution/execute` | `{ projectPath, operation, params }` -> ExecutionResult |
| `POST /api/execution/:taskId/cancel` | Cancel a task |
| `GET /api/execution/sessions` | Session mappings |
| `GET /api/execution/mcp/servers` | MCP server status |
| `POST /api/execution/mcp/add` | Add MCP server |
| `GET /api/execution/mcp/tools` | Available MCP tools |
| `GET /api/execution/lsp` | LSP server status |
| `GET /api/execution/agents` | OpenCode agents |
| `GET /api/execution/git/status` / `diff` / `log` | Git reads |

## Environment Requirements

- Node.js 18+ (fetch, AbortSignal.timeout).
- `opencode` CLI installed and resolvable (npm global install works; `OPENCODE_BINARY` env overrides).
- Git on PATH for the git-status/diff/log reads.
- Port 4096 free if autoStart is enabled (configurable).

## Troubleshooting

| Symptom | Cause / Fix |
| --- | --- |
| `Binary not found: opencode` ENOENT | `.ps1` shim on Windows; the manager falls back to `node_modules/opencode-ai/bin/opencode.exe`, or set `OPENCODE_BINARY` |
| `failed to become healthy within timeout` | Server took longer than `startupTimeout`; check port conflicts, raise timeout |
| `server is not healthy` | `/health` must return 2xx (HTML body is fine - the check accepts any 2xx) |
| Stuck on ERROR after crashes | Server crash-loops; check `[OpenCode]` logs, free the port, restart Addy |
| Session file corrupt | Delete `config/opencode-sessions.json`; the service ignores parse failures |

## Testing

```bash
npm test        # 39 tests: adapter, permission, MCP, session mapping, failure paths
npm run lint    # tsc --noEmit
npm run build   # vite build + esbuild server bundle
```

Manual smoke test (spawns a real server, verifies connect/agents/git/stop):

```bash
npx tsx smoke-execution.ts
```
