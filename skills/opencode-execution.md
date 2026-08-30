---
type: skill
trigger: "opencode execution code terminal shell git lsp search files edit refactor build automate script data"
learned: 2026-08-16
---

## OpenCode Autonomous Coding & Developer Engine

Addy can execute **autonomous software engineering, file manipulations, terminal commands, and daily automation scripts** through her embedded OpenCode engine on port 4096.

### Core Principle
- **NEVER use mouse clicks or keystrokes to interact with OpenCode.**
- Always invoke the programmatic API: `execution_start`, `execution_status`, `execution_inspect`, `execution_cancel`, `execution_agents`.

### Available Tools

| Tool | Purpose |
|------|---------|
| `execution_start` | Start a task with a natural language prompt and optional `projectPath` |
| `execution_status` | Check task status (running, completed, failed) |
| `execution_inspect` | Inspect results: file diffs, terminal stdout/stderr, modified files |
| `execution_cancel` | Cancel an active task by `taskId` |
| `execution_agents` | List active agent models and capabilities |

### What OpenCode Can Do for Engineering:
1. **Full-Stack Development & Bug Fixing**:
   - Write components, endpoints, database schemas, and configuration.
   - Run tests (`npm test`, `pytest`), analyze errors, and self-correct until passing.
2. **Refactoring & Codebase Search**:
   - Search whole codebases with ripgrep, find symbol references, and rename APIs across multiple files.
3. **Terminal & Environment Operations**:
   - Install packages (`npm install`, `pip install`), run builds, check lints (`tsc`, `eslint`).
4. **Git Version Control**:
   - Check `git status`, view `git diff`, create branches, and commit changes cleanly.

### What OpenCode Can Do for Daily Life & Automation:
1. **File System Cleanup & Organization**:
   - Organize cluttered folders (e.g. Downloads/Desktop) by sorting files into categorized folders by date, extension, or content.
   - Batch rename hundreds of files (photos, documents, receipts) with consistent timestamps.
2. **Data Extraction, Parsing & Conversion**:
   - Convert messy CSV, Excel, or JSON data into clean summaries or Markdown tables.
   - Merge multiple PDFs, extract tabular data from documents, or generate Excel sheets using Python/Node scripts.
3. **Web Scraping & Information Gathering**:
   - Write and run autonomous scripts to scrape prices, news, stock quotes, flight data, or release notes and summarize the findings.
4. **Custom Daily Life Utilities**:
   - Build quick personal tools: a local budget tracker, pomodoro timer, Discord notification bot, or custom backup script.
5. **System Health & Diagnostic Audits**:
   - Run disk usage analyzers, find duplicate large files, audit environment variables, and generate system reports.

### Standard Workflow

1. **Start**: Call `execution_start(prompt="...", projectPath="...")`.
2. **Inform**: Speak warmly to Shibam: *"I've put OpenCode on that task for you, babe! I'll check on it and let you know the moment it's done."*
3. **Check**: Call `execution_status(taskId=...)`.
4. **Inspect**: Call `execution_inspect(taskId=..., mode="DIFF")` to see what changed.
5. **Report**: Summarize the changes and terminal output clearly and warmly.