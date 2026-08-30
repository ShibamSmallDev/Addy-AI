import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { OpenCodeExecutionService } from '../execution/execution-service';
import { OpenCodeSdkAdapter } from '../execution/opencode-adapter';
import { OpenCodeProcessManager } from '../execution/opencode-process';
import { DefaultPermissionService } from '../execution/permission-service';
import { OpencodeClient } from '@opencode-ai/sdk';

function makeFakeAdapter(): OpenCodeSdkAdapter {
  const respond = (data: unknown) => ({ data, error: undefined });
  const fake = {
    session: {
      create: async () => respond({ id: 'oc-session-abc', directory: 'C:\\workspace', time: { created: 5000, updated: 5000 } }),
      prompt: async () => respond({
        role: 'assistant',
        parts: [{ type: 'text', text: 'Changed src/app.ts, ran tests: 5 passed' }],
      }),
      promptAsync: async () => respond({ id: 'msg-1' }),
      messages: async () => respond([
        { id: 'msg-1', role: 'assistant', parts: [
          { type: 'text', text: 'Changed src/app.ts, ran tests: 5 passed' },
          { type: 'step-finish', text: '' },
        ] },
      ]),
      abort: async () => respond(true),
    },
    vcs: { get: async () => respond({ branch: 'main' }) },
    lsp: { status: async () => respond([]) },
    mcp: { status: async () => respond({}) },
    project: { list: async () => respond([]) },
    find: { files: async () => respond([]) },
    file: { read: async () => respond({ content: '', type: 'text' }) },
    app: { agents: async () => respond([]) },
  };
  return new OpenCodeSdkAdapter(() => fake as unknown as OpencodeClient);
}

test('execution: start/status reports adapter state', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  const status = await service.status();
  assert.equal(status.state, 'READY');
  assert.ok(status.capabilities.gitOperations.includes('status'));
});

test('execution: inspect routes searchFiles to the adapter', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  const result = await service.inspect({
    mode: 'INSPECT',
    projectPath: 'C:\\workspace',
    operation: 'listProjects',
    params: {},
  });
  assert.ok(Array.isArray(result));
});

test('execution: execute creates session mapping and returns success', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  const result = await service.execute({
    mode: 'EXECUTE',
    projectPath: 'C:\\workspace',
    operation: 'implementFeature',
    params: { feature: 'login' },
  });
  assert.equal(result.status, 'success');
  assert.match(result.summary, /Changed src\/app\.ts/);
  assert.ok(result.taskId.startsWith('task_'));

  const mapping = service.getSessionMapping(result.taskId);
  assert.ok(mapping);
  assert.equal(mapping?.opencodeSessionId, 'oc-session-abc');
  assert.equal(mapping?.status, 'completed');
});

test('execution: session mappings are listed and persisted', async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-exec-'));
  const old = process.env.ADDY_DATA_DIR;
  process.env.ADDY_DATA_DIR = tempDir;
  try {
    const service = new OpenCodeExecutionService(
      new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
    );
    await service.start();
    await service.execute({
      mode: 'EXECUTE',
      projectPath: 'C:\\workspace',
      operation: 'refactor',
      params: {},
    });
    const mappings = service.listSessionMappings();
    assert.equal(mappings.length, 1);

    const file = path.join(tempDir, 'config', 'opencode-sessions.json');
    assert.ok(fs.existsSync(file), 'session file persisted');
    const persisted = JSON.parse(fs.readFileSync(file, 'utf-8'));
    assert.equal(persisted[0].opencodeSessionId, 'oc-session-abc');
  } finally {
    if (old) process.env.ADDY_DATA_DIR = old;
    else delete process.env.ADDY_DATA_DIR;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('execution: cancel aborts the underlying OpenCode session', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  const result = await service.execute({
    mode: 'EXECUTE',
    projectPath: 'C:\\workspace',
    operation: 'build',
    params: {},
  });
  await service.cancel(result.taskId);
  const mapping = service.getSessionMapping(result.taskId);
  assert.equal(mapping?.status, 'aborted');
});

test('execution: cancel for unknown task throws', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  await assert.rejects(() => service.cancel('does-not-exist'), /No session/);
});

test('execution: unknown inspect operation throws', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFakeAdapter(), new DefaultPermissionService(['C:\\\\workspace']), { skipProcess: true }
  );
  await service.start();
  await assert.rejects(() =>
    service.inspect({ mode: 'INSPECT', projectPath: 'C:\\workspace', operation: 'nope', params: {} }),
    /Unknown inspect operation/
  );
});


