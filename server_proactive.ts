/**
 * Addy Autonomous Proactive Heartbeat Daemon
 * 
 * Periodically monitors:
 * 1. Breaking AI & tech news via Hacker News & TechCrunch RSS.
 * 2. Incoming emails via secure local IMAP.
 * 3. WhatsApp messages via cloned personal Edge browser session.
 * 
 * Features Cognitive Etiquette & Anti-Annoyance:
 * - Quiet hours (default 11 PM to 8 AM): speech completely muted.
 * - Active Window & Focus Awareness: checks current foreground window;
 *   suppresses voice during games, movies, meetings (Zoom, Teams, Discord).
 * - Speech Cooldown: minimum gap between spoken interruptions (default 15m).
 * - Duplicate suppression: tracks seen articles and notification timestamps.
 */

import fs from "fs";
import path from "path";
import { DATA_DIR, dataFile } from "./server_paths";

export interface ProactiveConfig {
  enabled: boolean;
  intervalMinutes: number;
  quietHoursStart: number; // 0 - 23 (default 23: 11 PM)
  quietHoursEnd: number;   // 0 - 23 (default 8: 8 AM)
  speechEnabled: boolean;
  notificationsEnabled: boolean;
  newsEnabled: boolean;
  emailEnabled: boolean;
  whatsappEnabled: boolean;
  speechCooldownMinutes: number; // min minutes between unsolicited speech
  conversationIdleGraceMinutes: number; // minutes of silence after user dialogue before speaking
  onlySpeakWhenFree: boolean; // only speak when Addy is free of tasks/executions
  minNewsScore: number; // minimum Hacker News score to announce aloud (default 100)
}

export interface ProactiveAlert {
  id: string;
  category: "news" | "email" | "whatsapp" | "system";
  title: string;
  summary: string;
  spokenText?: string;
  timestamp: number;
  spoken: boolean;
  metadata?: Record<string, unknown>;
}

const DEFAULT_CONFIG: ProactiveConfig = {
  enabled: true,
  intervalMinutes: 15,
  quietHoursStart: 23,
  quietHoursEnd: 8,
  speechEnabled: true,
  notificationsEnabled: true,
  newsEnabled: true,
  emailEnabled: true,
  whatsappEnabled: true,
  speechCooldownMinutes: 15,
  conversationIdleGraceMinutes: 3,
  onlySpeakWhenFree: true,
  minNewsScore: 100,
};

const CONFIG_FILE = dataFile("proactive_config.json");
const ALERTS_FILE = dataFile("proactive_alerts.json");

let currentConfig: ProactiveConfig = { ...DEFAULT_CONFIG };
let alertsHistory: ProactiveAlert[] = [];
let heartbeatTimer: NodeJS.Timeout | null = null;
let lastCheckTime: number = 0;
let lastSpeechTime: number = 0;
let isChecking: boolean = false;

type BroadcastFn = (data: unknown) => void;
type CallAgentFn = (tool: string, args: Record<string, unknown>) => Promise<{ ok: boolean; result?: unknown; error?: string }>;
export type BusyCheckFn = () => { busy: boolean; reason?: string };

let _broadcast: BroadcastFn | null = null;
let _callAgent: CallAgentFn | null = null;
let _busyCheck: BusyCheckFn | null = null;
let lastUserActivityTime = 0;

/** Register an external callback to inspect if Addy is busy executing tasks or active turns. */
export function registerBusyCheck(fn: BusyCheckFn): void {
  _busyCheck = fn;
}

/** Record user speech or text interaction to enforce idle grace periods. */
export function recordUserActivity(): void {
  lastUserActivityTime = Date.now();
}

// Applications where Addy should never interrupt with voice
const FOCUS_PROTECTED_PROCESSES = new Set([
  "zoom.exe",
  "teams.exe",
  "discord.exe",
  "obs64.exe",
  "steam.exe",
  "epicgameslauncher.exe",
  "valorant.exe",
  "league of legends.exe",
  "vlc.exe",
  "mpc-hc64.exe",
  "powerpnt.exe",
]);

function loadConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      currentConfig = { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch (e: any) {
    console.warn("[Proactive] Failed to load proactive_config.json:", e.message);
  }

  try {
    if (fs.existsSync(ALERTS_FILE)) {
      const raw = fs.readFileSync(ALERTS_FILE, "utf-8");
      alertsHistory = JSON.parse(raw) || [];
    }
  } catch {
    alertsHistory = [];
  }
}

