import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface CronJob {
  id: string;
  name: string;
  schedule: string;        // cron expression (e.g., "0 * * * *" for hourly) or interval ms
  type: "cron" | "interval";
  enabled: boolean;
  payload: Record<string, unknown>; // data passed to handler
  handler: string;         // name of registered handler
  createdAt: number;
  lastRun?: number;
  nextRun?: number;
  runCount: number;
  maxRuns?: number;        // optional limit
}

const CRON_FILE = path.resolve(__dirname, "..", "cron_jobs.json");
const handlers = new Map<string, (payload: Record<string, unknown>) => Promise<void>>();
const jobs = new Map<string, CronJob>();
let jobTimers = new Map<string, ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>>();

function loadJobs(): void {
  try {
    const data = fs.readFileSync(CRON_FILE, "utf-8");
    const arr = JSON.parse(data) as CronJob[];
    for (const job of arr) {
      jobs.set(job.id, job);
    }
    console.log(`[Cron] Loaded ${jobs.size} jobs from ${CRON_FILE}`);
  } catch {
    console.log("[Cron] No existing job file, starting fresh");
  }
}

function saveJobs(): void {
  const arr = [...jobs.values()];
  fs.writeFileSync(CRON_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

function computeNextRun(job: CronJob): number {
  if (job.type === "interval") {
    return Date.now() + (Number(job.schedule) || 60000);
  }
  // Simple cron parser for common patterns: minute hour day month weekday
  // For now, support basic minute/hour/day patterns
  const parts = job.schedule.split(/\s+/);
  if (parts.length !== 5) return Date.now() + 60000;
  const [min, hour, day, month, weekday] = parts;
  const now = new Date();
  let next = new Date(now);
  next.setSeconds(0);
  next.setMilliseconds(0);
  // Minute
  if (min !== "*") {
    const m = parseInt(min, 10);
    if (now.getMinutes() >= m) next.setHours(next.getHours() + 1);
    next.setMinutes(m);
  }
  // Hour
  if (hour !== "*") {
    const h = parseInt(hour, 10);
    if (next.getHours() >= h) next.setDate(next.getDate() + 1);
    next.setHours(h);
  }
  // Day of month
  if (day !== "*") {
    const d = parseInt(day, 10);
    next.setDate(d);
  }
  // Month
  if (month !== "*") {
    const mo = parseInt(month, 10) - 1;
    next.setMonth(mo);
  }
  // Weekday - simplified: skip for now
  if (next <= now) next.setHours(next.getHours() + 1);
  return next.getTime();
}

export function registerCronHandler(name: string, fn: (payload: Record<string, unknown>) => Promise<void>): void {
  handlers.set(name, fn);
}

export function addCronJob(job: Omit<CronJob, "id" | "createdAt" | "runCount" | "nextRun"> & { id?: string }): CronJob {
  const id = job.id || crypto.randomUUID();
  const fullJob: CronJob = {
    ...job,
    id,
    createdAt: Date.now(),
    runCount: 0,
    nextRun: computeNextRun({ ...job, id } as CronJob),
  };
  jobs.set(id, fullJob);
  saveJobs();
  if (fullJob.enabled) startJobTimer(fullJob);
  return fullJob;
}

export function removeCronJob(id: string): boolean {
  const job = jobs.get(id);
  if (!job) return false;
  stopJobTimer(id);
  jobs.delete(id);
  saveJobs();
  return true;
}

export function toggleCronJob(id: string, enabled: boolean): CronJob | null {
  const job = jobs.get(id);
  if (!job) return null;
  job.enabled = enabled;
  saveJobs();
  if (enabled) startJobTimer(job); else stopJobTimer(id);
  return job;
}

export function listCronJobs(): CronJob[] {
  return [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt);
}

export function getCronJob(id: string): CronJob | undefined {
  return jobs.get(id);
}

function startJobTimer(job: CronJob): void {
  stopJobTimer(job.id);
  if (!job.enabled) return;
  if (!handlers.has(job.handler)) {
    console.warn(`[Cron] Handler "${job.handler}" not registered for job ${job.id}`);
    return;
  }
  const run = async () => {
    try {
      console.log(`[Cron] Running job ${job.id} (${job.name})`);
      await handlers.get(job.handler)!(job.payload);
      job.lastRun = Date.now();
      job.runCount++;
      if (job.maxRuns && job.runCount >= job.maxRuns) {
        job.enabled = false;
        stopJobTimer(job.id);
      } else {
        job.nextRun = computeNextRun(job);
      }
      saveJobs();
    } catch (e: any) {
      console.error(`[Cron] Job ${job.id} failed:`, e);
    }
  };
  if (job.type === "interval") {
    const ms = Number(job.schedule) || 60000;
    const timer = setInterval(run, ms);
    jobTimers.set(job.id, timer);
    // Run once immediately
    run();
  } else {
    const delay = Math.max(0, job.nextRun! - Date.now());
    const timer = setTimeout(() => {
      run();
      if (job.enabled) startJobTimer(job); // reschedule
    }, delay);
    jobTimers.set(job.id, timer);
  }
}

function stopJobTimer(id: string): void {
  const timer = jobTimers.get(id);
  if (timer) {
    if (timer instanceof setInterval.constructor || "unref" in timer) {
      clearInterval(timer as any);
    } else {
      clearTimeout(timer as any);
    }
    jobTimers.delete(id);
  }
}

export function startAllJobs(): void {
  for (const job of jobs.values()) {
    if (job.enabled) startJobTimer(job);
  }
  console.log("[Cron] All enabled jobs started");
}

export function stopAllJobs(): void {
  for (const id of jobTimers.keys()) stopJobTimer(id);
  console.log("[Cron] All jobs stopped");
}

// Initialize
loadJobs();