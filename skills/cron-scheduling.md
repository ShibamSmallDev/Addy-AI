---
type: skill
trigger: "schedule cron job recurring task automation timer reminder"
learned: 2026-08-16
---

## Cron Scheduler — Recurring Task Automation

Addy can create, manage, and monitor **scheduled jobs** that run on cron expressions or intervals. Jobs persist across restarts (stored in `cron_jobs.json`).

### Available Tools (Function Declarations)

| Function | Purpose |
|----------|---------|
| `cron_create` | Create a new scheduled job |
| `cron_list` | List all jobs with status |
| `cron_toggle` | Enable/disable a job |
| `cron_delete` | Remove a job |

### Job Configuration

```json
{
  "name": "string",              // Human-readable name
  "schedule": "string",          // Cron expr ("0 * * * *") or interval ms ("3600000")
  "type": "cron" | "interval",   // How to interpret schedule
  "enabled": true,               // Start immediately
  "handler": "string",           // Built-in handler name
  "payload": {},                 // Data passed to handler
  "maxRuns": 10                  // Optional limit
}
```

### Built-in Handlers

| Handler | Description |
|---------|-------------|
| `memory_consolidation` | Run memory consolidation on recent dialogue |
| `vault_digest` | Write a daily session digest to the vault |

### Examples

| Request | Function Call |
|---------|---------------|
| "Run memory consolidation every hour" | `cron_create({name:"hourly memory", schedule:"0 * * * *", type:"cron", handler:"memory_consolidation"})` |
| "Write a daily vault digest at midnight" | `cron_create({name:"daily digest", schedule:"0 0 * * *", type:"cron", handler:"vault_digest"})` |
| "Check something every 5 minutes" | `cron_create({name:"5min check", schedule:"300000", type:"interval", handler:"memory_consolidation"})` |
| "Pause the hourly job" | `cron_toggle({id:"<job-id>", enabled:false})` |
| "List all scheduled jobs" | `cron_list({})` |

### Notes

- Jobs survive server restarts (persisted to JSON).
- `type: "cron"` uses standard 5-field cron (minute hour day month weekday).
- `type: "interval"` uses milliseconds (e.g., 60000 = 1 minute).
- `maxRuns` limits total executions; job auto-disables after limit.
- The `/api/cron` REST endpoints mirror these functions for UI integration.