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

import { readFileSync } from 'node:fs';
import { keyWarning, listModels, rankModels, resolveForListing, sanitizeKey } from '../src/lib/ai-providers.ts';

test('sanitizeKey removes what gets copied along with a key', () => {
  assert.equal(sanitizeKey('  "AIzaSyABC"\n'), 'AIzaSyABC');
  assert.equal(sanitizeKey('Bearer sk-or-abc def'), 'sk-or-abcdef');
  assert.equal(sanitizeKey("'gsk_x'"), 'gsk_x');
});

test('keyWarning spots keys that belong to another provider', () => {
  assert.equal(keyWarning('gemini', 'AIza' + 'x'.repeat(35)), null);
  assert.match(keyWarning('gemini', 'sk-abc')!, /AIza/);
  assert.equal(keyWarning('groq', 'gsk_abc'), null);
  assert.match(keyWarning('groq', 'AIzaabc')!, /gsk_/);
  assert.equal(keyWarning('mistral', 'anything'), null); // no known shape
  assert.equal(keyWarning('gemini', ''), null); // nothing typed yet
});

test('rankModels keeps chat models, free first, newest first, "-latest" aliases ahead', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures-openrouter-models.json', import.meta.url), 'utf8'));
  const ranked = rankModels(fixture).map((m) => m.id);
  assert.ok(!ranked.includes('google/lyria-3-pro-preview'), 'audio output is not a chat model');
  assert.ok(!ranked.some((id) => /content-safety/.test(id)), 'safety classifiers are not chat models');
  assert.equal(ranked[0], 'openrouter/free', 'the free auto-router is the safest default');
  assert.ok(ranked.indexOf('minimax/minimax-m3.1-flash:free') < ranked.indexOf('google/gemma-4-31b-it:free'), 'newer before older');
  const lastFree = Math.max(...ranked.map((id, i) => (id.endsWith(':free') || id === 'openrouter/free' ? i : -1)));
  assert.ok(lastFree < ranked.length - 1 || ranked.length === lastFree + 1);

  const gemini = rankModels([
    { id: 'models/gemini-2.5-flash' },
    { id: 'models/gemini-3.5-flash' },
    { id: 'models/gemini-flash-latest' },
    { id: 'models/text-embedding-004' },
    { id: 'models/gemini-3.5-pro' },
    { id: 'models/imagen-4.0-generate' },
  ]).map((m) => m.id);
  assert.deepEqual(gemini, ['gemini-flash-latest', 'gemini-3.5-pro', 'gemini-3.5-flash', 'gemini-2.5-flash']);
});

test('resolveForListing needs no model, and no key where the list is public', () => {
  assert.ok('error' in resolveForListing({ ...EMPTY_AI_CONFIG, provider: 'gemini' })); // key needed
  assert.ok(!('error' in resolveForListing({ ...EMPTY_AI_CONFIG, provider: 'openrouter' })));
  assert.ok(!('error' in resolveForListing({ ...EMPTY_AI_CONFIG, provider: 'ollama' })));
  assert.ok('error' in resolveForListing({ ...EMPTY_AI_CONFIG, provider: 'server' }));
});

test('listModels reads the live list and sends no Authorization header without a key', async (t) => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures-openrouter-models.json', import.meta.url), 'utf8'));
  let seen: { url: string; headers: Record<string, string> } | null = null;
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    seen = { url, headers: init.headers as Record<string, string> };
    return new Response(JSON.stringify({ data: fixture }));
  });
  const target = resolveForListing({ ...EMPTY_AI_CONFIG, provider: 'openrouter' });
  assert.ok(!('error' in target));
  const models = await listModels(target);
  assert.equal(seen!.url, 'https://openrouter.ai/api/v1/models');
  assert.equal(seen!.headers.Authorization, undefined);
  assert.ok(models.length > 3 && models.some((m) => m.free));
});

test('a rejected Gemini key says what a Gemini key looks like', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } }), { status: 400 }));
  const target = resolveProvider({ ...EMPTY_AI_CONFIG, provider: 'gemini', keys: { gemini: 'not-a-google-key' } });
  assert.ok(!('error' in target));
  await assert.rejects(async () => {
    for await (const _ of streamChat(target, 's', [])) void _;
  }, /rejected the API key.*AIza/);
});

test('isBuiltInSuggestion tells studio defaults (replaceable) from typed model ids', async () => {
  const { isBuiltInSuggestion, getProvider } = await import('../src/lib/ai-providers.ts');
  const gemini = getProvider('gemini')!;
  assert.ok(isBuiltInSuggestion(gemini, 'gemini-flash-latest'));
  assert.ok(isBuiltInSuggestion(gemini, 'gemini-2.5-flash'), 'an old default saved in the browser');
  assert.ok(!isBuiltInSuggestion(gemini, 'my-tuned-model'));
});
