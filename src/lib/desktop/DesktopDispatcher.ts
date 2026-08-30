export type DesktopAction =
  | 'mouseMove'
  | 'mouseMoveRelative'
  | 'mouseGetPosition'
  | 'mouseClick'
  | 'mouseRightClick'
  | 'mouseDoubleClick'
  | 'mouseScroll'
  | 'mouseDrag'
  | 'typeText'
  | 'pressKey'
  | 'pressKeyCombination'
  | 'takeScreenshot'
  | 'analyzeScreenshot'
  | 'readScreen'
  // Screen vision (OCR-based element locator)
  | 'locateElement'
  | 'getScreenElements';

export interface ActionRequest {
  action: DesktopAction;
  args: Record<string, unknown>;
  timestamp: number;
}

interface PermissionEntry {
  action: DesktopAction;
  allowed: boolean;
  expires: number; // 0 = session
}

const PERMISSION_TTL = 5 * 60 * 1000; // 5 min

// ── Permission classification ──

const HARMLESS_ACTIONS = new Set<DesktopAction>([
  'mouseClick', 'mouseRightClick', 'mouseDoubleClick',
  'mouseMove', 'mouseMoveRelative', 'mouseScroll',
  'mouseGetPosition',
  'typeText', 'pressKey', 'pressKeyCombination',
  'takeScreenshot', 'analyzeScreenshot', 'readScreen',
  'locateElement', 'getScreenElements',
]);

const DESTRUCTIVE_ACTIONS = new Set<DesktopAction>([
  'mouseDrag',
]);

export function getActionSeverity(action: DesktopAction): 'harmless' | 'normal' | 'destructive' {
  if (DESTRUCTIVE_ACTIONS.has(action)) return 'destructive';
  if (HARMLESS_ACTIONS.has(action)) return 'harmless';
  return 'normal';
}

export class DesktopDispatcher {
  private permissions: Map<string, PermissionEntry> = new Map();
  private history: ActionRequest[] = [];
  private onPermissionRequest?: (
    action: DesktopAction,
    args: Record<string, unknown>,
    resolve: (allow: boolean) => void,
  ) => void;

  setPermissionHandler(
    handler: (
      action: DesktopAction,
      args: Record<string, unknown>,
      resolve: (allow: boolean) => void,
    ) => void,
  ) {
    this.onPermissionRequest = handler;
  }

  private checkPermission(action: DesktopAction): boolean {
    const key = `${action}`;
    const entry = this.permissions.get(key);
    if (!entry) return false;
    if (entry.expires > 0 && Date.now() > entry.expires) {
      this.permissions.delete(key);
      return false;
    }
    return entry.allowed;
  }

  grantPermission(action: DesktopAction, durationMs = PERMISSION_TTL) {
    this.permissions.set(`${action}`, {
      action,
      allowed: true,
      expires: durationMs > 0 ? Date.now() + durationMs : 0,
    });
  }

  revokePermission(action: DesktopAction) {
    this.permissions.delete(`${action}`);
  }

  async execute(action: DesktopAction, args: Record<string, unknown> = {}): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    const request: ActionRequest = { action, args, timestamp: Date.now() };
    this.history.push(request);

    if (!this.checkPermission(action)) {
      const allowed = await new Promise<boolean>((resolve) => {
        this.onPermissionRequest?.(action, args, resolve);
      });
      if (!allowed) {
        this.history.push({ ...request, timestamp: Date.now() });
        return { ok: false, error: `Permission denied for ${action}` };
      }
      this.grantPermission(action);
    }

    return this.dispatch(action, args);
  }

  private async dispatch(
    action: DesktopAction,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; result?: unknown; error?: string }> {
    if ((window as any).Addy?.isDesktop && (window as any).Addy?.executeDesktopTool) {
      try {
        const result = await (window as any).Addy.executeDesktopTool(action, args);
        return { ok: true, result };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    }

    try {
      const res = await fetch('/api/desktop/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tool: action, args }),
      });
      const data = await res.json();
      if (!res.ok) return { ok: false, error: data.error || `HTTP ${res.status}` };
      return { ok: data.ok !== false, result: data.result, error: data.error };
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
  }

  getHistory(): ActionRequest[] {
    return [...this.history];
  }
}

export const desktopDispatcher = new DesktopDispatcher();
