import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-agent-int-'));
process.env.ADDY_DATA_DIR = TMP;
process.env.GEMINI_API_KEY = 'stub-key';

// Keep the embedding model from downloading (storeMemory side effect at completion).
import { env as tfEnv } from '@xenova/transformers';
tfEnv.allowRemoteModels = false;
tfEnv.allowLocalModels = true;
tfEnv.localModelPath = path.join(TMP, 'empty-models');

import { initDatabase } from '../database';
import { providerManager } from '../providers/ProviderManager';
import { AgentTaskManager, type AgentProgress } from '../agent/task-manager';

async function waitFor(fn: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('real AgentLoop: self-heals a failing step via the manager and completes with a summary', async () => {
  await initDatabase(TMP);

  const llmCalls: string[] = [];
  // Stub the LLM: plan -> self-heal fix -> summary, keyed off the prompt text.
  const realGen = providerManager.generateResilientCompletion.bind(providerManager);
  (providerManager as any).generateResilientCompletion = async (prompt: string) => {
    llmCalls.push(prompt.slice(0, 40));
    if (prompt.includes('Plan the optimal')) {
      return JSON.stringify({
        analysis: 'One step.',
        reflection: 'go',
        steps: [
          { thought: 'try v1', description: 'Run tool', tool: 'demoTool', args: { v: 1 }, spokenCue: 'Running it.', expected: 'ok' },
        ],
      });
    }
    if (prompt.includes('Suggest a corrected tool call')) {
      return JSON.stringify({ tool: 'demoTool', args: { v: 2 }, spokenCue: 'Retrying with the fix.' });
    }
    if (prompt.includes('Summarize the outcome')) {
      return 'Recovered and finished the job.';
    }
    return '';
  };

  try {
    const execCalls: Array<Record<string, unknown>> = [];
    const events: AgentProgress[] = [];
    const mgr = new AgentTaskManager(
      async (_tool, args) => {
        execCalls.push(args);
        // v1 fails, v2 (the self-healed args) succeeds
        if (args.v === 1) return { success: false, error: 'transient failure' };
        return { success: true, data: 'ok' };
      },
      (p) => events.push(p)
    );

    const rec = mgr.start('do a resilient thing');
    await waitFor(() => events.some((e) => e.event === 'completed' || e.event === 'failed'));

    const final = mgr.get(rec.taskId)!;
    // Self-repair happened: the failing v1 attempt was retried with corrected args and completed.
    assert.equal(final.status, 'completed', `expected completed, got ${final.status}: ${final.error}`);
    assert.equal(final.summary, 'Recovered and finished the job.');
    assert.deepEqual(execCalls, [{ v: 1 }, { v: 2 }]); // fail then repaired
    // A retry was surfaced to the progress stream.
    assert.ok(events.some((e) => e.event === 'step-retry'), 'expected a step-retry progress event');
    // The LLM was actually driven (plan + self-heal + summary).
    assert.ok(llmCalls.length >= 3, `expected >=3 LLM calls, got ${llmCalls.length}`);
    // Final summary announced as a spoken cue.
    const done = events.find((e) => e.event === 'completed')!;
    assert.equal(done.spokenCue, 'Recovered and finished the job.');
  } finally {
    (providerManager as any).generateResilientCompletion = realGen;
  }
});
