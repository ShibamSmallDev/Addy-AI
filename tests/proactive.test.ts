import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isQuietHours,
  updateProactiveConfig,
  getProactiveStatus,
  startProactiveDaemon,
  stopProactiveDaemon,
  runProactiveCycle,
  recordUserActivity,
  registerBusyCheck,
} from '../server_proactive';

test('proactive: isQuietHours correctly flags nighttime hours', () => {
  updateProactiveConfig({ quietHoursStart: 23, quietHoursEnd: 8 });

  // 11 PM (23:00) -> quiet
  const night1 = new Date(2026, 8, 12, 23, 15);
  assert.equal(isQuietHours(night1), true, '23:15 should be in quiet hours');

  // 3 AM (03:00) -> quiet
  const night2 = new Date(2026, 8, 12, 3, 0);
  assert.equal(isQuietHours(night2), true, '03:00 should be in quiet hours');

  // 7:59 AM -> quiet
  const night3 = new Date(2026, 8, 12, 7, 59);
  assert.equal(isQuietHours(night3), true, '07:59 should be in quiet hours');

  // 10 AM -> not quiet
  const day1 = new Date(2026, 8, 12, 10, 0);
  assert.equal(isQuietHours(day1), false, '10:00 should not be in quiet hours');

  // 2 PM -> not quiet
  const day2 = new Date(2026, 8, 12, 14, 30);
  assert.equal(isQuietHours(day2), false, '14:30 should not be in quiet hours');
});

test('proactive: configuration get and update cycle works', () => {
  const updated = updateProactiveConfig({
    intervalMinutes: 20,
    speechEnabled: true,
    notificationsEnabled: true,
    newsEnabled: true,
    emailEnabled: true,
    whatsappEnabled: false,
  });

  assert.equal(updated.intervalMinutes, 20);
  assert.equal(updated.whatsappEnabled, false);

  const status = getProactiveStatus();
  assert.equal(status.config.intervalMinutes, 20);
  assert.equal(status.config.whatsappEnabled, false);
});

test('proactive: runProactiveCycle executes news, email, whatsapp checks and emits alerts', async () => {
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const broadcasted: unknown[] = [];

  // Configure non-quiet hours for testing
  updateProactiveConfig({
    quietHoursStart: 3,
    quietHoursEnd: 4,
    speechEnabled: true,
    notificationsEnabled: true,
    newsEnabled: true,
    emailEnabled: true,
    whatsappEnabled: true,
    speechCooldownMinutes: 0,
  });

  const mockCallAgent = async (tool: string, args: Record<string, unknown>) => {
    toolCalls.push({ tool, args });

    if (tool === 'getActiveWindow') {
      return { ok: true, result: { process_name: 'code.exe', title: 'VS Code' } };
    }
    if (tool === 'fetchAINews') {
      return {
        ok: true,
        result: {
          articles: [
            {
              id: 'test_story_1',
              title: 'Anthropic Releases Claude 4 Breakthrough Model',
              url: 'https://news.ycombinator.com/item?id=123456',
              summary: 'New reasoning capabilities benchmarked at state of the art.',
            },
          ],
        },
      };
    }
    if (tool === 'checkEmails') {
      return {
        ok: true,
        result: {
          configured: true,
          unread_count: 1,
          emails: [
            {
              sender: 'boss@company.com',
              subject: 'Quarterly AI Roadmap',
              date: 'Sat, 12 Sep 2026 10:00:00 +0000',
            },
          ],
        },
      };
    }
    if (tool === 'checkWhatsAppMessages') {
      return {
        ok: true,
        result: {
          logged_in: true,
          unread_chats: 1,
          chats: [
            {
              sender: 'Sarah Connor',
              snippet: 'Are you working on Addy today?',
            },
          ],
        },
      };
    }
    if (tool === 'showDesktopNotification' || tool === 'speakText') {
      return { ok: true, result: 'Notification shown' };
    }

    return { ok: true, result: {} };
  };

  startProactiveDaemon(
    (data) => broadcasted.push(data),
    mockCallAgent
  );

  const res = await runProactiveCycle(true);
  stopProactiveDaemon();

  assert.equal(res.newsChecked, true, 'News check should have executed');
  assert.equal(res.emailChecked, true, 'Email check should have executed');
  assert.equal(res.whatsappChecked, true, 'WhatsApp check should have executed');
  assert.ok(res.alerts.length >= 2, 'Expected proactive alerts for news and email');

  // Verify notifications or speech were called
  const notificationCalls = toolCalls.filter((c) => c.tool === 'showDesktopNotification');
  assert.ok(notificationCalls.length >= 1, 'Expected at least one desktop notification call');

  const speechCalls = toolCalls.filter((c) => c.tool === 'speakText');
  assert.ok(speechCalls.length >= 1, 'Expected at least one proactive speech call');
});

