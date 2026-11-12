import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// server_paths resolves DATA_DIR at module load, so env MUST be set before any
// project module is imported (dynamic imports keep the ordering deterministic).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-plan-valid-'));
process.env.ADDY_DATA_DIR = TMP;
process.env.GEMINI_API_KEY = 'stub-key';

// Keep the embedding model from downloading if a completion path is ever hit.
import { env as tfEnv } from '@xenova/transformers';
tfEnv.allowRemoteModels = false;
tfEnv.allowLocalModels = true;
tfEnv.localModelPath = path.join(TMP, 'empty-models');

const { parsePlanJson, validatePlan, PlanValidationError } = await import('../agent/plan-validator');
type PlanValidationError = import('../agent/plan-validator').PlanValidationError;
const { providerManager } = await import('../providers/ProviderManager');
const { AgentTaskManager } = await import('../agent/task-manager');
type AgentProgress = import('../agent/task-manager').AgentProgress;
const { initDatabase } = await import('../database');

// Completion path calls storeMemory — needs the DB (mirrors agent-loop-integration.test.ts).
await initDatabase(TMP);

// ---------------------------------------------------------------------------
// Unit: parsing and validation
// ---------------------------------------------------------------------------

function expectPlanError(fn: () => unknown, kind: string, detailPattern?: RegExp): PlanValidationError {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof PlanValidationError, `expected PlanValidationError, got ${e}`);
    assert.equal((e as PlanValidationError).kind, kind, `kind mismatch: ${(e as PlanValidationError).message}`);
    if (detailPattern) assert.match((e as PlanValidationError).details.join(' | '), detailPattern);
    return e as PlanValidationError;
  }
  throw new Error(`expected PlanValidationError(${kind}) but nothing was thrown`);
}

test('parse: empty response and non-JSON output are typed malformed_json errors', () => {
  expectPlanError(() => parsePlanJson(''), 'malformed_json', /empty response/);
  expectPlanError(() => parsePlanJson('   '), 'malformed_json', /empty response/);
  expectPlanError(() => parsePlanJson('Sorry, I cannot help with that.'), 'malformed_json', /no JSON object/);
  expectPlanError(() => parsePlanJson('{ "steps": [ }'), 'malformed_json', /not valid JSON/);
});

test('validate: non-object plans, missing/non-array/empty steps are typed structure errors', () => {
  expectPlanError(() => validatePlan('nope'), 'invalid_structure', /must be a JSON object/);
  expectPlanError(() => validatePlan({ analysis: 'x' }), 'invalid_structure', /no 'steps' array/);
  expectPlanError(() => validatePlan({ steps: 'not-an-array' }), 'invalid_structure', /must be an array/);
  expectPlanError(() => validatePlan({ steps: [] }), 'empty_plan', /zero steps/);
});

test('validate: unknown tool names are rejected', () => {
  expectPlanError(
    () => validatePlan({ steps: [{ description: 'x', tool: 'definitelyNotATool', args: {} }] }),
    'unknown_tool',
    /unknown tool 'definitelyNotATool'/
  );
});

test('validate: missing required args, wrong types and unknown args are rejected', () => {
  // readFile requires 'path'
  expectPlanError(
    () => validatePlan({ steps: [{ tool: 'readFile', args: {} }] }),
    'invalid_args',
    /missing required argument 'path'/
  );
  expectPlanError(
    () => validatePlan({ steps: [{ tool: 'readFile', args: { path: 123 } }] }),
    'invalid_args',
    /argument 'path' must be of type STRING/
  );
  expectPlanError(
    () => validatePlan({ steps: [{ tool: 'readFile', args: { path: 'a.txt', bogus: 1 } }] }),
    'invalid_args',
    /unknown argument 'bogus'/
  );
  expectPlanError(
    () => validatePlan({ steps: [{ tool: 'readFile', args: 'not-an-object' }] }),
    'invalid_args',
    /'args' must be a JSON object/
  );
});

test('validate: ALL problems are collected and a partially valid plan is never returned', () => {
  const err = expectPlanError(
    () =>
      validatePlan({
        steps: [
          { tool: 'readFile', args: { path: 'ok.txt' } }, // valid step
          { tool: 'readFile', args: {} }, // missing required arg
          { tool: 'nopeTool', args: {} }, // unknown tool
        ],
      }),
    'invalid_args' // first kind recorded
  );
  assert.ok(err.details.length >= 2, `expected all problems collected, got: ${err.details.join(' | ')}`);
  assert.ok(err.details.some((d) => d.includes("missing required argument 'path'")));
  assert.ok(err.details.some((d) => d.includes("unknown tool 'nopeTool'")));
});

test('validate: a fully valid plan passes with analysis/reflection preserved', () => {
  const plan = validatePlan({
    analysis: 'Read it.',
    reflection: 'one step',
    steps: [
      { thought: 't', description: 'Read the file', tool: 'readFile', args: { path: 'ok.txt', max_chars: 100 }, spokenCue: 'Reading.', expected: 'content' },
    ],
  });
  assert.equal(plan.analysis, 'Read it.');
  assert.equal(plan.reflection, 'one step');
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0]!.tool, 'readFile');
  assert.deepEqual(plan.steps[0]!.args, { path: 'ok.txt', max_chars: 100 });
});

test('validate: browser alias tools without a Gemini declaration get structural validation only', () => {
  // 'browserClick' is in DESKTOP_TOOLS but has no function declaration — it must
  // not be rejected for lacking a schema, and args must still be an object.
  const plan = validatePlan({ steps: [{ tool: 'browserClick', args: { selector: '#go' } }] });
  assert.equal(plan.steps[0]!.tool, 'browserClick');
  expectPlanError(() => validatePlan({ steps: [{ tool: 'browserClick', args: [1, 2] }] }), 'invalid_args', /must be a JSON object/);
});

