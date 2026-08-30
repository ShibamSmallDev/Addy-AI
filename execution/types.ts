export type OpenCodeConnectionState =
  | 'DISABLED'
  | 'STARTING'
  | 'CONNECTING'
  | 'READY'
  | 'BUSY'
  | 'DISCONNECTED'
  | 'ERROR'
  | 'STOPPING';

export interface OpenCodeConfig {
  enabled: boolean;
  host: string;
  port: number;
  autoStart: boolean;
  startupTimeout: number;
  requestTimeout: number;
}

export interface OpenCodeHealth {
  healthy: boolean;
  version?: string;
  uptime?: number;
  details?: Record<string, unknown>;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  description?: string;
}

export interface FileSearchResult {
  path: string;
  matches?: Array<{ line: number; text: string }>;
}

export interface FileContent {
  path: string;
  content: string;
  size: number;
  modified: number;
}

export interface WorkspaceInspection {
  projectPath: string;
  files: string[];
  structure: Record<string, unknown>;
  gitStatus?: GitStatus;
}

export interface GitStatus {
  branch: string;
  hasUncommittedChanges: boolean;
  ahead: number;
  behind: number;
  files: Array<{ status: string; path: string }>;
}

export interface GitDiff {
  unified: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export interface GitLogOptions {
  limit?: number;
  since?: string;
  author?: string;
  path?: string;
}

export interface OpenCodeAgent {
  id: string;
  name: string;
  description: string;
  model?: string;
  tools?: string[];
}

export interface OpenCodeSession {
  id: string;
  projectId: string;
  status: 'active' | 'completed' | 'failed' | 'aborted';
  createdAt: number;
  updatedAt: number;
}

export interface SessionOptions {
  projectId?: string;
  agentId?: string;
  systemPrompt?: string;
}

export interface PromptOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: string[];
}

export interface ExecutionResult {
  taskId: string;
  status: 'success' | 'failed' | 'cancelled' | 'partial';
  summary: string;
  filesChanged: FileChange[];
  commandsExecuted: CommandExecution[];
  tests: TestResult[];
  errors: ExecutionError[];
  warnings: string[];
  durationMs: number;
  rawReference?: string;
}

export interface FileChange {
  path: string;
  type: 'created' | 'modified' | 'deleted' | 'renamed';
  diff?: string;
}

export interface CommandExecution {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

export interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  durationMs: number;
  details?: TestCase[];
}

export interface TestCase {
  name: string;
  status: 'passed' | 'failed' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface ExecutionError {
  code: string;
  message: string;
  severity: 'error' | 'warning';
  context?: Record<string, unknown>;
}

export interface LspStatus {
  language: string;
  server: string;
  status: 'running' | 'stopped' | 'error';
  version?: string;
}

export interface McpStatus {
  name: string;
  status: 'connected' | 'disconnected' | 'error';
  tools?: McpTool[];
  error?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  transport?: 'stdio' | 'sse';
  url?: string;
}

export type ExecutionMode = 'INSPECT' | 'EXECUTE';

export interface ExecutionCapabilities {
  fileOperations: string[];
  searchOperations: string[];
  terminalOperations: string[];
  gitOperations: string[];
  lspOperations: string[];
  mcpOperations: string[];
}

export interface InspectRequest {
  mode: 'INSPECT';
  projectPath: string;
  operation: string;
  params: Record<string, unknown>;
}

export interface ExecuteRequest {
  mode: 'EXECUTE';
  projectPath: string;
  operation: string;
  params: Record<string, unknown>;
}

export interface PermissionRequest {
  category: PermissionCategory;
  operation: string;
  resource: string;
  details: Record<string, unknown>;
}

export type PermissionCategory =
  | 'FILE_READ'
  | 'FILE_WRITE'
  | 'FILE_DELETE'
  | 'TERMINAL_READ'
  | 'TERMINAL_EXECUTE'
  | 'GIT_READ'
  | 'GIT_WRITE'
  | 'GIT_PUSH'
  | 'MCP_READ'
  | 'MCP_WRITE'
  | 'NETWORK'
  | 'PACKAGE_INSTALL'
  | 'SYSTEM_CHANGE';

export type PermissionDecision = 'ALLOW' | 'ASK' | 'DENY';

export interface PermissionResult {
  decision: PermissionDecision;
  reason?: string;
  conditions?: string[];
}

export interface ExecutionEvent {
  type: ExecutionEventType;
  taskId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export type ExecutionEventType =
  | 'execution.started'
  | 'execution.thinking'
  | 'execution.tool_started'
  | 'execution.tool_completed'
  | 'execution.file_changed'
  | 'execution.command_started'
  | 'execution.command_completed'
  | 'execution.test_started'
  | 'execution.test_completed'
  | 'execution.permission_required'
  | 'execution.completed'
  | 'execution.failed'
  | 'execution.cancelled';

export interface OpenCodeAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getHealth(): Promise<OpenCodeHealth>;
  listProjects(): Promise<ProjectInfo[]>;
  searchFiles(pattern: string, projectId?: string): Promise<FileSearchResult[]>;
  readFile(path: string): Promise<FileContent>;
  inspectWorkspace(projectPath: string): Promise<WorkspaceInspection>;
  listAgents(): Promise<OpenCodeAgent[]>;
  createSession(options: SessionOptions): Promise<OpenCodeSession>;
  sendPrompt(sessionId: string, prompt: string, options?: PromptOptions): Promise<ExecutionResult>;
  cancelSession(sessionId: string): Promise<void>;
  getLspStatus(): Promise<LspStatus[]>;
  getMcpStatus(): Promise<McpStatus[]>;
  addMcpServer(config: McpServerConfig): Promise<void>;
  getGitStatus(): Promise<GitStatus>;
  getGitDiff(): Promise<GitDiff>;
  getGitLog(options?: GitLogOptions): Promise<GitCommit[]>;
}

export interface ExecutionService {
  status(): Promise<{
    state: OpenCodeConnectionState;
    health: OpenCodeHealth;
    capabilities: ExecutionCapabilities;
  }>;
  inspect(request: InspectRequest): Promise<unknown>;
  execute(request: ExecuteRequest): Promise<ExecutionResult>;
  cancel(taskId: string): Promise<void>;
  getCapabilities(): Promise<ExecutionCapabilities>;
}

export interface PermissionService {
  checkPermission(request: PermissionRequest): Promise<PermissionResult>;
  getTrustedWorkspaces(): string[];
  addTrustedWorkspace(workspacePath: string): void;
  removeTrustedWorkspace(workspacePath: string): void;
}