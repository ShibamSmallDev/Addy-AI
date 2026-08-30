import fs from "fs";
import path from "path";
import { dataFile } from "./server_paths";

const BASE_DIR = dataFile("transcripts");

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Get today's date as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Get a human-readable timestamp */
function timestamp(): string {
  return new Date().toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
}

function iso(): string {
  return new Date().toISOString();
}

// ─── Transcript File Management ───────────────────────────────────────────

export interface TranscriptEntry {
  role: "user" | "model";
  text: string;
  ts: string; // ISO timestamp
}

export interface SessionTranscript {
  sessionId: string;
  date: string;
  startedAt: string;
  entries: TranscriptEntry[];
  summary?: string;
}

/** Create a new transcript file and return the session info */
export function createTranscript(): SessionTranscript {
  const date = today();
  const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const transcript: SessionTranscript = {
    sessionId,
    date,
    startedAt: iso(),
    entries: [],
  };
  // Lazily initialized in memory; files on disk are written only when first message arrives
  return transcript;
}

/** Append an entry to the transcript (coalescing consecutive same-role fragments) */
export function appendToTranscript(
  transcript: SessionTranscript,
  role: "user" | "model",
  text: string,
): void {
  const last = transcript.entries[transcript.entries.length - 1];
  if (last && last.role === role) {
    last.text = last.text + text;
  } else {
    transcript.entries.push({ role, text, ts: iso() });
  }
  writeTranscriptFile(transcript);
  updateDayIndex(transcript.date, transcript.sessionId);
}

/** Finalize transcript with optional summary and write the markdown export */
export function finalizeTranscript(
  transcript: SessionTranscript,
  summary?: string,
): void {
  if (!transcript || transcript.entries.length === 0) {
    // If empty transcript file exists, remove it
    try {
      const fp = transcriptFilePath(transcript);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
      const mfp = markdownFilePath(transcript);
      if (fs.existsSync(mfp)) fs.unlinkSync(mfp);
    } catch {}
    return;
  }
  transcript.summary = summary;
  writeTranscriptFile(transcript);
  writeMarkdownExport(transcript);
  updateDayIndex(transcript.date, transcript.sessionId);
  console.log(`[Transcript] Finalized: ${transcript.date}/${transcript.sessionId}`);
}

