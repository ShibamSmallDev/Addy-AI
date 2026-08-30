import { spawn, ChildProcess, SpawnOptions } from 'child_process';
import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { getOpenCodeConfig, getOpenCodeServerUrl } from './opencode-config';
import { OpenCodeConnectionState, OpenCodeHealth } from './types';

function resolveOpenCodeBinary(): string[] {
  const candidates: string[] = [];
  if (process.env.OPENCODE_BINARY) candidates.push(process.env.OPENCODE_BINARY);
  const npmPrefix = process.env.APPDATA
    ? path.join(process.env.APPDATA, 'npm')
    : path.join(process.env.HOME || '', '.npm');
  candidates.push(path.join(npmPrefix, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'));
  candidates.push('opencode.exe');
  candidates.push('opencode');
  const existing = candidates.filter((c) => !path.isAbsolute(c) || fs.existsSync(c));
  return existing.length > 0 ? existing : ['opencode'];
}

export class OpenCodeProcessManager extends EventEmitter {
  private process: ChildProcess | null = null;
  private state: OpenCodeConnectionState = 'DISABLED';
  private config = getOpenCodeConfig();
  private healthCheckInterval: NodeJS.Timeout | null = null;
  private restartAttempts = 0;
  private maxRestartAttempts = 3;
  private isShuttingDown = false;

  getState(): OpenCodeConnectionState {
    return this.state;
  }

  setState(newState: OpenCodeConnectionState): void {
    if (this.state !== newState) {
      this.state = newState;
      this.emit('stateChange', newState);
    }
  }

  async start(): Promise<void> {
    if (this.state === 'STARTING' || this.state === 'READY') {
      return;
    }

    this.setState('STARTING');
    this.isShuttingDown = false;

    try {
      await this.spawnProcess();
      await this.waitForHealth();
      this.setState('READY');
      this.restartAttempts = 0;
      this.startHealthChecks();
    } catch (error) {
      this.setState('ERROR');
      throw error;
    }
  }

  private async spawnProcess(): Promise<void> {
    return new Promise((resolve, reject) => {
      const config = getOpenCodeConfig();
      const serverUrl = getOpenCodeServerUrl();

      const env = {
        ...process.env,
        OPENCODE_HOST: config.host,
        OPENCODE_PORT: config.port.toString(),
      };

      const options: SpawnOptions = {
        cwd: process.cwd(),
        env,
        windowsHide: true,
        detached: false,
      };

      const binaries = resolveOpenCodeBinary();
      const attempt = (index: number): void => {
        const binary = binaries[index];
        console.log(`[OpenCode] Starting server on ${serverUrl} (${binary})...`);
        const child = spawn(binary, ['serve'], options);

        child.once('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT' && index + 1 < binaries.length) {
            console.warn(`[OpenCode] Binary not found: ${binary}, trying next candidate...`);
            attempt(index + 1);
            return;
          }
          if (this.state === 'STARTING') {
            reject(err);
          } else if (!this.isShuttingDown) {
            this.handleCrash();
          }
        });

        child.stdout?.on('data', (data) => {
          const output = data.toString().trim();
          if (output) console.log(`[OpenCode] ${output}`);
        });

        child.stderr?.on('data', (data) => {
          const output = data.toString().trim();
          if (output) console.error(`[OpenCode] ${output}`);
        });

        child.on('close', (code, signal) => {
          console.log(`[OpenCode] Process exited with code ${code}, signal ${signal}`);
          if (this.process === child) {
            this.process = null;
            this.stopHealthChecks();
            if (!this.isShuttingDown && this.state !== 'DISABLED' && this.state !== 'STOPPING') {
              this.handleCrash();
            }
          }
        });

        this.process = child;
      };

      attempt(0);

      setTimeout(() => {
        if (this.state === 'STARTING') {
          resolve();
        }
      }, 1000);
    });
  }

  private async waitForHealth(): Promise<void> {
    const config = getOpenCodeConfig();
    const startTime = Date.now();

    while (Date.now() - startTime < config.startupTimeout) {
      try {
        const response = await fetch(`${getOpenCodeServerUrl()}/health`, {
          method: 'GET',
          signal: AbortSignal.timeout(2000),
        });

        if (response.ok) {
          let version: string | undefined;
          try {
            const health = await response.json() as { version?: string };
            version = health.version;
          } catch {
            // /health may serve the SPA shell; 2xx still means the server is up
          }
          console.log(`[OpenCode] Server healthy${version ? `, version: ${version}` : ''}`);
          return;
        }
      } catch {}

      await new Promise(r => setTimeout(r, 500));
    }

    throw new Error('OpenCode server failed to become healthy within timeout');
  }

  private startHealthChecks(): void {
    this.stopHealthChecks();
    this.healthCheckInterval = setInterval(() => {
      this.checkHealth().catch(() => {});
    }, 30000);
  }

  private stopHealthChecks(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  private async checkHealth(): Promise<OpenCodeHealth> {
    try {
      const response = await fetch(`${getOpenCodeServerUrl()}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      if (response.ok) {
        let health: Record<string, unknown> = {};
        try {
          health = await response.json();
        } catch {
          // 2xx without JSON body is still healthy
        }
        this.emit('health', { healthy: true, ...health });
        return { healthy: true, ...health };
      }
    } catch (e) {
      this.emit('health', { healthy: false });
    }

    return { healthy: false };
  }

  private handleCrash(): void {
    console.warn('[OpenCode] Server crashed, attempting restart...');
    this.setState('DISCONNECTED');

    if (this.restartAttempts < this.maxRestartAttempts && !this.isShuttingDown) {
      this.restartAttempts++;
      console.log(`[OpenCode] Restart attempt ${this.restartAttempts}/${this.maxRestartAttempts}`);
      setTimeout(() => this.start(), 2000);
    } else {
      this.setState('ERROR');
      this.emit('crashed');
    }
  }

  async stop(): Promise<void> {
    this.isShuttingDown = true;
    this.setState('STOPPING');
    this.stopHealthChecks();

    const child = this.process;
    this.process = null;
    if (child) {
      child.kill('SIGTERM');
      await new Promise(r => setTimeout(r, 1000));
      if (!child.killed) {
        child.kill('SIGKILL');
      }
    }

    this.setState('DISABLED');
  }

  async restart(): Promise<void> {
    await this.stop();
    await new Promise(r => setTimeout(r, 1000));
    await this.start();
  }

  async getHealth(): Promise<OpenCodeHealth> {
    return this.checkHealth();
  }
}