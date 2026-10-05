import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages, parseAiRequest, SYSTEM_PROMPT } from '../src/lib/ai.ts';

test('parseAiRequest validates the action and chat prompt', () => {
  assert.ok('error' in parseAiRequest(null));
  assert.ok('error' in parseAiRequest({ action: 'delete-everything' }));
  assert.ok('error' in parseAiRequest({ action: 'chat', prompt: '   ' }));
  const ok = parseAiRequest({ action: 'explain', files: { 'main.ts': 'x' }, activeFile: 'main.ts' });
  assert.ok(!('error' in ok) && ok.activeFile === 'main.ts');
});

test('parseAiRequest drops malformed history and caps context size', () => {
  const parsed = parseAiRequest({
    action: 'chat',
    prompt: 'hi',
    history: [{ role: 'user', content: 'a' }, { role: 'system', content: 'sneaky' }, { role: 'assistant', content: 5 }, 'x'],
    files: { 'a.ts': 'x', 'b.ts': 7 },
  });
  assert.ok(!('error' in parsed));
  assert.deepEqual(parsed.history, [{ role: 'user', content: 'a' }]);
  assert.deepEqual(Object.keys(parsed.files), ['a.ts']);
  assert.ok('error' in parseAiRequest({ action: 'explain', files: { 'big.ts': 'x'.repeat(500 * 1024) } }));
});

test('buildMessages puts project context, diagnostics and the request in the last user turn', () => {
  const parsed = parseAiRequest({
    action: 'fix',
    files: { 'src/main.ts': 'eval("1")' },
    activeFile: 'src/main.ts',
    diagnostics: [{ file: 'src/main.ts', line: 1, column: 1, code: 'SC2020', message: 'no eval', hint: 'rewrite' }],
    history: [{ role: 'user', content: 'earlier' }, { role: 'assistant', content: 'reply' }],
  });
  assert.ok(!('error' in parsed));
  const messages = buildMessages(parsed);
  assert.equal(messages.length, 3);
  const last = messages[2];
  assert.equal(last.role, 'user');
  assert.match(String(last.content), /<file path="src\/main.ts" active="true">/);
  assert.match(String(last.content), /src\/main.ts:1:1 SC2020: no eval\n  hint: rewrite/);
  assert.match(String(last.content), /Fix the scriptc compile errors/);
});

test('system prompt is static so it can be cached', () => {
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(SYSTEM_PROMPT));
  assert.match(SYSTEM_PROMPT, /scriptc/);
});

test('rate limiter allows the limit per window, then reports the wait', async () => {
  const { createRateLimiter, clientKey } = await import('../src/lib/rate-limit.ts');
  const limiter = createRateLimiter(2, 60_000);
  assert.equal(limiter.check('a', 0), 0);
  assert.equal(limiter.check('a', 1), 0);
  assert.equal(limiter.check('a', 2), 60);
  assert.equal(limiter.check('b', 2), 0);
  assert.equal(limiter.check('a', 60_001), 0);
  assert.equal(clientKey(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assert.equal(clientKey(new Headers()), 'direct');
});
