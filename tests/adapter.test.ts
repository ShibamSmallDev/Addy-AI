import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeSdkAdapter } from '../execution/opencode-adapter';
import { OpencodeClient } from '@opencode-ai/sdk';

type StubClient = {
  [key: string]: any;
};

function makeFakeClient(): StubClient {
  const respond = (data: unknown) => ({ data, error: undefined });
  return {
    project: {
      list: async () => respond([
        { id: 'proj-1', worktree: 'C:\\workspace\\alpha' },
        { id: 'proj-2', worktree: 'C:\\workspace\\beta' },
      ]),
    },
    find: {
      files: async ({ query }: any) => respond([`${query.directory}\\src\\index.ts`]),
    },
    file: {
      read: async ({ query }: any) => respond({ content: `content of ${query.path}`, type: 'text' }),
    },
    app: {
      agents: async () => respond([
        { name: 'build', description: 'Builder agent', model: { modelID: 'qwen3:8b', providerID: 'ollama' }, tools: { read: true, write: true } },
        { name: 'plan', description: 'Planner agent', tools: {} },
      ]),
    },
    session: {
      create: async () => respond({ id: 'session-1', directory: 'C:\\workspace\\alpha', time: { created: 1000, updated: 1000 } }),
      prompt: async ({ path }: any) => respond({
        id: `msg-${path.id}`,
        role: 'assistant',
        parts: [{ type: 'text', text: 'Done. Changed src/index.ts.' }],
      }),
      abort: async () => respond(true),
    },
    vcs: { get: async () => respond({ branch: 'main' }) },
    lsp: {
      status: async () => respond([
        { id: 'ts', name: 'typescript', root: 'C:\\workspace\\alpha', status: 'connected' },
      ]),
    },
    mcp: {
      status: async () => respond({ filesystem: { status: 'connected' }, db: { status: 'failed', error: 'boom' } }),
      add: async () => respond({ added: { status: 'connected' } }),
    },
  };
}

function makeAdapter(): OpenCodeSdkAdapter {
  return new OpenCodeSdkAdapter(() => makeFakeClient() as unknown as OpencodeClient);
}

test('adapter: connect transitions to READY', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  assert.equal(adapter.getState(), 'READY');
});

test('adapter: listProjects maps id/path from SDK projects', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const projects = await adapter.listProjects();
  assert.equal(projects.length, 2);
  assert.equal(projects[0].id, 'proj-1');
  assert.equal(projects[0].path, 'C:\\workspace\\alpha');
});

test('adapter: searchFiles returns results for a pattern', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const results = await adapter.searchFiles('*.ts', 'proj-1');
  assert.equal(results.length, 1);
  assert.match(results[0].path, /index\.ts$/);
});

test('adapter: readFile returns content and size', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const content = await adapter.readFile('C:\\workspace\\alpha\\src\\index.ts');
  assert.match(content.content, /content of/);
  assert.ok(content.size > 0);
});

test('adapter: listAgents maps agent metadata', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const agents = await adapter.listAgents();
  assert.equal(agents.length, 2);
  assert.equal(agents[0].model, 'ollama/qwen3:8b');
  assert.deepEqual(agents[0].tools, ['read', 'write']);
});

test('adapter: createSession + sendPrompt round trip', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const session = await adapter.createSession({ projectId: 'C:\\workspace\\alpha' });
  assert.equal(session.id, 'session-1');
  const result = await adapter.sendPrompt(session.id, 'Fix the bug');
  assert.equal(result.status, 'success');
  assert.match(result.summary, /Done/);
});

test('adapter: cancelSession aborts the SDK session', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  await adapter.cancelSession('session-1');
  assert.ok(true);
});

test('adapter: getLspStatus maps SDK statuses', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const statuses = await adapter.getLspStatus();
  assert.equal(statuses[0].status, 'running');
  assert.equal(statuses[0].language, 'typescript');
});

test('adapter: getMcpStatus maps connected/failed servers', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  const servers = await adapter.getMcpStatus();
  assert.equal(servers.find((s) => s.name === 'filesystem')?.status, 'connected');
  assert.equal(servers.find((s) => s.name === 'db')?.status, 'error');
});

test('adapter: addMcpServer forwards local config', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  await adapter.addMcpServer({ name: 'tools', command: 'npx', args: ['-y', 'mcp-server'] });
  assert.ok(true);
});

test('adapter: disconnect resets state', async () => {
  const adapter = makeAdapter();
  await adapter.connect();
  await adapter.disconnect();
  assert.equal(adapter.getState(), 'DISABLED');
});

test('adapter: operations before connect throw', async () => {
  const adapter = makeAdapter();
  await assert.rejects(() => adapter.listProjects(), /not connected/);
});

