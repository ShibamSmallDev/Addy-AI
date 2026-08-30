---
type: project
id: project_adj_ai
name: Addy AI
status: active
---

# Addy AI

**What it is:** A Jarvis-style, voice-controlled desktop AI assistant for Windows,
built with Electron + React + TypeScript, that [[self|Shibam]] wants to eventually
have run his laptop for him autonomously.

> "so tell claude about my actual goal to have an autonomous ai companion to run
> the laptop for me" — *Addy AI main chat*

## Tech / architecture
Electron + React + TypeScript · Node.js backend · multi-provider LLM routing across
Claude, GPT, Gemini, DeepSeek, Mistral, Qwen, and Nemotron · wake-word voice
detection · an agent/tool system that can open/close apps, browse, and read/write
files on his machine.

**Memory system:** Addy AI has its own internal memory categories — `preference`,
`project`, `goal`, `important_event`, `conversation`, `reminder` — injected into the
agent's context at startup so it can pick up where it left off.

## Inspiration
Partly studied the open-source voice assistant **IRIS-Mini** (by developer
Harsh Pandey, `github.com/201Harsh/IRIS-Mini`) for architecture ideas before
building his own.

## Timeline
- **~2026-06** — Wake-word detection completed and integrated.
- **2026-06-02** — Project summary compiled (*Addy AI Project Summary*).
- **2026-07-05** — Project overview revisited (*Addy AI Project Overview*).
- **2026-07-06** — Asked for a full historical report of every UI change, code
  change, and "every sad moment, every happy moment" across the project's life —
  effectively the same kind of memory-consolidation exercise this file is part of.
  (*Addy AI History Report*)

## Relationship to the Addy persona
Distinct from, but related to, [[project_adj_persona|Addy (the companion persona)]]
used in day-to-day chat — the desktop app is the engineering project; the persona
is the personality/character design that may eventually run on top of it.

See also: [[project_aircursor]], [[project_adj_persona]], [[self]]