function saveConfig(): void {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(currentConfig, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[Proactive] Failed to save proactive_config.json:", e.message);
  }
}

function saveAlerts(): void {
  try {
    // Keep last 50 alerts
    const trimmed = alertsHistory.slice(-50);
    fs.writeFileSync(ALERTS_FILE, JSON.stringify(trimmed, null, 2), "utf-8");
  } catch (e: any) {
    console.warn("[Proactive] Failed to save proactive_alerts.json:", e.message);
  }
}

/** Check if current hour falls in quiet hours range. */
export function isQuietHours(now = new Date()): boolean {
  const hour = now.getHours();
  const { quietHoursStart, quietHoursEnd } = currentConfig;
  if (quietHoursStart > quietHoursEnd) {
    // e.g. 23 to 8: quiet if hour >= 23 OR hour < 8
    return hour >= quietHoursStart || hour < quietHoursEnd;
  } else {
    // e.g. 1 to 6
    return hour >= quietHoursStart && hour < quietHoursEnd;
  }
}

/** Check whether voice speech is currently polite and permitted. */
async function canSpeakNow(callAgent: CallAgentFn): Promise<boolean> {
  if (!currentConfig.speechEnabled) return false;
  if (isQuietHours()) return false;

  const now = Date.now();
  const cooldownMs = currentConfig.speechCooldownMinutes * 60 * 1000;
  if (now - lastSpeechTime < cooldownMs) return false;

  // 1. Check conversation idle grace period (don't interrupt if user was just talking or in active dialogue)
  if (lastUserActivityTime > 0) {
    const idleGraceMs = currentConfig.conversationIdleGraceMinutes * 60 * 1000;
    const elapsedSinceUserMsg = now - lastUserActivityTime;
    if (elapsedSinceUserMsg < idleGraceMs) {
      console.log(`[Proactive] Voice suppressed: user interacted ${Math.round(elapsedSinceUserMsg / 1000)}s ago (waiting for ${currentConfig.conversationIdleGraceMinutes}m idle silence)`);
      return false;
    }
  }

  // 2. Check if Addy is busy with any other tasks (coding, tools, subagents)
  if (currentConfig.onlySpeakWhenFree && _busyCheck) {
    try {
      const busyStatus = _busyCheck();
      if (busyStatus.busy) {
        console.log(`[Proactive] Voice suppressed: Addy is busy (${busyStatus.reason || 'executing tasks'})`);
        return false;
      }
    } catch (e: any) {
      console.warn("[Proactive] Busy check error:", e.message);
    }
  }

  // 3. Check foreground application focus (gaming, presentations, meetings)
  try {
    const fg = await callAgent("getActiveWindow", {});
    if (fg.ok && fg.result && typeof fg.result === "object") {
      const active = fg.result as Record<string, unknown>;
      const proc = String(active.process_name || "").toLowerCase();
      if (FOCUS_PROTECTED_PROCESSES.has(proc)) {
        console.log(`[Proactive] Voice suppressed: user is in focus-protected app (${proc})`);
        return false;
      }
    }
  } catch {
    // Best-effort check
  }

  return true;
}

/** Record a new proactive alert and broadcast to clients. */
function recordAlert(alert: ProactiveAlert): void {
  alertsHistory.push(alert);
  saveAlerts();
  if (_broadcast) {
    _broadcast({
      type: "proactive_alert",
      alert,
    });
  }
}

/**
 * Execute one autonomous check pass across news, email, and WhatsApp.
 */
