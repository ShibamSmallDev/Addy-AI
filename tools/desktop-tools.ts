/**
 * Desktop-agent tool registry - single source of truth (TypeScript side).
 *
 * Moved verbatim out of server.ts so the agent loop can validate generated
 * plans against the REAL tool-name allow-list and the REAL Gemini function
 * declarations without importing server.ts (which would be circular:
 * server -> agent/task-manager -> agent/loop).
 *
 * DESKTOP_TOOLS is kept in sync with desktop_agent/registry.py
 * DESKTOP_TOOL_NAMES (Python side).
 */
import { Type } from "@google/genai";

/**
 * The complete set of tool names routed to the Python desktop agent.
 * Kept in sync with desktop_agent/registry.py DESKTOP_TOOL_NAMES.
 */
export const DESKTOP_TOOLS: ReadonlySet<string> = new Set([
  // applications / websites / search
  "openApplication", "closeApplication", "openWebsite",
  "searchWeb", "searchYouTube", "searchGoogle", "searchGitHub",
  // files
  "createFile", "readFile", "renameFile", "deleteFile", "moveFile",
  "openFolder", "listFiles", "searchFiles", "readPdf",
  // pc control (volume + media + notification + gated power)
  "volumeUp", "volumeDown", "muteToggle", "setVolume",
  "mediaPlayPause", "mediaNextTrack", "mediaPrevTrack", "mediaStop", "showDesktopNotification",
  "requestPowerAction", "executePowerAction",
  // proactive speech & automated awareness
  "speakText", "fetchAINews", "resetNewsCache", "checkEmails", "configureEmail", "checkWhatsAppMessages",
  // windows
  "listWindows", "getActiveWindow", "focusWindow", "snapWindow",
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
export const REACH_TOOLS: ReadonlySet<string> = new Set([
  "readWebpage", "youtubeTranscript", "youtubeSearch", "youtubePlaylist",
  "githubRepo", "githubIssues", "webSearch", "readRSS",
]);

/**
 * Gemini function declarations for the internet-reach tools. Spread into the
 * functionDeclarations arrays of BOTH chat modes (text + voice/Live) so the
 * model knows it can call them.
 */
export const REACH_FUNCTION_DECLARATIONS = [
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
  // ======== AUTONOMOUS REACT TASK TOOLS (model-triggered, background) ========
  {
    name: "agent_run",
    description:
      "Delegate a complex, multi-step desktop goal to Addy's autonomous ReAct planner. Addy builds a plan, executes each step with self-healing retries, verifies the outcome, and narrates progress live. Runs in the background and returns a taskId immediately. Use this for goals that need many coordinated actions or may fail mid-way; use ordinary single tools for one-off actions.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        goal: { type: Type.STRING, description: "The complete natural-language goal to accomplish autonomously." },
      },
      required: ["goal"],
    },
  },
  {
    name: "agent_abort",
    description: "Stop a running autonomous task by its taskId. The task halts at the next safe point.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        taskId: { type: Type.STRING, description: "The taskId returned by agent_run." },
      },
      required: ["taskId"],
    },
  },
];

/**
 * Full function declarations for all desktop, browser, and OS tools.
 * Provided to BOTH text chat and voice WebSocket sessions.
 */
