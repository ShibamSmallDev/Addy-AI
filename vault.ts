/**
 * Addy — Obsidian Vault Interface
 * ================================
 * Thin read/write layer over the Obsidian markdown vault pointed at by
 * ADDY_MEMORY_DIR in .env (e.g. D:\Obsidian\MEMORIES VAULT\Addy memory).
 *
 * This is the ONLY place that touches vault files. Import it anywhere
 * in the Node/Express backend. Never import fs directly for vault ops.
 *
 * Usage in server.ts:
 *   import { buildVaultContext, vaultWrite, vaultAppend } from "./vault";
 *
 * Vault folder structure expected:
 *   {MEMORY_ROOT}/user/profile.md
 *   {MEMORY_ROOT}/projects/{name}.md
 *   {MEMORY_ROOT}/skills/{trigger-slug}.md
 *   {MEMORY_ROOT}/facts/{domain}.md
 *   {MEMORY_ROOT}/sessions/{YYYY-MM-DD}.md
 */

import fs from "fs/promises";
import path from "path";
import { MEMORY_ROOT } from "./server_paths";
import { computeEmbedding, cosineSimilarity } from "./memory/embeddings";

// ---------------------------------------------------------------------------
// Low-level read / write
// ---------------------------------------------------------------------------

export async function vaultRead(relativePath: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(MEMORY_ROOT, relativePath), "utf-8");
  } catch {
    return null;
  }
}

export async function vaultWrite(relativePath: string, content: string): Promise<void> {
  const full = path.join(MEMORY_ROOT, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, "utf-8");
}

