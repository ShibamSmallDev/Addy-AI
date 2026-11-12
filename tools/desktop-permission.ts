/**
 * P1-4: Permission mapping for desktop-agent tools.
 *
 * Central place that turns a desktop tool name + args into a
 * `PermissionRequest` (category + resource) so the existing
 * `DefaultPermissionService` can authorize it at the execution boundary.
 *
 * Every desktop tool goes through `callDesktopAgent`, which calls
 * `checkDesktopPermission` BEFORE touching the Python sidecar. Unknown tools
 * fail closed (no category => denied).
 */
import path from 'path';
import type { PermissionCategory } from '../execution/types';

export interface DesktopPermission {
  category: PermissionCategory;
  resource: string;
  operation: string;
}

const FILE_READ_TOOLS = new Set([
  'readFile', 'readPdf', 'listFiles', 'searchFiles', 'openFolder',
]);
const FILE_WRITE_TOOLS = new Set([
  'createFile', 'createPythonFile', 'writeCodeFile', 'createProjectFolder',
  'renameFile', 'moveFile',
]);
const FILE_DELETE_TOOLS = new Set(['deleteFile']);

const TERMINAL_TOOLS = new Set(['runPythonScript']);

import { DESKTOP_TOOLS } from '../tools/desktop-tools';

export function desktopPermissionFor(tool: string, args: Record<string, unknown> = {}): DesktopPermission | null {
  if (!DESKTOP_TOOLS.has(tool)) return null;
  if (FILE_READ_TOOLS.has(tool)) {
    const p = (args.path ?? args.folder ?? args.under ?? args.name) as string | undefined;
    return { category: 'FILE_READ', resource: p ? String(p) : process.cwd(), operation: tool };
  }
  if (FILE_WRITE_TOOLS.has(tool)) {
    const p = (args.path ?? args.destination ?? args.name) as string | undefined;
    const resource = p ? String(p) : (args.name ? path.join(String(args.path ?? process.cwd()), String(args.name)) : process.cwd());
    return { category: 'FILE_WRITE', resource, operation: tool };
  }
  if (FILE_DELETE_TOOLS.has(tool)) {
    const p = (args.path ?? args.destination) as string | undefined;
    return { category: 'FILE_DELETE', resource: p ? String(p) : process.cwd(), operation: tool };
  }
  if (TERMINAL_TOOLS.has(tool)) {
    const p = (args.path) as string | undefined;
    return { category: 'TERMINAL_EXECUTE', resource: 'terminal', operation: p ? `python ${p}` : 'python' };
  }
  // Power / auto-start / system settings keep their own confirmation gate in the
  // Python sidecar; permission category is DESKTOP_CONTROL (ALLOW by default).
  return { category: 'DESKTOP_CONTROL', resource: tool, operation: tool };
}

