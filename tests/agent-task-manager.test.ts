import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { AgentTaskManager, type AgentProgress, type LoopEvent, type ManagedLoop, type ToolExec } from '../agent/task-manager';
import type { AgentState } from '../agent/loop';

// A temp data dir so nothing touches the real Addy database/secrets.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-agent-test-'));
process.env.ADDY_DATA_DIR = TMP;
process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || 'test-key-for-stubbed-llm';

// Prevent the embedding model from being downloaded during storeMemory side effects.
import { env as tfEnv } from '@xenova/transformers';
tfEnv.allowRemoteModels = false;
tfEnv.allowLocalModels = true;
tfEnv.localModelPath = path.join(TMP, 'empty-models');

/** Scripted fake loop that replays a fixed list of events, then resolves. */
function fakeLoopFactory(script: LoopEvent[], finalStatus: AgentState['status'], state?: Partial<AgentState>): {
  factory: (goal: string, onEvent: (e: LoopEvent) => void, exec: ToolExec) => ManagedLoop;
  calls: { execArgs: Array<[string, Record<string, unknown>]>; aborted: boolean };
} {
  const calls = { execArgs: [] as Array<[string, Record<string, unknown>]>, aborted: false };
  const factory = (_goal: string, onEvent: (e: LoopEvent) => void, exec: ToolExec): ManagedLoop => {
    let aborted = false;
    return {
      async run() {
        // Give the manager a chance to flip queued -> running in its own async task.
        for (const ev of script) {
          if (aborted) break;
          onEvent(ev);
          await new Promise((r) => setTimeout(r, 0));
        }
        const s: AgentState = {
          goal: 'g', plan: null, status: finalStatus, currentStepIndex: 0, stepResults: [],
          ...state,
        } as AgentState;
        return s;
      },
      abort() { aborted = true; calls.aborted = true; },
      isAborted() { return aborted; },
      getState() { return { goal: 'g', plan: null, status: finalStatus, currentStepIndex: 0, stepResults: [] } as AgentState; },
    };
  };
  return { factory, calls };
}

async function waitFor(fn: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!fn()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
}

test('lifecycle: queued -> running -> completed, streams spokenCue and announces summary', async () => {
  const events: AgentProgress[] = [];
  const { factory } = fakeLoopFactory(
    [
      { type: 'plan', spokenCue: 'Planning it out.', data: { steps: [{}, {}] } },
      { type: 'step-start', spokenCue: 'Opening the browser.' },
      { type: 'step-done', spokenCue: 'Step 1 done.' },
      { type: 'step-start', spokenCue: 'Clicking submit.' },
      { type: 'step-done', spokenCue: 'Step 2 done.' },
      { type: 'verifying', spokenCue: 'Verifying.' },
      { type: 'completed', spokenCue: 'All done, babe!', data: { summary: 'All done, babe!' } },
    ],
    'completed'
  );
  const mgr = new AgentTaskManager(async () => ({ success: true }), (p) => events.push(p), factory);

  const rec = mgr.start('do the thing');
  // background runner has already flipped the record to 'running' by the time start() returns
  assert.equal(rec.status, 'running');
  const taskId = rec.taskId;

  await waitFor(() => events.some((e) => e.event === 'completed'));

  const final = mgr.get(taskId)!;
  assert.equal(final.status, 'completed');
  assert.equal(final.stepsTotal, 2);
  assert.equal(final.stepsDone, 2);
  assert.equal(final.summary, 'All done, babe!');
  assert.ok(final.finishedAt && final.finishedAt >= final.startedAt!);

  // spokenCue for every scripted event was streamed through onProgress
  const cues = events.filter((e) => e.spokenCue).map((e) => e.spokenCue);
  assert.ok(cues.includes('Opening the browser.'));
  assert.ok(cues.includes('Step 1 done.'));
  // final summary announced
  const completedEvt = events.find((e) => e.event === 'completed')!;
  assert.equal(completedEvt.spokenCue, 'All done, babe!');
  assert.equal(completedEvt.summary, 'All done, babe!');
});

test('lifecycle: a failed loop ends in failed status (not aborted) and carries error', async () => {
  const events: AgentProgress[] = [];
  const { factory } = fakeLoopFactory(
    [
      { type: 'plan', spokenCue: 'Planning.', data: { steps: [{}] } },
      { type: 'step-start', spokenCue: 'Trying.' },
      { type: 'step-failed', spokenCue: 'That did not work.', data: { error: 'boom' } },
      { type: 'failed', spokenCue: 'Halting.', data: { error: 'boom' } },
    ],
    'failed'
  );
  const mgr = new AgentTaskManager(async () => ({ success: false, error: 'boom' }), (p) => events.push(p), factory);

  const rec = mgr.start('fail please');
  await waitFor(() => events.some((e) => e.event === 'failed'));

  const final = mgr.get(rec.taskId)!;
  assert.equal(final.status, 'failed');
  assert.equal(final.error, 'boom');
});

