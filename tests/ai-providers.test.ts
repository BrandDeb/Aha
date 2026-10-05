import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, readEvent, resolveProvider, splitSse, streamChat, EMPTY_AI_CONFIG } from '../src/lib/ai-providers.ts';

test('splitSse returns complete data lines and keeps the partial tail', () => {
  const { events, rest } = splitSse('event: x\ndata: {"a":1}\n\ndata: [DONE]\ndata: {"b"');
  assert.deepEqual(events, ['{"a":1}', '[DONE]']);
  assert.equal(rest, 'data: {"b"');
});

test('readEvent understands OpenAI-compatible and Anthropic streams', () => {
  assert.deepEqual(readEvent('openai', '{"choices":[{"delta":{"content":"hi"}}]}'), { text: 'hi' });
  assert.deepEqual(readEvent('openai', '{"choices":[{"delta":{},"finish_reason":"length"}]}'), { stop: 'length' });
  assert.deepEqual(readEvent('openai', '{"error":{"message":"quota"}}'), { error: 'quota' });
  assert.equal(readEvent('openai', '[DONE]'), null);
  assert.equal(readEvent('openai', 'not json'), null);
  assert.deepEqual(readEvent('anthropic', '{"type":"content_block_delta","delta":{"type":"text_delta","text":"yo"}}'), { text: 'yo' });
  assert.deepEqual(readEvent('anthropic', '{"type":"message_delta","delta":{"stop_reason":"max_tokens"}}'), { stop: 'max_tokens' });
  assert.equal(readEvent('anthropic', '{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"…"}}'), null);
});

test('resolveProvider explains what is missing', () => {
  assert.ok('error' in resolveProvider(EMPTY_AI_CONFIG));
  assert.match((resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'groq' }) as { error: string }).error, /API key/);
  const ollama = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'ollama' });
  assert.ok(!('error' in ollama) && ollama.baseUrl === 'http://localhost:11434/v1' && ollama.model);
  const custom = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'custom', baseUrls: { custom: 'file:///etc' }, models: { custom: 'm' } });
  assert.ok('error' in custom);
  // Base URLs of hosted providers can't be redirected
  const groq = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'groq', keys: { groq: 'k' }, baseUrls: { groq: 'https://evil.example' } });
  assert.ok(!('error' in groq) && groq.baseUrl === 'https://api.groq.com/openai/v1');
});

test('every hosted provider uses https and has a key link', () => {
  for (const p of PROVIDERS) {
    if (p.kind === 'server' || p.local || p.id === 'custom') continue;
    assert.ok(p.baseUrl.startsWith('https://'), p.id);
    assert.ok(p.keyUrl?.startsWith('https://'), p.id);
  }
});

test('streamChat streams text from an OpenAI-compatible server', async (t) => {
  const chunks = ['data: {"choices":[{"delta":{"content":"Hel"}}]}\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n'];
  let seen: { url: string; init: RequestInit } | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    seen = { url, init };
    return new Response(new ReadableStream({
      start(c) {
        for (const chunk of chunks) c.enqueue(new TextEncoder().encode(chunk));
        c.close();
      },
    }));
  });
  const target = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'groq', keys: { groq: 'gsk_test' }, models: { groq: 'm' } });
  assert.ok(!('error' in target));
  let text = '';
  for await (const chunk of streamChat(target, 'sys', [{ role: 'user', content: 'hi' }])) text += chunk;
  assert.equal(text, 'Hello');
  assert.equal(seen!.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal((seen!.init.headers as Record<string, string>).Authorization, 'Bearer gsk_test');
  const body = JSON.parse(seen!.init.body as string);
  assert.deepEqual(body.messages[0], { role: 'system', content: 'sys' });
});

test('streamChat turns HTTP errors into readable messages', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'Invalid API Key' } }), { status: 401 }));
  const target = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'groq', keys: { groq: 'bad' } });
  assert.ok(!('error' in target));
  await assert.rejects(async () => {
    for await (const _ of streamChat(target, 's', [])) void _;
  }, /rejected the API key: Invalid API Key/);
});
