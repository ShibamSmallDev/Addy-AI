import { EventEmitter } from 'events';
import fs from 'fs';
import path from 'path';
import { OpenCodeProcessManager } from './opencode-process';
import { OpenCodeSdkAdapter } from './opencode-adapter';
import { DefaultPermissionService } from './permission-service';
import { getOpenCodeConfig } from './opencode-config';
import {
  ExecutionService,
  ExecutionCapabilities,
  ExecutionResult,
  ExecutionEvent,
  ExecuteRequest,
  InspectRequest,
  OpenCodeConnectionState,
  OpenCodeHealth,
  FileChange,
} from './types';

interface SessionMapping {
  addyTaskId: string;
  opencodeSessionId: string;
  projectPath: string;
  startedAt: number;
  status: 'active' | 'completed' | 'failed' | 'aborted';
  prompt: string;
}

const CAPABILITIES: ExecutionCapabilities = {
  fileOperations: ['read', 'write', 'delete', 'list', 'search'],
  searchOperations: ['text', 'files', 'symbols'],
  terminalOperations: ['classify', 'execute'],
  gitOperations: ['status', 'diff', 'log', 'commit'],
  lspOperations: ['status', 'diagnostics'],
  mcpOperations: ['status', 'tools', 'add'],
};

function sessionFilePath(): string {
  return path.join(process.env.ADDY_DATA_DIR || process.env.ADJ_DATA_DIR || process.cwd(), 'config', 'opencode-sessions.json');
}

export class OpenCodeExecutionService extends EventEmitter implements ExecutionService {
  readonly processManager: OpenCodeProcessManager;
  readonly adapter: OpenCodeSdkAdapter;
  readonly permissions: DefaultPermissionService;
  private sessions = new Map<string, SessionMapping>();
  private skipProcess: boolean;
  private eventStreamOff: (() => void) | null = null;

  constructor(
    processManager?: OpenCodeProcessManager,
    adapter?: OpenCodeSdkAdapter,
    permissions?: DefaultPermissionService,
    options?: { skipProcess?: boolean }
  ) {
    super();
    this.skipProcess = options?.skipProcess ?? false;
    this.processManager = processManager ?? new OpenCodeProcessManager();
    this.adapter = adapter ?? new OpenCodeSdkAdapter();
    this.permissions = permissions ?? new DefaultPermissionService();
    this.loadSessions();

    this.processManager.on('stateChange', (state: OpenCodeConnectionState) => {
      this.emit('execution', this.event('execution.started', { state }));
    });
    this.adapter.on('stateChange', (state: OpenCodeConnectionState) => {
      this.emit('execution', this.event('execution.started', { state }));
    });
  }

  private event(type: ExecutionEvent['type'], data: Record<string, unknown>): ExecutionEvent {
    return { type, taskId: 'execution', timestamp: Date.now(), data };
  }

  private forwardAdapterEvent(sessionId: string, ev: { type: string; data: Record<string, unknown> }): void {
    let mapping: ExecutionEvent['type'] | null = null;
    switch (ev.type) {
      case 'tool_started':
        mapping = 'execution.tool_started';
        break;
      case 'tool_completed':
        mapping = 'execution.tool_completed';
        break;
      case 'file_changed':
        mapping = 'execution.file_changed';
        break;
      case 'command_completed':
        mapping = 'execution.command_completed';
        break;
      case 'thinking':
        mapping = 'execution.thinking';
        break;
      case 'permission_required':
        mapping = 'execution.permission_required';
        break;
      case 'failed':
        mapping = 'execution.failed';
        break;
    }
    if (mapping) {
      const task = [...this.sessions.values()].find((s) => s.opencodeSessionId === sessionId);
      this.emit('execution', {
        type: mapping,
        taskId: task?.addyTaskId ?? 'execution',
        timestamp: Date.now(),
        data: ev.data,
      });
    }
  }

  async start(): Promise<void> {
    const config = getOpenCodeConfig();
    if (!config.enabled) {
      this.emit('execution', this.event('execution.failed', { reason: 'OpenCode disabled' }));
      return;
    }
    if (config.autoStart && !this.skipProcess) {
      await this.processManager.start();
    }
    await this.adapter.connect();
    this.eventStreamOff = this.adapter.subscribeToEvents((ev) => this.forwardAdapterEvent((ev.data?.sessionId as string) ?? '', ev));
  }