/** Save the summarized memory to memories.json (called externally) just returns the summary text */
export function formatSessionSummary(transcript: SessionTranscript): string {
  const dateStr = new Date(transcript.startedAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const timeStr = new Date(transcript.startedAt).toLocaleTimeString("en-US", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const entryCount = transcript.entries.length;
  const topics = transcript.summary
    ? transcript.summary.slice(0, 200)
    : `${entryCount} exchanges`;
  return `[${dateStr} ${timeStr}] ${topics}`;
}

// ─── Private helpers ──────────────────────────────────────────────────────

function transcriptFilePath(transcript: SessionTranscript): string {
  return path.join(BASE_DIR, transcript.date, `${transcript.sessionId}.json`);
}

function markdownFilePath(transcript: SessionTranscript): string {
  return path.join(BASE_DIR, transcript.date, `${transcript.sessionId}.md`);
}

function writeTranscriptFile(transcript: SessionTranscript): void {
  const fp = transcriptFilePath(transcript);
  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, JSON.stringify(transcript, null, 2), "utf-8");
}

function writeMarkdownExport(transcript: SessionTranscript): void {
  const fp = markdownFilePath(transcript);
  const dateStr = new Date(transcript.startedAt).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const lines: string[] = [
    `# Addy AI Conversation — ${dateStr}`,
    ``,
    `**Session ID:** ${transcript.sessionId}`,
    `**Started:** ${timestamp()}`,
    transcript.summary ? `**Summary:** ${transcript.summary}` : "",
    ``,
    `---`,
    ``,
  ];

  for (const entry of transcript.entries) {
    const speaker = entry.role === "user" ? "**You**" : "**Addy**";
    const t = new Date(entry.ts).toLocaleTimeString("en-US", {
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    });
    lines.push(`### ${speaker} — ${t}`);
    lines.push(``);
    lines.push(entry.text);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`*Exported from Addy AI — ${timestamp()}*`);

  ensureDir(path.dirname(fp));
  fs.writeFileSync(fp, lines.join("\n"), "utf-8");
}

function updateDayIndex(date: string, sessionId: string): void {
  const indexPath = path.join(BASE_DIR, date, "index.json");
  let sessions: string[] = [];
  try {
    if (fs.existsSync(indexPath)) {
      sessions = JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    }
  } catch { /* ignore corrupt index */ }
  if (!sessions.includes(sessionId)) {
    sessions.push(sessionId);
    fs.writeFileSync(indexPath, JSON.stringify(sessions, null, 2), "utf-8");
  }
}

/** List all transcript files for a given date */
export function listTranscripts(date?: string): string[] {
  const d = date || today();
  const indexPath = path.join(BASE_DIR, d, "index.json");
  try {
    if (fs.existsSync(indexPath)) {
      return JSON.parse(fs.readFileSync(indexPath, "utf-8"));
    }
  } catch { /* ignore */ }
  return [];
}

/** Load a transcript by date and session ID */
export function loadTranscript(date: string, sessionId: string): SessionTranscript | null {
  const fp = path.join(BASE_DIR, date, `${sessionId}.json`);
  try {
    if (fs.existsSync(fp)) {
      return JSON.parse(fs.readFileSync(fp, "utf-8"));
    }
  } catch { /* ignore */ }
  return null;
}

/** Load markdown export by date and session ID */
export function loadTranscriptMarkdown(date: string, sessionId: string): string | null {
  const fp = path.join(BASE_DIR, date, `${sessionId}.md`);
  try {
    if (fs.existsSync(fp)) {
      return fs.readFileSync(fp, "utf-8");
    }
  } catch { /* ignore */ }
  return null;
}

export async function generateSessionSummary(
  _apiKey: string,
  sessionId: string,
): Promise<string> {
  const { getSession, getSessionMessages } = await import("./server_phasex");
  const { providerManager } = await import("./providers/ProviderManager");

  const session = getSession(sessionId);
  if (!session) return "Session not found.";

  const messages = getSessionMessages(sessionId, 1000);
  if (messages.length === 0) return "No conversation recorded this session.";

  const dialogue = messages
    .map((m) => `${m.role === "user" ? "User" : "Addy"}: ${m.text}`)
    .join("\n");

  const prompt =
    `Summarize this conversation session in 3-6 sentences: what was discussed, ` +
    `what was accomplished or decided, and anything left unfinished or that should be ` +
    `picked up next time. Write it as a natural paragraph, third person, no headers.\n\n${dialogue}`;

  try {
    const text = await providerManager.generateResilientCompletion(
      prompt,
      "You are a helpful conversation summarizer."
    );
    if (!text || /^summary unavailable\.?$/i.test(text)) return "";
    return text;
  } catch (err) {
    console.error("[SessionSummary] Generation failed:", err);
    return "";
  }
}

export async function refreshSessionDocuments(
  apiKey: string,
  sessionId: string,
  clientWs?: any | null,
): Promise<void> {
  try {
    const { summaryFilePath, writeTranscriptDoc } = await import("./server_phasex");
    const { storeMemory } = await import("./memory/retriever");
    const { run, saveDatabase } = await import("./database");

    const summary = await generateSessionSummary(apiKey, sessionId);
    if (!summary) {
      console.warn(`[SessionSummary] Generation produced no summary; keeping existing summary for ${sessionId}`);
      return;
    }

    const sfp = summaryFilePath(sessionId);
    const header = `# Session Summary — ${new Date().toLocaleString()}\n\n`;
    fs.writeFileSync(sfp, header + summary + "\n", "utf-8");

    run("UPDATE phasex_sessions SET summary = ? WHERE id = ?", [summary, sessionId]);
    writeTranscriptDoc(sessionId);
    saveDatabase();

    const safeText = summary.slice(0, 500);
    storeMemory(
      safeText.split(/\s+/).slice(0, 5).join(" ").toLowerCase(),
      safeText,
      "session" as any,
      "",
      { source: 'agent_inference', importance: 0.7 }
    );

    if (clientWs && clientWs.readyState === 1) {
      clientWs.send(
        JSON.stringify({
          type: "summary_refresh",
          sessionId,
          summary,
        }),
      );
    }

    console.log(`[SessionSummary] Refreshed documents for session ${sessionId}`);
  } catch (err) {
    console.error("[SessionSummary] Refresh failed:", err);
  }
}
