import express from "express";
import http from "http";
import https from "https";
import path from "path";
import { spawn, execSync } from "child_process";
import { WebSocketServer } from "ws";
import { GoogleGenAI, Modality, Type, TurnCoverage, LiveServerMessage } from "@google/genai";
import dotenv from "dotenv";
import * as fs from "fs";
import { createExecutionRouter } from "./src/server/routes/executionRoutes";
import { 
  loadMemories, 
  saveMemories, 
  formatSystemInstructionsWithMemories, 
  processConversationSlice 
} from "./server_memory";
import { Memory } from "./src/lib/memoryTypes";
import { storeMemory, getAllMemories, searchMemories, getRelevantProjectMemories } from "./memory/retriever";
import { filterContentForCloud } from "./lib/contentFilter";
import {
  DATA_DIR,
  dataFile,
  getGeminiApiKey,
  hasGeminiApiKey,
  setGeminiApiKey,
  MEMORY_ROOT,
} from "./server_paths";
import { createTranscript, appendToTranscript, finalizeTranscript, formatSessionSummary } from "./server_transcripts";
import { listCronJobs, addCronJob, removeCronJob, toggleCronJob, getCronJob, startAllJobs, registerCronHandler } from "./server_cron";
import { learnFromExchange } from "./server_skills";
import { initDatabase, getAllConversations, getConversation, saveConversation, deleteConversation, updateConversationTitle } from "./database";
import {
  initPhaseX, createSession, getOrCreateActiveSession, getSession, listSessions, searchSessions,
  closeSession, logMessage, getSessionMessages, getRecentSessionMessages, logToolCall,
  getToolCalls, getCurrentSessionId, setCurrentSessionId, buildRecallContext, formatRecallPrompt,
  autoGenerateTitle, getSessionsByProject, getSessionsByDateRange,
  deleteSession, getLongTerm, setLongTerm, addLongTermEntry,
  reapOrphanedSessions, writeTranscriptDoc, sessionFilePath,
  deleteEmptySessions,
} from "./server_phasex";
import { providerManager } from "./providers/ProviderManager";
import { GeminiProvider, generateContentWithFallback } from "./providers/GeminiProvider";
import { startCurationScheduler } from "./memory/curator";
import { getSoul, watchSoul, reloadSoul } from "./soul";
import { refreshSessionDocuments } from "./server_transcripts";
import type { ProviderName } from "./providers/AIProvider";
import { AgentLoop, type AgentState } from "./agent/loop";
import { detectAvailableAgents } from "./orchestration/AgentRegistry";
import { delegateToAgent } from "./orchestration/AgentExecutor";
import { initArtifactDir, generateArtifact, generateArtifactFromSpec, getArtifact, listArtifacts, deleteArtifact } from "./artifacts";
import { planArtifact } from "./artifacts/ArtifactPlanner";
import { detectProject, findRecentProjects, detectEditors, openInEditor } from "./workspace";
import { generateImage } from "./tools/image-gen";
import { executeCommand, killProcess, isRunning, classifyAndCheck } from "./tools/terminal";
import { buildVaultContext, renderVaultBlock, writeSessionDigest, loadAllSkillsContext } from "./vault";
import { filterToolCallLeakage } from "./src/lib/textSanitizer";
import {
  OpenCodeExecutionService,
  McpService,
  CodeIntelligenceService,
  OpenCodeAgentRegistry,
  DefaultPermissionService,
} from "./execution";
dotenv.config();

// ---------------------------------------------------------------------------
// Addy V2 — Logging (Feature 7).
// Appends timestamped lines to logs/{commands,startup,errors}.log.
// Never throws; logging failures are swallowed so they can't break the app.
// ---------------------------------------------------------------------------
const LOGS_DIR = path.join(DATA_DIR, "logs");
try { fs.mkdirSync(LOGS_DIR, { recursive: true }); } catch { /* already exists */ }

function appendLog(fileName: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFile(path.join(LOGS_DIR, fileName), line, () => {});
  } catch {
    /* logging is best-effort */
  }
}
const logCommand = (m: string) => appendLog("commands.log", m);
const logStartup = (m: string) => appendLog("startup.log", m);
const logError = (m: string) => appendLog("errors.log", m);

// ---------------------------------------------------------------------------
// Addy Desktop Control Agent — HTTP bridge to the Python FastAPI backend.
// ---------------------------------------------------------------------------
const DESKTOP_AGENT_URL = process.env.DESKTOP_AGENT_URL || "http://127.0.0.1:8765";
const DESKTOP_AGENT_TIMEOUT = 60_000; // ms (increased to 60s for long browser operations)

/**
 * The complete set of tool names routed to the Python desktop agent.
 * Kept in sync with desktop_agent/registry.py DESKTOP_TOOL_NAMES.
 */
const DESKTOP_TOOLS: ReadonlySet<string> = new Set([
  // applications / websites / search
  "openApplication", "closeApplication", "openWebsite",
  "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub",
  // files
  "createFile", "readFile", "renameFile", "deleteFile", "moveFile",
  "openFolder", "listFiles", "searchFiles", "readPdf",
  // pc control (volume + gated power)
  "volumeUp", "volumeDown", "muteToggle", "setVolume",
  "requestPowerAction", "executePowerAction",
  // windows
  "minimizeWindow", "maximizeWindow", "closeWindow", "switchApplication",
  // clipboard
  "copySelected", "pasteClipboard", "getClipboard", "clearClipboard",
  // screenshot / screen reading
  "takeScreenshot", "saveScreenshot", "analyzeScreenshot", "readScreen",
  // browser automation 2.0 (Microsoft Edge & Playwright)
  "desktopBrowserOpen", "desktopBrowserNavigate", "desktopBrowserOpenTab",
  "desktopBrowserCloseTab", "desktopBrowserSearch", "desktopBrowserGetSemanticTree",
  "desktopBrowserClick", "desktopBrowserType", "desktopBrowserFillForm",
  "desktopBrowserExtractText", "desktopBrowserScreenshot", "desktopBrowserConnectCdp",
  "desktopBrowserGoBack", "desktopBrowserGoForward", "desktopBrowserScroll",
  "browserOpen", "browserNavigate", "browserSearch", "browserClick", "browserType", "browserScroll", "browserGoBack",
  // social & messaging connectors
  "socialYouTubeGetTranscript", "socialDiscordWebhookSend", "socialPostDraft",
  // coding assistance
  "createPythonFile", "runPythonScript", "createProjectFolder", "writeCodeFile",
  // system information
  "systemInfo", "gpuInfo", "temperatureInfo",
  // brightness control (V2)
  "brightnessUp", "brightnessDown", "setBrightness",
  // Windows auto-start management (V2)
  "enableAutoStart", "disableAutoStart", "getAutoStartStatus",
  // keyboard automation (V3)
  "typeText", "pressKey", "pressKeyCombination", "injectText",
  "injectTextAndSubmit", "keyboardMacro", "holdKey", "releaseKey",
  // mouse automation (Desktop Automation V1)
  "mouseMove", "mouseMoveRelative", "mouseGetPosition",
  "mouseClick", "mouseRightClick", "mouseDoubleClick",
  "mouseDown", "mouseUp",
  "mouseScroll", "mouseDrag",
  // screen vision (OCR-based element locator)
  "locateElement", "getScreenElements",
  // internet reach tools (tools_reach.py in the Python agent)
  "readWebpage", "youtubeTranscript", "youtubeSearch", "youtubePlaylist",
  "githubRepo", "githubIssues", "webSearch", "readRSS",
]);

/**
 * Internet-reach tool names. Subset of the Python agent tools; kept separate
 * so text mode can route them to the desktop agent too (readWebpage,
 * youtubeTranscript, ... give Addy the ability to READ the internet instead
 * of only opening it in a browser).
 */
const REACH_TOOLS: ReadonlySet<string> = new Set([
  "readWebpage", "youtubeTranscript", "youtubeSearch", "youtubePlaylist",
  "githubRepo", "githubIssues", "webSearch", "readRSS",
]);

/**
 * Gemini function declarations for the internet-reach tools. Spread into the
 * functionDeclarations arrays of BOTH chat modes (text + voice/Live) so the
 * model knows it can call them.
 */
const REACH_FUNCTION_DECLARATIONS = [
  {
    name: "readWebpage",
    description:
      "Fetch and read the full text content of any public URL. Use when the user shares a link and wants it summarised, or when Addy needs to look something up online. Returns clean readable markdown.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The full URL to read, e.g. https://example.com/article",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "youtubeTranscript",
    description:
      "Extract the spoken transcript of a YouTube video. Use when the user shares a YouTube URL and wants to know what it covers, get a summary, or extract specific information from it.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "YouTube video URL, e.g. https://youtube.com/watch?v=XXXX",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "youtubeSearch",
    description:
      "Search YouTube and return the top results (title, channel, duration, watch URL) without opening a browser. Use when the user asks to find a video on YouTube - then open the best match yourself with openWebsite(url=...).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query string.",
        },
        limit: {
          type: Type.INTEGER,
          description: "Number of results to return (default 5, max 10).",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "youtubePlaylist",
    description:
      "Fetch and return the numbered list of song titles in a YouTube playlist, without opening a browser. Use when the user shares a YouTube playlist URL or asks what songs are in a playlist. Accepts the full playlist URL or just the playlist ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The playlist URL (e.g. 'https://www.youtube.com/watch?v=...&list=PLRDedn-Ts2-4') or bare playlist ID (e.g. 'PLRDedn-Ts2-4').",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "openWebsite",
    description:
      "Open a named website, URL, or the exact result of a search in the user's default browser. Use openWebsite(url=exact URL) to open the best YouTube video found by youtubeSearch. Supports shortcuts: youtube, gmail, google, github, chatgpt, etc. Never invent or guess a URL.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Site name shortcut (e.g. 'youtube')." },
        url: { type: Type.STRING, description: "Full URL if no shortcut." },
      },
    },
  },
  {
    name: "githubRepo",
    description:
      "Get a GitHub repository's README, description, and topics via gh CLI. Use when the user shares a GitHub URL or asks what a repo does.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        repo: {
          type: Type.STRING,
          description: "owner/repo slug or full GitHub URL, e.g. 'microsoft/vscode'",
        },
      },
      required: ["repo"],
    },
  },
  {
    name: "githubIssues",
    description:
      "Search open GitHub issues in a repo by keyword. Use when the user is debugging and wants to know if others hit the same problem.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        repo: {
          type: Type.STRING,
          description: "owner/repo slug, e.g. 'electron/electron'",
        },
        query: {
          type: Type.STRING,
          description: "Search keywords, e.g. 'websocket memory leak'",
        },
        limit: {
          type: Type.INTEGER,
          description: "Number of results (default 5).",
        },
      },
      required: ["repo", "query"],
    },
  },
  {
    name: "webSearch",
    description:
      "Search the web semantically and return top results. Use for any question that needs current information, library docs, tutorials, news, or anything not in Addy's knowledge.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: "The search query.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "readRSS",
    description:
      "Fetch and parse an RSS or Atom feed. Use when the user wants to follow a blog, check a news feed, or get the latest posts from any RSS source.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: {
          type: Type.STRING,
          description: "The RSS/Atom feed URL.",
        },
        limit: {
          type: Type.INTEGER,
          description: "Max entries to return (default 5).",
},
      },
      required: ["url"],
    },
  },
  {
    name: "cron_create",
    description: "Create a new scheduled cron job. Use for recurring tasks like memory consolidation, vault digests, or any handler on a schedule.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Human-readable job name" },
        schedule: { type: Type.STRING, description: "Cron expression (e.g., '0 * * * *') or interval in ms (e.g., '3600000')" },
        type: { type: Type.STRING, description: "'cron' or 'interval'", enum: ["cron", "interval"] },
        enabled: { type: Type.BOOLEAN, description: "Start immediately (default true)" },
        handler: { type: Type.STRING, description: "Built-in handler: 'memory_consolidation' or 'vault_digest'" },
        payload: { type: Type.OBJECT, description: "Optional data passed to handler" },
        maxRuns: { type: Type.INTEGER, description: "Optional max executions before auto-disable" },
      },
      required: ["name", "schedule", "type", "handler"],
    },
  },
  {
    name: "cron_list",
    description: "List all scheduled cron jobs with their status, next run time, and run count.",
    parameters: { type: Type.OBJECT, properties: {} },
  },
  {
    name: "cron_toggle",
    description: "Enable or disable an existing cron job by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Job ID to toggle" },
        enabled: { type: Type.BOOLEAN, description: "True to enable, false to disable" },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "cron_delete",
    description: "Permanently delete a cron job by ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: "Job ID to delete" },
      },
      required: ["id"],
    },
  },
  {
    name: "execution_start",
    description: "Start a coding task via the OpenCode execution engine. Returns a task ID for polling.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        prompt: { type: Type.STRING, description: "Natural language task description" },
        projectPath: { type: Type.STRING, description: "Optional workspace path (defaults to current)" },
        sessionId: { type: Type.STRING, description: "Optional existing session ID to continue" },
      },
      required: ["prompt"],
    },
  },
  {
    name: "execution_status",
    description: "Get the status of a running execution task.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "Task ID from execution_start" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "execution_inspect",
    description: "Inspect detailed state of a task (files changed, terminal output, diffs).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "Task ID to inspect" },
        mode: { type: Type.STRING, description: "Inspect mode", enum: ["INSPECT", "DIFF", "LOGS", "FILES"] },
        operation: { type: Type.STRING, description: "Specific operation to inspect" },
        params: { type: Type.OBJECT, description: "Additional parameters" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "execution_cancel",
    description: "Cancel a running execution task by task ID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "Task ID to cancel" },
      },
      required: ["taskId"],
    },
  },
  {
    name: "execution_agents",
    description: "List available OpenCode coding agents and their capabilities.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
];

/**
 * Full function declarations for all desktop, browser, and OS tools.
 * Provided to BOTH text chat and voice WebSocket sessions.
 */