  async stop(): Promise<void> {
    if (this.eventStreamOff) {
      this.eventStreamOff();
      this.eventStreamOff = null;
    }
    await this.processManager.stop();
    await this.adapter.disconnect();
    this.persistSessions();
  }

  async status(): Promise<{
    state: OpenCodeConnectionState;
    health: OpenCodeHealth;
    capabilities: ExecutionCapabilities;
  }> {
    const state = this.adapter.getState();
    const health = await this.adapter.getHealth();
    return { state, health, capabilities: CAPABILITIES };
  }

  async getCapabilities(): Promise<ExecutionCapabilities> {
    return CAPABILITIES;
  }

  async inspect(request: InspectRequest): Promise<unknown> {
    switch (request.operation) {
      case 'searchFiles':
        return this.adapter.searchFiles(String(request.params.pattern ?? ''), request.projectPath);
      case 'readFile':
        return this.adapter.readFile(String(request.params.path ?? ''));
      case 'inspectWorkspace':
        return this.adapter.inspectWorkspace(request.projectPath);
      case 'listProjects':
        return this.adapter.listProjects();
      case 'listAgents':
        return this.adapter.listAgents();
      case 'gitStatus':
        return this.adapter.getGitStatus();
      case 'gitDiff':
        return this.adapter.getGitDiff();
      case 'gitLog':
        return this.adapter.getGitLog(request.params as never);
      case 'lspStatus':
        return this.adapter.getLspStatus();
      case 'mcpStatus':
        return this.adapter.getMcpStatus();
      default:
        throw new Error(`Unknown inspect operation: ${request.operation}`);
    }
  }

  async execute(request: ExecuteRequest): Promise<ExecutionResult> {
    const taskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.emit('execution', this.event('execution.started', { taskId, operation: request.operation }));

    const permissionCheck = await this.permissions.checkPermission({
      category: this.categoryForOperation(request.operation),
      operation: request.operation,
      resource: request.projectPath,
      details: request.params,
    });

    if (permissionCheck.decision === 'DENY') {
      const result: ExecutionResult = {
        taskId,
        status: 'failed',
        summary: `Permission denied: ${permissionCheck.reason || 'no reason'}`,
        filesChanged: [],
        commandsExecuted: [],
        tests: [],
        errors: [{ code: 'PERMISSION_DENIED', message: permissionCheck.reason || 'Permission denied', severity: 'error' }],
        warnings: [],
        durationMs: 0,
      };
      this.emit('execution', this.event('execution.failed', { taskId, reason: permissionCheck.reason }));
      return result;
    }

    this.emit('execution', this.event('execution.permission_required', {
      taskId,
      decision: permissionCheck.decision,
      category: this.categoryForOperation(request.operation),
    }));

    try {
      const gitBefore = await this.gitSnapshot(request.projectPath);
      const session = await this.adapter.createSession({ projectId: request.projectPath });
      const mapping: SessionMapping = {
        addyTaskId: taskId,
        opencodeSessionId: session.id,
        projectPath: request.projectPath,
        startedAt: Date.now(),
        status: 'active',
        prompt: request.operation,
      };
      this.sessions.set(taskId, mapping);
      this.persistSessions();

      const prompt = this.buildPrompt(request);
      const startedAt = Date.now();
      await this.adapter.sendPromptAsync(session.id, prompt);
      await this.adapter.waitForCompletion(session.id, (ev) => {
        this.forwardAdapterEvent(session.id, { ...ev, data: { ...ev.data, sessionId: session.id } });
      });
      const durationMs = Date.now() - startedAt;

      if (mapping.status === 'aborted') {
        const aborted: ExecutionResult = {
          taskId,
          status: 'cancelled',
          summary: 'Execution cancelled by user',
          filesChanged: [],
          commandsExecuted: [],
          tests: [],
          errors: [],
          warnings: [],
          durationMs,
        };
        this.emit('execution', this.event('execution.cancelled', { taskId }));
        return aborted;
      }

      const summary = await this.adapter.getSessionText(session.id);
      mapping.status = 'completed';
      this.persistSessions();

      const gitAfter = await this.gitSnapshot(request.projectPath);
      const result: ExecutionResult = {
        taskId,
        status: 'success',
        summary,
        filesChanged: this.diffFiles(gitBefore, gitAfter),
        commandsExecuted: [],
        tests: [],
        errors: [],
        warnings: [],
        durationMs,
        rawReference: JSON.stringify({ opencodeSessionId: session.id }),
      };
      this.emit('execution', this.event('execution.completed', { taskId, status: result.status }));
      return result;
    } catch (error) {
      const err = error as Error;
      const result: ExecutionResult = {
        taskId,
        status: 'failed',
        summary: err.message || 'Execution failed',
        filesChanged: [],
        commandsExecuted: [],
        tests: [],
        errors: [{ code: 'EXECUTION_ERROR', message: err.message || String(error), severity: 'error' }],
        warnings: [],
        durationMs: 0,
      };
      this.emit('execution', this.event('execution.failed', { taskId, error: err.message }));
      return result;
    }
  }