export async function runProactiveCycle(manual = false): Promise<{
  newsChecked: boolean;
  emailChecked: boolean;
  whatsappChecked: boolean;
  alerts: ProactiveAlert[];
}> {
  if (isChecking) {
    console.log("[Proactive] Cycle already in progress, skipping.");
    return { newsChecked: false, emailChecked: false, whatsappChecked: false, alerts: [] };
  }

  if (!manual && !currentConfig.enabled) {
    return { newsChecked: false, emailChecked: false, whatsappChecked: false, alerts: [] };
  }

  const callAgent = _callAgent;
  if (!callAgent) {
    console.warn("[Proactive] Desktop agent caller not initialized.");
    return { newsChecked: false, emailChecked: false, whatsappChecked: false, alerts: [] };
  }

  isChecking = true;
  lastCheckTime = Date.now();
  const newAlerts: ProactiveAlert[] = [];

  try {
    console.log(`[Proactive] Running autonomous cycle (manual=${manual})...`);

    // 1. AI & Tech News Check
    let newsChecked = false;
    if (currentConfig.newsEnabled) {
      try {
        const newsRes = await callAgent("fetchAINews", { limit: 3, unread_only: true });
        newsChecked = true;
        if (newsRes.ok && newsRes.result && typeof newsRes.result === "object") {
          const resObj = newsRes.result as Record<string, unknown>;
          const articles = (resObj.articles as Array<Record<string, unknown>>) || [];

          if (articles.length > 0) {
            const top = articles[0];
            const title = String(top.title || "Breaking AI News");
            const summary = String(top.summary || title);
            const spokenText = `Excuse me! A notable AI story just dropped: ${title}. Let me know if you'd like me to read more about it.`;

            const alert: ProactiveAlert = {
              id: "alert_news_" + Date.now(),
              category: "news",
              title: `AI News: ${title}`,
              summary,
              spokenText,
              timestamp: Date.now(),
              spoken: false,
              metadata: top,
            };

            // Notification
            if (currentConfig.notificationsEnabled) {
              await callAgent("showDesktopNotification", {
                title: "Addy AI News",
                message: title,
              }).catch(() => {});
            }

            const score = Number(top.score || 0);
            const isHighImpact = score >= currentConfig.minNewsScore || Boolean(top.breaking);

            // Proactive Voice Speech (only if high-impact story and not busy)
            if (isHighImpact && (await canSpeakNow(callAgent))) {
              console.log(`[Proactive] Speaking high-impact AI news alert aloud (score=${score})...`);
              const spkRes = await callAgent("speakText", { text: spokenText, wait: false }).catch(() => null);
              if (spkRes && spkRes.ok) {
                alert.spoken = true;
                lastSpeechTime = Date.now();
              }
            } else if (!isHighImpact) {
              console.log(`[Proactive] News story saved to alerts; voice skipped (score=${score} < ${currentConfig.minNewsScore})`);
            }

            recordAlert(alert);
            newAlerts.push(alert);
          }
        }
      } catch (e: any) {
        console.warn("[Proactive] News check failed:", e.message);
      }
    }

    // 2. Email Check
    let emailChecked = false;
    if (currentConfig.emailEnabled) {
      try {
        const emailRes = await callAgent("checkEmails", { limit: 3, unread_only: true });
        emailChecked = true;
        if (emailRes.ok && emailRes.result && typeof emailRes.result === "object") {
          const resObj = emailRes.result as Record<string, unknown>;
          const configured = Boolean(resObj.configured);
          const unreadCount = Number(resObj.unread_count || 0);
          const emails = (resObj.emails as Array<Record<string, unknown>>) || [];

          if (configured && unreadCount > 0 && emails.length > 0) {
            const latest = emails[0];
            const sender = String(latest.sender || "Unknown");
            const subject = String(latest.subject || "No Subject");
            const spokenText = `You have a new email from ${sender} regarding ${subject}.`;

            const alert: ProactiveAlert = {
              id: "alert_email_" + Date.now(),
              category: "email",
              title: `Email from ${sender}`,
              summary: subject,
              spokenText,
              timestamp: Date.now(),
              spoken: false,
              metadata: { unreadCount, latest },
            };

            if (currentConfig.notificationsEnabled) {
              await callAgent("showDesktopNotification", {
                title: "Addy Email Alert",
                message: `${unreadCount} unread email(s). Latest: "${subject}" from ${sender}`,
              }).catch(() => {});
            }

            if (await canSpeakNow(callAgent)) {
              console.log("[Proactive] Speaking email alert aloud...");
              const spkRes = await callAgent("speakText", { text: spokenText, wait: false }).catch(() => null);
              if (spkRes && spkRes.ok) {
                alert.spoken = true;
                lastSpeechTime = Date.now();
              }
            }

            recordAlert(alert);
            newAlerts.push(alert);
          }
        }
      } catch (e: any) {
        console.warn("[Proactive] Email check failed:", e.message);
      }
    }

    // 3. WhatsApp Check (Visible browser for user oversight)
    let whatsappChecked = false;
    if (currentConfig.whatsappEnabled) {
      try {
        const waRes = await callAgent("checkWhatsAppMessages", { headless: false, timeout: 15 });
        whatsappChecked = true;
        if (waRes.ok && waRes.result && typeof waRes.result === "object") {
          const resObj = waRes.result as Record<string, unknown>;
          const loggedIn = Boolean(resObj.logged_in);
          const unreadCount = Number(resObj.unread_chats || 0);
          const chats = (resObj.chats as Array<Record<string, unknown>>) || [];

          if (loggedIn && unreadCount > 0 && chats.length > 0) {
            const topChat = chats[0];
            const sender = String(topChat.sender || "Contact");
            const snippet = String(topChat.snippet || "");
            const spokenText = `You have an unread WhatsApp message from ${sender}.`;

            const alert: ProactiveAlert = {
              id: "alert_wa_" + Date.now(),
              category: "whatsapp",
              title: `WhatsApp: ${sender}`,
              summary: snippet,
              spokenText,
              timestamp: Date.now(),
              spoken: false,
              metadata: { unreadCount, chats },
            };

            if (currentConfig.notificationsEnabled) {
              await callAgent("showDesktopNotification", {
                title: "Addy WhatsApp Alert",
                message: `New message from ${sender}: "${snippet}"`,
              }).catch(() => {});
            }

            if (await canSpeakNow(callAgent)) {
              console.log("[Proactive] Speaking WhatsApp alert aloud...");
              const spkRes = await callAgent("speakText", { text: spokenText, wait: false }).catch(() => null);
              if (spkRes && spkRes.ok) {
                alert.spoken = true;
                lastSpeechTime = Date.now();
              }
            }

            recordAlert(alert);
            newAlerts.push(alert);
          }
        }
      } catch (e: any) {
        console.warn("[Proactive] WhatsApp check failed:", e.message);
      }
    }

    return {
      newsChecked,
      emailChecked,
      whatsappChecked,
      alerts: newAlerts,
    };
  } finally {
    isChecking = false;
  }
}

