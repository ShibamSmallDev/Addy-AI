# Addy AI Master Roadmap & Task Tracker

**Last Updated:** 2026-08-16  
**Status:** All Core Upgrades Complete & Verified  

---

## 🟢 1. Core Architecture & Backend (COMPLETED)
- [x] **Streamlined Gemini Engine Stack**
  - [x] Pure single-engine stack in [`providers/ProviderManager.ts`](file:///c:/MY%20PROJECTS/Addy AI/providers/ProviderManager.ts) (Verified low-latency Gemini model fallback chain: `3.5-flash` -> `flash-latest` -> `3.6-flash` -> `flash-lite-latest` -> `3.5-flash-lite`).
  - [x] Completely stripped legacy Ollama and OpenRouter wrappers, dead routing checks, and short-query interception bugs.
  - [x] Rate-limit (HTTP 429) protection for background extraction in [`server_skills.ts`](file:///c:/MY%20PROJECTS/Addy AI/server_skills.ts).
- [x] **Database Write Coalescing & Persistence**
  - [x] 1,000ms debounced SQLite persistence in [`database/index.ts`](file:///c:/MY%20PROJECTS/Addy AI/database/index.ts) (eliminated 4.5 MB full-file sync write loop).
  - [x] Exit cleanup listeners (`beforeExit`, `SIGINT`, `SIGTERM`) to guarantee zero dirty data loss.
- [x] **Server Modularization & IPC Keep-Alive**
  - [x] Extracted `/api/execution/*` endpoints into [`src/server/routes/executionRoutes.ts`](file:///c:/MY%20PROJECTS/Addy AI/src/server/routes/executionRoutes.ts).
  - [x] HTTP keep-alive persistent sockets in [`server.ts`](file:///c:/MY%20PROJECTS/Addy AI/server.ts) for desktop agent calls.
- [x] **Memory System 2.0 Core Upgrades**
  - [x] 250ms Mini-Batch embedding queue in [`memory/embeddings.ts`](file:///c:/MY%20PROJECTS/Addy AI/memory/embeddings.ts).
  - [x] Semantic Auto-Deduplication ($\ge 0.85$ cosine similarity) in [`memory/store.ts`](file:///c:/MY%20PROJECTS/Addy AI/memory/store.ts).
  - [x] Multi-factor unified scoring & 4,000-char hierarchical bounded context in [`memory/retriever.ts`](file:///c:/MY%20PROJECTS/Addy AI/memory/retriever.ts).
  - [x] 30-day low-importance memory decay & cleanup in [`memory/curator/MemoryCurator.ts`](file:///c:/MY%20PROJECTS/Addy AI/memory/curator/MemoryCurator.ts).
- [x] **Ponytail Cleanup & Endpoint Wiring**
  - [x] Deleted 6.1 MB of stale database dump files (`addy-ai.db.bak`, `addy-ai.db.zeroed`).
  - [x] Wired `GET/POST /api/prompt` for live `SOUL.md` editing and `/api/agent-health` proxy.
  - [x] Added `GET /api/models` and `POST /api/providers/model` for instant in-app Gemini model switching.

---

## 🟢 2. Browser Automation 2.0 & Native Microsoft Edge (COMPLETED)
- [x] **Browser Automation 2.0 & Native Microsoft Edge (`tools_browser.py`)**
  - [x] Configured native Microsoft Edge (`channel="msedge"`) as the primary browser with persistent profile storage in `desktop_agent/data/browser_profile/` (saves Twitter/X, GitHub, Reddit, LinkedIn logins).
  - [x] Implemented `desktopBrowserConnectCdp` to attach directly to running Microsoft Edge / Chrome instances on port 9222.
  - [x] Implemented `desktopBrowserGetSemanticTree` in [`desktop_agent/tools_browser.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_browser.py) to extract numbered interactive element trees (`[1] Button: "Post"`, `[2] Textbox: "What is happening?!"`).
  - [x] Added indexed `id` targeting to `desktopBrowserClick` and `desktopBrowserType` with auto-scroll and visibility wait.
  - [x] Implemented `desktopBrowserExtractText` to extract clean readable text from articles, tweets, Reddit threads, and docs.
  - [x] Implemented `desktopBrowserScreenshot` with full-page and viewport capture.
  - [x] **Wired all Browser 2.0 & Social Tools directly into Gemini's Text Chat (`/api/chat/text`), Voice Live WebSocket session, and Autonomous ReAct Loop (`agent/loop.ts`) with clear instructions that eliminate OCR usage for web pages.**
  - [x] **Whitespace Restoration & Playwright Verification in Prompts**:
    - [x] Fixed `filterToolCallLeakage` in [`src/lib/textSanitizer.ts`](file:///c:/MY%20PROJECTS/Addy AI/src/lib/textSanitizer.ts) to preserve leading and trailing whitespace across streamed chunks (preventing words from sticking together).
    - [x] Removed accumulator re-filtering in [`src/App.tsx`](file:///c:/MY%20PROJECTS/Addy AI/src/App.tsx) so captions and chat messages render with natural, crisp word spacing.
    - [x] Embedded explicit Playwright 1.49.1 and Microsoft Edge verified status in [`SOUL.md`](file:///c:/MY%20PROJECTS/Addy AI/SOUL.md) and [`skills/browser-automation.md`](file:///c:/MY%20PROJECTS/Addy AI/skills/browser-automation.md) to eliminate hallucinated install warnings.
  - [x] **High-Precision Element Location & Vision Overhaul**:
    - [x] Replaced legacy Win32 control loop with **Windows UIAutomation (`uiautomation`)** — provides 100% exact, sub-millisecond control bounding boxes (buttons, inputs, tabs, menus) with 0 OCR noise.
    - [x] Installed and integrated **RapidOCR ONNX (`rapidocr_onnxruntime`)** and **Windows 10/11 Native OCR (`winocr`)** for canvas, rendered surfaces, and images with 0 external Tesseract dependencies.
    - [x] Implemented **DPI Scaling Correction** in [`desktop_agent/tools_vision.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_vision.py) so physical screen captures map 1:1 to logical desktop mouse click coordinates.
    - [x] Integrated `rapidfuzz` token set ratio and semantic heuristics for accurate natural-language UI element matching.
    - [x] Upgraded `analyzeScreenshot` and `readScreen` in [`desktop_agent/tools_screenshot.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_screenshot.py).

---

## 🟢 3. Precision Mouse & Keyboard Hardware Drivers (COMPLETED)
- [x] **Win32 `SendInput` Hardware Mouse Driver**
  - [x] Sub-pixel normalized $(0 \dots 65535)$ virtual desktop coordinate mouse driver in [`desktop_agent/tools_mouse.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_mouse.py).
  - [x] Humanized Cubic Bézier curve trajectories (`_bezier_point`) with realistic acceleration and deceleration easing.
- [x] **Native UTF-16 Unicode Keyboard Injection**
  - [x] Implemented `KEYEVENTF_UNICODE` in [`desktop_agent/tools_keyboard.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_keyboard.py) to type emojis, non-ASCII symbols, and accents natively.
  - [x] Active foreground window title verification guard (`targetWindow`).

---

## 🟢 4. Desktop Vision & UI Element Locator (COMPLETED)
- [x] **Dual Win32 Window Controls + OCR Locator**
  - [x] Native Win32 control enumeration in [`desktop_agent/tools_vision.py`](file:///c:/MY%20PROJECTS/Addy AI/desktop_agent/tools_vision.py) (0 OCR dependency for standard UI buttons and fields).
  - [x] Multi-monitor coordinate origin translation (`_virtual_screen_origin`) for flawless click positioning.

---

## 🟢 5. Autonomous Reasoning & Hermes/OpenClaw Loops (COMPLETED)
- [x] **Dynamic ReAct Reasoning Loop in [`agent/loop.ts`](file:///c:/MY%20PROJECTS/Addy AI/agent/loop.ts)**
  - [x] Dynamic Reason + Act + Observe + Re-Plan execution cycle.
  - [x] Hermes private reflection scratchpad (`thought`).
  - [x] OpenClaw Verifier Gate (`verifying` phase with automated outcome summary).
  - [x] Resilient Google Gemini provider integration.

---

## 🟢 6. Voice & Proactive Talkback (COMPLETED)
- [x] **Tool-Step Spoken Progress Commentary**
  - [x] Pre-action and post-action `spokenCue` metadata generated for every step in [`agent/loop.ts`](file:///c:/MY%20PROJECTS/Addy AI/agent/loop.ts).
  - [x] Spoken task completion summaries stored directly in persistent memory core.

---

## 🟢 7. Social Media & Messaging Connectors (COMPLETED)
- [x] **YouTube Transcript Extractor**: `socialYouTubeGetTranscript` for rapid video transcript extraction and summaries.
- [x] **Discord Webhook Alerts**: `socialDiscordWebhookSend` for rich build and event notifications.
- [x] **Social Media Post Drafter**: `socialPostDraft` with character limits and draft-and-confirm safety checks.

---

## 🟢 8. Brand New Futuristic Glassmorphic Web UI (COMPLETED)
- [x] **Glassmorphic Command Island & Floating Dock**
  - [x] Top-dock navigation in [`src/App.tsx`](file:///c:/MY%20PROJECTS/Addy AI/src/App.tsx) integrating `CHAT`, `MEMORY`, `DESKTOP`, `DEV`, `VISION`, `SESSIONS`, `SETTINGS`.
  - [x] Eliminated duplicate legacy vertical sidebar.
- [x] **Real-Time Telemetry HUD & Multi-Wake Word Support**
  - [x] Badges for `EDGE BROWSER 2.0`, `AGENT :8765`, and `WAKE WORD` active indicators.
  - [x] Multi-wake word detection: **`"babe"`** + 30+ phonetic/conversational variants (`"hey babe"`, `"baby"`, `"bae"`, `"baeb"`, `"baybe"`, `"babs"`, `"babes"`, `"ok babe"`, `"hi baby"`), plus `"addy"`/`"eddy"` and custom phrases in [`src/lib/wakeWord.ts`](file:///c:/MY%20PROJECTS/Addy AI/src/lib/wakeWord.ts).
- [x] **Cyber Aesthetics & Design Tokens**
  - [x] Custom typography (`Plus Jakarta Sans` + `Space Grotesk` + `JetBrains Mono`).
  - [x] Glass panels (`.glass-panel`, `.glass-pill`) and neon glow tokens (`.neon-glow-cyan`, `.neon-glow-purple`) in [`src/index.css`](file:///c:/MY%20PROJECTS/Addy AI/src/index.css).

---

## 🟡 9. Expanded Panels & Split-View UX (NEXT UP)
- [ ] **Co-Pilot Side-by-Side Split View**: Smoothly scale central avatar to 35% left column when drawers open so Addy remains visible during chat.
- [ ] **Omni-Chat Rich Code Blocks**: Syntax highlighting with 1-click copy and collapsible tool execution logs.
- [ ] **Instant Slash Commands Autocomplete**: `/browse`, `/search`, `/memory`, `/clear` quick menu.