  async cancel(taskId: string): Promise<void> {
    const mapping = this.sessions.get(taskId);
    if (!mapping) {
      throw new Error(`No session for task: ${taskId}`);
    }
    await this.adapter.cancelSession(mapping.opencodeSessionId);
    mapping.status = 'aborted';
    this.persistSessions();
    this.emit('execution', this.event('execution.cancelled', { taskId }));
  }

  getSessionMapping(taskId: string): SessionMapping | undefined {
    return this.sessions.get(taskId);
  }

  listSessionMappings(): SessionMapping[] {
    return [...this.sessions.values()];
  }

  private buildPrompt(request: ExecuteRequest): string {
    const paramsJson = JSON.stringify(request.params ?? {}, null, 2);
    return [
      'You are Addy\'s developer execution engine running in a project.',
      '',
      `Project path: ${request.projectPath}`,
      `Operation: ${request.operation}`,
      '',
      'Parameters:',
      paramsJson,
      '',
      'Execute the operation carefully. Report exactly what you did: files changed (with paths), commands run, tests executed and their results, and any errors encountered.',
    ].join('\n');
  }

  /** Snapshot of `git status` for a project, keyed by path. Empty on failure. */
  private async gitSnapshot(cwd: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    try {
      const st = await this.adapter.getGitStatus(cwd);
      for (const f of st.files) map.set(f.path, f.status || 'M');
    } catch {
      /* not a git repo, or git unavailable — leave empty */
    }
    return map;
  }

  /** Derive real FileChange[] from a before/after git-status diff. */
  private diffFiles(before: Map<string, string>, after: Map<string, string>): FileChange[] {
    const typeFor = (s: string): FileChange['type'] =>
      s === '??' || s === 'A' ? 'created'
      : s === 'D' ? 'deleted'
      : s.startsWith('R') ? 'renamed'
      : 'modified';
    const out: FileChange[] = [];
    for (const [p, s] of after) {
      if (!before.has(p)) out.push({ path: p, type: typeFor(s) });
      else if (before.get(p) !== s) out.push({ path: p, type: typeFor(s) });
    }
    for (const p of before.keys()) {
      if (!after.has(p)) out.push({ path: p, type: 'deleted' });
    }
    return out;
  }

  private categoryForOperation(operation: string) {
    if (operation.startsWith('git')) return 'GIT_WRITE';
    if (operation.startsWith('mcp')) return 'MCP_WRITE';
    if (operation.startsWith('search')) return 'FILE_READ';
    return 'FILE_WRITE';
  }

  private loadSessions(): void {
    try {
      if (fs.existsSync(sessionFilePath())) {
        const parsed = JSON.parse(fs.readFileSync(sessionFilePath(), 'utf-8')) as SessionMapping[];
        for (const m of parsed) this.sessions.set(m.addyTaskId, m);
      }
    } catch {
      // ignore corrupt session file
    }
  }

  private persistSessions(): void {
    try {
      const file = sessionFilePath();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify([...this.sessions.values()], null, 2), 'utf-8');
    } catch {
      // non-fatal
    }
  }
}
