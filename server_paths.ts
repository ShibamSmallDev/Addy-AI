/**
 * Addy — path & secret resolution.
 *
 * Separates read-only *code/asset* locations (shipped with the app) from the
 * writable *data* location (per-user, survives reinstalls). In development both
 * collapse to the project root, so existing behaviour is unchanged. When the
 * packaged Electron app launches the backend it sets ADDY_DATA_DIR to a
 * writable folder under %APPDATA%\Addy, because the install directory
 * (Program Files) is read-only.
 *
 * The Gemini API key is NOT shipped with the app. Each user supplies their own
 * on first run; it is stored here in the per-user data dir (never returned to
 * the frontend).
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Load .env before resolving any paths below. This module is imported during
// the ESM import phase (before server.ts's own dotenv.config() runs), so the
// env vars must be available here for ADDY_MEMORY_DIR to take effect.
dotenv.config();

/** Writable per-user data directory. Falls back to cwd in development. */
export const DATA_DIR: string = process.env.ADDY_DATA_DIR || process.env.ADJ_DATA_DIR || process.cwd();

/**
 * Root for Addy's long-lived memory: the markdown knowledge base
 * (knowledge_base/), session transcripts (memory/sessions/), summaries and
 * long-term files (memory/). Point it at an Obsidian vault folder so
 * memories are readable/editable there, e.g.:
 *   ADDY_MEMORY_DIR="D:\Obsidian\MEMORIES VAULT\Addy memory"
 * Falls back to cwd in development.
 */
export const MEMORY_ROOT: string = process.env.ADDY_MEMORY_DIR || process.cwd();

try {
  fs.mkdirSync(DATA_DIR, { recursive: true });
} catch {
  /* already exists / best-effort */
}

/** Absolute path to a file inside the writable data directory. */
export function dataFile(name: string): string {
  return path.join(DATA_DIR, name);
}

// ---------------------------------------------------------------------------
// Gemini API key store (secrets.json in the data dir).
// ---------------------------------------------------------------------------
const SECRETS_FILE = dataFile("secrets.json");

interface Secrets {
  /** Legacy single key. Still read, and kept as the last pool entry. */
  geminiApiKey?: string;
  /** Ordered pool of keys tried in turn. */
  geminiApiKeys?: string[];
}

function readSecrets(): Secrets {
  try {
    if (fs.existsSync(SECRETS_FILE)) {
      return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf-8")) as Secrets;
    }
  } catch {
    /* corrupt — treat as empty */
  }
  return {};
}

function writeSecrets(next: Secrets): void {
  fs.writeFileSync(SECRETS_FILE, JSON.stringify(next, null, 2), "utf-8");
  try {
    fs.chmodSync(SECRETS_FILE, 0o600); // owner-only where supported
  } catch {
    /* Windows ACLs differ; best-effort */
  }
}

/** Every configured key, de-duplicated, env keys last. */
function keyPool(): string[] {
  const s = readSecrets();
  const list = Array.isArray(s.geminiApiKeys) ? s.geminiApiKeys : [];
  const legacy = s.geminiApiKey?.trim();
  const env = (
    process.env.ADDY_GEMINI_API_KEY ||
    process.env.ADJ_GEMINI_API_KEY ||
    process.env.GEMINI_API_KEY
  )?.trim();
  const all = [legacy, ...list, env]
    .filter((k): k is string => typeof k === "string")
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set(all)];
}

// ---------------------------------------------------------------------------
// Key health / rotation
//
// A failing key is benched for a growing cooldown instead of being removed, so
// a transient outage heals on its own and an expired-but-refreshed credential
// comes back without restarting the app.
//
// ponytail: health is in-memory only — a restart re-probes every key from
// scratch. Persist it only if key flapping actually becomes a problem.
// ---------------------------------------------------------------------------
interface KeyHealth {
  fails: number;
  cooldownUntil: number;
}
const keyHealth = new Map<string, KeyHealth>();
const BASE_COOLDOWN_MS = 30_000;
const MAX_COOLDOWN_MS = 10 * 60_000;

/**
 * Whether an error looks like a credential/quota problem worth rotating on.
 * Deliberately EXCLUDES capacity errors (503 / high demand / overloaded): those
 * are server-side, so every key hits the same overloaded backend and rotating
 * just multiplies the latency.
 */
export function isKeyError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? "").toLowerCase();
  if (isCapacityError(e)) return false;
  return (
    /api key not valid|invalid api key|api_key_invalid|permission denied|unauthenticated|unauthorized|too many requests|quota|resource_exhausted|rate limit|invalid_grant|invalid authentication|token expired|access denied|forbidden|400|401|403|429/.test(
      m
    )
  );
}

/**
 * Upstream capacity failure (503 / high demand / overloaded). Retrying other
 * models or keys cannot help, so callers should fail fast instead of walking
 * the whole fallback chain and multiplying the user's wait.
 */
