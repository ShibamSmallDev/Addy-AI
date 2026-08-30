import { desktopDispatcher, type DesktopAction } from './DesktopDispatcher';

export interface PlannedAction {
  action: DesktopAction;
  args: Record<string, unknown>;
  target: string;
  confidence: number;
}

export interface ExecutionResult {
  ok: boolean;
  plannedAction: PlannedAction;
  result?: unknown;
  error?: string;
  durationMs: number;
}

// ── Permission levels ──

const HARMLESS_ACTIONS = new Set([
  'mouseClick', 'mouseRightClick', 'mouseDoubleClick',
  'mouseMove', 'mouseMoveRelative', 'mouseScroll',
  'mouseGetPosition',
  'typeText', 'pressKey', 'pressKeyCombination',
  'takeScreenshot', 'analyzeScreenshot', 'readScreen',
  'locateElement', 'getScreenElements',
]);

const DESTRUCTIVE_ACTIONS = new Set([
  'deleteFile', 'closeApplication', 'closeWindow', 'requestPowerAction',
  'executePowerAction',
]);

export function isHarmless(action: string): boolean {
  return HARMLESS_ACTIONS.has(action);
}

export function isDestructive(action: string): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}

export function requiresConfirmation(action: string, args: Record<string, unknown>): boolean {
  if (isDestructive(action)) return true;
  if (isHarmless(action)) return false;
  // Unknown actions default to requiring confirmation
  return true;
}

// ── Action Planner ──

export class ActionPlanner {
  private history: ExecutionResult[] = [];
  private planInProgress = false;

  getHistory(): ExecutionResult[] {
    return [...this.history];
  }

  async planAndExecute(
    description: string,
    options?: { skipConfirmation?: boolean },
  ): Promise<ExecutionResult> {
    this.planInProgress = true;
    const t0 = Date.now();

    // Step 1: Parse the description into a planned action
    const plan = await this.parseDescription(description);

    // Step 2: If targeting a UI element, locate it on screen
    const finalPlan = await this.resolveTarget(plan);

    // Step 3: Check permissions
    if (!options?.skipConfirmation && requiresConfirmation(finalPlan.action, finalPlan.args)) {
      // This will be handled by the DesktopDispatcher permission gate
    }

    // Step 4: Execute
    const result = await desktopDispatcher.execute(finalPlan.action, finalPlan.args);

    const execResult: ExecutionResult = {
      ok: result.ok,
      plannedAction: finalPlan,
      result: result.result,
      error: result.error,
      durationMs: Date.now() - t0,
    };

    this.history.push(execResult);
    this.planInProgress = false;

    return execResult;
  }

