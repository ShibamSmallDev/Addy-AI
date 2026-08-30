import path from 'path';
import { classifyAndCheck } from '../tools/terminal';
import {
  PermissionService,
  PermissionRequest,
  PermissionResult,
  PermissionCategory,
  PermissionDecision,
} from './types';

const DEFAULT_POLICY: Record<PermissionCategory, PermissionDecision> = {
  FILE_READ: 'ALLOW',
  FILE_WRITE: 'ASK',
  FILE_DELETE: 'ASK',
  TERMINAL_READ: 'ALLOW',
  TERMINAL_EXECUTE: 'ASK',
  GIT_READ: 'ALLOW',
  GIT_WRITE: 'ASK',
  GIT_PUSH: 'ASK',
  MCP_READ: 'ALLOW',
  MCP_WRITE: 'ASK',
  NETWORK: 'ASK',
  PACKAGE_INSTALL: 'ASK',
  SYSTEM_CHANGE: 'DENY',
};

export class DefaultPermissionService implements PermissionService {
  private trustedWorkspaces: string[] = [];
  private policies: Record<PermissionCategory, PermissionDecision> = { ...DEFAULT_POLICY };

  constructor(trustedWorkspaces: string[] = []) {
    this.trustedWorkspaces = trustedWorkspaces.map((w) => path.resolve(w));
  }

  getTrustedWorkspaces(): string[] {
    return [...this.trustedWorkspaces];
  }

  addTrustedWorkspace(workspacePath: string): void {
    const resolved = path.resolve(workspacePath);
    if (!this.trustedWorkspaces.includes(resolved)) {
      this.trustedWorkspaces.push(resolved);
    }
  }

  removeTrustedWorkspace(workspacePath: string): void {
    const resolved = path.resolve(workspacePath);
    this.trustedWorkspaces = this.trustedWorkspaces.filter((w) => w !== resolved);
  }

  setPolicy(category: PermissionCategory, decision: PermissionDecision): void {
    this.policies[category] = decision;
  }

  async checkPermission(request: PermissionRequest): Promise<PermissionResult> {
    const policy = this.policies[request.category];

    if (policy === 'DENY') {
      return { decision: 'DENY', reason: `Policy denies ${request.category}` };
    }

    if (this.isFileCategory(request.category)) {
      const boundaryCheck = this.checkWorkspaceBoundary(request.resource);
      if (!boundaryCheck.ok) {
        return { decision: 'DENY', reason: boundaryCheck.reason };
      }
      if (boundaryCheck.insideTrusted && request.category === 'FILE_READ') {
        return { decision: 'ALLOW', reason: 'Inside trusted workspace' };
      }
    }

    if (request.category === 'TERMINAL_EXECUTE') {
      const classified = classifyAndCheck(request.operation);
      if (classified.blocked) {
        return { decision: 'DENY', reason: 'Command is on the blocked list' };
      }
      if (classified.safe && !classified.requiresApproval) {
        return { decision: 'ALLOW', reason: 'Command classified as safe' };
      }
      return { decision: 'ASK', reason: 'Command requires approval' };
    }

    return { decision: policy };
  }

  private isFileCategory(category: PermissionCategory): boolean {
    return category === 'FILE_READ' || category === 'FILE_WRITE' || category === 'FILE_DELETE';
  }

  private checkWorkspaceBoundary(resource: string): { ok: boolean; insideTrusted: boolean; reason?: string } {
    if (this.trustedWorkspaces.length === 0) {
      return { ok: false, insideTrusted: false, reason: 'No trusted workspaces configured' };
    }

    let resolved: string;
    try {
      resolved = path.resolve(resource);
    } catch {
      return { ok: false, insideTrusted: false, reason: 'Invalid path' };
    }

    for (const ws of this.trustedWorkspaces) {
      const relative = path.relative(ws, resolved);
      if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        return { ok: true, insideTrusted: true };
      }
    }

    return { ok: false, insideTrusted: false, reason: `Path escapes trusted workspace: ${resource}` };
  }
}