export function isCapacityError(e: unknown): boolean {
  const m = String((e as any)?.message ?? e ?? "").toLowerCase();
  return /high demand|overloaded|capacity|503|service unavailable|unavailable at this time|try again later|internal error|deadline exceeded/.test(
    m
  );
}

/**
 * All usable keys, healthiest first. Keys still cooling down are appended rather
 * than dropped, so a total outage degrades to "try them in turn" instead of
 * "no key at all".
 */
export function getGeminiApiKeys(): string[] {
  const now = Date.now();
  const pool = keyPool();
  const healthy: string[] = [];
  const cooling: string[] = [];
  for (const k of pool) {
    if ((keyHealth.get(k)?.cooldownUntil ?? 0) <= now) healthy.push(k);
    else cooling.push(k);
  }
  return [...healthy, ...cooling];
}

/**
 * Resolve the active Gemini API key — the single source of truth.
 * Priority: user-entered keys (secrets.json) → environment (.env, dev only).
 * Callers (GeminiProvider, AgentLoop, memory curator, skills learner, image
 * generation) all go through here so a key entered in the Settings UI works
 * everywhere, not just in the chat path.
 */
export function getGeminiApiKey(): string | undefined {
  return getGeminiApiKeys()[0];
}

/** Bench a failing key so the next request picks a different one. */
export function reportGeminiKeyFailure(key: string | undefined): void {
  if (!key) return;
  const h = keyHealth.get(key) ?? { fails: 0, cooldownUntil: 0 };
  h.fails += 1;
  h.cooldownUntil = Date.now() + Math.min(BASE_COOLDOWN_MS * 2 ** (h.fails - 1), MAX_COOLDOWN_MS);
  keyHealth.set(key, h);
  console.warn(
    `[GeminiKey] key …${key.slice(-4)} failed (${h.fails}); cooling down for ${Math.round(
      (h.cooldownUntil - Date.now()) / 1000
    )}s`
  );
}

/** Clear a key's failure history after a successful call. */
export function reportGeminiKeySuccess(key: string | undefined): void {
  if (key) keyHealth.delete(key);
}

/**
 * Whether a specific key is currently worth spending a request on.
 * Used to stop background housekeeping (memory consolidation, summaries) from
 * competing with real conversation when every key is benched.
 */
export function isGeminiKeyUsable(key: string): boolean {
  return (keyHealth.get(key)?.cooldownUntil ?? 0) <= Date.now();
}

/** Masked per-key status for diagnostics/settings UI. */
export function getGeminiKeyStatus(): Array<{
  masked: string;
  source: "settings" | "env";
  cooling: boolean;
  cooldownRemainingMs: number;
}> {
  const now = Date.now();
  const s = readSecrets();
  const inSettings = new Set(
    [s.geminiApiKey, ...(Array.isArray(s.geminiApiKeys) ? s.geminiApiKeys : [])]
      .filter((k): k is string => typeof k === "string")
      .map((k) => k.trim()),
  );
  return getGeminiApiKeys().map((k) => {
    const until = keyHealth.get(k)?.cooldownUntil ?? 0;
    return {
      masked: `…${k.slice(-4)}`,
      source: inSettings.has(k) ? ("settings" as const) : ("env" as const),
      cooling: until > now,
      cooldownRemainingMs: Math.max(0, until - now),
    };
  });
}

/** Whether any usable key is configured (without revealing it). */
export function hasGeminiApiKey(): boolean {
  return Boolean(getGeminiApiKey());
}

/**
 * Persist a user-supplied key or keys.
 * Accepts a single key, or several separated by newlines/commas so the existing
 * Settings field can take a pasted list without any UI change.
 */
export function setGeminiApiKey(key: string): void {
  const keys = String(key || "")
    .split(/[\r\n,]+/)
    .map((k) => k.trim())
    .filter(Boolean);
  if (keys.length === 0) throw new Error("API key must not be empty.");
  const current = readSecrets();
  current.geminiApiKeys = keys;
  delete current.geminiApiKey; // pool is now authoritative
  writeSecrets(current);
  for (const k of keys) keyHealth.delete(k);
}

/** Append one key to the pool, keeping existing ones. */
export function addGeminiApiKey(key: string): void {
  const trimmed = (key || "").trim();
  if (!trimmed) throw new Error("API key must not be empty.");
  const current = readSecrets();
  const existing = [
    ...(Array.isArray(current.geminiApiKeys) ? current.geminiApiKeys : []),
    ...(current.geminiApiKey ? [current.geminiApiKey] : []),
  ]
    .map((k) => k.trim())
    .filter(Boolean);
  if (!existing.includes(trimmed)) existing.push(trimmed);
  current.geminiApiKeys = existing;
  delete current.geminiApiKey;
  writeSecrets(current);
}

/** Remove all stored keys (used by "reset"/sign-out flows). */
export function clearGeminiApiKey(): void {
  const current = readSecrets();
  delete current.geminiApiKey;
  delete current.geminiApiKeys;
  writeSecrets(current);
  keyHealth.clear();
}
