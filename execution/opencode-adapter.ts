import { execFile } from 'child_process';
import { promisify } from 'util';
import { createOpencodeClient, OpencodeClient } from '@opencode-ai/sdk';
import { EventEmitter } from 'events';
import { getOpenCodeConfig, getOpenCodeServerUrl } from './opencode-config';
import {
  OpenCodeAdapter,
  OpenCodeConnectionState,
  OpenCodeHealth,
  ProjectInfo,
  FileSearchResult,
  FileContent,
  WorkspaceInspection,
  GitStatus,
  GitDiff,
  GitCommit,
  GitLogOptions,
  OpenCodeAgent,
  OpenCodeSession,
  SessionOptions,
  PromptOptions,
  ExecutionResult,
  LspStatus,
  McpStatus,
  McpServerConfig,
} from './types';

const execFileAsync = promisify(execFile);

export class OpenCodeSdkAdapter extends EventEmitter implements OpenCodeAdapter {
  private client: OpencodeClient | null = null;
  private state: OpenCodeConnectionState = 'DISABLED';
  private clientFactory: ((baseUrl: string) => OpencodeClient) | null = null;

  constructor(clientFactory?: (baseUrl: string) => OpencodeClient) {
    super();
    this.clientFactory = clientFactory ?? null;
  }

  getState(): OpenCodeConnectionState {
    return this.state;
  }

  private setState(next: OpenCodeConnectionState): void {
    if (this.state !== next) {
      this.state = next;
      this.emit('stateChange', next);
    }
  }

  async connect(): Promise<void> {
    if (this.state === 'READY' || this.state === 'CONNECTING') return;

    this.setState('CONNECTING');
    const config = getOpenCodeConfig();
    this.client = this.clientFactory
      ? this.clientFactory(getOpenCodeServerUrl())
      : createOpencodeClient({
          baseUrl: getOpenCodeServerUrl(),
        });
    if (!this.clientFactory) {
      const health = await this.getHealth();
      if (!health.healthy) {
        this.setState('DISCONNECTED');
        throw new Error('OpenCode server is not healthy');
      }
    }
    this.setState('READY');
    void config;
  }

  async disconnect(): Promise<void> {
    this.client = null;
    this.setState('DISABLED');
  }