let warmupTimer: NodeJS.Timeout | null = null;

/**
 * Start the autonomous heartbeat scheduler.
 */
export function startProactiveDaemon(broadcast: BroadcastFn, callAgent: CallAgentFn): void {
  loadConfig();
  _broadcast = broadcast;
  _callAgent = callAgent;

  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const intervalMs = Math.max(60_000, currentConfig.intervalMinutes * 60_000);
  console.log(`[Proactive] Daemon started. Checking every ${currentConfig.intervalMinutes} minutes.`);

  // Initial check after 30 seconds to let the system warm up
  warmupTimer = setTimeout(() => {
    warmupTimer = null;
    runProactiveCycle(false).catch((e) => console.warn("[Proactive] Initial cycle error:", e.message));
  }, 30_000);
  if (typeof warmupTimer.unref === "function") {
    warmupTimer.unref();
  }

  heartbeatTimer = setInterval(() => {
    runProactiveCycle(false).catch((e) => console.warn("[Proactive] Scheduled cycle error:", e.message));
  }, intervalMs);
  if (typeof heartbeatTimer.unref === "function") {
    heartbeatTimer.unref();
  }
}

/**
 * Stop the autonomous heartbeat daemon.
 */
export function stopProactiveDaemon(): void {
  if (warmupTimer) {
    clearTimeout(warmupTimer);
    warmupTimer = null;
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  console.log("[Proactive] Daemon stopped.");
}

/**
 * Get current proactive daemon status and recent history.
 */
export function getProactiveStatus(): {
  config: ProactiveConfig;
  lastCheckTime: number;
  lastSpeechTime: number;
  isQuietHours: boolean;
  history: ProactiveAlert[];
} {
  return {
    config: { ...currentConfig },
    lastCheckTime,
    lastSpeechTime,
    isQuietHours: isQuietHours(),
    history: [...alertsHistory].reverse().slice(0, 25),
  };
}

/**
 * Update proactive daemon settings.
 */
export function updateProactiveConfig(updates: Partial<ProactiveConfig>): ProactiveConfig {
  currentConfig = { ...currentConfig, ...updates };
  saveConfig();

  // If interval changed and timer is running, reschedule
  if (heartbeatTimer && _broadcast && _callAgent) {
    startProactiveDaemon(_broadcast, _callAgent);
  }

  return { ...currentConfig };
}
