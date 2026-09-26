import fs from "fs/promises";
import path from "path";
import { EventEmitter } from "events";
import { GoogleGenAI, Type } from "@google/genai";
import { Memory, MemoryTransaction } from "./src/lib/memoryTypes";
import { MEMORY_ROOT } from "./server_paths";
import { storeMemory, getAllMemories, deleteMemory, searchMemories, type MemoryCategory } from "./memory/retriever";
import { generateContentWithFallback } from "./providers/GeminiProvider";

export const memoryEvents = new EventEmitter();

/**
 * Real-time fast-path memory extractor.
 * Immediately captures explicit user statements, preferences, facts, and instructions
 * and persists them to SQLite without waiting for background batch consolidation.
 */
export function extractImmediateMemory(
  userText: string,
  projectPath?: string
): { key: string; value: string; category: MemoryCategory; id: string } | null {
  if (!userText || userText.trim().length < 5) return null;
  const text = userText.trim();

  const patterns: {
    regex: RegExp;
    category: MemoryCategory;
    transform?: (match: RegExpMatchArray) => { key: string; value: string };
  }[] = [
    {
      regex: /^(?:please\s+)?remember\s+(?:that\s+|:\s*)?(.+)$/i,
      category: "preference",
      transform: (m) => ({ key: m[1].slice(0, 30), value: m[1].trim() }),
    },
    {
      regex: /^(?:please\s+)?don'?t\s+forget\s+(?:that\s+|:\s*)?(.+)$/i,
      category: "reminder",
      transform: (m) => ({ key: m[1].slice(0, 30), value: m[1].trim() }),
    },
    {
      regex: /^(?:please\s+)?keep\s+in\s+mind\s+(?:that\s+|:\s*)?(.+)$/i,
      category: "preference",
      transform: (m) => ({ key: m[1].slice(0, 30), value: m[1].trim() }),
    },
    {
      regex: /^(?:please\s+)?note\s+(?:that\s+|:\s*)?(.+)$/i,
      category: "project_note",
      transform: (m) => ({ key: m[1].slice(0, 30), value: m[1].trim() }),
    },
    {
      regex: /^my\s+favorite\s+(\w+)\s+is\s+(.+)$/i,
      category: "preference",
      transform: (m) => ({ key: `favorite_${m[1]}`, value: `User's favorite ${m[1]} is ${m[2].trim()}` }),
    },
    {
      regex: /^my\s+(dog|cat|pet|wife|husband|partner|son|daughter|kid|editor|language|stack|os|operating system|job|role|hobby|birthday)\s+is\s+(.+)$/i,
      category: "identity",
      transform: (m) => ({ key: `user_${m[1].replace(/\s+/g, '_')}`, value: `User's ${m[1]} is ${m[2].trim()}` }),
    },
  ];

  for (const p of patterns) {
    const m = text.match(p.regex);
    if (m) {
      const { key, value } = p.transform ? p.transform(m) : { key: m[1].slice(0, 30), value: m[1].trim() };
      try {
        const id = storeMemory(
          key.toLowerCase().replace(/[^\w\s-]/g, '').trim(),
          value,
          p.category,
          projectPath,
          {
            source: 'user_direct_statement',
            importance: 0.9,
            confidence: 1.0,
          }
        );
        console.log(`[Memory] Real-time instant memory stored: [${p.category}] "${value}" (ID: ${id})`);
        const item = { id, key, value, category: p.category };
        memoryEvents.emit('memory_created', item);
        return item;
      } catch (err: any) {
        console.error('[Memory] Error storing immediate memory:', err.message);
      }
    }
  }
  return null;
}

// Mirror file lives in the vault (outside the Vite root) so writes never trigger
// a dev-server page reload. SQL remains the source of truth.
const MEMORY_FILE = path.join(MEMORY_ROOT, "memories.json");

const VALID_CATEGORIES = new Set([
  "identity", "preference", "goal", "project", "relationship", "emotional",
  "behavior", "session", "general", "important_event", "conversation",
  "reminder", "active_task", "debug_session", "decision", "project_note",
  "milestone", "bug_report"
]);