  private async parseDescription(description: string): Promise<PlannedAction> {
    const lower = description.toLowerCase().trim();

    // Click actions
    if (/click/i.test(lower) || /tap/i.test(lower) || /press/i.test(lower)) {
      const target = this.extractTarget(description, ['on', 'the', 'button', 'link', 'icon']);
      return {
        action: lower.includes('double') ? 'mouseDoubleClick' : lower.includes('right') ? 'mouseRightClick' : 'mouseClick',
        args: target ? { label: target } : {},
        target: target || '(current position)',
        confidence: target ? 70 : 50,
      };
    }

    // Double-click
    if (/double.?click/i.test(lower) || /open/i.test(lower)) {
      const target = this.extractTarget(description, ['on', 'the', 'folder', 'file', 'icon']);
      return {
        action: 'mouseDoubleClick',
        args: target ? { label: target } : {},
        target: target || '(current position)',
        confidence: target ? 70 : 50,
      };
    }

    // Scroll
    if (/scroll/i.test(lower)) {
      const direction = /down/i.test(lower) ? -3 : /up/i.test(lower) ? 3 : -3;
      return {
        action: 'mouseScroll',
        args: { clicks: direction },
        target: `scroll ${direction > 0 ? 'up' : 'down'}`,
        confidence: 90,
      };
    }

    // Move mouse
    if (/move.*(mouse|cursor)/i.test(lower) || /go to/i.test(lower)) {
      const target = this.extractTarget(description, ['to', 'the']);
      return {
        action: 'mouseMove',
        args: target ? { label: target } : {},
        target: target || '(center)',
        confidence: target ? 60 : 40,
      };
    }

    // Type text
    if (/type/i.test(lower) || /enter/i.test(lower) || /write/i.test(lower)) {
      const text = this.extractQuotedText(description) || description.replace(/^(type|enter|write)\s+/i, '').trim();
      return {
        action: 'typeText',
        args: { text },
        target: `type "${text.slice(0, 30)}"`,
        confidence: 80,
      };
    }

    // Key combination
    if (/ctrl|cop(y|ied)|paste|alt|shift/i.test(lower)) {
      const combo = this.detectKeyCombo(lower);
      if (combo) {
        return {
          action: 'pressKeyCombination',
          args: combo,
          target: `${combo.modifiers?.join('+')}+${combo.key}`,
          confidence: 90,
        };
      }
    }

    // Screenshot / read screen
    if (/screenshot|capture.*screen/i.test(lower)) {
      return {
        action: 'takeScreenshot',
        args: { include_image: false },
        target: 'screenshot',
        confidence: 95,
      };
    }
    if (/read.*screen|what.*on.*screen|analyze.*screen/i.test(lower)) {
      return {
        action: 'readScreen',
        args: {},
        target: 'screen contents',
        confidence: 85,
      };
    }

    // Default: try to interpret as a click on something
    const target = this.extractTarget(description, []);
    if (target) {
      return {
        action: 'mouseClick',
        args: { label: target },
        target,
        confidence: 50,
      };
    }

    return {
      action: 'mouseClick',
      args: {},
      target: '(unknown)',
      confidence: 30,
    };
  }

  private extractTarget(text: string, stopWords: string[]): string {
    // Remove common prefixes
    let cleaned = text
      .replace(/^(please\s+)?(could you\s+)?(can you\s+)?/i, '')
      .replace(/^(click|tap|press|double.?click|right.?click|open|scroll|type|enter|write|move|go to)\s+/i, '')
      .trim();

    // Remove trailing filler
    for (const word of stopWords) {
      const regex = new RegExp(`\\b${word}$`, 'i');
      cleaned = cleaned.replace(regex, '').trim();
    }

    // Remove articles
    cleaned = cleaned.replace(/\b(the|a|an)\b/gi, '').trim();

    return cleaned || '';
  }

  private extractQuotedText(text: string): string {
    const match = text.match(/[""'']([^"''"]+)[""'']/);
    return match ? match[1] : '';
  }

  private detectKeyCombo(lower: string): { modifiers?: string[]; key: string } | null {
    const map: Record<string, { modifiers?: string[]; key: string }> = {
      'copy': { modifiers: ['ctrl'], key: 'c' },
      'paste': { modifiers: ['ctrl'], key: 'v' },
      'cut': { modifiers: ['ctrl'], key: 'x' },
      'select all': { modifiers: ['ctrl'], key: 'a' },
      'save': { modifiers: ['ctrl'], key: 's' },
      'undo': { modifiers: ['ctrl'], key: 'z' },
      'redo': { modifiers: ['ctrl'], key: 'y' },
      'find': { modifiers: ['ctrl'], key: 'f' },
      'alt tab': { modifiers: ['alt'], key: 'tab' },
    };
    for (const [phrase, combo] of Object.entries(map)) {
      if (lower.includes(phrase)) return combo;
    }
    return null;
  }

  private async resolveTarget(plan: PlannedAction): Promise<PlannedAction> {
    if (!plan.args.label || plan.args.x) return plan; // Already has coordinates or no label

    const label = plan.args.label as string;
    const result = await desktopDispatcher.execute('locateElement', { label });

    if (result.ok && result.result && typeof result.result === 'object') {
      const data = result.result as Record<string, unknown>;
      if (data.found && typeof data.x === 'number' && typeof data.y === 'number') {
        return {
          ...plan,
          args: { ...plan.args, x: data.x, y: data.y, label: undefined },
          target: `${data.label || label} at (${data.x}, ${data.y})`,
          confidence: Math.min(plan.confidence + 20, 100),
        };
      }
    }

    return plan;
  }
}

export const actionPlanner = new ActionPlanner();