export async function vaultAppend(relativePath: string, content: string): Promise<void> {
  const full = path.join(MEMORY_ROOT, relativePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.appendFile(full, "\n" + content, "utf-8");
}

export async function vaultList(subdir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(MEMORY_ROOT, subdir));
    return entries.filter((f) => f.endsWith(".md")).sort();
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Context builder — called once per request to assemble the vault block
// that gets injected into the Gemini system prompt.
// ---------------------------------------------------------------------------

export interface VaultContext {
  profile: string;
  project: string | null;
  sessions: string[];
  skills: string[];
}

/**
 * Build the vault context to inject into a Gemini system prompt.
 *
 * @param userMessage — used to detect relevant project + skills
 */
export async function buildVaultContext(userMessage: string): Promise<VaultContext> {
  const [profile, project, sessions, skills] = await Promise.all([
    vaultRead("user/profile.md"),
    _detectProject(userMessage),
    _recentSessions(3),
    _matchSkills(userMessage),
  ]);

  return {
    profile: profile ?? "(no profile yet — build it as you learn about the user)",
    project,
    sessions,
    skills,
  };
}

/**
 * Render a VaultContext into the markdown block inserted into a system prompt.
 */
export function renderVaultBlock(ctx: VaultContext): string {
  const sessionBlock =
    ctx.sessions.length > 0
      ? ctx.sessions.join("\n\n---\n\n")
      : "(no recent sessions)";

  const skillBlock =
    ctx.skills.length > 0
      ? ctx.skills.join("\n\n---\n\n")
      : "(no matching skills)";

  return [
    "=== ADDY MEMORY VAULT ===",
    "",
    "--- USER PROFILE ---",
    ctx.profile,
    "",
    "--- ACTIVE PROJECT ---",
    ctx.project ?? "(no project context detected)",
    "",
    "--- RECENT SESSIONS (last 3) ---",
    sessionBlock,
    "",
    "--- MATCHING SKILLS ---",
    skillBlock,
    "",
    "=========================",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Session digest writer
// Writes a compressed daily digest — NOT a raw transcript.
// Call this on idle timeout or explicit session close.
// ---------------------------------------------------------------------------

export async function writeSessionDigest(
  date: string,  // "YYYY-MM-DD"
  workedOn: string[],
  decided: string[],
  leftOpen: string[]
): Promise<void> {
  const content = [
    `---`,
    `type: session`,
    `date: ${date}`,
    `---`,
    ``,
    `## Worked on`,
    ...workedOn.map((l) => `- ${l}`),
    ``,
    `## Decided`,
    ...decided.map((l) => `- ${l}`),
    ``,
    `## Left open`,
    ...leftOpen.map((l) => `- ${l}`),
  ].join("\n");

  // Append (not overwrite) so multiple sessions on same day accumulate
  await vaultAppend(`sessions/${date}.md`, "\n" + content);
}

// ---------------------------------------------------------------------------
// Skill writer
// Call this the second time Addy observes an identical multi-step workflow.
// ---------------------------------------------------------------------------

export async function writeSkill(
  triggerPhrase: string,
  steps: string[],
  context?: string
): Promise<string> {
  const slug = triggerPhrase
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 40);

  const date = new Date().toISOString().split("T")[0];
  const content = [
    `---`,
    `type: skill`,
    `trigger: "${triggerPhrase}"`,
    `learned: ${date}`,
    `---`,
    ``,
    `## Steps`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
    context ? `## Context\n${context}` : "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  await vaultWrite(`skills/${slug}.md`, content);
  return slug;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function _detectProject(userMessage: string): Promise<string | null> {
  const projectFiles = await vaultList("projects");
  const lower = userMessage.toLowerCase();

  // Match by filename stem
  for (const file of projectFiles) {
    const name = file.replace(".md", "");
    if (lower.includes(name.replace(/-/g, " ")) || lower.includes(name)) {
      return vaultRead(`projects/${file}`);
    }
  }

  // Default to adj-ai.md if it exists and nothing else matched
  if (projectFiles.includes("addy-ai.md")) {
    return vaultRead("projects/addy-ai.md");
  }
  if (projectFiles.includes("adj-ai.md")) {
    return vaultRead("projects/adj-ai.md");
  }
  return null;
}

async function _recentSessions(n: number): Promise<string[]> {
  const files = (await vaultList("sessions")).sort().reverse().slice(0, n);
  const contents = await Promise.all(files.map((f) => vaultRead(`sessions/${f}`)));
  return contents.filter((c): c is string => c !== null);
}

// Semantic skill matching cache: skill filename -> { content, embedding }
// Built lazily on first use so the first chat turn pays the one-time cost.
let skillEmbeddings = new Map<string, { content: string; embedding: number[] }>();
let skillEmbeddingCacheReady = false;
let skillEmbeddingCachePromise: Promise<void> | null = null;

// Cosine-similarity threshold for semantic skill matches. Calibrated for the
// MiniLM-L6-v2 embeddings used by memory/embeddings.ts (scores cluster ~0.0-0.4):
// relevant ~0.2+, unrelated ~<=0.0. Raise if false positives appear.
const SKILL_MATCH_THRESHOLD = 0.2;

async function _buildSkillEmbeddingCache(): Promise<void> {
  const skillFiles = await vaultList("skills");
  const fresh = new Map<string, { content: string; embedding: number[] }>();

  for (const file of skillFiles) {
    const content = await vaultRead(`skills/${file}`);
    if (!content) continue;
    // Reuse cached embedding when the file is unchanged.
    const cached = skillEmbeddings.get(file);
    if (cached && cached.content === content) {
      fresh.set(file, cached);
      continue;
    }
    try {
      const embedding = await computeEmbedding(_skillText(content));
      fresh.set(file, { content, embedding });
    } catch {
      // Leave this skill out of semantic matching; keyword fallback still applies.
    }
  }

  skillEmbeddings = fresh;
  skillEmbeddingCacheReady = true;
}

function _skillText(content: string): string {
  // Use the trigger phrase plus the body so the embedding captures intent.
  const trigger = content.match(/trigger:\s*"(.+?)"/)?.[1] ?? "";
  const body = content
    .replace(/```[\s\S]*?```/g, " ") // drop code fences
    .replace(/[#>*`-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${trigger}. ${body}`.slice(0, 2000);
}

async function _matchSkills(userMessage: string): Promise<string[]> {
  const skillFiles = await vaultList("skills");
  const lower = userMessage.toLowerCase();
  const scored: { content: string; score: number }[] = [];

  // Keyword fallback first — always available, no embeddings needed.
  const keywordMatched = new Set<string>();
  for (const file of skillFiles) {
    const content = await vaultRead(`skills/${file}`);
    if (!content) continue;
    const triggerMatch = content.match(/trigger:\s*"(.+?)"/);
    if (triggerMatch) {
      const triggerWords = triggerMatch[1].toLowerCase().split(/\s+/).filter(w => w.length > 2);
      const isMatched = lower.includes(triggerMatch[1].toLowerCase()) || triggerWords.some(w => lower.includes(w));
      if (isMatched) {
        scored.push({ content, score: 1 });
        keywordMatched.add(file);
      }
    }
  }

  // Semantic matching: embed the message and score against cached skill embeddings.
  let messageEmbedding: number[] = [];
  try {
    messageEmbedding = await computeEmbedding(userMessage);
  } catch {
    messageEmbedding = [];
  }

  if (messageEmbedding.length > 0) {
    if (!skillEmbeddingCacheReady) {
      if (!skillEmbeddingCachePromise) {
        skillEmbeddingCachePromise = _buildSkillEmbeddingCache().catch(() => undefined);
      }
      await skillEmbeddingCachePromise;
    }

    const matches: { file: string; content: string; score: number }[] = [];
    for (const file of skillFiles) {
      if (keywordMatched.has(file)) continue; // already included
      const cached = skillEmbeddings.get(file);
      if (!cached || cached.embedding.length === 0) continue;
      const score = cosineSimilarity(messageEmbedding, cached.embedding);
      matches.push({ file, content: cached.content, score });
    }

    matches.sort((a, b) => b.score - a.score);
    for (const m of matches) {
      if (m.score >= SKILL_MATCH_THRESHOLD) {
        scored.push({ content: m.content, score: m.score });
        console.log(
          `[skill_match_debug] "${m.file}" score=${m.score.toFixed(3)} (semantic, threshold ${SKILL_MATCH_THRESHOLD})`
        );
      }
    }
  }

  // De-duplicate and keep the highest score per skill.
  const byContent = new Map<string, number>();
  for (const s of scored) byContent.set(s.content, Math.max(byContent.get(s.content) ?? 0, s.score));
  return [...byContent.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([content]) => content);
}

/**
 * Load all core skills into a structured reference manual for prompt injection.
 */
export async function loadAllSkillsContext(): Promise<string> {
  const skillFiles = await vaultList("skills");
  const blocks: string[] = [];
  for (const file of skillFiles) {
    const content = await vaultRead(`skills/${file}`);
    if (content) {
      blocks.push(content.trim());
    }
  }
  return blocks.length > 0
    ? "\n\n=== LEARNED CAPABILITIES & SKILLS MANUAL ===\n" + blocks.join("\n\n---\n\n") + "\n============================================\n"
    : "";
}