// Safe memory loader backed by SQL memories table with fallback
export async function loadMemories(): Promise<Memory[]> {
  try {
    const records = getAllMemories(false, 1000);
    if (records && records.length > 0) {
      return records.map(r => ({
        id: r.id,
        category: (VALID_CATEGORIES.has(r.category) ? r.category : "general") as Memory["category"],
        text: r.value,
        createdAt: new Date(r.timestamp).toISOString(),
        updatedAt: new Date(r.timestamp).toISOString(),
      }));
    }
  } catch (error: any) {
    console.error("[Memory] Error loading from SQL:", error.message);
  }

  // Fallback to vault memories.json if SQL has no records
  try {
    const raw = await fs.readFile(MEMORY_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      console.log(`[Memory] Loaded ${parsed.length} memories from fallback file ${MEMORY_FILE}`);
      return parsed;
    }
  } catch {}

  return [];
}

export async function saveMemories(memories: Memory[]): Promise<void> {
  // Dual-write: SQL for querying, JSON file for client backward compat
  try {
    const { getAllMemories, deleteMemory, storeMemory, supersedMemory } = await import("./memory/retriever");
    const existing = getAllMemories(true, 2000);
    const existingMap = new Map(existing.map(e => [e.id, e]));
    const targetIds = new Set(memories.map(m => m.id));

    // Only delete specific removed memories if a valid list was supplied
    if (memories.length > 0 && existing.length > 0) {
      for (const e of existing) {
        // Preserve historical session memories and pinned memories across session turns
        if (!targetIds.has(e.id) && e.status === 'active' && e.category !== 'session' && !e.pinned) {
          try { deleteMemory(e.id); } catch {}
        }
      }
    }

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

    for (const m of memories) {
      const sqlCat = catMap[m.category] || "general";
      if (!existingMap.has(m.id)) {
        storeMemory(
          m.text.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
          m.text,
          sqlCat as any,
          "",
          {
            source: (m as any).source ?? 'user_conversation',
            importance: (m as any).importance ?? 0.5,
            confidence: (m as any).confidence ?? 0.8,
          }
        );
      }
    }

    // Post-pass: handle superseded memories
    for (const m of memories) {
      if ((m as any)._supersededBy) {
        try {
          supersedMemory(m.id, (m as any)._supersededBy);
        } catch {}
      }
    }
  } catch (e: any) {
    console.warn("[Memory] SQL write failed:", e.message);
  }

  // Keep JSON file in vault for backward compatibility and Obsidian viewing
  try {
    await fs.writeFile(MEMORY_FILE, JSON.stringify(memories, null, 2), "utf-8");
    // Write backup immediately after successful main write
    try {
      await fs.writeFile(MEMORY_FILE + '.bak', JSON.stringify(memories, null, 2), "utf-8");
    } catch {}
    console.log(`[Memory] Saved ${memories.length} memories successfully.`);
  } catch (error) {
    console.error("[Memory] Error writing memory file:", error);
  }
}

