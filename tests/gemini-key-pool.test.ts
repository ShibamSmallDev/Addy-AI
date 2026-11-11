import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// server_paths resolves DATA_DIR at module load, so it MUST be imported AFTER
// ADDY_DATA_DIR is pointed at a temp dir. A static `import` is hoisted above
// these statements and would bind to the real project data dir — which previously
// let this suite overwrite the real secrets.json.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'addy-keypool-'));
process.env.ADDY_DATA_DIR = TMP;

// Belt-and-braces: refuse to run if the data dir isn't a temp dir, so this suite
// can never write to the real secrets.json again.
if (!path.resolve(TMP).startsWith(path.resolve(os.tmpdir()))) {
  throw new Error('test data dir is not a temp dir — refusing to touch real secrets');
}

const {
  addGeminiApiKey,
  getGeminiApiKey,
  getGeminiApiKeys,
  getGeminiKeyStatus,
  isKeyError,
  reportGeminiKeyFailure,
  reportGeminiKeySuccess,
  clearGeminiApiKey,
  hasGeminiApiKey,
} = await import('../server_paths');

// server_paths calls dotenv.config() at import, which pulls the project's real
// .env in. Clear those vars AFTER import so the pool under test is deterministic
// (keyPool() reads them lazily on every call).
delete process.env.ADDY_GEMINI_API_KEY;
delete process.env.ADJ_GEMINI_API_KEY;
delete process.env.GEMINI_API_KEY;

const K1 = 'AIzaTESTKEY_ONE_aaaaaaaaaaaaaaaaaaa';
const K2 = 'AIzaTESTKEY_TWO_bbbbbbbbbbbbbbbbbbb';

test('pool: addGeminiApiKey accumulates and de-duplicates', () => {
  clearGeminiApiKey();
  addGeminiApiKey(K1);
  addGeminiApiKey(K2);
  addGeminiApiKey(K1); // duplicate must not create a second entry
  const keys = getGeminiApiKeys();
  assert.deepEqual(keys, [K1, K2]);
  assert.equal(getGeminiApiKey(), K1);
  assert.ok(hasGeminiApiKey());
});

test('pool: a failed key is benched and the next one is served', () => {
  clearGeminiApiKey();
  addGeminiApiKey(K1);
  addGeminiApiKey(K2);
  assert.equal(getGeminiApiKey(), K1);

  reportGeminiKeyFailure(K1);

  // K1 is cooling down, so K2 becomes active...
  assert.equal(getGeminiApiKey(), K2);
  // ...but K1 is still in the pool (benched, not deleted) so a total outage
  // still has something to try.
  assert.deepEqual(getGeminiApiKeys(), [K2, K1]);
});

test('pool: success clears a key failure history', () => {
  clearGeminiApiKey();
  addGeminiApiKey(K1);
  addGeminiApiKey(K2);
  reportGeminiKeyFailure(K1);
  assert.equal(getGeminiApiKey(), K2);
  reportGeminiKeySuccess(K1);
  assert.equal(getGeminiApiKey(), K1); // healthy again, promoted back to front
});

test('pool: status reports masked keys and cooldown without leaking secrets', () => {
  clearGeminiApiKey();
  addGeminiApiKey(K1);
  addGeminiApiKey(K2);
  reportGeminiKeyFailure(K1);

  const status = getGeminiKeyStatus();
  assert.equal(status.length, 2);
  assert.ok(status.every((s) => s.masked.startsWith('…') && !s.masked.includes('AIza')));
  const cooling = status.find((s) => s.cooling);
  assert.ok(cooling, 'expected one key to be cooling');
  assert.ok((cooling!.cooldownRemainingMs ?? 0) > 0);
});

test('pool: legacy single geminiApiKey is still honoured', () => {
  clearGeminiApiKey();
  const secretsFile = path.join(TMP, 'secrets.json');
  fs.writeFileSync(secretsFile, JSON.stringify({ geminiApiKey: K1 }));
  assert.equal(getGeminiApiKey(), K1);
  assert.deepEqual(getGeminiApiKeys(), [K1]);
});

test('isKeyError distinguishes credential/quota failures from real errors', () => {
  assert.ok(isKeyError(new Error('API key not valid. Please pass a valid API key.')));
  assert.ok(isKeyError(new Error('got status 429 Too Many Requests')));
  assert.ok(isKeyError(new Error('RESOURCE_EXHAUSTED: quota exceeded')));
  assert.ok(isKeyError(new Error('UNAUTHENTICATED')));
  assert.ok(!isKeyError(new Error('Model not found')));
  assert.ok(!isKeyError(new Error('fetch failed')));
  assert.ok(!isKeyError(new Error('socket hang up')));
});

test('pool: clearGeminiApiKey empties the pool', () => {
  addGeminiApiKey(K1);
  clearGeminiApiKey();
  assert.equal(getGeminiApiKey(), undefined);
  assert.equal(hasGeminiApiKey(), false);
});