  private async request<T>(fn: () => Promise<T>): Promise<T> {
    const config = getOpenCodeConfig();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error('OpenCode request timed out')), config.requestTimeout);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  private getClient(): OpencodeClient {
    if (!this.client) {
      throw new Error('OpenCode adapter not connected; call connect() first');
    }
    return this.client;
  }

  async getHealth(): Promise<OpenCodeHealth> {
    try {
      const response = await fetch(`${getOpenCodeServerUrl()}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (response.ok) {
        let health: Record<string, unknown> = {};
        try {
          health = await response.json() as Record<string, unknown>;
        } catch {
          // /health may serve the SPA shell; 2xx still means the server is up
        }
        return { healthy: true, version: health.version as string | undefined, details: health };
      }
    } catch {
      // fall through to unhealthy
    }
    return { healthy: false };
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const client = this.getClient();
    const res = await this.request(() => client.project.list({}));
    const projects = (res as { data?: unknown }).data ?? res;
    return (projects as Array<{ id: string; worktree: string; description?: string }>).map((p) => ({
      id: p.id,
      name: p.id,
      path: p.worktree,
      description: p.description,
    }));
  }

  async searchFiles(pattern: string, projectId?: string): Promise<FileSearchResult[]> {
    const client = this.getClient();
    const directory = await this.resolveDirectory(projectId);
    const res = await this.request(() => client.find.files({ query: { directory, query: pattern } }));
    const paths = ((res as { data?: unknown }).data ?? res) as string[];
    return paths.map((p) => ({ path: p }));
  }

  async readFile(path: string): Promise<FileContent> {
    const client = this.getClient();
    const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.';
    const fileName = path.includes('/') ? path.slice(path.lastIndexOf('/') + 1) : path;
    const res = await this.request(() => client.file.read({ query: { directory, path: fileName } }));
    const content = ((res as { data?: unknown }).data ?? res) as { content: string; type?: string };
    return {
      path,
      content: content.content ?? '',
      size: Buffer.byteLength(content.content ?? ''),
      modified: Date.now(),
    };
  }

  async inspectWorkspace(projectPath: string): Promise<WorkspaceInspection> {
    const client = this.getClient();
    const res = await this.request(() => client.find.files({ query: { directory: projectPath, query: '' } }));
    const files = ((res as { data?: unknown }).data ?? res) as string[];
    return {
      projectPath,
      files,
      structure: { fileCount: files.length },
    };
  }

  async listAgents(): Promise<OpenCodeAgent[]> {
    const client = this.getClient();
    const res = await this.request(() => client.app.agents({}));
    const agents = ((res as { data?: unknown }).data ?? res) as Array<{
      name: string;
      description?: string;
      model?: { modelID: string; providerID: string };
      tools?: Record<string, boolean>;
    }>;
    return agents.map((a) => ({
      id: a.name,
      name: a.name,
      description: a.description || '',
      model: a.model ? `${a.model.providerID}/${a.model.modelID}` : undefined,
      tools: a.tools ? Object.keys(a.tools) : undefined,
    }));
  }

  async createSession(options: SessionOptions): Promise<OpenCodeSession> {
    const client = this.getClient();
    const directory = options.projectId || process.cwd();
    const res = await this.request(() =>
      client.session.create({
        query: { directory },
        body: options.systemPrompt ? { title: options.systemPrompt.slice(0, 80) } : {},
      })
    );
    const session = ((res as { data?: unknown }).data ?? res) as {
      id: string;
      directory: string;
      time: { created: number; updated: number };
    };
    return {
      id: session.id,
      projectId: session.directory,
      status: 'active',
      createdAt: session.time.created,
      updatedAt: session.time.updated,
    };
  }

  async sendPrompt(sessionId: string, prompt: string, options?: PromptOptions): Promise<ExecutionResult> {
    const client = this.getClient();
    const startedAt = Date.now();
    const res = await this.request(() =>
      client.session.prompt({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
          model: options?.model ? { providerID: options.model.split('/')[0], modelID: options.model.split('/')[1] ?? options.model } : undefined,
        },
      })
    );
    const message = ((res as { data?: unknown }).data ?? res) as {
      role?: string;
      parts?: Array<{ type: string; text?: string; tool?: string }>;
    };
    const text = message.parts?.filter((p) => p.type === 'text').map((p) => p.text || '').join('\n') || '';
    return {
      taskId: sessionId,
      status: 'success',
      summary: text,
      filesChanged: [],
      commandsExecuted: [],
      tests: [],
      errors: [],
      warnings: [],
      durationMs: Date.now() - startedAt,
      rawReference: JSON.stringify(message).slice(0, 500),
    };
  }

  async sendPromptAsync(sessionId: string, prompt: string, options?: PromptOptions): Promise<{ messageId: string }> {
    const client = this.getClient();
    const res = await this.request(() =>
      client.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: 'text', text: prompt }],
          model: options?.model ? { providerID: options.model.split('/')[0], modelID: options.model.split('/')[1] ?? options.model } : undefined,
        },
      })
    );
    const data = ((res as { data?: unknown }).data ?? res) as { id?: string };
    return { messageId: data.id || '' };
  }

  async waitForCompletion(
    sessionId: string,
    onEvent?: (event: { type: string; data: Record<string, unknown> }) => void,
    timeoutMs?: number
  ): Promise<void> {
    const client = this.getClient();
    const config = getOpenCodeConfig();
    const deadline = Date.now() + (timeoutMs ?? config.requestTimeout);
    const seen = new Set<string>();
    let unchangedPolls = 0;
    let lastSeenCount = -1;

    while (Date.now() < deadline) {
      const messagesRes = await this.request(() => client.session.messages({ path: { id: sessionId } }));
      const messages = ((messagesRes as { data?: unknown }).data ?? messagesRes) as Array<{
        id: string;
        role?: string;
        parts?: Array<{ id?: string; type: string; tool?: string; text?: string; state?: string }>;
      }>;

      const allParts = messages.flatMap((m) => m.parts ?? []);
      const finished = allParts.some((p) => p.type === 'step-finish' || p.type === 'error' || p.type === 'retry');
      const totalCount = allParts.length;

      if (onEvent) {
        for (const part of allParts) {
          if (!part.id || seen.has(part.id)) continue;
          seen.add(part.id);
          if (part.type === 'tool') {
            onEvent({
              type: part.state === 'completed' || part.state === 'error' ? 'tool_completed' : 'tool_started',
              data: { tool: part.tool, state: part.state, sessionId },
            });
          } else if (part.type === 'text') {
            onEvent({ type: 'thinking', data: { text: (part.text || '').slice(0, 200), sessionId } });
          }
        }
      }

      if (finished) return;

      unchangedPolls = totalCount === lastSeenCount ? unchangedPolls + 1 : 0;
      lastSeenCount = totalCount;
      if (unchangedPolls >= 5 && totalCount > 0) return;

      await new Promise((r) => setTimeout(r, 1000));
    }

    throw new Error(`OpenCode session did not complete within timeout (${timeoutMs ?? config.requestTimeout}ms)`);
  }

  async getSessionText(sessionId: string): Promise<string> {
    const client = this.getClient();
    const res = await this.request(() => client.session.messages({ path: { id: sessionId } }));
    const messages = ((res as { data?: unknown }).data ?? res) as Array<{
      role?: string;
      parts?: Array<{ type: string; text?: string }>;
    }>;
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return lastAssistant?.parts?.filter((p) => p.type === 'text').map((p) => p.text || '').join('\n') || '';
  }

  subscribeToEvents(
    handler: (event: { type: string; data: Record<string, unknown> }) => void,
    directory?: string
  ): () => void {
    const client = this.getClient();
    let cancelled = false;
    const run = async (): Promise<void> => {
      try {
        const result = await client.event.subscribe({ query: { directory: directory || process.cwd() } });
        const stream = (result as { stream?: AsyncGenerator<unknown> }).stream;
        if (!stream) return;
        for await (const raw of stream) {
          if (cancelled) break;
          const ev = raw as { type?: string; properties?: Record<string, unknown> };
          if (!ev?.type) continue;
          const mapped = this.mapEvent(ev);
          if (mapped) handler(mapped);
        }
      } catch {
        // stream ended or failed; caller decides whether to resubscribe
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }

  private mapEvent(ev: { type?: string; properties?: Record<string, unknown> }): { type: string; data: Record<string, unknown> } | null {
    if (!ev.type) return null;
    const p = ev.properties ?? {};
    switch (ev.type) {
      case 'message.part.updated': {
        const part = p.part as { type?: string; tool?: string; state?: string; text?: string; file?: string } | undefined;
        if (!part) return null;
        if (part.type === 'tool') {
          const done = part.state === 'completed' || part.state === 'error';
          return { type: done ? 'tool_completed' : 'tool_started', data: { tool: part.tool, state: part.state } };
        }
        if (part.type === 'text') {
          return { type: 'thinking', data: { text: (part.text || '').slice(0, 200) } };
        }
        return null;
      }
      case 'file.edited':
        return { type: 'file_changed', data: { file: p.file } };
      case 'command.executed':
        return { type: 'command_completed', data: { name: p.name, arguments: p.arguments } };
      case 'session.status':
        return p.status && (p.status as { type?: string }).type === 'busy'
          ? { type: 'thinking', data: { sessionId: p.sessionID } }
          : null;
      case 'permission.updated':
        return { type: 'permission_required', data: { title: p.title, sessionId: p.sessionID } };
      case 'session.error':
        return { type: 'failed', data: { sessionId: p.sessionID, error: p.error } };
      default:
        return null;
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    const client = this.getClient();
    await this.request(() => client.session.abort({ path: { id: sessionId } }));
  }

  async getLspStatus(): Promise<LspStatus[]> {
    const client = this.getClient();
    const res = await this.request(() => client.lsp.status({}));
    const servers = ((res as { data?: unknown }).data ?? res) as Array<{
      id: string;
      name: string;
      root: string;
      status: string;
    }>;
    return servers.map((s) => ({
      language: s.name,
      server: s.name,
      status: s.status === 'connected' ? 'running' : s.status === 'error' ? 'error' : 'stopped',
      version: s.id,
    }));
  }

  async getMcpStatus(): Promise<McpStatus[]> {
    const client = this.getClient();
    const res = await this.request(() => client.mcp.status({}));
    const servers = ((res as { data?: unknown }).data ?? res) as Record<
      string,
      { status: string; error?: string }
    >;
    return Object.entries(servers).map(([name, info]) => ({
      name,
      status:
        info.status === 'connected'
          ? 'connected'
          : info.status === 'failed' || info.status === 'needs_auth' || info.status === 'needs_client_registration'
            ? 'error'
            : 'disconnected',
      error: info.error,
    }));
  }

  async addMcpServer(config: McpServerConfig): Promise<void> {
    const client = this.getClient();
    const body =
      config.transport === 'sse'
        ? { name: config.name, config: { type: 'remote', url: config.url || '' } }
        : {
            name: config.name,
            config: { type: 'local', command: [config.command, ...(config.args || [])] },
          };
    await this.request(() => client.mcp.add({ body: body as never }));
  }

  async getGitStatus(): Promise<GitStatus> {
    const client = this.getClient();
    const res = await this.request(() => client.vcs.get({}));
    const vcs = ((res as { data?: unknown }).data ?? res) as { branch: string };
    let branch = vcs.branch || 'unknown';
    let hasUncommittedChanges = false;
    let ahead = 0;
    let behind = 0;
    const files: Array<{ status: string; path: string }> = [];
    try {
      const { stdout } = await execFileAsync('git', ['status', '--porcelain', '--branch'], {
        cwd: process.cwd(),
      });
      const lines = stdout.split('\n').filter((l) => l.trim());
      for (const line of lines) {
        if (line.startsWith('##')) {
          const m = line.match(/## (.+?)(?:\.\.\.|$)/);
          if (m) branch = m[1];
          const aheadMatch = line.match(/ahead (\d+)/);
          const behindMatch = line.match(/behind (\d+)/);
          if (aheadMatch) ahead = parseInt(aheadMatch[1], 10);
          if (behindMatch) behind = parseInt(behindMatch[1], 10);
        } else {
          files.push({ status: line.slice(0, 2).trim(), path: line.slice(3) });
        }
      }
      hasUncommittedChanges = files.length > 0;
    } catch {
      // not a git repo or git unavailable; keep empty state
    }
    return { branch, hasUncommittedChanges, ahead, behind, files };
  }

  async getGitDiff(): Promise<GitDiff> {
    const unified = '';
    const files: Array<{ path: string; additions: number; deletions: number }> = [];
    try {
      const { stdout } = await execFileAsync('git', ['diff', '--stat', '--cached'], { cwd: process.cwd() });
      for (const line of stdout.split('\n')) {
        const m = line.match(/\|\s*(\d+)\s*(\+*)(-*)/);
        if (m) {
          const name = line.split('|')[0].trim();
          files.push({
            path: name,
            additions: (m[2] || '').length,
            deletions: (m[3] || '').length,
          });
        }
      }
    } catch {
      // not a git repo
    }
    return { unified, files };
  }

  async getGitLog(options?: GitLogOptions): Promise<GitCommit[]> {
    const limit = options?.limit || 20;
    try {
      const args = ['log', `--max-count=${limit}`, '--format=%h|%H|%an|%ad|%s', '--date=iso'];
      if (options?.path) args.push('--', options.path);
      const { stdout } = await execFileAsync('git', args, { cwd: process.cwd() });
      return stdout
        .split('\n')
        .filter((l) => l.trim())
        .map((line) => {
          const [shortHash, hash, author, date, ...msgParts] = line.split('|');
          return {
            hash,
            shortHash,
            message: msgParts.join('|'),
            author,
            date,
            files: [],
          };
        });
    } catch {
      return [];
    }
  }

  private async resolveDirectory(projectId?: string): Promise<string> {
    if (!projectId) return process.cwd();
    try {
      const projects = await this.listProjects();
      const match = projects.find((p) => p.id === projectId || p.path === projectId);
      if (match) return match.path;
    } catch {
      // fall through
    }
    return projectId;
  }
}