// Format memory core to system instruction injections
export function formatSystemInstructionsWithMemories(baseInstruction: string, memories: Memory[]): string {
  if (memories.length === 0) {
    return baseInstruction + 
      "\n\n" +
      "=== Addy MEMORY CORE ===\n" +
      "You do not possess any historic recollections of this companion yet. " +
      "As you speak, pay deep attention to who they are, their projects, relationships, and habits so you naturally grow closer over time.\n" +
      "=========================\n";
  }

  // Group by category
  const grouped: Record<string, string[]> = {};
  memories.forEach((m) => {
    grouped[m.category] = grouped[m.category] || [];
    grouped[m.category].push(m.text);
  });

  let memoryBlock = 
    "\n\n" +
    "=== Addy PERSISTENT MEMORY CORE (RECOLLECTIONS) ===\n" +
    "You have spoken with this user for a long duration. Below are your persistent recollections of who they are.\n" +
    "CRITICAL BRAND AND COGNITIVE PRINCIPLES:\n" +
    "- INTEGRATE MEMORIES INSTINCTIVELY: Always make conversational references feel completely smooth, natural, and human. NEVER say 'According to my memory files...', 'My recollection database indicates...', or 'As you told me on June 12th...'. Instead, speak of these details casually and supportively as a true friend would (e.g. 'Oh, since you're working on that website project...', 'I hope you're keeping up with your YouTube channel goals too!').\n" +
    "- COMPANIONSHIP DEPTH: Allow your witty and responsive personality to adapt with empathy, based on their goals, life events, emotional milestones, and preferences.\n\n" +
    "CURRENT PERSISTENT KNOWLEDGE CARD:\n";

  const categoriesOrdered = [
    { key: "session", label: "Previous Sessions History & Chronology (what was discussed in past sessions with dates/times)" },
    { key: "identity", label: "Identity (Name, nick, profession, background)" },
    { key: "preference", label: "Preferences & Tastes (Likes, dislikes, games, movies)" },
    { key: "goal", label: "Active Goals & Aspirations" },
    { key: "project", label: "Ongoing Projects & Ecosystems" },
    { key: "relationship", label: "Key People & Relationships mentioned" },
    { key: "emotional", label: "Emotional Highlights & Core Milestones" },
    { key: "behavior", label: "Observed Traits & Behavioral Tendencies" },
  ];

  categoriesOrdered.forEach((cat) => {
    let list = grouped[cat.key] || [];
    // Keep most recent/relevant entries per category to avoid multi-thousand token prompt bloat in voice mode
    const limit = cat.key === "session" ? 4 : 6;
    if (list.length > limit) {
      list = list.slice(-limit);
    }
    if (list.length > 0) {
      memoryBlock += `* ${cat.label}:\n` + list.map(t => `  - ${t}`).join("\n") + "\n";
    }
  });

  memoryBlock += "====================================================\n";

  return baseInstruction + memoryBlock;
}

// Background memory consolidation queue lock + gate (max once per 30s)
let isConsolidating = false;
let lastConsolidationTime = 0;
const CONSOLIDATION_COOLDOWN_MS = 30_000;

// Persistent rolling buffer: keeps turns that arrived during cooldown so no messages are dropped
let unconsolidatedBuffer: { role: string; text: string }[] = [];
let pendingConsolidationTimer: NodeJS.Timeout | null = null;
let lastConsolidationApiKey: string = "";

export function queueDialogueForConsolidation(slice: { role: string; text: string }[]): void {
  for (const item of slice) {
    if (item.text?.trim()) {
      unconsolidatedBuffer.push({ role: item.role, text: item.text.trim() });
    }
  }
  if (unconsolidatedBuffer.length > 50) {
    unconsolidatedBuffer = unconsolidatedBuffer.slice(-50);
  }
}

