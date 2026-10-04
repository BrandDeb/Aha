import { test } from 'node:test';
import assert from 'node:assert/strict';
import handleRequest, { timingSafeEqual, type Env } from '../src/edge/index.ts';

function makeEnv(overrides: Partial<Env> = {}): Env {
  const store = new Map<string, string>();
  return {
    KV: {
      get: async (key: string) => store.get(key) ?? null,
      put: async (key: string, value: string) => { store.set(key, value); },
      delete: async (key: string) => { store.delete(key); },
      list: async () => ({ keys: [...store.keys()] }),
    },
    R2: {} as Env['R2'],
    AI_GATEWAY_URL: '',
    AUTH_SECRET: 's3cret',
    ...overrides,
  };
}

function post(path: string, body: unknown): Request {
  return new Request(`https://edge.example${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function validate(token: unknown, env = makeEnv()) {
  const res = await handleRequest(post('/api/auth/validate', { token }), env, {});
  return (await res.json()).valid;
}

test('auth validation accepts only the configured secret', async () => {
  assert.equal(await validate('s3cret'), true);
  assert.equal(await validate('valid_anything'), false);
  assert.equal(await validate('s3cre'), false);
  assert.equal(await validate(undefined), false);
  assert.equal(await validate({}), false);
});

test('auth validation fails closed when no secret is configured', async () => {
  assert.equal(await validate('', makeEnv({ AUTH_SECRET: '' })), false);
  assert.equal(await validate(undefined, makeEnv({ AUTH_SECRET: '' })), false);
});

test('timingSafeEqual compares strings', () => {
  assert.ok(timingSafeEqual('abc', 'abc'));
  assert.ok(!timingSafeEqual('abc', 'abd'));
  assert.ok(!timingSafeEqual('abc', 'abcd'));
  assert.ok(!timingSafeEqual('', 'a'));
});

test('URL shortener stores valid URLs and returns a short link', async () => {
  const env = makeEnv();
  const res = await handleRequest(post('/api/shorten', { url: 'https://example.com/a?b=1' }), env, {});
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.match(data.shortId, /^[A-Za-z0-9]{8}$/);
  assert.equal(data.shortUrl, `https://edge.example/s/${data.shortId}`);
  assert.equal(await env.KV.get(data.shortId), 'https://example.com/a?b=1');
});

test('URL shortener rejects invalid input and taken custom ids', async () => {
  const env = makeEnv();
  for (const body of [{ url: 'not a url' }, { url: 'javascript:alert(1)' }, { url: 'https://a.b', customId: '../x' }]) {
    const res = await handleRequest(post('/api/shorten', body), env, {});
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const first = await handleRequest(post('/api/shorten', { url: 'https://a.b', customId: 'mine' }), env, {});
  assert.equal(first.status, 200);
  const second = await handleRequest(post('/api/shorten', { url: 'https://evil.b', customId: 'mine' }), env, {});
  assert.equal(second.status, 409);
  assert.equal(await env.KV.get('mine'), 'https://a.b/');
});
