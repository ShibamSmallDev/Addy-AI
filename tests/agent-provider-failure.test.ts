import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// server_paths resolves DATA_DIR at module load, so env MUST be set before any
// project module is imported (dynamic imports keep the ordering deterministic).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-provider-fail-'));
process.env.ADDY_DATA_DIR = TMP;
process.env.GEMINI_API_KEY = 'stub-key';

// Keep the embedding model from downloading if a completion path is ever hit.
import { env as tfEnv } from '@xenova/transformers';
tfEnv.allowRemoteModels = false;
tfEnv.allowLocalModels = true;
tfEnv.localModelPath = path.join(TMP, 'empty-models');

const { classifyProviderFailure, ProviderFailureError } = await import('../providers/errors');
const { providerManager } = await import('../providers/ProviderManager');
const { AgentTaskManager } = await import('../agent/task-manager');
type AgentProgress = import('../agent/task-manager').AgentProgress;

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

/** Run a task whose provider stub behaves according to `behavior`. */
async function runTaskWithProvider(
  behavior: (prompt: string) => Promise<string>,
  execCalls: string[] = []
): Promise<{ status: string; error?: string; events: AgentProgress[] }> {
  const realGen = providerManager.generateResilientCompletion.bind(providerManager);
  (providerManager as any).generateResilientCompletion = behavior;
  try {
    const events: AgentProgress[] = [];
    const mgr = new AgentTaskManager(
      async (tool) => {
        execCalls.push(tool);
        return { success: true, data: 'ok' };
      },
      (p) => events.push(p)
    );
    const rec = mgr.start('audit task: plan must not be faked');
    await waitFor(() => events.some((e) => e.event === 'completed' || e.event === 'failed'));
    const final = mgr.get(rec.taskId)!;
    return { status: final.status, error: final.error, events };
  } finally {
    (providerManager as any).generateResilientCompletion = realGen;
  }
}

// ---------------------------------------------------------------------------
// Unit: typed classification
// ---------------------------------------------------------------------------

test('classify: rate limit, auth, capacity, timeout, unavailable map to stable kinds', () => {
  assert.equal(classifyProviderFailure(new Error('AI provider unavailable: 429 Too Many Requests')), 'rate_limit');
  assert.equal(classifyProviderFailure(new Error('quota exceeded for quota metric')), 'rate_limit');
  assert.equal(classifyProviderFailure(new Error('API key not valid. Please pass a valid API key.')), 'auth');
  assert.equal(classifyProviderFailure(new Error('The model is overloaded right now, 503')), 'capacity');
  assert.equal(classifyProviderFailure(new Error('Request timed out after 60000ms')), 'timeout');
  assert.equal(classifyProviderFailure(new Error('fetch failed')), 'unavailable');
  assert.equal(classifyProviderFailure(undefined), 'unavailable');
});

test('ProviderFailureError.from: wraps unknown errors with phase, preserves typed instances', () => {
  const wrapped = ProviderFailureError.from(new Error('API key not valid'), 'planning');
  assert.ok(wrapped instanceof ProviderFailureError);
  assert.equal(wrapped.kind, 'auth');
  assert.equal(wrapped.phase, 'planning');
  assert.match(wrapped.message, /Provider failure during planning: authentication failed/);

  // An already-typed error is returned unchanged (no double wrapping).
  assert.equal(ProviderFailureError.from(wrapped, 'summary'), wrapped);
});

// ---------------------------------------------------------------------------
// Regression D1: provider failure during planning must fail the task typed,
// with ZERO tools executed (no silent "" → fake searchFiles fallback plan).
// ---------------------------------------------------------------------------

test('D1: planning provider failure fails the task with a typed reason and executes no tool', async () => {
  const execCalls: string[] = [];
  const { status, error, events } = await runTaskWithProvider(async () => {
    throw new Error('AI provider unavailable: 429 Too Many Requests');
  }, execCalls);

  assert.equal(status, 'failed');
  assert.match(String(error), /Provider failure during planning/);
  assert.match(String(error), /rate limit/);
  assert.equal(execCalls.length, 0, `no tool may run on a planning failure, ran: ${execCalls.join(',')}`);
  assert.ok(!events.some((e) => e.event === 'completed'), 'a provider outage must not be reported as success');
  const failed = events.find((e) => e.event === 'failed');
  assert.ok(failed, 'a failed progress event must be emitted');
  assert.match(String(failed!.error), /Provider failure during planning/);
});

test('D1: auth failures surface as authentication failures, not empty plans', async () => {
  const execCalls: string[] = [];
  const { status, error } = await runTaskWithProvider(async () => {
    throw new Error('API key not valid. Please pass a valid API key.');
  }, execCalls);

  assert.equal(status, 'failed');
  assert.match(String(error), /authentication failed/);
  assert.equal(execCalls.length, 0);
});

test('D1: a non-string completion from the provider is a typed failure, not an empty plan', async () => {
  const execCalls: string[] = [];
  const { status, error } = await runTaskWithProvider(async () => undefined as unknown as string, execCalls);

  assert.equal(status, 'failed');
  assert.match(String(error), /Provider failure during planning/);
  assert.equal(execCalls.length, 0);
});

// ---------------------------------------------------------------------------
// Self-repair path: provider failure is observable and never faked as a fix.
// ---------------------------------------------------------------------------

test('self-repair provider failure is logged with its kind; step failure still ends the task as failed', async () => {
  const warns: string[] = [];
  const realWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warns.push(args.map(String).join(' '));
  };
  try {
    const realGen = providerManager.generateResilientCompletion.bind(providerManager);
    (providerManager as any).generateResilientCompletion = async (prompt: string) => {
      if (prompt.includes('Plan the optimal')) {
        return JSON.stringify({
          analysis: 'One step.',
          reflection: 'go',
          steps: [
            { thought: 't', description: 'Run tool', tool: 'readFile', args: { path: 'x.txt', max_chars: 1 }, spokenCue: 'go', expected: 'ok' },
          ],
        });
      }
      if (prompt.includes('Suggest a corrected tool call')) {
        throw new Error('AI provider unavailable: service overloaded 503');
      }
      if (prompt.includes('Summarize the outcome')) {
        return 'not reached because the step keeps failing';
      }
      return '';
    };
    try {
      const events: AgentProgress[] = [];
      const execCalls: string[] = [];
      const mgr = new AgentTaskManager(
        async (tool) => {
          execCalls.push(tool);
          return { success: false, error: 'tool always fails' };
        },
        (p) => events.push(p)
      );
      const rec = mgr.start('goal that will fail at execution');
      await waitFor(() => events.some((e) => e.event === 'completed' || e.event === 'failed'));
      const final = mgr.get(rec.taskId)!;

      assert.equal(final.status, 'failed');
      assert.match(String(final.error), /tool always fails/);
      assert.ok(
        warns.some((w) => w.includes('Self-repair suggestion unavailable') && w.includes('provider at capacity')),
        `expected an observable self-repair warning, got: ${JSON.stringify(warns)}`
      );
      assert.ok(!events.some((e) => e.event === 'completed'), 'failure must not be reported as success');
    } finally {
      (providerManager as any).generateResilientCompletion = realGen;
    }
  } finally {
    console.warn = realWarn;
  }
});
