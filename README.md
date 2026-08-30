# Addy AI

> **A persistent personal AI that remembers, reasons, acts, and grows with you. An evolving agent architecture combining memory, orchestration, tools, skills, and desktop capabilities.**

---

## 🌟 Overview

**Addy AI** is a local-first, highly agentic AI companion and desktop co-pilot. Powered by a hybrid reasoning engine (Google Gemini with resilient multi-tier fallback chains), Addy integrates real-time audio interaction, multi-layer persistent memory, automated web and media comprehension, and deep native desktop automation.

---

## 🏛️ Core Architecture

```
                                  ┌────────────────────────┐
                                  │   React / Electron UI   │
                                  │   (Visualizer & Audio) │
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
└────────────────────────────────────────┬────────────────────────────────────────┘
                                         │ HTTP (Port 8765)
                                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     Addy Python Desktop Agent (Sidecar)                         │
│                                                                                 │
│   • Headed Google Chrome Automation      • Win32 Mouse & Keyboard (Unicode)     │
│   • Native YouTube / Media Intelligence  • Screen OCR, Vision & Window Controls │
│   • GitHub REST API & CLI Tools          • 106+ Registered Automation Tools     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Key Capabilities

### 🧠 Persistent Long-Term Memory Core
* **Two-Way Sync**: SQLite local database (`addy-ai.db`) mirrored into a Markdown/Obsidian Knowledge Vault.
* **Vector Deduplication**: Real-time cosine similarity threshold ($\ge 0.85$) automatically suppresses conflicting or outdated records.
* **Curator Garbage Collection**: Periodic 6-hour scheduler consolidating memory clusters and auto-decaying unpinned working memory.

### 🌐 Headed Browser & Desktop Automation
* **Live User Co-Pilot**: Automation operates in a visible Google Chrome window (`headless=False`) with automatic window restoration and focus.
* **Semantic Web Navigation**: Accessible DOM tree parsing (`desktopBrowserGetSemanticTree`) and interactive element selection.
* **Native Desktop Control**: DPI-corrected mouse positioning, full Unicode keystroke injection, and window management.

### 🎥 Media & Internet Research
* **YouTube Intelligence**: Instant video search, playlist retrieval, and transcript extraction via native `yt-dlp` and `youtube_transcript_api`.
* **Semantic Search & Web Reading**: Full page markdown extraction via Jina Reader and DuckDuckGo parsing.
* **GitHub Integration**: Direct repository exploration, README analysis, and issue querying.

### 🎙️ Real-Time Voice & Wake-Word
* **Multi-Phonetic Detection**: Fast client-side wake-word engine with custom keyword recognition.
* **Audio Visualizer**: Dynamic canvas rendering responsive to emotions, voice intensity, and agent state.

---

## 🛠️ Quickstart Guide

### Prerequisites
* **Node.js** (v18+)
* **Python** (3.10+)
* **Google Chrome** installed on your system

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
