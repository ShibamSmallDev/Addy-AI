# Architecture Comparison: Addy vs Hermes vs OpenClaw

- **Date:** 2026-08-15
- **Scope:** Structural, end-to-end comparison of three personal AI agent systems - Addy (local prototype), Hermes Agent (Nous Research), and OpenClaw (open-source framework). Not a feature contest; a mapping of how each is built and where each stands in maturity.
- **Method:** Verified against local source for Addy (`C:\MY PROJECTS\Addy AI`) and Hermes (`C:\MY PROJECTS\Hermes Agent`). OpenClaw details from its public repository (`github.com/openclaw/openclaw`); no local copy.

---

## 1. Executive Summary

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| Repo | local only | `NousResearch/hermes-agent` | `openclaw/openclaw` |
| Language | TypeScript (Electron + React) + Python sidecar | Python | TypeScript / Node |
| Maturity | Prototype - many subsystems UI-dead | Production (~230K stars) | Production (~250K stars) |
| Core differentiator | Native live voice + Windows desktop control | Deep learning loop + provider-agnostic engine | SOUL.md simplicity + huge skill ecosystem |

---

## 2. High-Level Stack

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| UI | Electron + React desktop | TUI + Web UI + desktop | TUI + Web + gateway |
| Runtime model | Monolith server + subprocess agents | Monolith gateway process | Gateway (HTTP + WebSocket) |
| Language | TypeScript (backend/UI) + Python (sidecar) | Python | TypeScript / Node |
| Platform | Windows-native | Linux / macOS / WSL2 (Win native experimental) | macOS / Linux / Win via WSL |
| License | - | MIT | permissive (open source) |

---

## 3. Core Process Architecture

### Addy
- `server.ts` is a single Express server owning everything: text chat (REST), voice (Gemini Live over WebSocket), memory, sessions, transcripts.
- Delegates to discrete layers:
  - `agent/loop.ts` - the single agent loop.
  - `orchestration/` - AgentRegistry + AgentExecutor + TaskClassifier (classifier is dead code).
  - `execution/` - opencode subprocess manager + MCP service + Hermes/OpenClaw stubs (**UI-dead**: nothing in the UI calls the execution endpoints).
  - `desktop_agent/` - Python sidecar (FastAPI on :8765) for browser, system, file, clipboard, screenshot, OCR, and reach (web/YouTube/GitHub) tools.
- No central gateway; a single process plus one sidecar.

### Hermes
- A **gateway** process (`gateway/`) is the hub connecting 20+ messaging platforms (Telegram, Discord, Slack, WhatsApp, Signal, Matrix, Mattermost, Email, Teams, Google Chat).
- The **agent core** (`agent/`) is a rich set of ~100+ modules: `conversation_loop`, `prompt_builder`, `context_engine`, `memory_manager`, `curator`, `tool_executor`, `tool_guardrails`, `subagent_lifecycle`, `turn_finalizer`, plus provider adapters (anthropic, gemini, bedrock, vertex, codex) and registries for TTS/STT/image/web-search/video-gen.
- Skills live in `skills/`. Providers in `providers/`. Cron in `cron/`.

### OpenClaw
- A **gateway** runtime (`gateway/` with `server.js`, HTTP + WebSocket routes).
- Agents are defined by a single **`SOUL.md`** markdown file: identity, personality, rules, and skill references.
- Platform connectors (Telegram, Discord, WhatsApp, Slack, WeChat).
- Skills directory plus the **ClawHub** marketplace; ready-to-use agent templates in `agents/`.

---

## 4. Execution / Tool System

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| Tool registry | Python `desktop_agent/registry.py` + TS `tools/` | `tools/` + `tool_executor.py` + `tool_guardrails.py` | built-in skills (browser, scraper, file, api, git, docker...) |
| Terminal backends | local only (`tools/terminal.ts`) | **7**: local, Docker, SSH, Singularity, Modal, Daytona, Vercel Sandbox | local + cloud |
| Browser | hand-rolled Python (`tools_websites.py` / `tools_browser.py`), OCR/coordinate-based | registry-based (`browser_registry`/`browser_provider`), pluggable | `browser` skill, structured snapshots |
| MCP | `execution/mcp-service.ts` (UI-dead) | full MCP support | MCP support |
| Subagents | types only (`specialist-registry.ts`), no runtime | full `subagent_lifecycle`, parallel delegation, Python RPC | parallel Spaces |

---

## 5. Memory

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| Model | category-based vault (preference/project/goal/...) injected into context | multi-layer: agent-curated memory, FTS5 session search + LLM summarization, Honcho user modeling, learning graph | persistent memory, semantic search across history |
| Self-improvement | none | **learning loop**: auto-creates skills, improves during use, nudge-to-persist | SOUL.md-driven, skill accumulation |
| Persistence | Obsidian vault + SQLite | `~/.hermes/` | local storage |

---

## 6. Skills

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| Count | 1 (custom) | 40-77+ | 40+ built-in, 13K+ on ClawHub |
| Format | `{slug}.md`, `trigger:` keyword | `SKILL.md` (agentskills.io standard, rich metadata) | SOUL.md reference + skills |
| Selection | keyword substring match | semantic, description-driven | template/skill marketplace |
| Creation | manual | **autonomous** (from experience) | manual + marketplace |
| Self-improve | no | yes (during use) | via community |

---

## 7. Voice / Multi-modal

| | **Addy** | **Hermes** | **OpenClaw** |
|---|---|---|---|
| Voice | **Gemini Live real-time audio** (native, both directions) | transcription + TTS registries (provider-based, not true live) | limited / platform-based |
| Image gen / TTS / web search | via tools | full registries (image_gen, tts, video_gen, web_search) | via skills |

---

## 8. Maturity Assessment

- **Hermes** - the most **architecturally rich** agent core: deepest context engine, real learning loop, provider-agnostic with 7 terminal backends, cross-platform gateway. Over-engineered but genuinely mature.
- **OpenClaw** - the most **approachable and ecosystem-rich**: one `SOUL.md` file defines an agent, huge skill marketplace, largest community. Simpler core, huge reach.
- **Addy** - **prototype**. Its agent layer is scattered (`agent/`, `orchestration/`, `execution/` overlap) and the audits flag ~4,000 lines of dead/UI-unreachable subsystems (execution engine, orchestration, transcripts, LTM).

---

## 9. What Addy Uniquely Has

Neither Hermes nor OpenClaw ships these:

1. **Native Gemini Live voice** - real-time audio both directions (Hermes runs STT-to-TTS pipeline, not true live).
2. **Windows-native desktop agent** - the Python sidecar controlling the actual machine.
3. **Personal companion persona** - memory vault + session history + ChatGPT-style rail.

---

## 10. Recommended Direction for Addy

1. **Steal Hermes' learning loop + semantic skills** - replaces Addy's brittle keyword `trigger:` skill system (`vault.ts:220`).
2. **Steal OpenClaw's SOUL.md identity pattern** - replace hardcoded prompts in `server.ts` with a readable identity file loaded into context.
3. **Keep Addy's native voice + Windows desktop** as differentiators.
4. **Fix the dead layer** - either wire `execution/` to a real engine (opencode / Hermes / OpenClaw via MCP) or cut it.
5. **Add a cron scheduler** for long-term unattended automation.

---

*Built for the Addy AI project. Sources: local source trees for Addy and Hermes; public repo for OpenClaw.*