test('proactive: canSpeakNow suppresses speech if user was active recently', async () => {
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  updateProactiveConfig({
    quietHoursStart: 3,
    quietHoursEnd: 4,
    speechEnabled: true,
    notificationsEnabled: true,
    newsEnabled: false,
    emailEnabled: true,
    whatsappEnabled: false,
    speechCooldownMinutes: 0,
    conversationIdleGraceMinutes: 5,
  });

  // Record user activity right now
  recordUserActivity();

  const mockCallAgent = async (tool: string, args: Record<string, unknown>) => {
    toolCalls.push({ tool, args });
    if (tool === 'getActiveWindow') {
      return { ok: true, result: { process_name: 'code.exe', title: 'VS Code' } };
    }
    if (tool === 'checkEmails') {
      return {
        ok: true,
        result: {
          configured: true,
          unread_count: 1,
          emails: [{ sender: 'team@addy.ai', subject: 'Urgent Update 2', date: 'Sat, 12 Sep 2026 10:05:00 +0000' }],
        },
      };
    }
    return { ok: true, result: {} };
  };

  startProactiveDaemon(() => {}, mockCallAgent);
  const res = await runProactiveCycle(true);
  stopProactiveDaemon();

  assert.equal(res.emailChecked, true);
  assert.ok(res.alerts.length >= 1, 'Alert should still be recorded in history');
  const speechCalls = toolCalls.filter((c) => c.tool === 'speakText');
  assert.equal(speechCalls.length, 0, 'Speech should be suppressed within conversationIdleGraceMinutes');
});

test('proactive: canSpeakNow suppresses speech if busy check reports busy', async () => {
  const toolCalls: Array<{ tool: string; args: Record<string, unknown> }> = [];

  updateProactiveConfig({
    quietHoursStart: 3,
    quietHoursEnd: 4,
    speechEnabled: true,
    notificationsEnabled: true,
    newsEnabled: false,
    emailEnabled: true,
    whatsappEnabled: false,
    speechCooldownMinutes: 0,
    conversationIdleGraceMinutes: 0,
    onlySpeakWhenFree: true,
  });

  registerBusyCheck(() => ({ busy: true, reason: 'running background tool' }));

  const mockCallAgent = async (tool: string, args: Record<string, unknown>) => {
    toolCalls.push({ tool, args });
    if (tool === 'getActiveWindow') {
      return { ok: true, result: { process_name: 'code.exe', title: 'VS Code' } };
    }
    if (tool === 'checkEmails') {
      return {
        ok: true,
        result: {
          configured: true,
          unread_count: 1,
          emails: [{ sender: 'vip@corp.com', subject: 'Release Notes 3', date: 'Sat, 12 Sep 2026 10:10:00 +0000' }],
        },
      };
    }
    return { ok: true, result: {} };
  };

  startProactiveDaemon(() => {}, mockCallAgent);
  const res = await runProactiveCycle(true);
  stopProactiveDaemon();

  // Reset busy check
  registerBusyCheck(() => ({ busy: false }));

  assert.equal(res.emailChecked, true);
  assert.ok(res.alerts.length >= 1, 'Alert should still be recorded in history');
  const speechCalls = toolCalls.filter((c) => c.tool === 'speakText');
  assert.equal(speechCalls.length, 0, 'Speech should be suppressed when busy check returns busy');
});

