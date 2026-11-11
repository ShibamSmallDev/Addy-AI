# Addy AI

> **Local-first multimodal AI companion & desktop co-pilot. Features real-time voice, a reactive audio visualizer, 24/7 autonomous proactive awareness, multi-tier memory with Obsidian sync, a ReAct self-healing planner, and 120+ native OS automation tools.**

---

## 🌟 Overview

**Addy AI** is a local-first, highly agentic multimodal companion and desktop co-pilot. Powered by a hybrid reasoning engine (Google Gemini Multimodal Live API over WebSockets with resilient multi-tier fallback chains), Addy integrates real-time audio interaction, a reactive audio visualizer, a 24/7 autonomous proactive awareness daemon, multi-layer persistent memory with Obsidian two-way sync, and 120+ native Windows automation tools.

> **Tool count:** 123 tools are registered in the Python desktop agent; 115 are routable from the server, and ~110 are exposed to the model as function declarations.

---

## 🏛️ Core Architecture

```
                                  ┌────────────────────────┐
                                  │   React 19 / Vite UI   │
                                  │  (Visualizer & Audio)  │
                                  └───────────┬────────────┘
                                              │ WebSocket / HTTP
                                              ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Addy Orchestration Layer                              │
│                                                                                 │
│   ┌──────────────────────┐   ┌──────────────────────┐   ┌───────────────────┐   │
│   │    Gemini Live /     │   │   ReAct Reasoning    │   │  Provider Manager │   │
│   │     Audio Loop       │   │    Agent Loop        │   │  (Low Latency)    │   │
│   └──────────┬───────────┘   └──────────┬───────────┘   └─────────┬─────────┘   │
│              │                          │                         │             │
│              ▼                          ▼                         ▼             │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                       Multi-Tier Persistent Memory                      │   │
│   │   • SQLite Core (addy-ai.db)         • Semantic Auto-Deduplication (≥0.85)│   │
│   │   • Obsidian Knowledge Vault         • 6-Hour Background Curator Decay   │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
│                                         │                                       │
│   ┌─────────────────────────────────────┴───────────────────────────────────┐   │
│   │                 Autonomous Proactive Heartbeat Daemon                   │   │
│   │   • AI Tech News (RSS)               • Headless IMAP Email Reader       │   │
│   │   • WhatsApp Web Cloned Profile      • Quiet Hours & Focus Etiquette    │   │
│   └─────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ HTTP (Port 8765)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Addy Python Desktop Agent (Sidecar)                         │
│                                                                                 │
│   • Headed Microsoft Edge Automation     • Win32 Mouse & Keyboard (Unicode)     │
│   • Native YouTube / Media Intelligence  • Screen OCR, Vision & Window Controls │
│   • Background Email & WhatsApp Watchers • 123 Registered Automation Tools      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Capabilities

### 🎨 Reactive Audio Visualizer
* **Real-Time Core Visualizer**: A canvas-rendered audio-reactive core (`AddyCoreVisualizer`) that pulses and shifts colour with the live voice stream and Addy's emotional state.
* **Energy Orb**: Lightweight `ReactingOrb` renderer driven by session audio amplitude.
* **Emotion-Aware**: Visual state follows the active emotion (idle, thinking, speaking, listening).

### ⏰ Autonomous Proactive Heartbeat Daemon
* **24/7 Background Awareness**: Periodically polls breaking AI news (HN & TechCrunch), unread IMAP emails, and WhatsApp messages via cloned Edge session.
* **Cognitive Etiquette**: Strict quiet hours (11:00 PM – 8:00 AM) and active window focus awareness (automatically suppresses voice interruptions during fullscreen games, movies, Zoom, Teams, or Discord meetings).

### 🧠 Persistent Long-Term Memory Core
* **Two-Way Sync**: SQLite local database (`addy-ai.db`) mirrored into a Markdown/Obsidian Knowledge Vault (`MEMORIES VAULT`).
* **Instant Extraction**: Real-time regex extraction for preferences, user identity, and reminders during live dialogue.
* **Vector Deduplication**: Real-time cosine similarity threshold ($\ge 0.85$) with local `@xenova/transformers` (`all-MiniLM-L6-v2`).
* **Curator Garbage Collection**: Periodic 6-hour scheduler consolidating memory clusters and auto-decaying unpinned working memory.

### 🎭 6 Personality Presets & Companion Persona
* **Customizable Personalities**: Select between Warm Girl (Addy / Adrija), Tsundere, Professional Assistant, Chaotic Hacker, Playful Gamer, and Cyberpunk Operative.
* **First-Start Onboarding Gate**: Interactive identity onboarding to personalize assistant and user names with permanent memory persistence.

### 🌐 Headed Browser & Desktop Automation (123 Tools)
* **Live User Co-Pilot**: Automation operates in a visible Microsoft Edge window (`headless=False`) with automatic window restoration and focus.
* **Semantic Web Navigation**: Accessible DOM tree parsing (`desktopBrowserGetSemanticTree`) and interactive element selection.
* **Native Desktop Control**: DPI-corrected mouse positioning, full Unicode keystroke injection, window snapping, volume/media keys, and gated power actions.

### 🎥 Media & Internet Research
* **YouTube Intelligence**: Instant video search, playlist retrieval, and transcript extraction via native `yt-dlp` and `youtube_transcript_api`.
* **Semantic Search & Web Reading**: Full page markdown extraction via Jina Reader and DuckDuckGo parsing.
* **GitHub Integration**: Direct repository exploration, README analysis, and issue querying.

---


## 🛠️ Quickstart Guide

### Prerequisites
* **Node.js** (v18+)
* **Python** (3.10+)
* **Microsoft Edge** (or Google Chrome) installed on your system

### 1. Installation
Clone the repository and install dependencies:
```bash
git clone https://github.com/ShibamSmallDev/Addy-AI.git
cd Addy-AI

# Install Node backend & frontend dependencies
npm install

# Install Python desktop agent dependencies
cd desktop_agent
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment
Create a `.env` file in the root directory:
```env
# Gemini API Key (Required)
GEMINI_API_KEY=your_gemini_api_key_here

# GitHub Token (Optional for GitHub tools)
GITHUB_TOKEN=ghp_your_github_token_here
```

### 3. Launch Addy
Run the integrated start script:
```bash
# Windows
start-addy.bat
```
Or start the servers manually:
```bash
# Terminal 1: Desktop Agent
python -m uvicorn desktop_agent.main:app --host 127.0.0.1 --port 8765

# Terminal 2: Node Backend & Vite Frontend
npm run dev
```

Open your browser at `http://localhost:3000` to start interacting with Addy!

---

## 📜 License
MIT License. Built with ❤️ for continuous learning, engineering assistance, and personal companionship.
