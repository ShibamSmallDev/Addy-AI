import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DefaultPermissionService } from '../execution/permission-service';
import { PermissionRequest } from '../execution/types';

test('permission: FILE_READ inside trusted workspace is allowed', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  const result = await svc.checkPermission({
    category: 'FILE_READ',
    operation: 'read',
    resource: 'C:\\workspace\\src\\index.ts',
    details: {},
  });
  assert.equal(result.decision, 'ALLOW');
});

test('permission: FILE_READ outside trusted workspace is denied', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  const result = await svc.checkPermission({
    category: 'FILE_READ',
    operation: 'read',
    resource: 'C:\\other\\secret.txt',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

test('permission: path traversal via .. is denied', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  const result = await svc.checkPermission({
    category: 'FILE_READ',
    operation: 'read',
    resource: 'C:\\workspace\\..\\..\\secret.txt',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

test('permission: no trusted workspaces denies file operations', async () => {
  const svc = new DefaultPermissionService([]);
  const result = await svc.checkPermission({
    category: 'FILE_WRITE',
    operation: 'write',
    resource: 'C:\\anything\\file.ts',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

test('permission: SYSTEM_CHANGE is always denied', async () => {
  const svc = new DefaultPermissionService([]);
  const result = await svc.checkPermission({
    category: 'SYSTEM_CHANGE',
    operation: 'shutdown',
    resource: 'system',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

test('permission: GIT_READ defaults to allow', async () => {
  const svc = new DefaultPermissionService([]);
  const result = await svc.checkPermission({
    category: 'GIT_READ',
    operation: 'status',
    resource: 'C:\\workspace',
    details: {},
  });
  assert.equal(result.decision, 'ALLOW');
});

test('permission: blocked terminal commands are denied', async () => {
  const svc = new DefaultPermissionService([]);
  const result = await svc.checkPermission({
    category: 'TERMINAL_EXECUTE',
    operation: 'rm -rf C:\\',
    resource: 'terminal',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

test('permission: safe terminal commands are allowed', async () => {
  const svc = new DefaultPermissionService([]);
  const result = await svc.checkPermission({
    category: 'TERMINAL_EXECUTE',
    operation: 'git status',
    resource: 'terminal',
    details: {},
  });
  assert.equal(result.decision, 'ALLOW');
});

test('permission: FILE_WRITE inside trusted workspace is ASK by default', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  const result = await svc.checkPermission({
    category: 'FILE_WRITE',
    operation: 'write',
    resource: 'C:\\workspace\\src\\index.ts',
    details: {},
  });
  assert.equal(result.decision, 'ASK');
});

test('permission: addTrustedWorkspace extends the boundary', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  svc.addTrustedWorkspace('C:\\data');
  const result = await svc.checkPermission({
    category: 'FILE_READ',
    operation: 'read',
    resource: 'C:\\data\\notes.txt',
    details: {},
  });
  assert.equal(result.decision, 'ALLOW');
});

test('permission: removeTrustedWorkspace shrinks the boundary', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace']);
  svc.removeTrustedWorkspace('C:\\workspace');
  const result = await svc.checkPermission({
    category: 'FILE_READ',
    operation: 'read',
    resource: 'C:\\workspace\\src\\index.ts',
    details: {},
  });
  assert.equal(result.decision, 'DENY');
});

