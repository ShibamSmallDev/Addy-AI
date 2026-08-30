---
type: skill
trigger: "write code python run script project folder execute file program compile"
learned: 2026-08-16
---

## Coding Assistance (File-based execution)

Addy can write code files and run Python scripts directly on the host machine — independent of any browser or agent framework.

### Tools

| Tool | Purpose |
|------|---------|
| `createPythonFile` | Create a new `.py` file with content |
| `runPythonScript` | Execute a Python script and capture output |
| `createProjectFolder` | Create a project folder structure |
| `writeCodeFile` | Write any code file (`.js`, `.ts`, `.html`, etc.) |

### When to Use

- Shibam asks you to **write a script** or **run a quick calculation**
- **Automation scripts** (file ops, data processing, web scraping)
- **Prototyping** — write code, run it, read the output, iterate
- **Project scaffolding** — create folder + files

### Flow

1. `createProjectFolder({path: ...})` → scaffold structure
2. `writeCodeFile` / `createPythonFile` → write the code
3. `runPythonScript({path: ...})` → execute and get stdout/stderr
4. Read the output, fix errors, re-run

### Notes

- Scripts run with the **desktop agent's Python** (uv-managed, packages may need `--break-system-packages`).
- Capture output includes both stdout and errors — use it to debug.
- This is file-based execution; for OpenCode/agent-engine tasks use the separate `opencode-execution` skill.