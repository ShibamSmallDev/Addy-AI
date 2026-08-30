import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpService } from '../execution/mcp-service';
import { OpenCodeSdkAdapter } from '../execution/opencode-adapter';
import { DefaultPermissionService } from '../execution/permission-service';
import { OpencodeClient } from '@opencode-ai/sdk';

function makeAdapter(): OpenCodeSdkAdapter {
  const respond = (data: unknown) => ({ data, error: undefined });
  const fake = {
    mcp: {
      status: async () => respond({
        filesystem: { status: 'connected' },
        db: { status: 'failed', error: 'boom' },
        disabled: { status: 'disabled' },
      }),
      add: async () => respond({ added: { status: 'connected' } }),
    },
  };
  return new OpenCodeSdkAdapter(() => fake as unknown as OpencodeClient);
}

test('mcp: listServers surfaces status from adapter', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const svc = new McpService(adapter, new DefaultPermissionService([]));
  const servers = await svc.listServers();
  assert.equal(servers.length, 3);
  assert.equal(servers.find((s) => s.name === 'filesystem')?.status, 'connected');
  assert.equal(servers.find((s) => s.name === 'db')?.status, 'error');
});

test('mcp: getServerStatus finds a named server', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const svc = new McpService(adapter, new DefaultPermissionService([]));
  const db = await svc.getServerStatus('db');
  assert.equal(db?.status, 'error');
  assert.equal(db?.error, 'boom');
});

test('mcp: addServer is blocked when permissions deny', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const permissions = new DefaultPermissionService([]);
  permissions.setPolicy('MCP_WRITE', 'DENY');
  const svc = new McpService(adapter, permissions);
  await assert.rejects(
    () => svc.addServer({ name: 'tools', command: 'npx' }),
    /denied/
  );
});

test('mcp: addServer succeeds when allowed', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const svc = new McpService(adapter, new DefaultPermissionService([]));
  await svc.addServer({ name: 'tools', command: 'npx' });
  assert.ok(true);
});

test('mcp: listTools returns empty when servers expose no tools', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const svc = new McpService(adapter, new DefaultPermissionService([]));
  const tools = await svc.listTools();
  assert.deepEqual(tools, []);
});

test('mcp: context relevant tools filters by prefix', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const svc = new McpService(adapter, new DefaultPermissionService([]));
  (svc as unknown as { listTools: () => Promise<{ name: string }[]> }).listTools = async () => [
    { name: 'read_file', description: 'x', inputSchema: {} },
    { name: 'weird_tool', description: 'x', inputSchema: {} },
  ];
  const tools = await svc.listContextRelevantTools();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, 'read_file');
});

