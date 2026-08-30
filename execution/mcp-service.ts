import { EventEmitter } from 'events';
import { OpenCodeSdkAdapter } from './opencode-adapter';
import { DefaultPermissionService } from './permission-service';
import {
  McpStatus,
  McpServerConfig,
  McpTool,
  ExecutionEvent,
} from './types';

const CONTEXT_RELEVANT_TOOL_PREFIXES = [
  'read',
  'grep',
  'search',
  'list',
  'find',
  'git',
  'mcp',
  'bash',
  'execute',
];

export class McpService extends EventEmitter {
  constructor(
    private adapter: OpenCodeSdkAdapter,
    private permissions: DefaultPermissionService
  ) {
    super();
  }

  async listServers(): Promise<McpStatus[]> {
    return this.adapter.getMcpStatus();
  }

  async getServerStatus(name: string): Promise<McpStatus | undefined> {
    const servers = await this.adapter.getMcpStatus();
    return servers.find((s) => s.name === name);
  }

  async addServer(config: McpServerConfig): Promise<void> {
    const permission = await this.permissions.checkPermission({
      category: 'MCP_WRITE',
      operation: 'addServer',
      resource: config.name,
      details: config as unknown as Record<string, unknown>,
    });
    if (permission.decision === 'DENY') {
      throw new Error(`MCP add denied: ${permission.reason}`);
    }
    this.emit('execution', this.event('execution.tool_started', { tool: 'mcp.add', name: config.name }));
    await this.adapter.addMcpServer(config);
    this.emit('execution', this.event('execution.tool_completed', { tool: 'mcp.add', name: config.name }));
  }

  async removeServer(name: string): Promise<void> {
    const permission = await this.permissions.checkPermission({
      category: 'MCP_WRITE',
      operation: 'removeServer',
      resource: name,
      details: {},
    });
    if (permission.decision === 'DENY') {
      throw new Error(`MCP remove denied: ${permission.reason}`);
    }
    this.emit('execution', this.event('execution.tool_started', { tool: 'mcp.remove', name }));
    await this.adapter.addMcpServer({ name, command: '' });
    this.emit('execution', this.event('execution.tool_completed', { tool: 'mcp.remove', name }));
  }

  async enableServer(name: string): Promise<void> {
    const permission = await this.permissions.checkPermission({
      category: 'MCP_WRITE',
      operation: 'enableServer',
      resource: name,
      details: {},
    });
    if (permission.decision === 'DENY') {
      throw new Error(`MCP enable denied: ${permission.reason}`);
    }
    await this.adapter.addMcpServer({ name, command: '' });
  }

  async disableServer(name: string): Promise<void> {
    const permission = await this.permissions.checkPermission({
      category: 'MCP_WRITE',
      operation: 'disableServer',
      resource: name,
      details: {},
    });
    if (permission.decision === 'DENY') {
      throw new Error(`MCP disable denied: ${permission.reason}`);
    }
    await this.adapter.addMcpServer({ name, command: '' });
  }

  async listTools(): Promise<McpTool[]> {
    const servers = await this.adapter.getMcpStatus();
    const tools: McpTool[] = [];
    for (const server of servers) {
      if (server.tools) {
        tools.push(...server.tools);
      }
    }
    return tools;
  }

  async listContextRelevantTools(): Promise<McpTool[]> {
    const tools = await this.listTools();
    return tools.filter((t) =>
      CONTEXT_RELEVANT_TOOL_PREFIXES.some((prefix) => t.name.toLowerCase().startsWith(prefix))
    );
  }

  private event(type: ExecutionEvent['type'], data: Record<string, unknown>): ExecutionEvent {
    return { type, taskId: 'mcp', timestamp: Date.now(), data };
  }
}