test('abort: requested mid-run ends in aborted status and gates the desktop executor', async () => {
  const events: AgentProgress[] = [];
  // A loop that emits one step-start, then waits until aborted before failing.
  const factory = (_g: string, onEvent: (e: LoopEvent) => void, exec: ToolExec): ManagedLoop => {
    let aborted = false;
    return {
      async run() {
        onEvent({ type: 'plan', spokenCue: 'Planning.', data: { steps: [{}] } });
        onEvent({ type: 'step-start', spokenCue: 'Starting step 1.' });
        // exercise the wrapped executor while not aborted
        await exec('someTool', { a: 1 });
        // spin until aborted (or timeout)
        const deadline = Date.now() + 1000;
        while (!aborted && Date.now() < deadline) await new Promise((r) => setTimeout(r, 5));
        onEvent({ type: 'failed', spokenCue: 'Stopped.', data: { error: 'Aborted by user' } });
        return { goal: 'g', plan: null, status: 'failed', currentStepIndex: 0, stepResults: [] } as AgentState;
      },
      abort() { aborted = true; },
      isAborted() { return aborted; },
      getState() { return { goal: 'g', plan: null, status: 'failed', currentStepIndex: 0, stepResults: [] } as AgentState; },
    };
  };

  const execCalls: string[] = [];
  const mgr = new AgentTaskManager(async (tool) => { execCalls.push(tool); return { success: true }; }, (p) => events.push(p), factory);

  const rec = mgr.start('long running task');
  await waitFor(() => events.some((e) => e.event === 'step-start'));

  // request abort mid-run
  assert.equal(mgr.abort(rec.taskId), true);

  await waitFor(() => events.some((e) => e.event === 'failed'));
  const final = mgr.get(rec.taskId)!;
  assert.equal(final.status, 'aborted'); // aborted, NOT failed
  assert.equal(final.abortRequested, true);
  assert.ok(execCalls.includes('someTool')); // the pre-abort call went through
});

test('abort: wrapped executor refuses new desktop actions once abort is requested', async () => {
  let loop!: ManagedLoop;
  let abortedFlag = false;
  const factory = (_g: string, _onEvent: (e: LoopEvent) => void, exec: ToolExec): ManagedLoop => {
    loop = {
      async run() { return { goal: 'g', plan: null, status: 'failed', currentStepIndex: 0, stepResults: [] } as AgentState; },
      abort() { abortedFlag = true; },
      isAborted() { return abortedFlag; },
      getState() { return { goal: 'g', plan: null, status: 'failed', currentStepIndex: 0, stepResults: [] } as AgentState; },
    };
    (loop as any).__exec = exec; // expose the wrapped executor to the test
    return loop;
  };
  let realToolRan = 0;
  const mgr = new AgentTaskManager(async () => { realToolRan++; return { success: true }; }, () => {}, factory);

  const rec = mgr.start('g');
  await waitFor(() => !!loop);
  const wrappedExec: ToolExec = (loop as any).__exec;

  // before abort: goes through to the real tool
  const before = await wrappedExec('toolA', {});
  assert.equal(before.success, true);
  assert.equal(realToolRan, 1);

  mgr.abort(rec.taskId);
  abortedFlag = true;

  // after abort: refused, real tool NOT invoked
  const after = await wrappedExec('toolB', {});
  assert.equal(after.success, false);
  assert.match(String(after.error), /abort/i);
  assert.equal(realToolRan, 1); // unchanged
});

test('abort: aborting an already-finished task is a no-op', async () => {
  const { factory } = fakeLoopFactory([{ type: 'completed', spokenCue: 'done', data: { summary: 'done' } }], 'completed');
  const mgr = new AgentTaskManager(async () => ({ success: true }), () => {}, factory);
  const rec = mgr.start('quick');
  await waitFor(() => mgr.get(rec.taskId)!.status === 'completed');
  assert.equal(mgr.abort(rec.taskId), false); // already terminal
});

test('self-repair: step-retry is forwarded and the task stays running until it completes', async () => {
  const events: AgentProgress[] = [];
  const { factory } = fakeLoopFactory(
    [
      { type: 'plan', spokenCue: 'Planning.', data: { steps: [{}] } },
      { type: 'step-start', spokenCue: 'First attempt.' },
      { type: 'step-retry', spokenCue: 'Retrying after a fix.', data: { attempt: 2 } },
      { type: 'step-done', spokenCue: 'Recovered and finished.' },
      { type: 'completed', spokenCue: 'All good.', data: { summary: 'All good.' } },
    ],
    'completed'
  );
  const mgr = new AgentTaskManager(async () => ({ success: true }), (p) => events.push(p), factory);
  const rec = mgr.start('recovering task');
  await waitFor(() => events.some((e) => e.event === 'completed'));

  // step-retry event was streamed, and the task did NOT fail on retry
  const retryEvt = events.find((e) => e.event === 'step-retry')!;
  assert.ok(retryEvt);
  assert.equal(retryEvt.spokenCue, 'Retrying after a fix.');
  assert.equal(mgr.get(rec.taskId)!.status, 'completed');
});
