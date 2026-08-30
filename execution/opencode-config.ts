import fs from 'fs';
import path from 'path';
import { OpenCodeConfig } from './types';

const DEFAULT_CONFIG: OpenCodeConfig = {
  enabled: true,
  host: '127.0.0.1',
  port: 4096,
  autoStart: true,
  startupTimeout: 10000,
  requestTimeout: 120000,
};

const CONFIG_DIR = path.join(process.env.ADDY_DATA_DIR || process.env.ADJ_DATA_DIR || process.cwd(), 'config');
const CONFIG_FILE = path.join(CONFIG_DIR, 'opencode.json');

let cachedConfig: OpenCodeConfig | null = null;

export function getOpenCodeConfig(): OpenCodeConfig {
  if (cachedConfig) return cachedConfig;

  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const content = fs.readFileSync(CONFIG_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      cachedConfig = { ...DEFAULT_CONFIG, ...parsed };
      return cachedConfig;
    }
  } catch (e) {
    console.warn('[OpenCode] Failed to read config, using defaults:', e);
  }

  cachedConfig = DEFAULT_CONFIG;
  return cachedConfig;
}

export function setOpenCodeConfig(config: Partial<OpenCodeConfig>): void {
  const current = getOpenCodeConfig();
  cachedConfig = { ...current, ...config };

  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(cachedConfig, null, 2), 'utf-8');
  } catch (e) {
    console.error('[OpenCode] Failed to write config:', e);
  }
}

export function resetOpenCodeConfig(): void {
  cachedConfig = DEFAULT_CONFIG;
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch {}
}

export function getOpenCodeServerUrl(): string {
  const config = getOpenCodeConfig();
  return `http://${config.host}:${config.port}`;
}