export async function processConversationSlice(
  apiKey: string,
  dialogueHistory: { role: string; text: string }[],
  terminal = false
): Promise<Memory[] | null> {
  if (apiKey) lastConsolidationApiKey = apiKey;
  if (dialogueHistory.length > 0) {
    queueDialogueForConsolidation(dialogueHistory);
  }

  const now = Date.now();
  if (!terminal) {
    if (now - lastConsolidationTime < CONSOLIDATION_COOLDOWN_MS) {
      const waitMs = CONSOLIDATION_COOLDOWN_MS - (now - lastConsolidationTime);
      console.log(`[Memory] Consolidation gate active (${Math.round((now - lastConsolidationTime) / 1000)}s since last). Queued ${unconsolidatedBuffer.length} messages.`);
      
      // Auto-schedule delayed drain if not already scheduled
      if (!pendingConsolidationTimer && lastConsolidationApiKey) {
        pendingConsolidationTimer = setTimeout(async () => {
          pendingConsolidationTimer = null;
          if (unconsolidatedBuffer.length >= 2 && !isConsolidating) {
            console.log(`[Memory] Auto-draining unconsolidated buffer (${unconsolidatedBuffer.length} messages)...`);
            await processConversationSlice(lastConsolidationApiKey, [], false);
          }
        }, waitMs + 500);
      }
      return null;
    }
    if (isConsolidating) {
      console.log("[Memory] Consolidation loop busy, dialogue queued in buffer");
      return null;
    }
  } else {
    // Terminal call: if already consolidating, wait up to 5s then proceed anyway
    if (isConsolidating) {
      console.log("[Memory] Terminal consolidation waiting for in-progress run...");
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
    if (pendingConsolidationTimer) {
      clearTimeout(pendingConsolidationTimer);
      pendingConsolidationTimer = null;
    }
  }

  const batchToProcess = [...unconsolidatedBuffer];
  if (batchToProcess.length < 2) {
    return null;
  }

  isConsolidating = true;
  console.log("[Memory] Initiating pipeline for dialogue batch of length:", batchToProcess.length);

  try {
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        }
      }
    });

    const currentMemories = await loadMemories();
    
    // Format memory map to help Gemini understand what to edit
    const memoryContext = currentMemories.map(m => `ID: ${m.id} | Category: ${m.category} | Fact: ${m.text}`).join("\n");
    const dialogueContext = dialogueHistory.map(line => `${line.role === "user" ? "User" : "Addy"}: ${line.text}`).join("\n");

    // Find existing session summary memory to give context
    const existingSession = currentMemories.find(m => m.category === "session");
    const sessionContext = existingSession
      ? `\nPrevious session summary: ${existingSession.text}`
      : "";

    const prompt = `You are Addy's deep cognitive recollection engine. Your task is to analyze the recent conversation piece against previous persistent memories, and output precise update transactions.

### OBJECTIVE
Decide if any statements contain durable, important personal facts, enduring preferences, aspirations, ongoing projects, critical relationships, key historical emotional events, or behavioral trends.
Avoid cataloging small talk, greetings, general chit-chat, or fleeting sentences (e.g., ignore 'hello', 'how are you', 'waking up', 'lol').

### CURRENT USER MEMORIES:
${memoryContext || "(No memory records exist)"}
${sessionContext}

### RECENT DIALOGUE SLICE:
${dialogueContext}

### RULES
- ACTIONS:
  - "ADD": If new material information is introduced (e.g. user says 'My favorite food is lasagna' and it's not present).
  - "UPDATE": If previous information has evolved or is corrected (e.g. user says 'I changed my major to computer science' when memory says they study history). Provide the exact ID of the memory to replace.
  - "REMOVE": If a memory was explicitly disproven or the user directly asked Addy to forget it.
- TEXT STYLE: Express the memories as clean, concise, third-person declarative summaries (e.g., 'The user is building a startup named Addy.', 'The user loves playing GTA 6.', 'The user enjoys technical and fast-paced styling explanations.'). Do not include conversational filler, quotes, or timestamps.
- ID: For ADD, leave blank. For UPDATE or REMOVE, provide the exact 'id' from the "Current user memories" list.
- SESSION SUMMARY: Always provide a brief 1-3 sentence sessionSummary describing what this conversation session is about so far. Keep it concise. If a previous session summary exists, update it to include the new discussion points.`;

    const resultTextRaw = await generateContentWithFallback(ai, prompt, {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          transactions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                action: {
                  type: Type.STRING,
                  description: "ADD, UPDATE, or REMOVE transaction.",
                  enum: ["ADD", "UPDATE", "REMOVE"]
                },
                id: {
                  type: Type.STRING,
                  description: "Specific ID of the existing memory being modified or deleted (leave blank/null for ADD)."
                },
                category: {
                  type: Type.STRING,
                  description: "The Memory category classification.",
                  enum: ["identity", "preference", "goal", "project", "relationship", "emotional", "behavior", "session"]
                },
                text: {
                  type: Type.STRING,
                  description: "The memory summarized as a concise declarative statement in third-person."
                }
              },
              required: ["action", "category", "text"]
            }
          },
          sessionSummary: {
            type: Type.STRING,
            description: "Brief 1-3 sentence summary of what this conversation session is about so far."
          }
        },
        required: ["transactions"]
      }
    }).catch(() => "");

    const resultText = resultTextRaw.trim() || "{}";
    let resultObj: any = {};
    try {
      resultObj = JSON.parse(resultText);
    } catch {
      console.warn("[Memory] Gemini returned non-JSON response, skipping consolidation.");
      isConsolidating = false;
      return null;
    }
    const transactions: MemoryTransaction[] = resultObj.transactions || [];
    const sessionSummary: string | undefined = resultObj.sessionSummary;

    const hasTransactions = transactions.length > 0;
    const hasSessionSummary = !!sessionSummary?.trim();

    if (!hasTransactions && !hasSessionSummary) {
      console.log("[Memory] No updates generated. Ignored routine conversations.");
      isConsolidating = false;
      return null;
    }

    if (hasTransactions) {
      console.log(`[Memory] Processing ${transactions.length} memory updates:`, JSON.stringify(transactions));
    }
    if (hasSessionSummary) {
      console.log(`[Memory] Session summary: ${sessionSummary}`);
    }

    let updatedMemories = [...currentMemories];
    const timestamp = new Date().toISOString();

    for (const trx of transactions) {
      if (trx.action === "ADD") {
        const newMemory: Memory = {
          id: Math.random().toString(36).substring(2, 11),
          category: trx.category,
          text: trx.text,
          createdAt: timestamp,
          updatedAt: timestamp
        };
        updatedMemories.push(newMemory);
      } else if (trx.action === "UPDATE") {
        const tarIndex = updatedMemories.findIndex(m => m.id === trx.id);
        if (tarIndex !== -1) {
          const oldMemory = updatedMemories[tarIndex];
          // Create the replacement memory first
          const newMemory: Memory = {
            id: Math.random().toString(36).substring(2, 11),
            category: trx.category,
            text: trx.text,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          updatedMemories.push(newMemory);
          // Mark the old one as superseded (keep in array so saveMemories can handle it)
          updatedMemories[tarIndex] = {
            ...oldMemory,
            updatedAt: timestamp,
            // Signal to saveMemories that this entry should be superseded in SQL
            _supersededBy: newMemory.id,
          } as any;
        } else {
          // ID not found — treat as ADD
          const newMemory: Memory = {
            id: Math.random().toString(36).substring(2, 11),
            category: trx.category,
            text: trx.text,
            createdAt: timestamp,
            updatedAt: timestamp,
          };
          updatedMemories.push(newMemory);
        }
      } else if (trx.action === "REMOVE") {
        updatedMemories = updatedMemories.filter(m => m.id !== trx.id);
      }
    }

    // Save the session summary as a persistent chronological memory with date & time
    if (hasSessionSummary) {
      const dateStr = new Date().toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
      const timeStr = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const sessionMemoryText = `[Session on ${dateStr} at ${timeStr}]: ${sessionSummary!}`;

      const isDuplicate = updatedMemories.some(
        (m) => m.category === "session" && (m.text === sessionMemoryText || m.text.includes(sessionSummary!))
      );
      if (!isDuplicate) {
        const newSessionMem: Memory = {
          id: Math.random().toString(36).substring(2, 11),
          category: "session",
          text: sessionMemoryText,
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        updatedMemories.push(newSessionMem);
        memoryEvents.emit("memory_created", newSessionMem);
      }
    }

    // Drain processed batch from buffer
    unconsolidatedBuffer = unconsolidatedBuffer.filter(item => !batchToProcess.includes(item));

    await saveMemories(updatedMemories);
    isConsolidating = false;
    lastConsolidationTime = Date.now();
    return updatedMemories;

  } catch (error) {
    console.error("[Memory] Consolidation failure:", error);
    isConsolidating = false;
    lastConsolidationTime = Date.now();
    return null;
  }
}