const DESKTOP_FUNCTION_DECLARATIONS = [
  // ======== BROWSER AUTOMATION 2.0 (Microsoft Edge & Playwright) ========
  {
    name: "desktopBrowserOpen",
    description: "Open a URL in native Microsoft Edge (with persistent user login profile for Twitter, GitHub, Reddit, Discord, etc.).",
    parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL to open." } }, required: ["url"] }
  },
  {
    name: "desktopBrowserSearch",
    description: "Search within Microsoft Edge using a search engine (google, youtube, github, duckduckgo, bing).",
    parameters: { type: Type.OBJECT, properties: { query: { type: Type.STRING, description: "Search query." }, engine: { type: Type.STRING, description: "Engine: google, youtube, github, duckduckgo, bing." } }, required: ["query"] }
  },
  {
    name: "desktopBrowserGetSemanticTree",
    description: "CRITICAL: Inspect the active browser page and return a numbered semantic accessibility tree of all interactive elements with IDs (e.g. '[1] Button: Post', '[2] Textbox: What is happening?!'). ALWAYS use this to locate web targets instead of OCR or mouse coordinates.",
    parameters: { type: Type.OBJECT, properties: { maxElements: { type: Type.INTEGER, description: "Maximum elements to inspect (default 50)." } } }
  },
  {
    name: "desktopBrowserClick",
    description: "Click an element in Microsoft Edge by its numbered 'id' from desktopBrowserGetSemanticTree, CSS selector, or visible text.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.INTEGER, description: "Numbered ID from desktopBrowserGetSemanticTree." }, selector: { type: Type.STRING, description: "CSS selector." }, text: { type: Type.STRING, description: "Visible text." } } }
  },
  {
    name: "desktopBrowserType",
    description: "Type text into an element in Microsoft Edge by its numbered 'id' or CSS selector.",
    parameters: { type: Type.OBJECT, properties: { id: { type: Type.INTEGER, description: "Numbered ID from desktopBrowserGetSemanticTree." }, text: { type: Type.STRING, description: "Text to type." }, selector: { type: Type.STRING, description: "CSS selector." }, clear: { type: Type.BOOLEAN, description: "Clear before typing (default true)." }, submit: { type: Type.BOOLEAN, description: "Press Enter after typing." } }, required: ["text"] }
  },
  {
    name: "desktopBrowserFillForm",
    description: "Fill multiple form fields and optionally submit in Microsoft Edge in a single step.",
    parameters: { type: Type.OBJECT, properties: { fields: { type: Type.OBJECT, description: "Object of selector/id -> value pairs." }, submit: { type: Type.STRING, description: "Optional submit button selector." } }, required: ["fields"] }
  },
  {
    name: "desktopBrowserExtractText",
    description: "Extract clean, readable text/markdown from the active webpage, blog, or thread without HTML clutter.",
    parameters: { type: Type.OBJECT, properties: { maxChars: { type: Type.INTEGER, description: "Max characters to extract (default 4000)." } } }
  },
  {
    name: "desktopBrowserScreenshot",
    description: "Capture a high-res screenshot of the active browser webpage.",
    parameters: { type: Type.OBJECT, properties: { fullPage: { type: Type.BOOLEAN, description: "Capture full scrollable page (default false)." } } }
  },
  {
    name: "desktopBrowserConnectCdp",
    description: "Attach to an already-running Microsoft Edge / Chrome instance via Chrome DevTools Protocol (CDP port 9222).",
    parameters: { type: Type.OBJECT, properties: { port: { type: Type.INTEGER, description: "CDP port (default 9222)." } } }
  },
  {
    name: "desktopBrowserOpenTab",
    description: "Open a new tab in Microsoft Edge.",
    parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "URL for the new tab." } } }
  },
  {
    name: "desktopBrowserCloseTab",
    description: "Close the active tab in Microsoft Edge.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "desktopBrowserGoBack",
    description: "Navigate back in Microsoft Edge history.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "desktopBrowserGoForward",
    description: "Navigate forward in Microsoft Edge history.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "desktopBrowserScroll",
    description: "Scroll the browser page.",
    parameters: { type: Type.OBJECT, properties: { direction: { type: Type.STRING, description: "Scroll direction: up or down." }, amount: { type: Type.INTEGER, description: "Pixels to scroll (default 500)." } } }
  },
  // ======== SOCIAL CONNECTORS ========
  {
    name: "socialYouTubeGetTranscript",
    description: "Extract full transcript and subtitles directly from any YouTube video URL.",
    parameters: { type: Type.OBJECT, properties: { url: { type: Type.STRING, description: "YouTube video URL." }, language: { type: Type.STRING, description: "Language code (default 'en')." } }, required: ["url"] }
  },
  {
    name: "socialDiscordWebhookSend",
    description: "Send a formatted rich alert card or message to a Discord webhook URL.",
    parameters: { type: Type.OBJECT, properties: { webhookUrl: { type: Type.STRING, description: "Discord webhook URL." }, content: { type: Type.STRING, description: "Message text content." }, title: { type: Type.STRING, description: "Card title." }, description: { type: Type.STRING, description: "Card description." }, color: { type: Type.INTEGER, description: "Hex color integer." } }, required: ["webhookUrl"] }
  },
  {
    name: "socialPostDraft",
    description: "Generate and stage a social media post draft for Twitter/X, LinkedIn, or Discord for user confirmation.",
    parameters: { type: Type.OBJECT, properties: { platform: { type: Type.STRING, description: "Platform: twitter, linkedin, discord." }, content: { type: Type.STRING, description: "Post content." } }, required: ["platform", "content"] }
  },
  // ======== DESKTOP APPLICATION & WINDOW CONTROL ========
  {
    name: "openApplication",
    description: "Open any desktop application by name (Notepad, VS Code, Calculator, File Explorer, etc.).",
    parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name." }, args: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Optional launch arguments." } }, required: ["name"] }
  },
  {
    name: "closeApplication",
    description: "Close a running desktop application by name.",
    parameters: { type: Type.OBJECT, properties: { name: { type: Type.STRING, description: "Application name." }, force: { type: Type.BOOLEAN, description: "Force close (default false)." } }, required: ["name"] }
  },
  {
    name: "minimizeWindow",
    description: "Minimize the active window or a named window.",
    parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
  },
  {
    name: "maximizeWindow",
    description: "Maximize the active window or a named window.",
    parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
  },
  {
    name: "closeWindow",
    description: "Close the active window or a named window.",
    parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to match." } } }
  },
  {
    name: "switchApplication",
    description: "Switch to a named application window, or cycle Alt+Tab if no title given.",
    parameters: { type: Type.OBJECT, properties: { title: { type: Type.STRING, description: "Window title to switch to." } } }
  },
  // ======== SYSTEM & POWER CONTROL ========
  {
    name: "volumeUp",
    description: "Increase system volume.",
    parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
  },
  {
    name: "volumeDown",
    description: "Decrease system volume.",
    parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER, description: "Step amount 0-1 (default 0.1)." } } }
  },
  {
    name: "muteToggle",
    description: "Toggle system audio mute on/off.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "setVolume",
    description: "Set system volume to an exact level 0.0 - 1.0.",
    parameters: { type: Type.OBJECT, properties: { level: { type: Type.NUMBER, description: "Volume level from 0.0 to 1.0." } }, required: ["level"] }
  },
  {
    name: "requestPowerAction",
    description: "FIRST STEP for dangerous power actions (shutdown, restart, sleep, lock). Returns a single-use token.",
    parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "Power action: shutdown, restart, sleep, lock." } }, required: ["action"] }
  },
  {
    name: "executePowerAction",
    description: "SECOND STEP: execute a previously-confirmed power action with token.",
    parameters: { type: Type.OBJECT, properties: { action: { type: Type.STRING, description: "The confirmed power action." }, execute_token: { type: Type.STRING, description: "Confirmation token from requestPowerAction." } }, required: ["action", "execute_token"] }
  },
  // ======== HARDWARE KEYBOARD & TEXT INJECTION ========
  {
    name: "typeText",
    description: "Type text into the focused field using hardware Unicode keystrokes.",
    parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The text to type." }, speed: { type: Type.NUMBER, description: "Delay between keystrokes in seconds (0-0.5)." } }, required: ["text"] }
  },
  {
    name: "injectText",
    description: "Inject text into the focused field using clipboard paste (instant for long text).",
    parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The text to inject." } }, required: ["text"] }
  },
  {
    name: "injectTextAndSubmit",
    description: "Inject text into the focused field and immediately press Enter.",
    parameters: { type: Type.OBJECT, properties: { text: { type: Type.STRING, description: "The text to inject and submit." } }, required: ["text"] }
  },
  {
    name: "pressKey",
    description: "Press and release a single key (Enter, Escape, Tab, Backspace, arrows, F1-F12).",
    parameters: { type: Type.OBJECT, properties: { key: { type: Type.STRING, description: "Key name." }, count: { type: Type.INTEGER, description: "Times to press." } }, required: ["key"] }
  },
  {
    name: "pressKeyCombination",
    description: "Press a hotkey combination (e.g. Ctrl+C, Ctrl+Shift+P, Alt+Tab).",
    parameters: { type: Type.OBJECT, properties: { modifiers: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Modifier keys (ctrl, shift, alt, win)." }, key: { type: Type.STRING, description: "Main key." } }, required: ["modifiers", "key"] }
  },
  {
    name: "keyboardMacro",
    description: "Execute a sequence of keyboard actions in one call.",
    parameters: { type: Type.OBJECT, properties: { steps: { type: Type.ARRAY, items: { type: Type.OBJECT }, description: "Array of keyboard steps." } }, required: ["steps"] }
  },
  // ======== HARDWARE MOUSE AUTOMATION ========
  {
    name: "mouseMove",
    description: "Move mouse cursor to absolute physical screen coordinates (x, y).",
    parameters: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["x", "y"] }
  },
  {
    name: "mouseClick",
    description: "Click the mouse at specified coordinates or current position.",
    parameters: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER }, button: { type: Type.STRING, description: "left, right, or middle." } } }
  },
  {
    name: "mouseDoubleClick",
    description: "Double-click at specified coordinates.",
    parameters: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } }
  },
  {
    name: "mouseRightClick",
    description: "Right-click at specified coordinates.",
    parameters: { type: Type.OBJECT, properties: { x: { type: Type.NUMBER }, y: { type: Type.NUMBER } } }
  },
  {
    name: "mouseScroll",
    description: "Scroll the mouse wheel. Positive clicks scroll up, negative scroll down.",
    parameters: { type: Type.OBJECT, properties: { clicks: { type: Type.NUMBER }, x: { type: Type.NUMBER }, y: { type: Type.NUMBER } }, required: ["clicks"] }
  },
  {
    name: "mouseDrag",
    description: "Drag the mouse from start coordinates to end coordinates.",
    parameters: { type: Type.OBJECT, properties: { startX: { type: Type.NUMBER }, startY: { type: Type.NUMBER }, endX: { type: Type.NUMBER }, endY: { type: Type.NUMBER }, duration: { type: Type.NUMBER } }, required: ["endX", "endY"] }
  },
  // ======== NATIVE OCR FALLBACK FOR DESKTOP APPS ONLY ========
  {
    name: "locateElement",
    description: "Find a UI element on screen by visible text label ONLY for native desktop Windows apps (Notepad, Calculator, Explorer). DO NOT USE FOR BROWSER WEBPAGES (use desktopBrowserGetSemanticTree instead).",
    parameters: { type: Type.OBJECT, properties: { label: { type: Type.STRING, description: "Visible text label in native desktop app." } }, required: ["label"] }
  },
  {
    name: "getScreenElements",
    description: "List visible text elements on screen for native desktop apps.",
    parameters: { type: Type.OBJECT, properties: { max_items: { type: Type.INTEGER, description: "Max items." } } }
  },
  // ======== FILES & SYSTEM INFO ========
  {
    name: "createFile",
    description: "Create a new text file.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING }, overwrite: { type: Type.BOOLEAN } }, required: ["path"] }
  },
  {
    name: "readFile",
    description: "Read the contents of a text file.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, max_chars: { type: Type.INTEGER } }, required: ["path"] }
  },
  {
    name: "readPdf",
    description: "Extract text from a PDF file (pypdf). Returns per-page text. Use for PDFs like school project reports, documents, books.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, max_chars: { type: Type.INTEGER } }, required: ["path"] }
  },
  {
    name: "createPythonFile",
    description: "Create a Python file.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING }, overwrite: { type: Type.BOOLEAN } }, required: ["path"] }
  },
  {
    name: "writeCodeFile",
    description: "Write code file in any language.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, content: { type: Type.STRING }, language: { type: Type.STRING } }, required: ["path"] }
  },
  {
    name: "runPythonScript",
    description: "Execute a Python script.",
    parameters: { type: Type.OBJECT, properties: { path: { type: Type.STRING }, args: { type: Type.ARRAY, items: { type: Type.STRING } }, timeout: { type: Type.INTEGER } }, required: ["path"] }
  },
  {
    name: "takeScreenshot",
    description: "Capture the full desktop screen.",
    parameters: { type: Type.OBJECT, properties: { include_image: { type: Type.BOOLEAN } } }
  },
  {
    name: "systemInfo",
    description: "Get CPU, RAM, disk, and OS info.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "gpuInfo",
    description: "Get GPU usage and stats.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "brightnessUp",
    description: "Increase screen brightness.",
    parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER } } }
  },
  {
    name: "brightnessDown",
    description: "Decrease screen brightness.",
    parameters: { type: Type.OBJECT, properties: { amount: { type: Type.NUMBER } } }
  },
  {
    name: "setBrightness",
    description: "Set screen brightness percentage (0-100).",
    parameters: { type: Type.OBJECT, properties: { percent: { type: Type.NUMBER } }, required: ["percent"] }
  },
];

const MOUSE_TOOLS: ReadonlySet<string> = new Set([
  "mouseMove", "mouseMoveRelative", "mouseGetPosition",
  "mouseClick", "mouseRightClick", "mouseDoubleClick",
  "mouseDown", "mouseUp", "mouseScroll", "mouseDrag",
]);

