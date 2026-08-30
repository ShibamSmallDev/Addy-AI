import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenCodeExecutionService } from '../execution/execution-service';
import { OpenCodeSdkAdapter } from '../execution/opencode-adapter';
import { OpenCodeProcessManager } from '../execution/opencode-process';
import { DefaultPermissionService } from '../execution/permission-service';
import { OpencodeClient } from '@opencode-ai/sdk';

function makeFailingAdapter(): OpenCodeSdkAdapter {
  const fake = {
    session: {
      create: async () => {
        throw new Error('SDK connection refused');
      },
      prompt: async () => {
        throw new Error('SDK connection refused');
      },
      abort: async () => ({ data: true }),
    },
    vcs: { get: async () => ({ data: { branch: 'main' } }) },
    lsp: { status: async () => ({ data: [] }) },
    mcp: { status: async () => ({ data: {} }) },
    project: { list: async () => ({ data: [] }) },
    find: { files: async () => ({ data: [] }) },
    file: { read: async () => ({ data: { content: '', type: 'text' } }) },
    app: { agents: async () => ({ data: [] }) },
  };
  return new OpenCodeSdkAdapter(() => fake as unknown as OpencodeClient);
}

test('failure: execute returns failed result when SDK throws', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFailingAdapter(), new DefaultPermissionService(['C:\\workspace']), { skipProcess: true });
  await service.start();
  const result = await service.execute({
    mode: 'EXECUTE',
    projectPath: 'C:\\workspace',
    operation: 'implement',
    params: {},
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'EXECUTION_ERROR');
  assert.match(result.errors[0].message, /SDK connection refused/);
  assert.equal(result.filesChanged.length, 0);
});

test('failure: execute denied by permission returns PERMISSION_DENIED error', async () => {
  const permissions = new DefaultPermissionService([]);
  permissions.setPolicy('FILE_WRITE', 'DENY');
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFailingAdapter(), permissions, { skipProcess: true });
  await service.start();
  const result = await service.execute({
    mode: 'EXECUTE',
    projectPath: 'C:\\workspace',
    operation: 'writeFile',
    params: {},
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.errors[0].code, 'PERMISSION_DENIED');
  assert.match(result.summary, /Permission denied/);
});

test('failure: execute still yields a stable result shape on any error', async () => {
  const service = new OpenCodeExecutionService(
    new OpenCodeProcessManager(), makeFailingAdapter(), new DefaultPermissionService(['C:\\workspace']), { skipProcess: true });
  await service.start();
  const result = await service.execute({
    mode: 'EXECUTE',
    projectPath: 'C:\\workspace',
    operation: 'whatever',
    params: { unexpected: true },
  });
  assert.ok(Array.isArray(result.errors));
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.tests));
  assert.ok(Array.isArray(result.commandsExecuted));
  assert.equal(typeof result.taskId, 'string');
});


