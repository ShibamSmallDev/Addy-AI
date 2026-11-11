/**
 * Addy Settings Store — persistent user preferences (V2).
 *
 * Establishes the persistence pattern for Addy: settings are mirrored to
 * localStorage (instant local read) AND synced to the backend (settings.json)
 * so auto-start / wake-word preferences survive across browsers and the
 * Python desktop agent can read them too.
 *
 * Pattern follows the existing codebase conventions: plain state + ref mirrors.
 * No Context/Zustand — this is deliberately lightweight to match audio.ts/memoryTypes.ts.
 */

export interface AddySettings {
  /** Name of the AI companion / assistant (e.g. "Addy", "Luna", "Maya"). */
  assistantName: string;
  /** Your preferred name / nickname (e.g. "Shibam", "Master"). */
  userName: string;
  /** Personality style preset id ("warm_girl" | "playful" | "tsundere" | "cyberpunk" | "devoted_maid" | "pro_copilot"). */
  personalityPreset: string;
  /** Enable the warm emotional girl companion persona structure. */
  companionMode: boolean;
  /** Launch Addy (backends + browser tab) silently on Windows login. */
  autoStart: boolean;
  /** Auto-start screen sharing when a voice session connects (Electron only — no permission prompt). */
  autoStartScreenShare: boolean;
  /** Enable the always-listening wake-word detector. */
  wakeWordEnabled: boolean;
  /** Phrase that activates Addy (case-insensitive substring match). */
  wakePhrase: string;
  /** Preferred microphone device id ("" = system default). */
  micDeviceId: string;
  /** Wake-word sensitivity: 0 (strict) .. 100 (loose). Affects debounce window. */
  sensitivity: number;
  /** Master toggle for UI animations. */
  animations: boolean;
  /** Visualizer presence mode on main screen ('orb' = reacting holographic orb, 'video' = character video playback). */
  visualizerMode: 'orb' | 'video';
  /** Autonomous conversation consciousness: Addy proactively asks follow-up questions during silence. */
  proactiveFollowUps: boolean;
  /** Seconds of silence before Addy asks a follow-up question (default 45s). */
  followUpIntervalSeconds: number;
  /** Maximum consecutive follow-ups without a user reply before gracefully resting. */
  maxConsecutiveFollowUps: number;
}

export const DEFAULT_SETTINGS: AddySettings = {
  assistantName: "Addy",
  userName: "Shibam",
  personalityPreset: "warm_girl",
  companionMode: true,
  autoStart: false,
  autoStartScreenShare: true,
  wakeWordEnabled: true,
  wakePhrase: "babe",
  micDeviceId: "",
  sensitivity: 60,
  animations: true,
  visualizerMode: "orb",
  proactiveFollowUps: true,
  followUpIntervalSeconds: 45,
  maxConsecutiveFollowUps: 1,
};

const STORAGE_KEY = "Addy.settings.v2";

/** Settings keys that the browser should never persist (security). */
const NEVER_PERSIST: ReadonlySet<keyof AddySettings> = new Set([]);

/**
 * localStorage holds ONLY explicitly-set overrides — never the whole
 * defaults-merged object. That distinction is what lets boot hydration tell
 * "the user chose this" apart from "this is just a default", so settings.json
 * can be the base and fresh browsers can't clobber it.
 */
function readStoredOverrides(): Partial<AddySettings> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<AddySettings>) : {};
  } catch {
    return {};
  }
}

/**
 * Load settings for immediate render: defaults with local overrides applied.
 */
export function loadSettings(): AddySettings {
  return { ...DEFAULT_SETTINGS, ...readStoredOverrides() };
}

/**
 * Hydrate from the durable backend store on boot.
 *
 * Precedence: defaults < settings.json (server, durable) < local overrides.
 * The server is the base, so a fresh browser profile (or a settings.json edited
 * out-of-band) picks up the saved preferences instead of silently replacing them
 * with defaults.
 */
export async function hydrateSettingsFromBackend(): Promise<AddySettings> {
  const overrides = readStoredOverrides();
  try {
    const res = await fetch("/api/settings", { cache: "no-store" });
    if (!res.ok) return { ...DEFAULT_SETTINGS, ...overrides };
    const server = (await res.json()) as Partial<AddySettings>;
    if (!server || typeof server !== "object") return { ...DEFAULT_SETTINGS, ...overrides };
    return { ...DEFAULT_SETTINGS, ...server, ...overrides } as AddySettings;
  } catch {
    return { ...DEFAULT_SETTINGS, ...overrides };
  }
}

/**
 * Persist a settings patch.
 * Returns the fully merged settings object.
 */
export function saveSettings(patch: Partial<AddySettings>): AddySettings {
  const stored = readStoredOverrides();
  const nextStored: Partial<AddySettings> = { ...stored };
  (Object.keys(patch) as (keyof AddySettings)[]).forEach((k) => {
    if (!NEVER_PERSIST.has(k)) (nextStored as Record<string, unknown>)[k] = patch[k];
  });
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextStored));
    } catch {
      /* localStorage may be unavailable (private mode) — fail silently. */
    }
  }
  const next: AddySettings = { ...DEFAULT_SETTINGS, ...nextStored } as AddySettings;
  // Best-effort sync to backend so the Python agent can read auto-start state.
  // Send ONLY the patch — the server merges it over settings.json. Shipping the
  // whole defaults-merged object made any browser with empty localStorage
  // overwrite the user's stored preferences (e.g. visualizerMode -> "orb").
  void syncSettingsToBackend(patch).catch(() => {});
  return next;
}

/** Push a settings patch to the backend (server.ts merges it into settings.json). */
async function syncSettingsToBackend(patch: Partial<AddySettings>): Promise<void> {
  try {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
  } catch {
    /* Backend may be briefly unavailable during boot — non-fatal. */
  }
}