export const DESKTOP_FUNCTION_DECLARATIONS = [
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
    description: "Set system audio volume level percentage (e.g. 50 for 50%, or 0.5 for 50%).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        percent: { type: Type.NUMBER, description: "Volume level percentage 0-100 (e.g. 50)." },
        level: { type: Type.NUMBER, description: "Volume level fraction 0.0-1.0 (e.g. 0.5)." }
      }
    }
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
  // ======== WINDOW MANAGEMENT ========
  {
    name: "listWindows",
    description: "List all open visible application windows with titles, process names, PIDs, and coordinates.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "getActiveWindow",
    description: "Get metadata for the current foreground window (title, process name, PID, bounding rect).",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "focusWindow",
    description: "Bring a window to the foreground by partial title, process name, or PID.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Window title (e.g. 'Visual Studio Code', 'Edge', 'Spotify')" },
        process: { type: Type.STRING, description: "Process executable name (e.g. 'code.exe', 'msedge.exe')" },
        pid: { type: Type.INTEGER, description: "Process ID" }
      }
    }
  },
  {
    name: "snapWindow",
    description: "Snap the active or target window to a zone: 'left', 'right', 'top', 'bottom', 'maximize', 'center'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        zone: { type: Type.STRING, description: "Zone: 'left', 'right', 'top', 'bottom', 'maximize', 'center'" },
        title: { type: Type.STRING, description: "Optional window title to snap" }
      },
      required: ["zone"]
    }
  },
  // ======== SYSTEM AUDIO & MEDIA CONTROL ========
  {
    name: "mediaPlayPause",
    description: "Toggle play/pause for the system media player (Spotify, YouTube, browser media).",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "mediaNextTrack",
    description: "Skip to the next media track.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "mediaPrevTrack",
    description: "Return to the previous media track.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "mediaStop",
    description: "Stop active media playback.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  // ======== NOTIFICATIONS & PROACTIVE SPEECH ========
  {
    name: "showDesktopNotification",
    description: "Display a native Windows desktop toast notification.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: "Notification title (e.g. 'Task Finished', 'Reminder')" },
        message: { type: Type.STRING, description: "Notification body text" }
      },
      required: ["message"]
    }
  },
  {
    name: "speakText",
    description: "Speak text aloud to the user using Windows native speech synthesis (SAPI). Useful for proactive alerts, summaries, and conversational responses.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "The text message to speak aloud" },
        wait: { type: Type.BOOLEAN, description: "Whether to wait for speech to finish (default false)" }
      },
      required: ["text"]
    }
  },
  {
    name: "fetchAINews",
    description: "Fetch the latest breaking AI news and tech stories from Hacker News and TechCrunch AI RSS.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER, description: "Maximum number of articles to return (default 5)" },
        unread_only: { type: Type.BOOLEAN, description: "Filter out articles already seen in previous checks (default true)" }
      }
    }
  },
  {
    name: "resetNewsCache",
    description: "Reset the seen news article cache so past stories can be re-fetched.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "checkEmails",
    description: "Check for unread emails via secure local IMAP connection. Returns sender, subject, date, and body snippets.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        limit: { type: Type.INTEGER, description: "Maximum number of unread emails to retrieve (default 5)" },
        folder: { type: Type.STRING, description: "Mailbox folder to check (default 'INBOX')" },
        unread_only: { type: Type.BOOLEAN, description: "Whether to fetch unread emails only (default true)" }
      }
    }
  },
  {
    name: "configureEmail",
    description: "Configure local email IMAP credentials (host, port, username, password/app-password) stored securely on this machine.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        imap_host: { type: Type.STRING, description: "IMAP server hostname (e.g. 'imap.gmail.com', 'outlook.office365.com')" },
        username: { type: Type.STRING, description: "Email address or username" },
        password: { type: Type.STRING, description: "App password or account password" },
        imap_port: { type: Type.INTEGER, description: "IMAP port (default 993)" },
        use_ssl: { type: Type.BOOLEAN, description: "Whether to use SSL (default true)" }
      },
      required: ["imap_host", "username", "password"]
    }
  },
  {
    name: "checkWhatsAppMessages",
    description: "Check WhatsApp Web for unread messages using the user's cloned Microsoft Edge browser profile.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        headless: { type: Type.BOOLEAN, description: "Run in background without showing browser window (default true)" },
        timeout: { type: Type.INTEGER, description: "Seconds to wait for page load (default 15)" }
      }
    }
  },

  // ======== FILE MANAGEMENT (previously routable but never declared) ========
  {
    name: "renameFile",
    description: "Rename a file or folder on disk.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Full path of the file/folder to rename." },
        new_name: { type: Type.STRING, description: "The new name (not the full path)." }
      },
      required: ["path", "new_name"]
    }
  },
  {
    name: "deleteFile",
    description: "Delete a file. Goes to the Recycle Bin by default; only set permanent=true if the user explicitly asks for irreversible deletion.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Full path of the file to delete." },
        permanent: { type: Type.BOOLEAN, description: "Bypass the Recycle Bin (default false)." }
      },
      required: ["path"]
    }
  },
  {
    name: "moveFile",
    description: "Move a file to another folder (optionally renaming it).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Full path of the file to move." },
        destination: { type: Type.STRING, description: "Destination folder path." },
        name: { type: Type.STRING, description: "Optional new filename." }
      },
      required: ["path", "destination"]
    }
  },
  {
    name: "openFolder",
    description: "Open a folder in Windows File Explorer. Accepts a full path or an alias such as desktop, downloads, documents, projects.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Folder path or alias (desktop, downloads, documents, projects)." },
        name: { type: Type.STRING, description: "Alias of 'path'." }
      }
    }
  },
  {
    name: "listFiles",
    description: "List the contents of a folder.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Folder path or alias (desktop, downloads, documents, projects)." },
        name: { type: Type.STRING, description: "Alias of 'path'." },
        pattern: { type: Type.STRING, description: "Glob filter, e.g. '*.pdf' (default '*')." }
      }
    }
  },
  {
    name: "searchFiles",
    description: "Find files recursively by name glob or extension, e.g. name='*.py' under 'Documents'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        folder: { type: Type.STRING, description: "Folder to search in (path or alias). Default 'home'." },
        under: { type: Type.STRING, description: "Alias of 'folder'." },
        name: { type: Type.STRING, description: "Filename glob, e.g. 'report*'." },
        pattern: { type: Type.STRING, description: "Alias of 'name'." },
        extension: { type: Type.STRING, description: "Extension to match, e.g. 'pdf'. Alternative to 'name'." },
        limit: { type: Type.INTEGER, description: "Max results (default 100)." }
      }
    }
  },

  // ======== CLIPBOARD ========
  {
    name: "copySelected",
    description: "Press Ctrl+C to copy the current selection and read it back from the clipboard.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        wait: { type: Type.NUMBER, description: "Seconds to wait before reading (default 0.4)." }
      }
    }
  },
  {
    name: "pasteClipboard",
    description: "Put text on the clipboard and paste it into the focused app, or just paste existing clipboard contents.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        text: { type: Type.STRING, description: "Text to place on the clipboard first. Omit to paste what is already there." }
      }
    }
  },
  {
    name: "getClipboard",
    description: "Read the current clipboard text.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_chars: { type: Type.INTEGER, description: "Truncate result to this many characters." }
      }
    }
  },
  {
    name: "clearClipboard",
    description: "Clear the clipboard contents.",
    parameters: { type: Type.OBJECT, properties: {} }
  },

  // ======== SCREEN / OCR ========
  {
    name: "saveScreenshot",
    description: "Capture the screen and save it as a PNG under Pictures\\ADDScreenshots.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Optional filename for the saved screenshot." }
      }
    }
  },
  {
    name: "analyzeScreenshot",
    description: "Capture the screen and read all visible text out of it using OCR.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_chars: { type: Type.INTEGER, description: "Truncate OCR output to this many characters." }
      }
    }
  },
  {
    name: "readScreen",
    description: "Read the text on screen from the foreground window and report its title.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        max_chars: { type: Type.INTEGER, description: "Truncate OCR output to this many characters." }
      }
    }
  },

  // ======== SYSTEM / STARTUP ========
  {
    name: "createProjectFolder",
    description: "Create a project directory with a standard subfolder structure and starter files.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        path: { type: Type.STRING, description: "Parent folder for the new project." },
        name: { type: Type.STRING, description: "Project folder name." },
        scaffold_standard: { type: Type.BOOLEAN, description: "Create the standard subfolder tree (default true)." }
      },
      required: ["name"]
    }
  },
  {
    name: "temperatureInfo",
    description: "Report GPU and CPU temperatures. Windows usually cannot read CPU temperature without extra hardware monitoring software, so CPU may be unavailable.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "enableAutoStart",
    description: "Start Addy automatically when the user signs in to Windows (adds a Run registry entry).",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "disableAutoStart",
    description: "Stop Addy from starting automatically at sign-in.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "getAutoStartStatus",
    description: "Check whether Addy is currently configured to start at sign-in.",
    parameters: { type: Type.OBJECT, properties: {} }
  },

  // ======== KEYBOARD / MOUSE (previously routable but never declared) ========
  {
    name: "holdKey",
    description: "Press a key down and keep holding it (pair with releaseKey). Use for chords like holding Ctrl.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING, description: "Key name or character to hold down, e.g. 'ctrl', 'shift', 'a'." }
      },
      required: ["key"]
    }
  },
  {
    name: "releaseKey",
    description: "Release a key that was held down with holdKey.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        key: { type: Type.STRING, description: "Key name or character to release." }
      },
      required: ["key"]
    }
  },
  {
    name: "mouseMoveRelative",
    description: "Move the cursor by an offset from its current position.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dx: { type: Type.INTEGER, description: "Horizontal pixels to move." },
        dy: { type: Type.INTEGER, description: "Vertical pixels to move." }
      },
      required: ["dx", "dy"]
    }
  },
  {
    name: "mouseGetPosition",
    description: "Read the current cursor coordinates.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "mouseDown",
    description: "Press and hold a mouse button. Pair with mouseUp, or use mouseDrag.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        button: { type: Type.STRING, description: "'left', 'right' or 'middle' (default left)." }
      }
    }
  },
  {
    name: "mouseUp",
    description: "Release a held mouse button.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        button: { type: Type.STRING, description: "'left', 'right' or 'middle' (default left)." }
      }
    }
  },

  // ======== SEARCH SHORTCUTS (open in the OS default browser) ========
  {
    name: "searchWeb",
    description: "Run a web search in the user's default browser.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "What to search for." },
        engine: { type: Type.STRING, description: "Optional engine: google, duckduckgo, bing." }
      },
      required: ["query"]
    }
  },
  {
    name: "searchGoogle",
    description: "Search Google in the user's default browser.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "What to search for." } },
      required: ["query"]
    }
  },
  {
    name: "searchYouTube",
    description: "Search YouTube in the user's default browser.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "What to search for on YouTube." } },
      required: ["query"]
    }
  },
  {
    name: "searchGitHub",
    description: "Search GitHub in the user's default browser.",
    parameters: {
      type: Type.OBJECT,
      properties: { query: { type: Type.STRING, description: "Search terms, e.g. 'react three fiber'." } },
      required: ["query"]
    }
  },
];
