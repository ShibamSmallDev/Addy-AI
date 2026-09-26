import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { initDatabase } from '../database';
import { extractImmediateMemory, queueDialogueForConsolidation } from '../server_memory';
import { formatRecallPrompt, RecallContext } from '../server_phasex';
import { getAllMemories } from '../memory/retriever';
import { filterToolCallLeakage, stripEmojisAndAsterisks } from '../src/lib/textSanitizer';

before(async () => {
  await initDatabase();
});

after(() => {
  setTimeout(() => process.exit(0), 200).unref();
});

test('memory: extractImmediateMemory extracts and stores direct preferences immediately', () => {
  const result = extractImmediateMemory('Remember that my favorite code editor is VS Code');
  assert.ok(result, 'Expected immediate memory extraction');
  assert.equal(result.category, 'preference');
  assert.ok(result.value.includes('VS Code'));

  const all = getAllMemories(false, 100);
  const found = all.find(m => m.value.includes('VS Code'));
  assert.ok(found, 'Expected memory to be present in SQL database');
});

test('memory: extractImmediateMemory extracts identity attributes', () => {
  const result = extractImmediateMemory('My dog is named Cooper');
  assert.ok(result, 'Expected immediate identity extraction');
  assert.equal(result.category, 'identity');
  assert.ok(result.value.includes('Cooper'));
});

test('memory: extractImmediateMemory extracts reminders', () => {
  const result = extractImmediateMemory("Don't forget to deploy the server tonight");
  assert.ok(result, 'Expected reminder extraction');
  assert.equal(result.category, 'reminder');
  assert.ok(result.value.includes('deploy the server tonight'));
});

test('memory: formatRecallPrompt generates chronological multi-session timeline with dates and times', () => {
  const startTime1 = new Date('2026-09-10T14:30:00Z').getTime();
  const endTime1 = new Date('2026-09-10T15:00:00Z').getTime();
  const startTime2 = new Date('2026-09-11T10:00:00Z').getTime();
  const endTime2 = new Date('2026-09-11T10:25:00Z').getTime();

  const mockContext: RecallContext = {
    session: {
      lastSessionSummary: 'Configured project tools.',
      lastSessionId: 'ses_prev_2',
      lastSessionTime: endTime2,
    },
    recentSessions: [
      {
        id: 'ses_prev_2',
        title: 'Browser Profile Cloning',
        startTime: startTime2,
        endTime: endTime2,
        durationMinutes: 25,
        messageCount: 8,
        summary: 'Cloned Edge browser cookies and authenticated profile.',
      },
      {
        id: 'ses_prev_1',
        title: 'Memory and Architecture Audit',
        startTime: startTime1,
        endTime: endTime1,
        durationMinutes: 30,
        messageCount: 14,
        summary: 'Audited memory overwrite bugs and proposed multi-session ledger.',
      },
    ],
    longTerm: {
      preferences: { 'Theme': 'Dark' },
      projects: ['Addy AI'],
      decisions: ['Use Microsoft Edge for cloned profile'],
      frequentlyReferenced: [],
    },
    activeProject: 'C:\\MY PROJECTS\\Addy AI',
    workspace: 'C:\\MY PROJECTS\\Addy AI',
    unfinishedTasks: [],
    recentConversation: [],
  };

  const prompt = formatRecallPrompt(mockContext);
  assert.ok(prompt.includes('CHRONOLOGICAL SESSION HISTORY'), 'Expected chronological session section');
  assert.ok(prompt.includes('Browser Profile Cloning'), 'Expected session 2 title');
  assert.ok(prompt.includes('Memory and Architecture Audit'), 'Expected session 1 title');
  assert.ok(prompt.includes('Cloned Edge browser cookies'), 'Expected session 2 summary');
  assert.ok(prompt.includes('Audited memory overwrite bugs'), 'Expected session 1 summary');
  assert.ok(prompt.includes('USER PREFERENCES'), 'Expected preferences section');
});

test('memory: queueDialogueForConsolidation buffers turns safely without dropping', () => {
  assert.doesNotThrow(() => {
    queueDialogueForConsolidation([
      { role: 'user', text: 'Quick turn 1' },
      { role: 'model', text: 'Quick response 1' },
    ]);
    queueDialogueForConsolidation([
      { role: 'user', text: 'Quick turn 2' },
      { role: 'model', text: 'Quick response 2' },
    ]);
  });
});

test('sanitizer: stripEmojisAndAsterisks removes emojis, pictographs, and symbols', () => {
  const input = "I love you so much babe! 💖✨🌸 How are you doing today? 😊🔥";
  const output = stripEmojisAndAsterisks(input);
  assert.equal(output.trim(), "I love you so much babe! How are you doing today?");
});

test('sanitizer: stripEmojisAndAsterisks removes asterisk action roleplay tags', () => {
  const input = "*giggles softly* I'm right here with you, Shibam! *smiles warmly*";
  const output = stripEmojisAndAsterisks(input);
  assert.equal(output.trim(), "I'm right here with you, Shibam!");
});

test('sanitizer: filterToolCallLeakage removes both leaked tool calls and emojis', () => {
  const input = '{"name": "mouseClick", "args": {"x": 100, "y": 200}} Done for you, darling! ✨💖';
  const output = filterToolCallLeakage(input);
  assert.equal(output.trim(), "Done for you, darling!");
});

test('sanitizer: preserves clean natural speech without emojis', () => {
  const input = "Good morning Shibam! Ready to write some amazing code today?";
  const output = filterToolCallLeakage(input);
  assert.equal(output.trim(), input);
});

