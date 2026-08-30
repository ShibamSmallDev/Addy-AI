import fs from "fs";
import path from "path";

const SOUL_PATH = path.resolve(process.cwd(), "SOUL.md");

let soulContent = "";
let watcher: fs.FSWatcher | null = null;

function loadSoul(): string {
  try {
    return fs.readFileSync(SOUL_PATH, "utf-8");
  } catch {
    return "";
  }
}

/** Return the current SOUL.md content (hot-reloaded). */
export function getSoul(): string {
  return soulContent;
}

/** Reload SOUL.md immediately (used by tests / manual triggers). */
export function reloadSoul(): string {
  soulContent = loadSoul();
  return soulContent;
}

/** Watch SOUL.md and reload on change without restarting the server. */
export function watchSoul(): void {
  if (watcher) return;
  soulContent = loadSoul();
  try {
    watcher = fs.watch(SOUL_PATH, (_eventType, filename) => {
      if (filename === "SOUL.md" || filename === null) {
        soulContent = loadSoul();
        console.log("[Soul] Reloaded SOUL.md");
      }
    });
  } catch {
    console.warn("[Soul] Could not watch SOUL.md (file may not exist yet).");
  }
}

/** Stop watching (mainly for tests / clean shutdown). */
export function stopWatchingSoul(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
