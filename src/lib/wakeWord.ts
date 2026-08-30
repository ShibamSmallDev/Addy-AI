/**
 * Addy Wake Word Detector (V3 — Smart-Home Grade).
 *
 * Designed to behave like Amazon Alexa / Google Home:
 *   - Always listening: preemptive restart of SpeechRecognition every 35s
 *     (before Chrome's ~60s kill limit).
 *   - WakeLock API: keeps the screen/machine awake where supported.
 *   - Visibility handling: instantly re-arms when the tab becomes visible.
 *   - Instant reconnect: no exponential backoff; restarts in ~100ms.
 *   - Phonetic matching: tries common mis-transcriptions so "sakura"
 *     is recognized even when the en-US speech engine hears it differently.
 *
 * Zero external dependencies — uses only native browser APIs.
 *
 * Public API:
 *   const det = new AddyWakeWordDetector();
 *   det.start({ phrase, sensitivity, onTriggered, onState });
 *   det.setPhrase("sakura");
 *   det.setSensitivity(60);
 *   det.stop();
 */

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: any) => void) | null;
  onerror: ((e: any) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

/**
 * Common en-US speech-to-text mis-hearings of the "eddy"/"addy" name family
 * (the words most people pick as Addy's wake phrase). Each entry is matched
 * as a substring of the transcript, so "hey heidi" matches via "heidi" and
 * "say hi to abby" matches via "abby". Deliberately excludes very short
 * fragments ("edi", "adi") that collide with common words like "media".
 */
const EDDY_ADDY_MISHEARINGS: readonly string[] = [
  // --- "addy" family: core single-word spellings ---
  "addy", "addie", "ady", "adie", "adee", "addee", "addey", "aidy", "aidi",
  // --- "eddy" family: core single-word spellings ---
  "eddy", "eddie", "edie", "edy", "eddee", "eddey",
  // --- "addy" / "eddy" with greetings & conversational prefixes ---
  "hey addy", "hi addy", "hello addy", "yo addy", "ok addy", "okay addy", "sup addy",
  "hey eddy", "hi eddy", "hello eddy", "yo eddy", "ok eddy", "okay eddy", "sup eddy",
  "hey addie", "hi addie", "hello addie", "ok addie", "okay addie",
  "hey eddie", "hi eddie", "hello eddie", "ok eddie", "okay eddie",
  "listen addy", "wake up addy", "good morning addy", "good night addy",
  "listen eddy", "wake up eddy", "good morning eddy", "good night eddy",
];

/**
 * Comprehensive list of "babe" / "baby" wake words and clean phonetic variants,
 * mishearings, and conversational prefixes.
 */
const BABE_VARIANTS: readonly string[] = [
  // --- Core single-word forms ---
  "babe", "baby", "babes", "babie", "babee",
  // --- Common phonetic transcriptions & STT mis-hearings ---
  "baeb", "baeby", "bayb", "baybe", "baybee", "beyb", "beybe",
  "bebe", "bebi",
  // --- With greetings / conversational prefixes ---
  "hey babe", "hi babe", "hello babe", "yo babe", "ok babe", "okay babe", "sup babe", "my babe",
  "hey baby", "hi baby", "hello baby", "yo baby", "ok baby", "okay baby", "sup baby", "my baby",
  "hey bebe", "hi bebe", "hello bebe", "yo bebe",
  "hey baeb", "hi baeb",
  "hey baybe", "hi baybe",
  "hey baybee", "hi baybee",
  "listen babe", "wake up babe", "good morning babe", "good night babe",
  "listen baby", "wake up baby", "good morning baby", "good night baby"
];

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition || null) as
    | SpeechRecognitionCtor
    | null;
}

export type WakeWordState = "stopped" | "listening" | "triggered" | "error" | "suspended";

export interface WakeWordOptions {
  phrase: string;
  sensitivity?: number;
  onTriggered?: () => void;
  onState?: (state: WakeWordState) => void;
}

export class AddyWakeWordDetector {
  private recognition: SpeechRecognitionLike | null = null;
  private ctor: SpeechRecognitionCtor | null;
  private phrase = "babe";
  private phraseVariants: string[] = [];
  private sensitivity = 60;
  private onTriggered: (() => void) | null = null;
  private onState: ((s: WakeWordState) => void) | null = null;

  private intended = false;
  private active = false;
  private lastTrigger = 0;
  private debounceMs = 4000;

  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private preemptTimer: ReturnType<typeof setTimeout> | null = null;
  private consecutiveErrors = 0;

