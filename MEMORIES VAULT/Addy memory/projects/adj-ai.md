---
type: project
status: active
updated: 2026-08-09
tags: [electron, nodejs, typescript, gemini, python]
---
## What it is
Addy (Addy AI v3) - local-first AI companion + desktop operating assistant.
Electron shell, React frontend, Express backend, Python desktop_agent sidecar.

## Current state
- Text + voice modes working
- Python FastAPI agent on port 8765 handles OS control
- Obsidian vault memory being integrated
- Agent-Reach internet tools (readWebpage, youtubeTranscript, webSearch, ...)
  added via desktop_agent/tools_reach.py

## Decisions made
- Obsidian vault = long-term memory (ADDY_MEMORY_DIR in .env)
- Agent-Reach via desktop_agent (tools_reach.py) for internet reads
- Vault block injected into Gemini system prompt each call

## Known bugs (from bug report)
- Voice conversation messages not persisting (role='model' CHECK violation)
- Background memory consolidation wipes pinned memories + embeddings
- Session memory spam (one entry per model turn)