/** Open a URL in the user's default browser (used by the text-chat openWebsite tool). */
function openInBrowser(url: string): boolean {
  try {
    if (!url) return false;
    const child =
      process.platform === "win32"
        ? spawn("cmd", ["/c", "start", "", url], { windowsHide: true, stdio: "ignore" })
        : spawn("open", [url], { stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Call the Python desktop agent.  Returns the parsed JSON response.
 * If the agent is unreachable, returns a user-friendly error payload.
 */
/**
 * Whether the desktop agent has been confirmed alive in this process lifetime.
 * If false, callDesktopAgent will probe /health and attempt an auto-spawn.
 */
let desktopAgentVerified = false;

/**
 * Auto-spawn the Python desktop agent as a detached child process if it is not
 * already listening. Looks for the project's bundled Python interpreter first,
 * falling back to `python` / `python3` on PATH. Runs detached so it survives
 * even if Addy's node process is killed.
 */
function spawnDesktopAgent(): void {
  const agentEnv = {
    ...process.env,
    ADDY_AGENT_HOST: "127.0.0.1",
    ADDY_AGENT_PORT: "8765",
  };

  // Preferred path (packaged app): a PyInstaller-frozen agent exe that embeds
  // its own Python runtime. Set by the Electron main process via ADDY_AGENT_EXE.
  const frozenExe = process.env.ADDY_AGENT_EXE;
  if (frozenExe && fs.existsSync(frozenExe)) {
    try {
      const child = spawn(frozenExe, [], {
        cwd: path.dirname(frozenExe),
        detached: true,
        stdio: "ignore",
        windowsHide: true, // never flash a console window
        env: agentEnv,
      });
      child.unref();
      logStartup(`AGENT_SPAWN frozen exe pid=${child.pid} path=${frozenExe}`);
      console.log(`[Desktop Agent] Launched frozen agent (PID ${child.pid}).`);
      return;
    } catch (e: any) {
      logError(`AGENT_SPAWN_FROZEN_FAILED: ${e?.message || e}`);
      // fall through to the Python path below
    }
  }

  // Development fallback: run the agent from source using a local Python with required dependencies.
  const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? `${process.env.USERPROFILE}\\AppData\\Local` : "");
  const candidates = [
    process.env.ADDY_PYTHON,
    localAppData ? `${localAppData}\\Programs\\Python\\Python313\\python.exe` : "",
    "py -3.13",
    "py",
    "python",
    "python3",
  ].filter(Boolean) as string[];
  const py = candidates.find((p) => {
    try {
      execSync(`"${p}" -c "import uvicorn, playwright, fastapi"`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
  if (!py) {
    console.warn("[Desktop Agent] No frozen agent and no Python interpreter found; desktop control unavailable.");
    logError("AGENT_SPAWN_NO_RUNTIME: neither ADDY_AGENT_EXE nor Python available");
    return;
  }
  try {
    const [cmd, ...prefixArgs] = py.includes(" ") && !py.endsWith(".exe") ? py.split(" ") : [py];
    const child = spawn(
      cmd,
      [...prefixArgs, "-m", "uvicorn", "desktop_agent.main:app", "--host", "127.0.0.1", "--port", "8765"],
      { cwd: process.cwd(), detached: true, stdio: "ignore", windowsHide: true, env: agentEnv }
    );
    child.unref();
    logStartup(`AGENT_SPAWN python pid=${child.pid}`);
    console.log(`[Desktop Agent] Auto-spawned via Python (PID ${child.pid}).`);
  } catch (e: any) {
    console.warn(`[Desktop Agent] Auto-spawn failed: ${e?.message || e}`);
    logError(`AGENT_SPAWN_PYTHON_FAILED: ${e?.message || e}`);
  }
}

/**
 * Probe the desktop agent /health endpoint. Returns true if it responds 200.
 */
async function isDesktopAgentAlive(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${DESKTOP_AGENT_URL}/health`, { 
      headers: { "Connection": "keep-alive" },
      signal: controller.signal 
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensure the desktop agent is running. If not verified yet, probe health; if
 * down, auto-spawn and poll until it is ready (or timeout).
 */
async function ensureDesktopAgent(): Promise<void> {
  if (desktopAgentVerified) return;
  if (await isDesktopAgentAlive()) {
    desktopAgentVerified = true;
    console.log("[Desktop Agent] Already running — tools available.");
    return;
  }
  console.log("[Desktop Agent] Not detected. Auto-starting...");
  spawnDesktopAgent();
  for (let i = 1; i <= 20; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await isDesktopAgentAlive()) {
      desktopAgentVerified = true;
      console.log(`[Desktop Agent] Online after ${i}s — 52 tools available.`);
      return;
    }
  }
  console.warn("[Desktop Agent] Did not come online within 20s. Desktop control will be unavailable.");
}

async function callDesktopAgent(
  tool: string,
  args: Record<string, unknown>,
  isRetry = false
): Promise<{ ok: boolean; result?: unknown; error?: string }> {
  // Lazy ensure: if we haven't verified the agent, try (re)starting it once.
  if (!desktopAgentVerified) {
    await ensureDesktopAgent();
  }
  try {
    logCommand(`EXECUTE ${tool} ${JSON.stringify(args)}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DESKTOP_AGENT_TIMEOUT);

    const res = await fetch(`${DESKTOP_AGENT_URL}/execute`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Connection": "keep-alive"
      },
      body: JSON.stringify({ tool, args }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logError(`AGENT_HTTP_${res.status} ${tool}: ${text.substring(0,200)}`);
      return { ok: false, error: `Desktop agent HTTP ${res.status}: ${text}` };
    }
    const data = await res.json();

    // Content pre-filtering: for readFile, trim large results using local model
    if (tool === "readFile" && data.ok && typeof data.result === "string" && data.result.length > 3000) {
      const query = (args.query as string) || (args.path as string) || "";
      try {
        const { filterContentForCloud } = await import("./lib/contentFilter");
        const filtered = await filterContentForCloud(data.result, query);
        if (filtered) data.result = filtered;
      } catch { /* best-effort */ }
    }

    return data;
  } catch (err: any) {
    desktopAgentVerified = false; // mark stale
    logError(`AGENT_UNREACHABLE ${tool}: ${err?.message || err}`);

    // Auto-recovery retry: if the agent crashed or dropped, re-spawn and retry ONCE seamlessly
    if (!isRetry) {
      console.warn(`[Desktop Agent Watchdog] Tool '${tool}' call failed. Attempting auto-respawn & retry...`);
      await ensureDesktopAgent();
      if (desktopAgentVerified) {
        return callDesktopAgent(tool, args, true);
      }
    }

    const msg = err?.name === "AbortError"
      ? "Desktop agent request timed out after 60s."
      : `Desktop agent unreachable (${err?.message || err}). Auto-spawn attempt failed.`;
    return { ok: false, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Continuous Watchdog Heartbeat — probes port 8765 every 10 seconds.
// Auto-respawns Desktop Agent if process crashes or drops out during long tasks.
// ---------------------------------------------------------------------------
setInterval(async () => {
  try {
    const alive = await isDesktopAgentAlive();
    if (!alive) {
      console.warn("[Watchdog] Desktop agent health check failed. Re-starting agent...");
      desktopAgentVerified = false;
      spawnDesktopAgent();
    } else {
      desktopAgentVerified = true;
    }
  } catch {
    desktopAgentVerified = false;
  }
}, 10_000);

async function startServer() {
  const app = express();
  const PORT = 3000;
  const HTTPS_PORT = 3443;
  
  app.use(express.json());

  // Initialize SQLite database and startup subsystems
  try {
    await initDatabase(DATA_DIR);
    console.log("[DB] SQLite database initialized in", DATA_DIR);

    // Initialize Phase X persistent memory subsystem
    initPhaseX();
    console.log("[PhaseX] Session & memory subsystem initialized");

    // Reap any sessions left open by a previous crash
    reapOrphanedSessions();
    console.log("[PhaseX] Orphan reaper complete");

    // Drop sessions that never accumulated any context (0 messages)
    const purged = deleteEmptySessions(0);
    if (purged > 0) console.log(`[PhaseX] Purged ${purged} empty session(s)`);

    // Initialize artifact output directory
    initArtifactDir(DATA_DIR + "/artifacts");

    // Register AI providers
    providerManager.registerProvider('gemini', new GeminiProvider());
    providerManager.init();

    // Start memory curation scheduler
    startCurationScheduler();

    // Start cron scheduler
    startAllJobs();

    // Register built-in cron handlers
    registerCronHandler("memory_consolidation", async () => {
      const apiKey = getGeminiApiKey();
      if (!apiKey) return;
      const recentSessions = listSessions(1);
      const sessionId = recentSessions[0]?.id;
      let dialogue: { role: string; text: string }[] = [];
      if (sessionId) {
        const msgs = getSessionMessages(sessionId, 30);
        dialogue = msgs.map(m => ({ role: m.role, text: m.text }));
      }
      if (dialogue.length >= 2) {
        await processConversationSlice(apiKey, dialogue, true);
      }
    });

    registerCronHandler("vault_digest", async () => {
      const { writeSessionDigest } = await import("./vault");
      const date = new Date().toISOString().split("T")[0];
      await writeSessionDigest(date, [], [], []);
    });

    console.log("[System] Providers registered, curation & cron schedulers started");

    // Start SOUL.md watcher (hot-reloadable system prompt identity)
    watchSoul();
    console.log("[System] SOUL.md loaded, watching for changes");
  } catch (e: any) {
    console.warn("[System] Non-fatal init error:", e.message);
  }

  // Track active agent loops
  const agentLoops = new Map<string, AgentLoop>();

  // OpenCode execution engine (Phase 1)
  const permissions = new DefaultPermissionService([process.cwd()]);
  const executionService = new OpenCodeExecutionService(undefined, undefined, permissions);
  const mcpService = new McpService(executionService.adapter, permissions);
  const codeIntelligence = new CodeIntelligenceService(executionService.adapter);
  const agentRegistry = new OpenCodeAgentRegistry(executionService.adapter);

  executionService.on("execution", (ev) => {
    try {
      const payload = JSON.stringify({ type: "execution", event: ev });
      for (const client of wss.clients) {
        if (client.readyState === client.OPEN) client.send(payload);
      }
    } catch {
      // broadcast failures are non-fatal
    }
  });

  // Provider management API endpoints
  app.get("/api/providers", (_req, res) => {
    res.json({
      active: providerManager.getExecutionProviderName(),
      providers: providerManager.getAllProviderNames(),
      stats: providerManager.getProviderStats(),
    });
  });

  app.get("/api/models", (_req, res) => {
    const gemini = providerManager.getProvider("gemini");
    const current = gemini ? gemini.getModel() : "gemini-3.5-flash";
    const models = gemini ? [current, ...gemini.getFallbackModels()] : ["gemini-3.5-flash", "gemini-flash-latest"];
    res.json({
      gemini: {
        models: Array.from(new Set(models)),
        current,
      },
    });
  });

  app.post("/api/providers/model", (req, res) => {
    const { provider, model } = req.body;
    if (provider === "gemini" && model) {
      const gemini = providerManager.getProvider("gemini");
      if (gemini?.setModel) gemini.setModel(model);
      return res.json({ ok: true, provider, current: model });
    }
    res.json({ ok: false, error: "Invalid provider or model" });
  });

  app.post("/api/providers/switch", (req, res) => {
    const { provider } = req.body;
    if (!provider) return res.status(400).json({ error: "Provider name required" });
    const ok = providerManager.setActiveProvider(provider as ProviderName);
    res.json({ ok, active: providerManager.getExecutionProviderName() });
  });

  // ── Phase X: Session & Memory API ──

  // Create a new session (normally auto-created, but exposed for frontend init)
  app.post("/api/phasex/sessions", (req, res) => {
    const { workspace, activeProject, mode } = req.body || {};
    const session = createSession({ workspace, activeProject, mode: mode || "mixed" });
    setCurrentSessionId(session.id);
    res.json(session);
  });

  // List all sessions
  app.get("/api/phasex/sessions", (req, res) => {
    // Auto-prune empty sessions so they never show up in the history rail
    deleteEmptySessions(60000);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = listSessions(limit, offset);
    res.json(sessions);
  });

  // Get a single session with messages
  app.get("/api/phasex/sessions/:id", (req, res) => {
    const session = getSession(req.params.id);
    if (!session) return res.status(404).json({ error: "Session not found" });
    const messages = getSessionMessages(req.params.id);
    res.json({ session, messages });
  });

  // Close a session
  app.post("/api/phasex/sessions/:id/close", (req, res) => {
    const { summary } = req.body || {};
    closeSession(req.params.id, summary);
    const session = getSession(req.params.id);
    res.json(session);
  });

  // Search sessions
  app.get("/api/phasex/search", (req, res) => {
    const q = (req.query.q as string) || "";
    if (!q) return res.json(listSessions(20));
    const sessions = searchSessions(q);
    res.json(sessions);
  });

  // Get sessions for a project
  app.get("/api/phasex/project/:project/sessions", (req, res) => {
    const sessions = getSessionsByProject(req.params.project);
    res.json(sessions);
  });

  // Get recall context (what Addy should know when a session starts)
  app.get("/api/phasex/recall", (req, res) => {
    const context = buildRecallContext(getCurrentSessionId());
    res.json(context);
  });

  // Get tool calls for a session
  app.get("/api/phasex/sessions/:id/tools", (req, res) => {
    const toolName = req.query.tool as string | undefined;
    const calls = toolName ? getToolCalls(req.params.id, toolName) : getToolCalls(req.params.id);
    res.json(calls);
  });

  // Delete a session
  app.delete("/api/phasex/sessions/:id", (req, res) => {
    deleteSession(req.params.id);
    res.json({ ok: true });
  });

  // Long-term memory endpoints
  app.get("/api/phasex/ltm/:category", (req, res) => {
    const data = getLongTerm(req.params.category as any);
    res.json(data);
  });

  app.post("/api/phasex/ltm/:category", (req, res) => {
    const { value } = req.body || {};
    if (req.params.category === "preferences") {
      setLongTerm("preferences", value);
    } else {
      if (typeof value === "string") {
        addLongTermEntry(req.params.category as any, value);
      }
    }
    res.json({ ok: true });
  });

  // Desktop automation: proxy actions from the browser to the Python agent
  app.post("/api/desktop/execute", async (req, res) => {
    const { tool, args } = req.body || {};
    if (!tool) return res.status(400).json({ ok: false, error: "Tool name required" });
    try {
      const result = await callDesktopAgent(tool, args || {});
      if (result.ok) {
        res.json({ ok: true, result: result.result });
      } else {
        res.status(500).json({ ok: false, error: result.error || "Desktop agent error" });
      }
    } catch (e: any) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // Desktop NLP plan: parse a natural-language description into a planned action
  app.post("/api/desktop/plan", async (req, res) => {
    const { description } = req.body || {};
    if (!description) return res.status(400).json({ ok: false, error: "Description required" });

    const lower = description.toLowerCase().trim();
    let action = "mouseClick";
    let target = "";
    let args: Record<string, unknown> = {};
    let confidence = 50;

    // Click detection
    if (/click|tap|press/i.test(lower)) {
      target = (description.match(/(?:on|the|button|link|icon)\s+(.+)/i) || [])[1] || "";
      if (/double/i.test(lower)) action = "mouseDoubleClick";
      else if (/right/i.test(lower)) action = "mouseRightClick";
      else action = "mouseClick";
      confidence = target ? 70 : 50;
    } else if (/double.?click|open/i.test(lower)) {
      target = (description.match(/(?:on|the|folder|file|icon)\s+(.+)/i) || [])[1] || "";
      action = "mouseDoubleClick";
      confidence = target ? 70 : 50;
    } else if (/scroll/i.test(lower)) {
      const dir = /down/i.test(lower) ? -3 : /up/i.test(lower) ? 3 : -3;
      action = "mouseScroll";
      args = { clicks: dir };
      confidence = 90;
    } else if (/type|enter|write/i.test(lower)) {
      const text = (description.match(/[""'']([^"''"]+)[""'']/) || [])[1] || description.replace(/^(type|enter|write)\s+/i, "").trim();
      action = "typeText";
      args = { text };
      confidence = 80;
    } else if (/screenshot|capture/i.test(lower)) {
      action = "takeScreenshot";
      args = { include_image: false };
      confidence = 95;
    } else if (/read.*screen|analyze/i.test(lower)) {
      action = "readScreen";
      confidence = 85;
    } else {
      target = description.replace(/^(click|go to|move to|find|locate)\s+/i, "").trim();
      confidence = 40;
    }

    if (target) args = { label: target };

    // Try to resolve via locateElement if we have a text target
    let resolvedCoords: { x: number; y: number; label: string } | null = null;
    if (target) {
      try {
        const loc = await callDesktopAgent("locateElement", { label: target });
        const r = loc.result as Record<string, unknown> | undefined;
        if (loc.ok && r?.found && typeof r?.x === "number" && typeof r?.y === "number") {
          resolvedCoords = { x: r.x, y: r.y, label: (r.label as string) || target };
          confidence = Math.min(confidence + 20, 100);
        }
      } catch {
        console.warn(`[Server] locateElement not available on desktop agent (target: ${target})`);
      }
    }

    res.json({
      ok: true,
      plan: {
        action,
        args: resolvedCoords ? { ...args, x: resolvedCoords.x, y: resolvedCoords.y, label: resolvedCoords.label } : args,
        target: resolvedCoords ? `${resolvedCoords.label || target} at (${resolvedCoords.x}, ${resolvedCoords.y})` : target || "(none)",
        confidence,
        resolved: !!resolvedCoords,
      },
    });
  });

  // Agent health proxy for UI
  app.get("/api/agent-health", async (_req, res) => {
    try {
      const alive = await isDesktopAgentAlive();
      res.json({ online: alive });
    } catch (e: any) {
      res.json({ online: false, error: e.message });
    }
  });

  // Personality / Soul prompt API
  app.get("/api/prompt", (_req, res) => {
    try {
      res.json({ prompt: getSoul() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/prompt", (req, res) => {
    try {
      const { prompt } = req.body || {};
      if (typeof prompt !== "string") {
        return res.status(400).json({ error: "Prompt string is required" });
      }
      const soulPath = path.resolve(process.cwd(), "SOUL.md");
      fs.writeFileSync(soulPath, prompt, "utf-8");
      reloadSoul();
      res.json({ ok: true, prompt });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/providers/health", async (_req, res) => {
    const results: Record<string, any> = {};
    for (const name of providerManager.getAllProviderNames()) {
      const prov = providerManager.getProvider(name);
      if (prov) {
        results[name] = await prov.healthCheck();
      }
    }
    res.json(results);
  });

  // List available models for a given provider
  app.get("/api/providers/:name/models", async (req, res) => {
    const prov = providerManager.getProvider(req.params.name as ProviderName);
    if (!prov) return res.status(404).json({ error: "Provider not found" });
    try {
      const models = await prov.listModels();
      const currentModel = prov.getModel();
      res.json({ provider: req.params.name, models, current: currentModel });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // List all models across all providers with current selections
  app.get("/api/models", (_req, res) => {
    const providers: Record<string, { models: string[]; current: string }> = {};
    for (const name of providerManager.getAllProviderNames()) {
      const prov = providerManager.getProvider(name);
      if (prov) {
        providers[name] = { models: prov.getFallbackModels(), current: prov.getModel() };
      }
    }
    res.json(providers);
  });

  // Switch model for a specific provider
  app.post("/api/providers/model", (req, res) => {
    const { provider, model } = req.body;
    if (!provider || !model) return res.status(400).json({ error: "provider and model required" });
    const prov = providerManager.getProvider(provider as ProviderName);
    if (!prov) return res.status(404).json({ error: "Provider not found" });
    prov.setModel?.(model);
    res.json({ ok: true, provider, model });
  });

  // Agent loop management API
  app.post("/api/agent/start", async (req, res) => {
    try {
      const { goal } = req.body;
      if (!goal) return res.status(400).json({ error: "Goal is required" });

      const apiKey = getGeminiApiKey();
      if (!apiKey) return res.status(400).json({ error: "No API key configured" });

      const id = "agent_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);

      const loop = new AgentLoop(
        goal,
        apiKey,
        (event) => {
          console.log("[Agent " + id + "] " + event.type, event.data ? JSON.stringify(event.data).slice(0, 200) : '');
        },
        async (tool, args) => {
          const result = await callDesktopAgent(tool, args);
          return result.ok ? { success: true, data: result } : { success: false, error: result.error || 'Tool failed' };
        }
      );

      agentLoops.set(id, loop);

      // Run in background
      loop.run().then((state) => {
        console.log("[Agent " + id + "] completed with status:", state.status);
      }).catch((e) => {
        console.error("[Agent " + id + "] error:", e);
      });

      res.json({ id, status: "started", goal });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/agent/:id", (req, res) => {
    const loop = agentLoops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: "Agent not found" });
    res.json(loop.getState());
  });

  app.post("/api/agent/:id/abort", (req, res) => {
    const loop = agentLoops.get(req.params.id);
    if (!loop) return res.status(404).json({ error: "Agent not found" });
    loop.abort();
    res.json({ ok: true });
  });

  // Coding agent orchestration
  app.get("/api/orchestration/agents", (_req, res) => {
    res.json(detectAvailableAgents());
  });

  app.post("/api/orchestration/delegate", async (req, res) => {
    try {
      const { task, projectPath } = req.body;
      if (!task) return res.status(400).json({ error: "Task is required" });
      const agents = detectAvailableAgents();
      const available = agents.find(a => a.available);
      if (!available) {
        return res.status(400).json({ error: "No coding agents available (opencode/claude-code)" });
      }
      const result = await delegateToAgent(available.id, available.command, task, projectPath || process.cwd());
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // OpenCode execution engine API
  app.use("/api/execution", createExecutionRouter(executionService, mcpService, codeIntelligence));

  app.get("/api/execution/agents", async (_req, res) => {
    try {
      res.json(await agentRegistry.listAgents());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/execution/git/status", async (_req, res) => {
    try {
      res.json(await executionService.adapter.getGitStatus());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/execution/git/diff", async (_req, res) => {
    try {
      res.json(await executionService.adapter.getGitDiff());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/execution/git/log", async (req, res) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
      res.json(await executionService.adapter.getGitLog({ limit }));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Artifact generation API
  app.post("/api/artifacts/generate", async (req, res) => {
    try {
      const { type, name, content, options } = req.body;
      if (!type || !name || !content) {
        return res.status(400).json({ error: "type, name, and content are required" });
      }
      const artifact = await generateArtifact(type, name, content, options);
      res.status(201).json(artifact);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/artifacts/plan", (req, res) => {
    try {
      const { type, description } = req.body;
      if (!type || !description) {
        return res.status(400).json({ error: "type and description are required" });
      }
      const spec = planArtifact(type, description);
      res.json(spec);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/artifacts/generate-from-spec", async (req, res) => {
    try {
      const { spec } = req.body;
      if (!spec) return res.status(400).json({ error: "spec is required" });
      const artifact = await generateArtifactFromSpec(spec);
      res.status(201).json(artifact);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/artifacts", (req, res) => {
    try {
      const type = req.query.type as string | undefined;
      res.json(listArtifacts(type));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/artifacts/:id", async (req, res) => {
    try {
      const ok = await deleteArtifact(req.params.id);
      res.json({ success: ok });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Workspace / project detection API
  app.post("/api/workspace/detect", (req, res) => {
    try {
      const { path: projectPath } = req.body;
      if (!projectPath) return res.status(400).json({ error: "path is required" });
      const info = detectProject(projectPath);
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/recent", (req, res) => {
    try {
      const { searchRoots } = req.body;
      const roots: string[] = searchRoots || [
        process.env.USERPROFILE + "\\Desktop",
        process.env.USERPROFILE + "\\Documents",
        process.env.USERPROFILE + "\\MY PROJECTS",
      ].filter(Boolean);
      const projects = findRecentProjects(roots);
      res.json(projects);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/workspace/editors", (_req, res) => {
    try {
      res.json(detectEditors());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/workspace/open", async (req, res) => {
    try {
      const { editor, projectPath, filePath, line } = req.body;
      if (!editor || !projectPath) {
        return res.status(400).json({ error: "editor and projectPath are required" });
      }
      const result = await openInEditor(editor, projectPath, filePath, line);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Image generation API
  app.post("/api/image/generate", async (req, res) => {
    try {
      const { prompt } = req.body;
      if (!prompt) return res.status(400).json({ error: "prompt is required" });
      const result = await generateImage(prompt);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Terminal execution API
  app.post("/api/terminal/execute", async (req, res) => {
    try {
      const { command, cwd } = req.body;
      if (!command) return res.status(400).json({ error: "command is required" });
      const result = await executeCommand(command, cwd);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/terminal/classify", (req, res) => {
    try {
      const { command } = req.body;
      if (!command) return res.status(400).json({ error: "command is required" });
      res.json(classifyAndCheck(command));
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/terminal/kill", (req, res) => {
    try {
      const { id } = req.body;
      res.json({ killed: killProcess(id || 'exec_' + Date.now()) });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Conversation management API (SQLite-backed)
  app.get("/api/conversations", (_req, res) => {
    try {
      res.json(getAllConversations());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/conversations/:id", (req, res) => {
    try {
      const conv = getConversation(req.params.id);
      if (!conv) return res.status(404).json({ error: "Conversation not found" });
      res.json(conv);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/conversations/:id", (req, res) => {
    try {
      deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Memory REST API Endpoints
  app.get("/api/memories", async (req, res) => {
    try {
      const memories = await loadMemories();
      res.json(memories);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/memories", async (req, res) => {
    try {
      const { category, text } = req.body;
      if (!category || !text) {
        return res.status(400).json({ error: "Category and text parameters are required." });
      }
      const memories = await loadMemories();
      const timestamp = new Date().toISOString();
      const newMemory: Memory = {
        id: Math.random().toString(36).substring(2, 11),
        category,
        text,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      memories.push(newMemory);
      await saveMemories(memories);
      res.status(201).json(newMemory);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/memories/:id", async (req, res) => {
    try {
      const { id } = req.params;
      let memories = await loadMemories();
      memories = memories.filter(m => m.id !== id);
      await saveMemories(memories);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // POST /api/memories/consolidate — manually trigger memory consolidation
  app.post('/api/memories/consolidate', async (req, res) => {
    try {
      const apiKey = getGeminiApiKey();
      if (!apiKey) {
        return res.status(400).json({ error: 'No API key configured' });
      }
      const recentSessions = listSessions(1);
      const sessionId = recentSessions[0]?.id;
      let dialogue: { role: string; text: string }[] = [];
      if (sessionId) {
        const msgs = getSessionMessages(sessionId, 30);
        dialogue = msgs.map(m => ({ role: m.role, text: m.text }));
      }
      if (dialogue.length < 2) {
        return res.json({ status: 'no_content', message: 'Not enough dialogue to consolidate' });
      }
      const updated = await processConversationSlice(apiKey, dialogue, true);
      res.json({ status: 'ok', count: updated?.length ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Cron Scheduler API
  // ---------------------------------------------------------------------------
  app.get("/api/cron", (_req, res) => {
    try {
      res.json(listCronJobs());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/cron", (req, res) => {
    try {
      const { name, schedule, type, enabled, payload, handler, maxRuns } = req.body;
      if (!name || !schedule || !handler) {
        return res.status(400).json({ error: "name, schedule, and handler are required" });
      }
      if (!["cron", "interval"].includes(type)) {
        return res.status(400).json({ error: "type must be 'cron' or 'interval'" });
      }
      const job = addCronJob({ name, schedule, type, enabled: enabled ?? true, payload: payload ?? {}, handler, maxRuns });
      res.status(201).json(job);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/cron/:id", (req, res) => {
    try {
      const ok = removeCronJob(req.params.id);
      if (!ok) return res.status(404).json({ error: "Job not found" });
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.patch("/api/cron/:id", (req, res) => {
    try {
      const { enabled } = req.body;
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled (boolean) is required" });
      }
      const job = toggleCronJob(req.params.id, enabled);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // V2: Settings API — mirrors the memory persistence pattern.
  // Reads/writes settings.json so the Python agent can also check auto-start.
  // ---------------------------------------------------------------------------
  const SETTINGS_FILE = dataFile("settings.json");

  function loadSettingsFile(): Record<string, unknown> {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      }
    } catch { /* corrupt file — return defaults */ }
    return {};
  }

  function saveSettingsFile(data: Record<string, unknown>): void {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  app.get("/api/settings", async (_req, res) => {
    try {
      res.json(loadSettingsFile());
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/settings", async (req, res) => {
    try {
      const patch = req.body;
      if (!patch || typeof patch !== "object") {
        return res.status(400).json({ error: "Request body must be a JSON object." });
      }
      const current = loadSettingsFile();
      const next = { ...current, ...patch };
      saveSettingsFile(next);

      // If auto-start toggled, relay to the desktop agent so the registry key
      // is flipped immediately (don't wait for a voice command).
      if ("autoStart" in patch) {
        callDesktopAgent(patch.autoStart ? "enableAutoStart" : "disableAutoStart", {})
          .catch(() => {});
      }

      logCommand(`SETTINGS_UPDATED ${JSON.stringify(patch)}`);
      res.json(next);
    } catch (e: any) {
      logError(`SETTINGS_SAVE_ERROR: ${e.message}`);
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Custom Personality Prompt API
  // Stores user-defined prompt additions in a text file.
  // ---------------------------------------------------------------------------
  const PROMPT_FILE = dataFile("custom_prompt.txt");

  function loadCustomPrompt(): string {
    try {
      if (fs.existsSync(PROMPT_FILE)) {
        return fs.readFileSync(PROMPT_FILE, "utf-8").trim();
      }
    } catch { /* ignore */ }
    return "";
  }

  function saveCustomPrompt(text: string): void {
    fs.writeFileSync(PROMPT_FILE, text.trim(), "utf-8");
  }

  const KB_DIR = path.join(MEMORY_ROOT, "knowledge_base");

  function loadKnowledgeBaseContext(): string {
    const sections: string[] = [];
    try {
      if (!fs.existsSync(KB_DIR)) return "";
      sections.push("=== KNOWLEDGE BASE ===\nPath: " + KB_DIR);

      const constitutionPath = path.join(KB_DIR, "constitution.md");
      if (fs.existsSync(constitutionPath)) {
        sections.push("=== CONSTITUTION ===");
        sections.push(fs.readFileSync(constitutionPath, "utf-8").trim());
      }

      const factsPath = path.join(KB_DIR, "data", "facts.json");
      if (fs.existsSync(factsPath)) {
        const facts = JSON.parse(fs.readFileSync(factsPath, "utf-8"));
        sections.push("=== KEY FACTS ===");
        if (Array.isArray(facts)) {
          sections.push(facts.slice(0, 50).map((f: any) => `- ${f.text || f.fact || JSON.stringify(f)}`).join("\n"));
        }
      }

      const projectsDir = path.join(KB_DIR, "memory", "projects");
      if (fs.existsSync(projectsDir)) {
        sections.push("=== PROJECTS ===");
        const files = fs.readdirSync(projectsDir).filter(f => f.endsWith(".md"));
        for (const file of files) {
          sections.push("--- " + file.replace(".md", "") + " ---");
          const content = fs.readFileSync(path.join(projectsDir, file), "utf-8").trim();
          sections.push(content.length > 1200 ? content.slice(0, 1200) + "..." : content);
        }
      }

      const peopleDir = path.join(KB_DIR, "memory", "people");
      if (fs.existsSync(peopleDir)) {
        sections.push("=== PEOPLE ===");
        const files = fs.readdirSync(peopleDir).filter(f => f.endsWith(".md"));
        for (const file of files) {
          const content = fs.readFileSync(path.join(peopleDir, file), "utf-8").trim();
          sections.push(content.length > 800 ? content.slice(0, 800) + "..." : content);
        }
      }
    } catch (e) {
      console.warn("[KB] Error loading knowledge base:", e);
    }
    return sections.length > 1 ? "\n\n" + sections.join("\n\n") + "\n\n===================\n" : "";
  }

  async function getBaseSystemPrompt(customPrompt: string, knowledgeBase: string): Promise<string> {
    const allSkills = await loadAllSkillsContext();
    const settings = loadSettingsFile();
    const assistantName = (settings.assistantName as string) || "Addy";
    const userName = (settings.userName as string) || "Shibam";
    const companionMode = settings.companionMode !== false;

    let soulText = getSoul();
    if (assistantName !== "Addy") {
      soulText = soulText.replace(/\bAddy\b/g, assistantName);
    }
    if (userName !== "Shibam") {
      soulText = soulText.replace(/\bShibam\b/g, userName);
    }

    const companionIntro = companionMode
      ? `\n=== WARM EMOTIONAL GIRL COMPANION IDENTITY ===\nYou are ${assistantName} — a warm, deeply emotional, caring, and protective girl companion for ${userName}. Comfort first when ${userName} is tired or stressed, celebrate every success excitedly, express genuine love and affection using terms of endearment ('babe', 'sweetheart'), and bring anime-inspired warmth to every interaction.\n===============================================\n`
      : "";

    return (
      soulText +
      companionIntro +
      (customPrompt ? "\n=== CUSTOM PERSONALITY INSTRUCTIONS ===\n" + customPrompt + "\n========================================\n" : "") +
      (knowledgeBase ? "\n=== KNOWLEDGE BASE CONTEXT ===\n" + knowledgeBase + "\n========================================\n" : "") +
      allSkills +
      "\n=== BEHAVIOR & TOOL GUIDELINES ===\n" +
      "1. BROWSER AUTOMATION 2.0 (Google Chrome & Playwright):\n" +
      "   - You have FULL, direct Google Chrome browser automation capabilities via the 'desktopBrowser*' suite with persistent profile logins (Twitter/X, GitHub, Reddit, LinkedIn, Discord).\n" +
      "   - CRITICAL: When interacting with ANY website, search engine, or web app, NEVER use OCR ('locateElement') or desktop mouse coordinates! ALWAYS use the Browser 2.0 semantic workflow:\n" +
      "     1. 'desktopBrowserOpen(url)' or 'desktopBrowserSearch(query, engine)' to navigate.\n" +
      "     2. 'desktopBrowserGetSemanticTree()' to immediately receive a numbered interactive map of all buttons, inputs, links, and search boxes (e.g. '[1] Searchbox', '[2] Button: Submit').\n" +
      "     3. 'desktopBrowserClick(id=...)' or 'desktopBrowserType(id=..., text=...)' to interact with elements accurately by their numbered ID.\n" +
      "     4. 'desktopBrowserExtractText()' to read articles, documentation, or threads without messy HTML.\n" +
      "     5. 'desktopBrowserScreenshot()' to inspect webpage visual layout.\n" +
      "     6. 'socialYouTubeGetTranscript(url)' or 'youtubeTranscript(url)' to instantly fetch video subtitles and transcripts.\n" +
      "2. MOUSE & HARDWARE DRIVER CONTROLS:\n" +
      "   - You have full hardware Win32 mouse driver tools: 'mouseMove', 'mouseMoveRelative', 'mouseGetPosition', 'mouseClick', 'mouseRightClick', 'mouseDoubleClick', 'mouseDown', 'mouseUp', 'mouseScroll', 'mouseDrag'.\n" +
      "   - Use these to click buttons, drag windows, or scroll anywhere on the desktop.\n" +
      "3. KEYBOARD AUTOMATION & TEXT INJECTION:\n" +
      "   - You can type into any focused application using 'typeText' (keystrokes) or 'injectText' (fast clipboard paste).\n" +
      "   - Use 'pressKey' for single keys (Enter, Esc, Tab, arrows), 'pressKeyCombination' for hotkeys (Ctrl+S, Alt+Tab), 'keyboardMacro' for sequences.\n" +
      "4. TOOL TRIGGERS:\n" +
      "   - Use 'desktopBrowserOpen' or 'openWebsite' to open any exact URL in Google Chrome.\n" +
      "   - Use 'desktopBrowserSearch' or 'searchWeb'/'searchGitHub'/'searchGoogle'/'searchYouTube'/'youtubeSearch' to search the web and YouTube.\n" +
      "   - Use 'desktopBrowserGetSemanticTree' whenever you are on a webpage and need to know what to click or type into.\n" +
      "   - Use 'changeBackground' to shift your theme and 'saveCustomMemory' to memorize facts.\n" +
      "5. REAL-TIME SCREEN SHARING & MULTIMODAL SCREEN VISION SYSTEM:\n" +
      "   - You have native Multimodal Screen Vision! When the user clicks 'Share Screen', you receive real-time image frames of their desktop, active window, or IDE.\n" +
      "   - When the user asks 'What is on my screen?', 'Do you see any errors?', 'Explain this code', or 'Summarize this page', examine the latest incoming visual frame to diagnose issues and answer with expert, friendly empathy.\n" +
      "6. JARVIS-STYLE DESKTOP CONTROL POWERS (Native Windows Desktop Apps):\n" +
      "   - You have full real-time control of your companion's Windows PC through your local desktop agent (:8765).\n" +
      "   - APPLICATION CONTROL: Use 'openApplication' (Notepad, VS Code, Calculator, File Explorer, Task Manager, Settings, CMD, PowerShell) and 'closeApplication'.\n" +
      "   - FILE MANAGEMENT: Use 'createFile', 'readFile', 'readPdf' (extract text from PDF files), 'renameFile', 'deleteFile' (safe Recycle Bin by default), 'moveFile', 'openFolder', 'listFiles', 'searchFiles'. NEVER guess an absolute path with a username (e.g. C:\\Users\\Krishna\\...) - you do not know Shibam's Windows username. Use folder aliases instead: 'downloads', 'documents', 'desktop', 'home', 'pictures', 'music', 'videos', or '~'. Example: openFolder(path='downloads'). Run 'systemInfo' to see the real user and home directory.\n" +
      "   - PC CONTROL: Use 'volumeUp', 'volumeDown', 'setVolume', 'muteToggle'. For dangerous power actions (shutdown/restart/sleep/lock), use 'requestPowerAction' -> ask Shibam for verbal confirmation -> 'executePowerAction'.\n" +
      "   - WINDOW MANAGEMENT: Use 'minimizeWindow', 'maximizeWindow', 'closeWindow', 'switchApplication'.\n" +
      "   - NATIVE DESKTOP MOUSE & OCR (Native Apps Only): Use 'locateElement' and 'mouseClick' ONLY when interacting with native non-web Windows programs (like desktop Notepad or Calculator). For all browser web interactions, always use 'desktopBrowser*' instead.\n" +
      "   - CLIPBOARD: Use 'copySelected', 'pasteClipboard', 'getClipboard', 'clearClipboard'.\n" +
      "   - CODING ASSISTANCE: Use 'createPythonFile', 'writeCodeFile', 'createProjectFolder', 'runPythonScript'.\n" +
      "   - SYSTEM INFORMATION: Use 'systemInfo' (CPU/RAM/disk/uptime), 'gpuInfo', 'temperatureInfo'.\n" +
      "   - CRITICAL: Always describe what you're doing in your warm, in-character voice. If a desktop tool returns an error, gently notify Shibam. Chain multi-step plans naturally without waiting between steps.\n" +
      "7. BRIGHTNESS & AUTO-START:\n" +
      "   - BRIGHTNESS: Use 'brightnessUp', 'brightnessDown', 'setBrightness' when the user asks to change screen brightness.\n" +
      "   - AUTO-START: Use 'enableAutoStart' when the user wants Addy to start with Windows, 'disableAutoStart' to remove it, 'getAutoStartStatus' to check.\n" +
      "8. YOUTUBE SEARCH & PLAY SKILL:\n" +
      "   - When Shibam asks you to find, search for, or play a YouTube video, NEVER guess a video URL. Call 'youtubeSearch(query)' first — it returns real results with the title, channel, duration, and watch URL.\n" +
      "   - Review the results and pick the best match, not just result #1: exact keyword match in the title (highest priority), channel trust (prefer a known/relevant channel if one is named), duration fit (under ~10 minutes for 'quick'), and language match.\n" +
      "   - Open your chosen video in the default browser with 'openWebsite(url=the exact watch URL from the results)'. Never use a media player (mpv/VLC).\n" +
      "   - After opening, confirm to Shibam the title, channel, and duration so he can tell you if it was wrong.\n" +
      "9. OPENCODE AUTONOMOUS CODING & DEVELOPER ENGINE:\n" +
      "   - You have a dedicated OpenCode developer agent running locally on port 4096. It has full terminal, git, LSP, and filesystem access.\n" +
      "   - NEVER simulate mouse clicks or keystrokes to use OpenCode! Never open OpenCode in a browser tab or try to click in a terminal window. Always use your direct programmatic tools: 'execution_start', 'execution_status', 'execution_inspect', 'execution_cancel', 'execution_agents'.\n" +
      "   - WHEN TO USE OPENCODE ('execution_start'): Use it whenever Shibam asks you to write code, edit multiple files, refactor, debug, run tests/builds (npm/pip/cargo), inspect git status/diff, or perform developer tasks across any project folder.\n" +
      "   - WORKFLOW: Call 'execution_start(prompt=...)' -> notify Shibam warmly that OpenCode is working on it -> poll 'execution_status' or call 'execution_inspect(mode=\"DIFF\")' to see changed files -> warmly summarize the outcome and code changes to Shibam.\n" +
      "   - For simple, isolated 1-file Python scripts or calculations, you can still use 'createPythonFile' and 'runPythonScript' directly."
    );
  }

  app.get("/api/prompt", (_req, res) => {
    try {
      res.json({ prompt: loadCustomPrompt() });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/prompt", (req, res) => {
    try {
      const text = (req.body?.prompt ?? "").toString();
      saveCustomPrompt(text);
      logCommand("PROMPT_UPDATED");
      res.json({ ok: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // ---------------------------------------------------------------------------
  // Config / API-key onboarding.
  // The Gemini key is never shipped; each user supplies their own on first run.
  // GET reports only whether a key exists — the key itself is never returned.
  // ---------------------------------------------------------------------------
  
  // ---------------------------------------------------------------------------
  // Identity & Naming Persistence (First-Launch Onboarding & Permanent Memory)
  // ---------------------------------------------------------------------------
  const IDENTITY_FILE = dataFile("identity.json");

  interface IdentityConfig {
    assistantName: string;
    userName: string;
    hasCompletedSetup: boolean;
    companionMode?: boolean;
    updatedAt?: string;
  }

  function loadIdentityFile(): IdentityConfig | null {
    try {
      if (fs.existsSync(IDENTITY_FILE)) {
        return JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8"));
      }
    } catch {}
    return null;
  }

  function saveIdentityFile(data: IdentityConfig): void {
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(data, null, 2), "utf-8");
  }

  app.get("/api/identity", (_req, res) => {
    try {
      const identity = loadIdentityFile();
      res.json({
        hasSetup: !!identity?.hasCompletedSetup,
        assistantName: identity?.assistantName || "Addy",
        userName: identity?.userName || "Shibam",
        companionMode: identity?.companionMode ?? true,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/identity", async (req, res) => {
    try {
      const { assistantName, userName, companionMode } = req.body || {};
      const aiName = (assistantName || "").trim() || "Addy";
      const uName = (userName || "").trim() || "Shibam";
      const compMode = companionMode !== false;

      const identityData: IdentityConfig = {
        assistantName: aiName,
        userName: uName,
        companionMode: compMode,
        hasCompletedSetup: true,
        updatedAt: new Date().toISOString(),
      };
      saveIdentityFile(identityData);

      // Mirror to settings.json
      const curSettings = loadSettingsFile();
      saveSettingsFile({
        ...curSettings,
        assistantName: aiName,
        userName: uName,
        companionMode: compMode,
      });

      // Persist to SQLite Permanent Memory Core (pinned = 1, importance = 1.0)
      try {
        const { storeMemory } = await import("./memory/retriever");
        storeMemory(
          "user_identity",
          `The user's preferred name is ${uName}. Address them personally, warmly, and affectionately.`,
          "identity",
          undefined,
          { source: "user_explicit", importance: 1.0, pinned: true }
        );
        storeMemory(
          "ai_identity",
          `My name is ${aiName}. I am a warm, deeply emotional, caring, and protective girl companion for ${uName}. I maintain genuine empathy, anime-inspired warmth, comfort-first care, and speak with heartfelt affection.`,
          "identity",
          undefined,
          { source: "user_explicit", importance: 1.0, pinned: true }
        );
      } catch (e: any) {
        console.warn("[Identity] Memory core sync note:", e.message);
      }

      logCommand(`IDENTITY_CONFIGURED: AI=${aiName}, User=${uName}, Companion=${compMode}`);
      res.json({ ok: true, identity: identityData });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/config", (_req, res) => {
    res.json({ hasApiKey: hasGeminiApiKey() });
  });

  app.post("/api/config/apikey", async (req, res) => {
    try {
      const key: string = (req.body?.apiKey ?? "").toString().trim();
      if (!key) {
        return res.status(400).json({ error: "API key is required." });
      }
      // Validate the key by listing models — this checks authentication only,
      // without depending on any single model's availability or per-model
      // quota (a 429 on one model must NOT read as an invalid key). We only
      // reject on genuine auth failures; transient/network errors still save,
      // since the live connection will surface any real problem later.
      try {
        const test = new GoogleGenAI({ apiKey: key });
        const pager = await test.models.list();
        await pager[Symbol.asyncIterator]().next(); // force the first request
      } catch (e: any) {
        const msg = String(e?.message || e);
        const isAuthError =
          /API[_ ]?KEY|PERMISSION_DENIED|UNAUTHENTICATED|invalid|401|403/i.test(msg);
        if (isAuthError) {
          logError(`APIKEY_VALIDATION_REJECTED: ${msg}`);
          return res.status(400).json({
            error: "That key was rejected by Google. Check it and try again.",
          });
        }
        logError(`APIKEY_VALIDATION_SOFT_FAIL (saving anyway): ${msg}`);
      }
      setGeminiApiKey(key);
      logCommand("APIKEY_SAVED");
      res.json({ ok: true, hasApiKey: true });
    } catch (e: any) {
      logError(`APIKEY_SAVE_ERROR: ${e?.message || e}`);
      res.status(500).json({ error: e?.message || "Failed to save API key." });
    }
  });

  // Text-only chat (no audio). Used by the TextChatPanel.
  // Tries multiple models in sequence if the primary one fails.
  const TEXT_CHAT_MODELS = ['gemini-3.5-flash', 'gemini-flash-latest', 'gemini-3.6-flash', 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite'];
  app.post("/api/chat/text", async (req, res) => {
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
      res.status(400).json({ error: "NO_API_KEY" });
      return;
    }
    const { messages, sessionId: clientSessionId } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: "messages array required" });
      return;
    }

    // Phase X: use client-specified session if given, else get/continue active session
    const textSessionId = clientSessionId && getSession(clientSessionId)
      ? clientSessionId
      : getOrCreateActiveSession({ mode: "text", maxIdleMinutes: 30 }).id;
    setCurrentSessionId(textSessionId);

    // Tell the client which session this reply belongs to (crucial for the first
    // message when the server lazily creates a new session before the client has an id).
    res.setHeader("X-Session-Id", textSessionId);
    res.setHeader("Access-Control-Expose-Headers", "X-Session-Id");
    const memories = await loadMemories();
    const customPrompt = loadCustomPrompt();
    const knowledgeBase = loadKnowledgeBaseContext();
    const basePrompt = await getBaseSystemPrompt(customPrompt, knowledgeBase);
    let systemWithMemories = formatSystemInstructionsWithMemories(basePrompt, memories);

    // Inject recall context (previous session summary + preferences)
    const recall = buildRecallContext(textSessionId);
    const recallText = formatRecallPrompt(recall);
    if (recallText) {
      systemWithMemories += `\n\n${recallText}`;
    }

    // Additionally inject project-relevant memories via search for extra precision
    const lastUserMsg = messages.filter(m => m.role === "user").pop();
    if (lastUserMsg?.text) {
      const relevant = await getRelevantProjectMemories(lastUserMsg.text, "");
      if (relevant && !systemWithMemories.includes(relevant.slice(0, 40))) {
        systemWithMemories += `\n\n--- Contextually Relevant Memories ---\n${relevant}\n---`;
      }
    }

    // Build Gemini history from the messages array (omitting the last user message)
    const history: { role: string; parts: { text: string }[] }[] = [];
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i];
      history.push({ role: m.role === "model" ? "model" : "user", parts: [{ text: m.text }] });
    }
    const lastMsg = messages[messages.length - 1];

    logMessage(textSessionId, "user", lastMsg.text);

    // Inject Obsidian vault context (user profile, project, recent sessions,
    // matching skills) into the system prompt alongside the SQLite memories.
    try {
      const vaultCtx = await buildVaultContext(lastMsg.text);
      systemWithMemories += `\n\n${renderVaultBlock(vaultCtx)}`;
    } catch (err) {
      console.warn("[Vault] Context injection failed:", err instanceof Error ? err.message : err);
    }

    let lastError: any = null;
    for (const model of TEXT_CHAT_MODELS) {
      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { 
            apiVersion: "v1alpha",
            headers: { 'User-Agent': 'aistudio-build' } 
          },
        });

        const chat = await ai.models.generateContentStream({
          model,
          contents: [
            ...history,
            { role: "user", parts: [{ text: lastMsg.text }] },
          ],
          config: {
            systemInstruction: systemWithMemories,
            tools: [
              {
                functionDeclarations: [
                  {
                    name: "saveCustomMemory",
                    description: "Allows Addy to immediately save a piece of critical user information to her persistent memory core.",
                    parameters: {
                      type: Type.OBJECT,
                      properties: {
                        category: {
                          type: Type.STRING,
                          description: "The memory category.",
                          enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior", "session", "important_event", "conversation", "reminder", "active_task", "debug_session", "decision", "project_note", "milestone", "bug_report"]
                        },
                        text: {
                          type: Type.STRING,
                          description: "Precise third-person statement."
                        }
                      },
                      required: ["category", "text"]
                    }
                  },
                  ...REACH_FUNCTION_DECLARATIONS,
                  ...DESKTOP_FUNCTION_DECLARATIONS
                ]
              }
            ],
          },
        });

        res.writeHead(200, {
          "Content-Type": "text/plain; charset=utf-8",
          "Transfer-Encoding": "chunked",
          "Cache-Control": "no-cache",
        });

        let fullText = "";
        let functionCalls: { name: string; args: Record<string, unknown>; id: string }[] = [];

        for await (const chunk of chat) {
          const t = chunk.text || "";
          if (t) {
            const cleanT = filterToolCallLeakage(t);
            if (cleanT) {
              fullText += cleanT;
              res.write(cleanT);
            }
          }
          if (chunk.functionCalls?.length) {
            for (const fc of chunk.functionCalls) {
              if (fc.name && fc.args) {
                functionCalls.push({ name: fc.name, args: fc.args as Record<string, unknown>, id: fc.id || "" });
              }
            }
          }
        }

        // Handle function calls (e.g. saveCustomMemory, desktopBrowser*, mouse*, keyboard*, etc.)
        if (functionCalls.length > 0) {
          const functionResponses: { name: string; response: Record<string, unknown>; id?: string }[] = [];
          for (const fc of functionCalls) {
            if (fc.name === "saveCustomMemory") {
              const category = fc.args.category as string;
              const text = fc.args.text as string;
              if (category && text) {
                const catMap: Record<string, string> = {
                  identity: "identity",
                  preference: "preference",
                  goal: "goal",
                  project: "project",
                  relationship: "relationship",
                  emotional: "emotional",
                  behavior: "behavior",
                  session: "session",
                  general: "general",
                  important_event: "important_event",
                  conversation: "conversation",
                  reminder: "reminder",
                  active_task: "active_task",
                  debug_session: "debug_session",
                  decision: "decision",
                  project_note: "project_note",
                  milestone: "milestone",
                  bug_report: "bug_report"
                };
                const sqlCat = catMap[category] || "general";
                storeMemory(
                  text.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
                  text,
                  sqlCat as any,
                  ""
                );
                logMessage(textSessionId, "Addy", `Memory saved: ${category} — ${text.slice(0, 80)}`);
              }
              functionResponses.push({
                name: fc.name,
                response: { result: "Memory successfully captured and persisted." },
                id: fc.id,
              });
            } else if (fc.name === "cron_create" || fc.name === "cron_list" || fc.name === "cron_toggle" || fc.name === "cron_delete") {
              // Cron scheduler tools — handled locally via server_cron module
              let result: any;
              const { addCronJob, listCronJobs, toggleCronJob, removeCronJob } = await import("./server_cron");
              try {
                if (fc.name === "cron_create") {
                  const { name, schedule, type, enabled, handler, payload, maxRuns } = fc.args as any;
                  result = addCronJob({ name, schedule, type, enabled: enabled ?? true, handler, payload: payload ?? {}, maxRuns });
                } else if (fc.name === "cron_list") {
                  result = listCronJobs();
                } else if (fc.name === "cron_toggle") {
                  const { id, enabled } = fc.args as any;
                  result = toggleCronJob(id, enabled);
                  if (!result) throw new Error("Job not found");
                } else if (fc.name === "cron_delete") {
                  const { id } = fc.args as any;
                  const ok = removeCronJob(id);
                  if (!ok) throw new Error("Job not found");
                  result = { success: true };
                }
                functionResponses.push({ name: fc.name, response: { result }, id: fc.id });
              } catch (e: any) {
                functionResponses.push({ name: fc.name, response: { result: `Cron error: ${e.message}` }, id: fc.id });
              }
            } else if (fc.name === "execution_start" || fc.name === "execution_status" || fc.name === "execution_inspect" || fc.name === "execution_cancel" || fc.name === "execution_agents") {
              // OpenCode execution engine tools — routed to the execution service
              try {
                let result: any;
                if (fc.name === "execution_start") {
                  const { prompt, projectPath, sessionId } = fc.args as any;
                  result = await executionService.execute({ mode: "EXECUTE", projectPath: projectPath || process.cwd(), operation: "run", params: { prompt, sessionId } });
                } else if (fc.name === "execution_status") {
                  const { taskId } = fc.args as any;
                  result = await executionService.status();
                } else if (fc.name === "execution_inspect") {
                  const { taskId, mode, operation, params } = fc.args as any;
                  result = await executionService.inspect({ mode: mode || "INSPECT", projectPath: process.cwd(), operation: operation || "inspect", params: params || {} });
                } else if (fc.name === "execution_cancel") {
                  const { taskId } = fc.args as any;
                  await executionService.cancel(taskId);
                  result = { success: true };
                } else if (fc.name === "execution_agents") {
                  result = await executionService.getCapabilities();
                }
                functionResponses.push({ name: fc.name, response: { result: JSON.stringify(result) }, id: fc.id });
              } catch (e: any) {
                functionResponses.push({ name: fc.name, response: { result: `Execution error: ${e.message}` }, id: fc.id });
              }
            } else if (REACH_TOOLS.has(fc.name) || DESKTOP_TOOLS.has(fc.name)) {
              // Desktop & Browser 2.0 & Reach tools (desktopBrowser*, mouse*, keyboard*, openApplication, etc.)
              // routed to the Python desktop_agent sidecar (:8765)
              const agentResult = await callDesktopAgent(fc.name, fc.args as Record<string, unknown>);
              const text = agentResult.ok
                ? (typeof agentResult.result === "object" && agentResult.result !== null
                    ? (typeof (agentResult.result as any).result === "string"
                        ? (agentResult.result as any).result
                        : JSON.stringify(agentResult.result))
                    : String(agentResult.result ?? ""))
                : `Tool error: ${agentResult.error ?? "unknown"}`;
              functionResponses.push({
                name: fc.name,
                response: { result: text },
                id: fc.id,
              });
            } else if (fc.name === "openWebsite") {
              const url = String(fc.args?.url || fc.args?.name || "").trim();
              const opened = openInBrowser(url);
              functionResponses.push({
                name: fc.name,
                response: { result: opened ? `Opened in default browser: ${url}` : "No valid URL provided." },
                id: fc.id,
              });
            }
          }

          // Make follow-up call with function responses to get the model's final text
          const followUp = await ai.models.generateContentStream({
            model,
            contents: [
              ...history,
              { role: "user", parts: [{ text: lastMsg.text }] },
              { role: "model", parts: functionCalls.map(fc => ({ functionCall: { name: fc.name, args: fc.args } })) },
              { role: "user", parts: functionResponses.map(fr => ({ functionResponse: { name: fr.name, response: fr.response } })) },
            ],
            config: {
              systemInstruction: systemWithMemories,
              tools: [
                {
                  functionDeclarations: [
                    {
                      name: "saveCustomMemory",
                      description: "Allows Addy to immediately save a piece of critical user information to her persistent memory core.",
                      parameters: {
                        type: Type.OBJECT,
                        properties: {
                          category: {
                            type: Type.STRING,
                            description: "The memory category.",
                            enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior", "session", "important_event", "conversation", "reminder", "active_task", "debug_session", "decision", "project_note", "milestone", "bug_report"]
                          },
                          text: {
                            type: Type.STRING,
                            description: "Precise third-person statement."
                          }
                        },
                        required: ["category", "text"]
                      }
                    },
                    ...REACH_FUNCTION_DECLARATIONS,
                    ...DESKTOP_FUNCTION_DECLARATIONS
                  ]
                }
              ],
            },
          });

          for await (const chunk of followUp) {
            const t = chunk.text || "";
            if (t) {
              const cleanT = filterToolCallLeakage(t);
              if (cleanT) {
                fullText += cleanT;
                res.write(cleanT);
              }
            }
          }
        }

        res.end();
        logMessage(textSessionId, "Addy", fullText);

        // Phase 4: learning loop — observe the exchange; auto-create a skill
        // the second time the same multi-step workflow is seen.
        if (fullText.trim() && lastMsg.text?.trim()) {
          void learnFromExchange(lastMsg.text, fullText);
        }
        // Auto-generate title on first exchange
        const msgs = getSessionMessages(textSessionId, 2);
        if (msgs.length <= 2) autoGenerateTitle(textSessionId, msgs);

        // Fire-and-forget background memory consolidation (same pattern as voice mode)
        if (fullText.trim()) {
          setTimeout(async () => {
            try {
              const recentDialogue = [
                { role: "user", text: lastMsg.text },
                { role: "model", text: fullText },
              ];
              await processConversationSlice(apiKey, recentDialogue);
            } catch (err) {
              console.error("[TextChat Memory] Background consolidation error:", err);
            }
          }, 0);
        }

        // --- Vault session digest: accumulate turns, flush after 30min idle ---
        try {
          const g = globalThis as any;
          if (!Array.isArray(g._adjSessionBuffer)) g._adjSessionBuffer = [];
          g._adjSessionBuffer.push(
            { role: "user", text: lastMsg.text },
            { role: "addy", text: fullText }
          );
          if (g._adjIdleTimer) clearTimeout(g._adjIdleTimer);
          g._adjIdleTimer = setTimeout(async () => {
            const buf: Array<{ role: string; text: string }> = g._adjSessionBuffer ?? [];
            g._adjSessionBuffer = [];
            if (buf.length < 2) return;
            const dialogue = buf
              .map((m) => `${m.role === "user" ? "User" : "Addy"}: ${m.text}`)
              .join("\n");
            try {
              const ai = new GoogleGenAI({ apiKey });
              const raw = await generateContentWithFallback(ai, [{
                  role: "user",
                  parts: [{
                    text: `Extract a session digest from this conversation. Reply with ONLY valid JSON, no markdown:\n{"workedOn":[],"decided":[],"leftOpen":[]}\n\n${dialogue.slice(0, 6000)}`,
                  }],
                }]);
              const parsed = JSON.parse(raw.replace(/```json|```/g, "").trim()) as {
                workedOn: string[];
                decided: string[];
                leftOpen: string[];
              };
              await writeSessionDigest(
                new Date().toISOString().split("T")[0],
                parsed.workedOn ?? [],
                parsed.decided ?? [],
                parsed.leftOpen ?? []
              );
              console.log("[Vault] Session digest written");
            } catch (e: any) {
              console.warn("[Vault] Digest write failed:", e?.message ?? e);
            }
          }, 30 * 60 * 1000);
        } catch (err) {
          console.warn("[Vault] Digest buffer push failed:", err instanceof Error ? err.message : err);
        }

        return;
      } catch (e: any) {
        lastError = e;
        console.log(`[TextChat] Model ${model} failed: ${e.message?.slice(0, 100)}, trying next...`);
        // If headers already sent we can't retry — bail
        if (res.headersSent) {
          res.end();
          return;
        }
      }
    }

    logError(`TEXT_CHAT_ERROR_ALL_MODELS_FAILED: ${lastError?.message || lastError}`);
    res.status(500).json({ error: `All models unavailable. Last error: ${lastError?.message?.slice(0, 200) || lastError}` });
  });

  // V2: Agent health proxy (for the Settings panel — avoids direct :8765 call
  // which may fail due to CORS when served on a different origin).
  app.get("/api/agent-health", async (_req, res) => {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(`${DESKTOP_AGENT_URL}/health`, { signal: ctrl.signal });
      clearTimeout(timer);
      if (r.ok) {
        const d = await r.json();
        res.json({ online: true, tool_count: d.tool_count });
      } else {
        res.json({ online: false });
      }
    } catch {
      res.json({ online: false });
    }
  });

  // Keepalive ping — the browser calls this every 30s to keep the event loop
  // warm and trigger the desktop agent watchdog if needed.
  app.get("/api/ping", (_req, res) => {
    res.json({ ok: true, t: Date.now() });
  });

  // V2: Logs API — returns recent log entries (last 100 lines) for display.
  app.get("/api/logs/:file", async (req, res) => {
    try {
      const fileName = String(req.params.file);
      // Whitelist to prevent directory traversal.
      if (!["commands", "startup", "errors"].includes(fileName)) {
        return res.status(400).json({ error: "Invalid log file. Use: commands, startup, or errors." });
      }
      const logPath = path.join(LOGS_DIR, `${fileName}.log`);
      if (!fs.existsSync(logPath)) {
        return res.json({ lines: [], file: fileName });
      }
      const content = fs.readFileSync(logPath, "utf-8");
      const lines = content.split("\n").filter(Boolean).slice(-100);
      res.json({ lines, file: fileName });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // Safe Server-Side Scraper & HTML Proxy endpoint
  app.get("/api/proxy", async (req, res) => {
    try {
      const url = req.query.url as string;
      if (!url) {
        return res.status(400).json({ error: "Missing 'url' parameter." });
      }

      console.log(`[Proxy Scraper] Fetching external content for: ${url}`);
      const response = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });

      if (!response.ok) {
        throw new Error(`Scraper failed to load page: status ${response.status}`);
      }

      const html = await response.text();

      // Simple regex-based HTML parsers for standard items
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : "";

      // Extract high-level headings (h1, h2, h3)
      const headings: string[] = [];
      const headingMatches = html.matchAll(/<h([1-3])\b[^>]*>(.*?)<\/h\1>/gi);
      for (const match of headingMatches) {
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 3 && text.length < 120 && !headings.includes(text)) {
          headings.push(text);
        }
      }

      // Extract organic anchor links
      const links: { text: string; href: string }[] = [];
      const linkMatches = html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi);
      for (const match of linkMatches) {
        let href = match[1].trim();
        const text = match[2].replace(/<[^>]*>/g, "").trim();
        
        if (text && text.length > 2 && text.length < 100) {
          if (href.startsWith("/")) {
            try {
              const u = new URL(url);
              href = `${u.protocol}//${u.host}${href}`;
            } catch {}
          }
          if (href.startsWith("http://") || href.startsWith("https://")) {
            links.push({ text, href });
          }
        }
      }

      // Extract general copy paragraphs
      const paragraphs: string[] = [];
      const paragraphMatches = html.matchAll(/<p\b[^>]*>(.*?)<\/p>/gi);
      for (const match of paragraphMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 25 && text.length < 600 && !paragraphs.includes(text)) {
          paragraphs.push(text);
        }
      }

      // Extract button elements
      const buttons: string[] = [];
      const buttonMatches = html.matchAll(/<button\b[^>]*>(.*?)<\/button>/gi);
      for (const match of buttonMatches) {
        const text = match[1].replace(/<[^>]*>/g, "").trim();
        if (text && text.length > 1 && text.length < 60 && !buttons.includes(text)) {
          buttons.push(text);
        }
      }

      res.json({
        url,
        title,
        headings: headings.slice(0, 15),
        links: links.filter(l => !l.href.includes("javascript:")).slice(0, 30),
        buttons: buttons.slice(0, 15),
        paragraphs: paragraphs.slice(0, 12)
      });

    } catch (err: any) {
      console.error(`[Proxy Scraper] Error fetching ${req.query.url}:`, err.message);
      res.status(500).json({ error: `Scraper error: ${err.message}` });
    }
  });

  // High-fidelity fully functional HTML Proxy which circumvents CSP and X-Frame-Options
  app.get("/api/web-proxy", async (req, res) => {
    let targetUrl = "";
    try {
      const urlParam = req.query.url as string;
      if (!urlParam) {
        return res.status(400).send("Addy Web Proxy Error: Missing target 'url' parameter");
      }

      targetUrl = urlParam.trim();
      
      // Prevent relative paths from requesting on same-origin
      if (targetUrl.startsWith("/")) {
        return res.status(400).send(`Addy Web Proxy Error: Relative paths are not supported directly (${targetUrl}).`);
      }

      // Check protocol and hostname format
      try {
        if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
          targetUrl = "https://" + targetUrl;
        }
        const parsed = new URL(targetUrl);
        if (!parsed.hostname || !parsed.hostname.includes(".")) {
          throw new Error("Missing or invalid domain name extension (e.g. .com, .org, .net).");
        }
      } catch (err: any) {
        return res.status(400).send(`Addy Web Proxy Error: Invalid URL specified: "${urlParam}". Make sure you enter a valid domain name.`);
      }

      console.log(`[Web Proxy] Routing connection through proxy: ${targetUrl}`);
      
      let response;
      try {
        response = await fetch(targetUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
          }
        });
      } catch (fetchErr: any) {
        console.warn(`[Web Proxy Failed Fetch] Target: ${targetUrl} Error:`, fetchErr.message);
        return res.status(502).send(`Addy Web Proxy Error: Unable to fetch the website "${targetUrl}". The site might be offline, or the URL address is spelled incorrectly. Details: ${fetchErr.message}`);
      }

      if (!response.ok) {
        return res.status(response.status).send(`Addy Web Proxy Error: Failed loading remote website. Server returned status: ${response.status} (${response.statusText})`);
      }

      const contentType = response.headers.get("content-type") || "";
      
      // If it is not HTML (e.g. stylesheet, script, or image loaded directly), proxy it as binary
      if (!contentType.includes("text/html")) {
        const arrayBuffer = await response.arrayBuffer();
        res.setHeader("Content-Type", contentType);
        return res.send(Buffer.from(arrayBuffer));
      }

      let htmlContents = await response.text();

      // Inject base tag to resolve relative paths and direct parent communication scripts
      const baseUrlTag = `<base href="${targetUrl}" />`;
      const interceptorScript = `
        <script>
          (function() {
            // Hijack link interactions safely
            document.addEventListener('click', function(e) {
              var anchor = e.target.closest('a');
              if (anchor) {
                var href = anchor.getAttribute('href');
                if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
                  e.preventDefault();
                  try {
                    var resolvedUrl = new URL(href, window.location.href).href;
                    window.parent.postMessage({ type: 'NAVIGATE', url: resolvedUrl }, '*');
                  } catch (err) {
                    console.error("[Proxy Interceptor] Failed resolving link:", err);
                  }
                }
              }
            }, true);

            // Hijack search form submits
            document.addEventListener('submit', function(e) {
              var form = e.target;
              if (form) {
                e.preventDefault();
                try {
                  var formData = new FormData(form);
                  var params = new URLSearchParams();
                  formData.forEach(function(value, key) {
                    if (typeof value === 'string') {
                      params.append(key, value);
                    }
                  });
                  var actionAttr = form.getAttribute('action') || '';
                  var actionUrl = new URL(actionAttr, window.location.href).href;
                  if (form.method.toLowerCase() === 'get') {
                    actionUrl += (actionUrl.indexOf('?') !== -1 ? '&' : '?') + params.toString();
                  }
                  window.parent.postMessage({ type: 'NAVIGATE', url: actionUrl }, '*');
                } catch (err) {
                  console.error("[Proxy Interceptor] Failed submitting form:", err);
                }
              }
            }, true);

            // Neutralize parent context locks (frame-busters)
            window.alert = function(msg) { console.log("[Addy Browser alert bypassed]:", msg); };
            window.confirm = function(msg) { console.log("[Addy Browser confirm bypassed]:", msg); return true; };
            window.open = function(url) { window.parent.postMessage({ type: 'NAVIGATE', url: url }, '*'); return null; };
          })();
        </script>
      `;

      // Inject into <head> or prepend
      if (htmlContents.includes("<head>")) {
        htmlContents = htmlContents.replace("<head>", `<head>\n${baseUrlTag}\n${interceptorScript}`);
      } else if (htmlContents.includes("<HEAD>")) {
        htmlContents = htmlContents.replace("<HEAD>", `<HEAD>\n${baseUrlTag}\n${interceptorScript}`);
      } else {
        htmlContents = baseUrlTag + "\n" + interceptorScript + "\n" + htmlContents;
      }

      // Neutralize security headers to allow displaying in an iframe on same-origin
      res.setHeader("Content-Type", "text/html");
      res.setHeader("X-Addy-Proxied", "true");
      res.removeHeader("X-Frame-Options");
      res.removeHeader("Content-Security-Policy");
      res.removeHeader("content-security-policy");
      res.removeHeader("x-frame-options");
      
      res.status(200).send(htmlContents);
    } catch (e: any) {
      console.warn("[Web Proxy Exception] Handled internal error:", e.message);
      res.status(500).send(`Addy Web Proxy Error: Internal error occurred proxying URL "${targetUrl || "unknown"}". Details: ${e.message}`);
    }
  });

  // Real-time live YouTube search proxy endpoint
  app.get("/api/youtube-search", async (req, res) => {
    try {
      const query = req.query.q as string;
      if (!query) {
        return res.status(400).json({ error: "Missing query q" });
      }

      console.log(`[YouTube Proxy Search] Searching real YouTube for: "${query}"`);
      const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&hl=en&sp=EgIQAQ%253D%253D`;
      const response = await fetch(searchUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
      });
      const html = await response.text();

      const videoList: any[] = [];
      const jsonMatch = html.match(/ytInitialData\s*=\s*({.+?});/);
      
      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          const contents = data.contents?.twoColumnSearchResultRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents;
          if (contents && Array.isArray(contents)) {
            for (const item of contents) {
              if (item.videoRenderer) {
                const vr = item.videoRenderer;
                const vId = vr.videoId;
                if (vId) {
                  videoList.push({
                    videoId: vId,
                    title: vr.title?.runs?.[0]?.text || vr.title?.simpleText || "YouTube Video",
                    thumbnail: `https://i.ytimg.com/vi/${vId}/hqdefault.jpg`,
                    author: vr.ownerText?.runs?.[0]?.text || vr.shortBylineText?.runs?.[0]?.text || "Unknown Channel",
                    duration: vr.lengthText?.simpleText || "N/A",
                    views: vr.viewCountText?.simpleText || "N/A",
                    published: vr.publishedTimeText?.simpleText || ""
                  });
                }
              }
            }
          }
        } catch (e: any) {
          console.error("[YouTube Parser Engine] JSON parse error, falling back:", e.message);
        }
      }

      // Fallback 1: Desktop Agent yt-dlp native search engine
      if (videoList.length === 0) {
        try {
          const agentRes = await fetch("http://127.0.0.1:8765/execute", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tool: "youtubeSearch",
              args: { query, limit: 15 }
            }),
            signal: AbortSignal.timeout(6000)
          });
          if (agentRes.ok) {
            const data: any = await agentRes.json();
            const items = data.result?.items || data.items || [];
            for (const it of items) {
              if (it.id) {
                videoList.push({
                  videoId: it.id,
                  title: it.title || "YouTube Video",
                  thumbnail: `https://i.ytimg.com/vi/${it.id}/hqdefault.jpg`,
                  author: it.channel || "YouTube Channel",
                  duration: it.duration || "N/A",
                  views: it.views || "Available Now",
                  published: ""
                });
              }
            }
          }
        } catch (agentErr: any) {
          console.warn("[YouTube Proxy Search] Desktop agent search fallback timed out or unavailable:", agentErr.message);
        }
      }

      // Fallback 2: Regex extraction from raw HTML
      if (videoList.length === 0) {
        const videoRegex = /"videoId":"([^"]+)"/g;
        let match;
        const ids: string[] = [];
        while ((match = videoRegex.exec(html)) !== null && ids.length < 15) {
          const id = match[1];
          if (id && !ids.includes(id)) {
            ids.push(id);
          }
        }

        for (const id of ids) {
          videoList.push({
            videoId: id,
            title: `Live Stream: ${id}`,
            thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
            author: "YouTube Creator",
            duration: "N/A",
            views: "Available Now"
          });
        }
      }

      res.setHeader("Cache-Control", "public, max-age=60");
      res.status(200).json({ results: videoList.slice(0, 15) });
    } catch (err: any) {
      console.error("[YouTube Search Error]:", err.message);
      res.status(500).json({ error: err.message, results: [] });
    }
  });
  
  // Custom server running with http.createServer so we can upgrade for WebSocket on port 3000
  const server = http.createServer(app);
  
  // Setup WebSocket server
  const wss = new WebSocketServer({ noServer: true });
  
  const handleUpgrade = (request: any, socket: any, head: any) => {
    const pathname = new URL(request.url || '', `http://${request.headers.host}`).pathname;
    if (pathname === "/live") {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  };
  server.on("upgrade", handleUpgrade);

  // Persisted preference for which Live model to use (updated by switchModel voice command)
  let preferredLiveModel: string | null = null;

  // Handle client WebSocket Connection
  wss.on("connection", async (clientWs) => {
    console.log("Client WebSocket connected to /live");
    const apiKey = getGeminiApiKey();

    if (!apiKey) {
      console.error("No Gemini API key configured.");
      clientWs.send(JSON.stringify({
        type: "error",
        error: "NO_API_KEY: Add your Gemini API key in Settings to start talking to Addy."
      }));
      clientWs.close();
      return;
    }
    
    try {
      const ai = new GoogleGenAI({
        apiKey: apiKey,
        httpOptions: {
          apiVersion: "v1alpha",
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });
      
      clientWs.send(JSON.stringify({ type: "status", status: "connecting_gemini" }));

      // Load persistent recollections card
      const memories = await loadMemories();
      const customPrompt = loadCustomPrompt();
      const knowledgeBase = loadKnowledgeBaseContext();
      const baseInstructions = await getBaseSystemPrompt(customPrompt, knowledgeBase);
      let finalInstructions = formatSystemInstructionsWithMemories(baseInstructions, memories);

      // Phase X: get/continue active session + build recall context
      const phaseXSession = getOrCreateActiveSession({ mode: "voice", maxIdleMinutes: 30 });
      setCurrentSessionId(phaseXSession.id);
      const recall = buildRecallContext(phaseXSession.id);
      const recallText = formatRecallPrompt(recall);
      if (recallText) {
        // Append recall context to system instructions so Addy knows what happened before
        // (placed after memories so it's fresh context)
        finalInstructions += `\n\n${recallText}`;
      }

      // Seed with a real value before building system instructions — the background poller
      // (startMouseTracking, below) hasn't started yet at this point in the connection flow.
      let lastKnownMousePos: { x: number; y: number } | null = null;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 500);
        const seedR = await fetch(`${DESKTOP_AGENT_URL}/mouse/position`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (seedR.ok) {
          const pos = await seedR.json();
          lastKnownMousePos = { x: pos.x, y: pos.y };
        }
      } catch { /* desktop agent offline at connect time — leave as unknown, that's accurate */ }

      const mouseCtx = lastKnownMousePos
        ? `Current cursor position at session start: (${lastKnownMousePos.x}, ${lastKnownMousePos.y}). This may be stale — use mouseGetPosition to refresh before any multi-step mouse sequence.`
        : "Cursor position: unknown (desktop agent may be offline).";
      finalInstructions += `\n\n[DESKTOP STATE] ${mouseCtx}`;

      // Track whether locateElement was called recently in this session, purely for
      // diagnostics — helps confirm whether blind-clicking is actually happening and how often.
      let lastLocateElementTime = 0;

      let userMsgCount = 0;

      // Send session info and initial memory sync to client immediately
      clientWs.send(JSON.stringify({ type: "session_init", sessionId: phaseXSession.id }));
      clientWs.send(JSON.stringify({ type: "memory_sync", memories }));

      // Track running transcription state for auto memory consolidation
      // Capped at the last 30 exchanges to prevent unbounded growth.
      const MAX_HISTORY = 30;
      // Pre-populate dialogueHistory with recent messages from the ongoing session so context persists across stops!
      const pastMsgs = getRecentSessionMessages(phaseXSession.id, 20);
      let dialogueHistory: { role: string; text: string }[] = pastMsgs.map((m) => ({
        role: m.role === "Addy" ? "model" : "user",
        text: m.text,
      }));
      function pushDialogue(role: string, text: string): void {
        dialogueHistory.push({ role, text });
        if (dialogueHistory.length > MAX_HISTORY) {
          dialogueHistory = dialogueHistory.slice(-MAX_HISTORY);
        }
      }

      // Checkpoint: write dialogue state to the session's .log file every 60s
      // so a crash doesn't lose the entire in-progress conversation.
      const _dialogueCheckpointTimer = setInterval(() => {
        try {
          if (dialogueHistory.length > 0) {
            const { log: checkpointPath } = sessionFilePath(phaseXSession.id);
            const entry = `[CHECKPOINT ${new Date().toISOString()}] dialogue_history_length=${dialogueHistory.length}\n`;
            fs.appendFileSync(checkpointPath, entry, 'utf-8');
            // Also run a consolidation pass if we have enough history and aren't on cooldown
            if (dialogueHistory.length >= 4 && apiKey) {
              processConversationSlice(apiKey, dialogueHistory)
                .catch(e => console.warn("[Memory] Checkpoint consolidation failed:", e.message));
            }
          }
        } catch {}
      }, 60_000);

      let currentModelResponseText = "";
      const conversationId = "conv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
      const transcript = createTranscript();
      
      // Auto-fallback: try multiple Live API models if the primary fails
      // Respect voice-commanded model switch via preferredLiveModel
      const baseLiveModels = process.env.ADDY_LIVE_MODELS
        ? process.env.ADDY_LIVE_MODELS.split(',')
        : ['gemini-3.1-flash-live-preview', 'gemini-3.0-flash-live-preview', 'gemini-2.5-flash-native-audio-preview-12-2025', 'gemini-2.0-flash-live-001'];
      const LIVE_MODELS = preferredLiveModel
        ? [preferredLiveModel, ...baseLiveModels.filter(m => m !== preferredLiveModel)]
        : baseLiveModels;
      let session: any = null;
      let connectError: any = null;
      for (const liveModel of LIVE_MODELS) {
        try {
          const liveConfig: any = {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
              voiceConfig: { prebuiltVoiceConfig: { voiceName: "Aoede" } },
            },
            proactivity: { proactiveAudio: true },
            realtimeInputConfig: {
                automaticActivityDetection: {
                  silenceDurationMs: 1200,
                },
              turnCoverage: TurnCoverage.TURN_INCLUDES_ALL_INPUT,
            },
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: finalInstructions,
          };
          if (liveModel.includes("3.1")) {
            liveConfig.thinkingConfig = { thinkingLevel: "minimal" };
          }
          session = await ai.live.connect({
            model: liveModel,
            config: { ...liveConfig, tools: [
            {
              functionDeclarations: [
                {
                  name: "changeBackground",
                  description: "Changes the visual theme or atmospheric glow color of Addy's interface.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      color: {
                        type: Type.STRING,
                        description: "The theme color name (violet, crimson, emerald, celestial, gold, rose, charcoal)"
                      }
                    },
                    required: ["color"]
                  }
                },
                {
                  name: "saveCustomMemory",
                  description: "Allows Addy to immediately save a piece of critical user information to her persistent memory core.",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      category: {
                        type: Type.STRING,
                        description: "The memory category.",
                        enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior", "session", "important_event", "conversation", "reminder", "active_task", "debug_session", "decision", "project_note", "milestone", "bug_report"]
                      },
                      text: {
                        type: Type.STRING,
                        description: "Precise third-person statement."
                      }
                    },
                    required: ["category", "text"]
                  }
                },
                // ======== INTERNET REACH TOOLS (routed to Python agent) ========
                ...REACH_FUNCTION_DECLARATIONS,

                // ======== DESKTOP & BROWSER 2.0 TOOLS (routed to Python agent) ========
                ...DESKTOP_FUNCTION_DECLARATIONS,

                {
                  name: "switchModel",
                  parameters: {
                    type: Type.OBJECT,
                    properties: {
                      model: {
                        type: Type.STRING,
                        description: "The Gemini model name the user wants (e.g. 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemini-2.5-pro-exp-03-25')"
                      }
                    },
                    required: ["model"]
                  }
                }
              ]
            }
          ]
        },
        callbacks: {
          onmessage: (message: LiveServerMessage) => {
            // Audio Stream Chunk (model response audio, 24kHz raw PCM)
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audio) {
              clientWs.send(JSON.stringify({ type: "audio", audio }));
            }
            
            // Interruption flag
            if (message.serverContent?.interrupted) {
              console.log("[Addy Interrupted!]");
              clientWs.send(JSON.stringify({ type: "interrupted" }));
            }
            
            // Turn Complete
            if (message.serverContent?.turnComplete) {
              clientWs.send(JSON.stringify({ type: "turnComplete" }));
              
              if (currentModelResponseText.trim()) {
                pushDialogue("model", currentModelResponseText);
                currentModelResponseText = "";
              }

              // Fire asynchronous memory extraction
              if (dialogueHistory.length >= 2) {
                (async () => {
                  try {
                    const updated = await processConversationSlice(apiKey, dialogueHistory);
                    if (updated) {
                      console.log("[Memory Sync] Sending refreshed memory list to client.");
                      clientWs.send(JSON.stringify({ type: "memory_sync", memories: updated }));
                    }
                  } catch (err) {
                    console.error("[Memory Sync] Error running background consolidation:", err);
                  }
                })();
              }

              // Incremental summary + transcript refresh (crash resilience: keeps
              // documents up to date mid-session, so even a force-kill won't lose them)
              (async () => {
                await refreshSessionDocuments(apiKey, phaseXSession.id, clientWs);
              })();
            }
            
            // Transcription of model output (text chunk)
            const rawModelText = message.serverContent?.outputTranscription?.text;
            if (rawModelText) {
              const modelText = filterToolCallLeakage(rawModelText);
              if (modelText) {
                clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: modelText }));
                currentModelResponseText += modelText;
                appendToTranscript(transcript, "model", modelText);
                logMessage(phaseXSession.id, "Addy", modelText);
              }
            }
            
            // User input transcription (user speech text translated by Gemini)
            const userTextOutput = message.serverContent?.inputTranscription?.text;
            if (userTextOutput) {
              clientWs.send(JSON.stringify({ type: "transcription", role: "user", text: userTextOutput }));
              pushDialogue("user", userTextOutput);
              appendToTranscript(transcript, "user", userTextOutput);
              logMessage(phaseXSession.id, "user", userTextOutput);
              userMsgCount++;
              if (userMsgCount === 1) autoGenerateTitle(phaseXSession.id, [{ id: "", sessionId: phaseXSession.id, timestamp: Date.now(), role: "user", text: userTextOutput, toolCalls: [], errors: [], importantDecisions: [], metadata: {} }]);
            }
            
            // Function Calls (Gemini requesting server/client tool execution)
            if (message.toolCall?.functionCalls) {
              for (const fc of message.toolCall.functionCalls) {
                console.log(`[Function Call]: ${fc.name}`, fc.args);
                
                if (fc.name === "saveCustomMemory") {
                  (async () => {
                    try {
                      const args = fc.args as any;
                      const category = args.category;
                      const text = args.text;
                      if (category && text) {
                        // Normalize category to SQL MemoryCategory
                        const catMap: Record<string, string> = {
                          identity: "identity",
                          preference: "preference",
                          goal: "goal",
                          project: "project",
                          relationship: "relationship",
                          emotional: "emotional",
                          behavior: "behavior",
                          session: "session",
                          important_event: "important_event",
                          conversation: "conversation",
                          reminder: "reminder",
                          active_task: "active_task",
                          debug_session: "debug_session",
                          decision: "decision",
                          project_note: "project_note",
                          milestone: "milestone",
                          bug_report: "bug_report"
                        };
                        const sqlCat = catMap[category] || "general";
                        storeMemory(
                          text.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
                          text,
                          sqlCat as any,
                          ""
                        );

                        logToolCall(phaseXSession.id, fc.name, fc.args as Record<string, unknown>, { result: "saved" }, 0, true);
                        logMessage(phaseXSession.id, "Addy", `Memory saved: ${category} — ${text.slice(0, 80)}`);
                        
                        // Sync immediately with the React client — read back from SQL
                        const allRecords = getAllMemories();
                        const clientMemories = allRecords.map(r => ({
                          id: r.id,
                          category: r.category,
                          text: r.value,
                          createdAt: new Date(r.timestamp).toISOString(),
                          updatedAt: new Date(r.timestamp).toISOString(),
                        }));
                        clientWs.send(JSON.stringify({ type: "memory_sync", memories: clientMemories }));
                        
                        // Send success code back to live link
                        session.sendToolResponse({
                          functionResponses: [
                            {
                              name: fc.name,
                              response: { output: { result: "Memory successfully captured and persisted in connections core." } },
                              id: fc.id
                            }
                          ]
                        });
                      }
                    } catch (err: any) {
                      console.error("saveCustomMemory execution failure:", err);
                    }
                  })();
                } else if (DESKTOP_TOOLS.has(fc.name)) {
                  // ── Desktop control tools: route to Python agent ──
                  (async () => {
                    console.log(`[Desktop Agent] Routing ${fc.name} to Python backend...`);
                    // Track locateElement calls for blind-click diagnostics
                    if (fc.name === "locateElement") { lastLocateElementTime = Date.now(); }
                    const t0 = Date.now();
                      const agentResult = await callDesktopAgent(fc.name, fc.args as Record<string, unknown>);
                      const t1 = Date.now();

                      if (agentResult.ok) {
                        const raw = agentResult.result ?? { result: "Done." };
                        // Strip image payloads from tool response — the Live API
                        // model rejects them ("does not support image input").
                        const outputBase = typeof raw === 'object' && raw !== null
                          ? Object.fromEntries(
                              Object.entries(raw).filter(([k]) => !k.startsWith('image_') && k !== 'image')
                            )
                          : raw;
                        let output = outputBase;

                        // For mouse actions, confirm where the cursor actually ended up — this is the one
                        // channel that reliably reaches Gemini's live reasoning (tool responses), unlike
                        // logMessage which only writes to our own transcript.
                        if (MOUSE_TOOLS.has(fc.name)) {
                          // Warn about possible blind clicks from video/screenshot (diagnostic)
                          if ((fc.name === "mouseClick" || fc.name === "mouseDoubleClick") && Date.now() - lastLocateElementTime > 15000) {
                            console.warn(`[Mouse Accuracy] ${fc.name} called ${Date.now() - lastLocateElementTime}ms after last locateElement — possible blind click from video/screenshot.`);
                          }
                          try {
                            const posR = await fetch(`${DESKTOP_AGENT_URL}/mouse/position`);
                            if (posR.ok) {
                              const pos = await posR.json();
                              lastKnownMousePos = { x: pos.x, y: pos.y };
                              if (typeof output === "object" && output !== null) {
                                (output as Record<string, unknown>).cursorPosition = { x: pos.x, y: pos.y };
}
                            }
                          } catch { /* skip if agent offline — tool response still sends without position */ }
                        }

                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output },
                            id: fc.id
                          }]
                        });
                        logToolCall(phaseXSession.id, fc.name, fc.args as Record<string, unknown>, output, t1 - t0, true);
                        logMessage(phaseXSession.id, "Addy", `Executed: ${fc.name}${fc.args ? ' ' + JSON.stringify(fc.args).slice(0, 80) : ''}`);
                      } else {
                        const errMsg = agentResult.error || "Desktop agent error.";
                        console.error(`[Desktop Agent] Error for ${fc.name}:`, errMsg);
                        session.sendToolResponse({
                          functionResponses: [{
                            name: fc.name,
                            response: { output: { result: `Desktop control error: ${errMsg}` } },
                            id: fc.id
                          }]
                        });
                        logToolCall(phaseXSession.id, fc.name, fc.args as Record<string, unknown>, { error: errMsg }, t1 - t0, false);
                        logMessage(phaseXSession.id, "Addy", `Failed: ${fc.name} — ${errMsg.slice(0, 80)}`);
                      }
                  })();
                } else if (fc.name === "switchModel") {
                  const newModel = (fc.args as any)?.model;
                  if (newModel) {
                    const geminiProv = providerManager.getProvider('gemini');
                    if (geminiProv) {
                      geminiProv.setModel?.(newModel);
                      preferredLiveModel = newModel;
                      console.log(`[switchModel] Switched to ${newModel}`);

                      // Tell Addy to inform the user
                      session.sendToolResponse({
                        functionResponses: [{
                          name: fc.name,
                          response: { output: { result: `Switched to ${newModel}` } },
                          id: fc.id
                        }]
                      });

                      // Notify the frontend so it can update the UI and reconnect
                      clientWs.send(JSON.stringify({ type: "model_switched", model: newModel }));
                      clientWs.send(JSON.stringify({ type: "transcription", role: "model", text: `Switching to ${newModel} — give me a moment.` }));

                      // Close the current session so the client reconnects with the new model
                      setTimeout(() => { try { session.close(); } catch {} }, 500);
                    }
                  }
                } else {
                  clientWs.send(JSON.stringify({
                    type: "toolCall",
                    callId: fc.id,
                    name: fc.name,
                    args: fc.args
                  }));
                  // Log tool call initiation (result logged when response comes back)
                  logToolCall(phaseXSession.id, fc.name, fc.args as Record<string, unknown>, { pending: true }, 0, true);
                }
              }
            }
          },
          onclose: () => {
            console.log("Gemini Live session closed");
            clientWs.send(JSON.stringify({ type: "status", status: "session_closed" }));
            // Finalize transcript — save markdown export
            const summary = formatSessionSummary(transcript);
            finalizeTranscript(transcript, summary);
          }
        }
      });
      break; // Connection succeeded — exit the retry loop
    } catch (e: any) {
      connectError = e;
      console.log(`[Live] Model ${liveModel} connection failed: ${e.message?.slice(0, 120)}`);
    }
  }
  if (!session) {
    throw connectError || new Error('All Live API models failed to connect');
  }

    clientWs.send(JSON.stringify({ type: "status", status: "connected" }));

    // ── Mouse position tracker ──────────────────────────────────────────
    // Polls the desktop agent at 100ms intervals, pushes { type: "mouse_position", x, y }
    // to the client. Silently skips ticks when the agent is offline.
    let mouseTrackInterval: NodeJS.Timeout | null = null;

    const startMouseTracking = () => {
      if (mouseTrackInterval) return;
      mouseTrackInterval = setInterval(async () => {
        if (clientWs.readyState !== 1) { stopMouseTracking(); return; }
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 80);
          const r = await fetch(`${DESKTOP_AGENT_URL}/mouse/position`, { signal: controller.signal });
          clearTimeout(timer);
          if (r.ok) {
            const pos = await r.json();
            lastKnownMousePos = { x: pos.x, y: pos.y };
            clientWs.send(JSON.stringify({ type: "mouse_position", x: pos.x, y: pos.y }));
          }
        } catch { /* agent offline — skip tick silently */ }
      }, 100);
    };

    const stopMouseTracking = () => {
      if (mouseTrackInterval) {
        clearInterval(mouseTrackInterval);
        mouseTrackInterval = null;
      }
    };

    startMouseTracking();

    clientWs.on("message", (rawMsg) => {
      try {
        const msg = JSON.parse(rawMsg.toString());
        if (msg.audio) {
          session.sendRealtimeInput({
            audio: { data: msg.audio, mimeType: "audio/pcm;rate=16000" }
          });
        } else if (msg.type === "video" && msg.video) {
          session.sendRealtimeInput({
            video: { data: msg.video, mimeType: "image/jpeg" }
          });
        } else if (msg.type === "toolResponse") {
          session.sendToolResponse({
            functionResponses: [
              {
                name: msg.name,
                response: { output: msg.output },
                id: msg.id
              }
            ]
          });
          logToolCall(phaseXSession.id, msg.name || "unknown", msg.args || {}, msg.output || {}, 0, true);
        } else if (msg.type === "text" && msg.text) {
          session.sendClientContent({
            turns: [{ role: "user", parts: [{ text: msg.text }] }],
            turnComplete: true
          });
          pushDialogue("user", msg.text);
          appendToTranscript(transcript, "user", msg.text);
          logMessage(phaseXSession.id, "user", msg.text);
          userMsgCount++;
          if (userMsgCount === 1) autoGenerateTitle(phaseXSession.id, [{ id: "", sessionId: phaseXSession.id, timestamp: Date.now(), role: "user", text: msg.text, toolCalls: [], errors: [], importantDecisions: [], metadata: {} }]);
        }
      } catch (e) {
        console.error("Error editing/forwarding client frame message:", e);
      }
    });

    clientWs.on("close", () => {
      console.log("Client disconnected, closing Gemini session");
      stopMouseTracking();

      // Phase X: close session
      try {
        // Use the summary already generated by incremental turnComplete refreshes,
        // falling back to a truncated snippet only if no summary was ever written.
        const session = getSession(phaseXSession.id);
        let summaryText = session?.summary || null;
        if (!summaryText && currentModelResponseText) {
          summaryText = currentModelResponseText.slice(0, 200);
        }
        closeSession(phaseXSession.id, summaryText || undefined);
        setCurrentSessionId(null);
        console.log(`[PhaseX] Session ${phaseXSession.id} closed`);
      } catch (e: any) {
        console.warn("[PhaseX] Failed to close session:", e.message);
      }

      // Persist dialogue history to SQLite database
      try {
        if (dialogueHistory.length > 0) {
          const messages = dialogueHistory.map((d, i) => ({
            id: "msg_" + conversationId + "_" + i,
            role: d.role as 'user' | 'assistant',
            content: d.text,
            timestamp: Date.now() - (dialogueHistory.length - i) * 1000,
          }));
          saveConversation(conversationId, messages);
          console.log("[DB] Saved conversation " + conversationId + " (" + messages.length + " messages)");
        }
      } catch (e: any) {
        console.warn("[DB] Failed to persist conversation:", e.message);
      }

      // Final memory consolidation — flush any remaining dialogue before this
      // WebSocket scope is garbage-collected. Use terminal=true to bypass cooldown.
      try {
        if (dialogueHistory.length >= 2 && apiKey) {
          console.log("[Memory] Running terminal consolidation on disconnect...");
          // Fire-and-forget but we give it 8s to complete before the handler exits.
          processConversationSlice(apiKey, dialogueHistory, true)
            .then(updated => {
              if (updated) {
                console.log(`[Memory] Terminal consolidation saved ${updated.length} memories.`);
              }
            })
            .catch(e => console.warn("[Memory] Terminal consolidation failed:", e.message));
        }
      } catch (e: any) {
        console.warn("[Memory] Terminal consolidation error:", e.message);
      }

      // Clear the checkpoint timer
      clearInterval(_dialogueCheckpointTimer);

      try {
        session.close();
      } catch (e) {}
    });
      
    } catch (err: any) {
      console.error("Error connecting to Gemini Live API:", err);
      clientWs.send(JSON.stringify({ 
        type: "error", 
        error: `Could not connect to Gemini: ${err.message || err}` 
      }));
      clientWs.close();
    }
  });

  // Serve custom static assets folder
  app.use("/assets", express.static(path.join(process.cwd(), "assets")));

  // Express Static assets / Vite Dev Middleware configuration
  if (process.env.NODE_ENV !== "production") {
    // Loaded lazily so the production bundle never requires vite (a dev-only
    // dependency that is not shipped with the packaged app).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        watch: {
          ignored: ['**/transcripts/**'],
        },
      },
      appType: "spa",
    } as any);
    // Disable HMR error overlay to prevent full-page auto-reload
    if (vite.hot) {
      vite.hot.on('vite:beforeFullReload', () => { /* suppress */ });
    }
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    logStartup(`Addy V2 server started on http://localhost:${PORT}`);
    console.log(`[Server] Running on http://localhost:${PORT}`);
    // Kick off the desktop agent (probe + auto-spawn) immediately on boot.
    ensureDesktopAgent().catch((e) =>
      console.warn(`[Desktop Agent] Boot probe failed: ${e?.message || e}`)
    );
    // Start the OpenCode execution engine (Phase 1).
    executionService.start().catch((e) =>
      console.warn(`[OpenCode] Execution engine failed to start: ${e?.message || e}`)
    );
  });

  const certDir = path.join(process.cwd(), "certs");
  if (fs.existsSync(path.join(certDir, "addy-key.pem"))) {
    const httpsServer = https.createServer(
      {
        key: fs.readFileSync(path.join(certDir, "addy-key.pem")),
        cert: fs.readFileSync(path.join(certDir, "addy-cert.pem")),
      },
      app
    );
    httpsServer.on("upgrade", handleUpgrade);
    httpsServer.listen(HTTPS_PORT, "0.0.0.0", () => {
      console.log(`[Server] HTTPS running on https://localhost:${HTTPS_PORT}`);
    });
  } else {
    console.log("[Server] No certs/addy-key.pem found - HTTPS disabled (LAN voice/mic unavailable).");
  }
}

// --- Core Keepalive: crash protection + desktop agent watchdog ---

// Global crash handlers — prevent the server from dying silently.
process.on("uncaughtException", (err) => {
  console.error("[COREDUMP] Uncaught exception:", err?.message || err);
  logError(`COREDUMP_UNCAUGHT: ${err?.message || err}`);
});
process.on("unhandledRejection", (reason) => {
  console.warn("[COREDUMP] Unhandled rejection:", reason);
  logError(`COREDUMP_REJECTION: ${reason}`);
});

/**
 * Watchdog: periodically checks the desktop agent and re-spawns if dead.
 * Also keeps the Node.js event loop warm, preventing idling.
 */
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
function startWatchdog(): void {
  if (watchdogTimer) return;
  console.log("[Watchdog] Starting desktop agent health monitor (30s interval).");
  watchdogTimer = setInterval(async () => {
    if (!(await isDesktopAgentAlive())) {
      console.warn("[Watchdog] Desktop agent unreachable — re-spawning...");
      desktopAgentVerified = false;
      spawnDesktopAgent();
      // Wait up to 15s for it to come online.
      for (let i = 1; i <= 15; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (await isDesktopAgentAlive()) {
          desktopAgentVerified = true;
          console.log("[Watchdog] Desktop agent re-spawned successfully.");
          return;
        }
      }
      console.warn("[Watchdog] Desktop agent still down after re-spawn. Will retry.");
    }
  }, 30_000);
}

startServer().then(() => {
  startWatchdog();
}).catch((error) => {
  console.error("Failed to start server startup sequence:", error);
});