  private wakeLock: WakeLockSentinel | null = null;
  private handleVisibility: (() => void) | null = null;

  constructor() {
    this.ctor = getSpeechRecognitionCtor();
    this.buildVariants(this.phrase);
  }

  static isSupported(): boolean {
    return getSpeechRecognitionCtor() !== null;
  }

  start(opts: WakeWordOptions): boolean {
    if (!this.ctor) {
      this.setState("error");
      return false;
    }
    this.phrase = (opts.phrase || "babe").toLowerCase().trim();
    this.buildVariants(this.phrase);
    this.sensitivity = opts.sensitivity ?? this.sensitivity;
    this.onTriggered = opts.onTriggered ?? null;
    this.onState = opts.onState ?? null;
    this.debounceMs = Math.round(8000 - (this.sensitivity / 100) * 6500);
    this.intended = true;
    this.consecutiveErrors = 0;

    this.acquireWakeLock();
    this.listenVisibility();
    this.launch();
    return true;
  }

  stop(): void {
    this.intended = false;
    this.clearTimers();
    this.teardown();
    this.releaseWakeLock();
    this.unlistenVisibility();
    this.setState("stopped");
  }

  setPhrase(phrase: string): void {
    this.phrase = (phrase || "babe").toLowerCase().trim();
    this.buildVariants(this.phrase);
  }

  setSensitivity(value: number): void {
    this.sensitivity = Math.max(0, Math.min(100, value));
    this.debounceMs = Math.round(8000 - (this.sensitivity / 100) * 6500);
  }

  // --- Build phonetic variants for fuzzy matching ---
  // The en-US speech engine transcribes names in many ways. We pre-compute
  // every likely alternative and match with substring `includes`, so any
  // variant present in the transcript (with or without a "hey"/"say" prefix)
  // wakes Addy.

  private buildVariants(phrase: string): void {
    const v = new Set<string>();
    v.add(phrase);

    const expand = (p: string): void => {
      // Homophone swaps - the en-US engine commonly confuses y/ie
      // (e.g. "eddy" transcribed as "eddie", "baby" as "babie"), so accept both.
      v.add(p.replace(/y$/i, "ie"));
      v.add(p.replace(/ie$/i, "y"));

      // Simple phonetic expansions
      v.add(p.replace(/^s/, "s "));
      v.add(p.replace(/^s/, "c "));
      v.add(p.replace(/sa/gi, "sa "));
      v.add(p.replace(/ku/gi, "coo "));
      v.add(p.replace(/ku/gi, "ku "));
      v.add(p.replace(/ra$/i, "rah"));
      v.add(p.replace(/ra$/i, "ra "));
      v.add(p + ".");
    };

    expand(phrase);
    v.add("hey " + phrase);
    v.add("say " + phrase);
    v.add("hi " + phrase);
    v.add("ok " + phrase);
    v.add("okay " + phrase);

    // Bare-name forms so words alone (without "hey"/"say") still match.
    const bare = phrase.replace(/^(hey|say|hi|ha|ay|eh|ok|okay)\s+/i, "").trim();
    if (bare && bare !== phrase) {
      expand(bare);
      v.add("hey " + bare);
      v.add("say " + bare);
      v.add("hi " + bare);
    }

    // Always accept the "Addy"/"Eddy" family
    for (const m of EDDY_ADDY_MISHEARINGS) v.add(m);

    // Always accept the "Babe"/"Baby"/"Bae" family & all variants
    for (const b of BABE_VARIANTS) v.add(b);

    // Sanitise: trim and remove empty.
    const out: string[] = [];
    for (const variant of v) {
      const clean = variant.toLowerCase().trim();
      if (clean) out.push(clean);
    }
    this.phraseVariants = out;
  }

  /** Check if transcript matches any variant using strict word boundaries. */
  private matches(transcript: string): boolean {
    const lower = transcript.toLowerCase().trim();
    if (!lower) return false;

    // Normalize punctuation and whitespace into clean space-delimited tokens
    const cleanText = lower.replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"']/g, " ").replace(/\s+/g, " ").trim();
    const words = cleanText.split(" ");

    // Check each pre-computed variant with strict whole-word / phrase boundaries
    for (const v of this.phraseVariants) {
      if (!v) continue;
      if (v.includes(" ")) {
        // Multi-word phrase (e.g. "hey addy", "wake up babe"): match as distinct phrase with word boundaries
        const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
        if (regex.test(cleanText)) return true;
      } else {
        // Single word (e.g. "addy", "babe"): must match an exact whole token, NOT a substring of another word!
        if (words.includes(v)) return true;
      }
    }

    return false;
  }