// ---------------------------------------------------------------------------
// Loop-level regression: invalid plans => ZERO tool executions, bounded replan
// ---------------------------------------------------------------------------

const VALID_PLAN = JSON.stringify({
  analysis: 'One step.',
  reflection: 'go',
  steps: [
    { thought: 't', description: 'Read the file', tool: 'readFile', args: { path: 'ok.txt' }, spokenCue: 'Reading.', expected: 'content' },
  ],
});
const UNKNOWN_TOOL_PLAN = JSON.stringify({
  analysis: 'x',
  steps: [{ description: 'mystery', tool: 'definitelyNotATool', args: {} }],
});
const MISSING_ARG_PLAN = JSON.stringify({
  analysis: 'x',
  steps: [{ description: 'read', tool: 'readFile', args: {} }],
});
const EMPTY_STEPS_PLAN = JSON.stringify({ analysis: 'x', steps: [] });

interface RunResult {
  status: string;
  error?: string;
  events: AgentProgress[];
  execCalls: string[];
  planCalls: () => number;
}

/** planOutputs: consumed one per planning attempt (initial, then replan). */
async function runTask(planOutputs: Array<string | Error>): Promise<RunResult> {
  let planCall = 0;
  const realGen = providerManager.generateResilientCompletion.bind(providerManager);
  (providerManager as any).generateResilientCompletion = async (prompt: string) => {
    if (prompt.includes('Plan the optimal') || prompt.includes('REJECTED before execution')) {
      const out = planOutputs[Math.min(planCall, planOutputs.length - 1)];
      planCall++;
      if (out instanceof Error) throw out;
      return out;
    }
    if (prompt.includes('Summarize the outcome')) return 'Task done.';
    return '';
  };
  try {
    const events: AgentProgress[] = [];
    const execCalls: string[] = [];
    const mgr = new AgentTaskManager(
      async (tool) => {
        execCalls.push(tool);
        return { success: true, data: 'ok' };
      },
      (p) => events.push(p)
    );
    const rec = mgr.start('read the project file');
    const start = Date.now();
    while (!events.some((e) => e.event === 'completed' || e.event === 'failed')) {
      if (Date.now() - start > 5000) throw new Error('waitFor timed out');
      await new Promise((r) => setTimeout(r, 5));
    }
    const final = mgr.get(rec.taskId)!;
    return { status: final.status, error: final.error, events, execCalls, planCalls: () => planCall };
  } finally {
    (providerManager as any).generateResilientCompletion = realGen;
  }
}

test('regression: a plan with an unknown tool fails the task with ZERO tool executions (bounded replan, no searchFiles fallback)', async () => {
  const r = await runTask([UNKNOWN_TOOL_PLAN]);
  assert.equal(r.status, 'failed');
  assert.match(String(r.error), /Plan validation failed \(unknown_tool\)/);
  assert.equal(r.execCalls.length, 0, `no tool may run, ran: ${r.execCalls.join(',')}`);
  assert.ok(!r.execCalls.includes('searchFiles'), 'the generic searchFiles fallback must not exist');
  assert.equal(r.planCalls(), 2, 'replan must be bounded to exactly 1 retry');
  assert.ok(!r.events.some((e) => e.event === 'completed'), 'invalid plan must not be reported as success');
  const rejected = r.events.filter((e) => e.event === 'plan-rejected');
  assert.equal(rejected.length, 2, 'each rejected attempt must be observable in the progress stream');
});

test('regression: malformed model output fails the task with ZERO tool executions', async () => {
  const r = await runTask(['Sorry, I cannot produce a plan right now.']);
  assert.equal(r.status, 'failed');
  assert.match(String(r.error), /Plan validation failed \(malformed_json\)/);
  assert.equal(r.execCalls.length, 0);
  assert.equal(r.planCalls(), 2, 'replan must be bounded');
});

test('regression: an empty plan fails the task with ZERO tool executions', async () => {
  const r = await runTask([EMPTY_STEPS_PLAN]);
  assert.equal(r.status, 'failed');
  assert.match(String(r.error), /Plan validation failed \(empty_plan\)/);
  assert.equal(r.execCalls.length, 0);
});

test('regression: missing required arguments fail before execution, then a corrected replan runs', async () => {
  const r = await runTask([MISSING_ARG_PLAN, VALID_PLAN]);
  assert.equal(r.status, 'completed', `expected completed after corrected replan, got ${r.status}: ${r.error}`);
  assert.deepEqual(r.execCalls, ['readFile'], 'only the validated plan may execute');
  assert.equal(r.planCalls(), 2, 'one initial attempt + one bounded replan');
});

test('a valid first plan executes immediately without a replan', async () => {
  const r = await runTask([VALID_PLAN]);
  assert.equal(r.status, 'completed');
  assert.deepEqual(r.execCalls, ['readFile']);
  assert.equal(r.planCalls(), 1, 'no replan may happen for a valid plan');
});

test('provider outage during a replan still follows the typed P1-1 failure path', async () => {
  const r = await runTask([
    MISSING_ARG_PLAN,
    new Error('AI provider unavailable: 429 Too Many Requests'),
  ]);
  assert.equal(r.status, 'failed');
  assert.match(String(r.error), /Provider failure during planning/);
  assert.match(String(r.error), /rate limit/);
  assert.equal(r.execCalls.length, 0);
});
