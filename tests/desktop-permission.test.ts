import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DefaultPermissionService } from '../execution/permission-service'
import { desktopPermissionFor } from '../tools/desktop-permission'

test('desktop-permission: file read inside trusted workspace is FILE_READ + allowed', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('readFile', { path: 'C:\\workspace\\src\\index.ts' })
  assert.equal(perm.category, 'FILE_READ')
  const r = await svc.checkPermission({ category: perm.category, operation: perm.operation, resource: perm.resource, details: {} })
  assert.equal(r.decision, 'ALLOW')
})

test('desktop-permission: file read outside trusted workspace is denied', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('readFile', { path: 'C:\\other\\secret.txt' })
  const r = await svc.checkPermission({ category: perm.category, operation: perm.operation, resource: perm.resource, details: {} })
  assert.equal(r.decision, 'DENY')
})

test('desktop-permission: deleteFile maps to FILE_DELETE', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('deleteFile', { path: 'C:\\workspace\\a.txt' })
  assert.equal(perm.category, 'FILE_DELETE')
})

test('desktop-permission: unknown tool returns null (fail closed)', () => {
  const perm = desktopPermissionFor('definitelyNotATool', {})
  assert.equal(perm, null)
})

test('desktop-permission: approval required before approval (FILE_WRITE)', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('createFile', { path: 'C:\\workspace\\new.txt' })
  const r = await svc.checkPermission({ category: perm.category, operation: perm.operation, resource: perm.resource, details: {} })
  assert.equal(r.decision, 'ASK')
})

test('desktop-permission: approved operation after grant', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('createFile', { path: 'C:\\workspace\\new.txt' })
  const req = { category: perm.category, operation: perm.operation, resource: perm.resource, details: {} }
  svc.grantApproval(req, 'session')
  const r = await svc.checkPermission(req)
  assert.equal(r.decision, 'ALLOW')
})

test('desktop-permission: approval scope enforcement', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const p1 = desktopPermissionFor('createFile', { path: 'C:\\workspace\\a.txt' })
  const p2 = desktopPermissionFor('createFile', { path: 'C:\\workspace\\b.txt' })
  svc.grantApproval({ category: p1.category, operation: p1.operation, resource: p1.resource, details: {} }, 'session')
  const r1 = await svc.checkPermission({ category: p1.category, operation: p1.operation, resource: p1.resource, details: {} })
  const r2 = await svc.checkPermission({ category: p2.category, operation: p2.operation, resource: p2.resource, details: {} })
  assert.equal(r1.decision, 'ALLOW')
  assert.equal(r2.decision, 'ASK', 'grant for a.txt must not cover b.txt')
})

test('desktop-permission: once-scope is consumed', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('createFile', { path: 'C:\\workspace\\x.txt' })
  const req = { category: perm.category, operation: perm.operation, resource: perm.resource, details: {} }
  svc.grantApproval(req, 'once')
  const r1 = await svc.checkPermission(req)
  const r2 = await svc.checkPermission(req)
  assert.equal(r1.decision, 'ALLOW')
  assert.equal(r2.decision, 'ASK', 'once grant must be consumed')
})

test('desktop-permission: revoke removes approval', async () => {
  const svc = new DefaultPermissionService(['C:\\workspace'])
  const perm = desktopPermissionFor('createFile', { path: 'C:\\workspace\\y.txt' })
  const req = { category: perm.category, operation: perm.operation, resource: perm.resource, details: {} }
  svc.grantApproval(req, 'session')
  svc.revokeApproval(req)
  const r = await svc.checkPermission(req)
  assert.equal(r.decision, 'ASK')
})