  // --- internals --------------------------------------------------------

  private launch(): void {
    this.clearTimers();
    if (!this.ctor || !this.intended) return;
    this.teardown();
    try {
      const rec = new this.ctor();
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = "en-US";
      rec.maxAlternatives = 3;

      rec.onstart = () => {
        this.consecutiveErrors = 0;
        this.active = true;
        this.setState("listening");
        console.log("[wakeWord] listening for '" + this.phrase + "'");
        this.schedulePreemptiveRestart();
      };

      rec.onresult = (e: any) => {
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i];
          if (!res) continue;
          for (let j = 0; j < res.length; j++) {
            const alt = res[j];
            // Skip low-confidence guesses on interim speech to prevent false triggers from background room noise
            if (!res.isFinal && typeof alt?.confidence === "number" && alt.confidence > 0 && alt.confidence < 0.6) {
              continue;
            }
            const transcript = (alt?.transcript || "").toString();
            if (this.matches(transcript)) {
              this.fire(transcript);
              return;
            }
          }
        }
      };

      rec.onerror = (e: any) => {
        const err = e?.error || "unknown";
        if (err === "no-speech" || err === "aborted") return;
        this.consecutiveErrors++;
        console.warn("[wakeWord] error:", err);
        this.setState("error");
      };

      rec.onend = () => {
        this.active = false;
        this.clearPreemptiveRestart();
        if (!this.intended) return;
        this.restartTimer = setTimeout(() => this.launch(), 100);
      };

      this.recognition = rec;
      rec.start();
    } catch (err) {
      console.warn("[wakeWord] launch failed:", err);
      this.setState("error");
      this.restartTimer = setTimeout(() => this.launch(), 1000);
    }
  }

  private teardown(): void {
    if (this.recognition) {
      try {
        this.recognition.onresult = null;
        this.recognition.onerror = null;
        this.recognition.onend = null;
        this.recognition.onstart = null;
        this.recognition.abort();
      } catch { /* ignore */ }
      this.recognition = null;
    }
    this.active = false;
  }

  private schedulePreemptiveRestart(): void {
    this.clearPreemptiveRestart();
    this.preemptTimer = setTimeout(() => {
      if (!this.intended) return;
      console.log("[wakeWord] preemptive restart");
      this.launch();
    }, 35_000);
  }

  private clearPreemptiveRestart(): void {
    if (this.preemptTimer) {
      clearTimeout(this.preemptTimer);
      this.preemptTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearPreemptiveRestart();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
  }

  private fire(transcript?: string): void {
    const now = Date.now();
    if (now - this.lastTrigger < this.debounceMs) return;
    this.lastTrigger = now;
    console.log("[wakeWord] triggered by:", transcript ?? "(matched)");
    this.playActivationSound();
    this.setState("triggered");
    try {
      this.onTriggered?.();
    } catch { /* never let a handler error kill the detector */ }
  }

  private async acquireWakeLock(): Promise<void> {
    if (!("wakeLock" in navigator)) return;
    try {
      this.wakeLock = await (navigator as any).wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => { this.wakeLock = null; });
    } catch { /* non-fatal */ }
  }

  private releaseWakeLock(): void {
    if (this.wakeLock) {
      this.wakeLock.release().catch(() => {});
      this.wakeLock = null;
    }
  }

  private listenVisibility(): void {
    if (typeof document === "undefined") return;
    const handler = () => {
      if (document.hidden) {
        this.teardown();
        this.setState("suspended");
      } else if (this.intended) {
        console.log("[wakeWord] tab visible, resuming");
        this.launch();
      }
    };
    document.addEventListener("visibilitychange", handler);
    this.handleVisibility = handler;
  }

  private unlistenVisibility(): void {
    if (this.handleVisibility && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this.handleVisibility);
      this.handleVisibility = null;
    }
  }

  private playActivationSound(): void {
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = new Ctx();
      const now = ctx.currentTime;
      const notes = [
        { f: 660, t: 0 },
        { f: 880, t: 0.12 },
      ];
      notes.forEach(({ f, t }) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = f;
        gain.gain.setValueAtTime(0.0001, now + t);
        gain.gain.exponentialRampToValueAtTime(0.18, now + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + t);
        osc.stop(now + t + 0.2);
      });
      setTimeout(() => ctx.close().catch(() => {}), 600);
    } catch { /* audio is best-effort */ }
  }

  private setState(s: WakeWordState): void {
    try { this.onState?.(s); } catch { /* ignore */ }
  }

  get isActive(): boolean {
    return this.active;
  }
}
