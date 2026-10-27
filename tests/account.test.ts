import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanAccount, providersFor, readAccount, sessionSecret, signAccount, type Account } from '../src/lib/account.ts';
import { readGooglePoll, readIdToken, startGoogleDevice, pollGoogleDevice } from '../src/lib/google-device.ts';

const secret = Buffer.from('a'.repeat(48));
const ada: Account = { provider: 'google', id: '1234', name: 'Ada Lovelace', handle: 'ada@example.com', avatar: 'https://lh3.googleusercontent.com/a/x' };

const jwt = (claims: Record<string, unknown>) => `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
const claims = (over: Record<string, unknown> = {}) => ({ iss: 'https://accounts.google.com', aud: 'client-1', sub: '1234', email: 'ada@example.com', email_verified: true, name: 'Ada Lovelace', picture: 'https://lh3.googleusercontent.com/a/x', exp: Math.floor(Date.now() / 1000) + 3600, ...over });

test('a signed account reads back; an altered, foreign or expired one does not', () => {
  const cookie = signAccount(ada, secret, 1_000, 30);
  assert.deepEqual(readAccount(cookie, secret, 2_000), ada);
  // Changing the payload (to become someone else) breaks the signature
  const [payload, sig] = cookie.split('.');
  const forged = Buffer.from(JSON.stringify({ a: { ...ada, id: '9999', handle: 'admin@example.com' }, exp: 9e15 })).toString('base64url');
  assert.equal(readAccount(`${forged}.${sig}`, secret, 2_000), null);
  assert.equal(readAccount(`${payload}.${sig.slice(0, -2)}xx`, secret, 2_000), null);
  // Another server's key, an expired session, and junk
  assert.equal(readAccount(cookie, Buffer.from('b'.repeat(48)), 2_000), null);
  assert.equal(readAccount(cookie, secret, 1_000 + 31 * 86_400_000), null);
  for (const junk of [undefined, '', 'nodot', '.', 'a.b', `${payload}.`]) assert.equal(readAccount(junk, secret), null, String(junk));
});

test('whatever a provider sends is cleaned before it is stored', () => {
  assert.equal(cleanAccount({ provider: 'facebook' as never, id: '1', handle: 'x' }), null);
  assert.equal(cleanAccount({ provider: 'github', id: '', handle: 'x' }), null);
  const a = cleanAccount({ provider: 'github', id: '7', handle: 'octo', name: 'n'.repeat(500), avatar: 'javascript:alert(1)' })!;
  assert.equal(a.avatar, null);
  assert.equal(a.name.length, 120);
  assert.equal(cleanAccount({ provider: 'github', id: '7', handle: 'octo', avatar: 'http://insecure.example/a.png' })!.avatar, null);
  assert.equal(cleanAccount({ provider: 'github', id: '7', handle: 'octo' })!.name, 'octo');
});

test('the signing key comes from the environment, or is made once and kept private', () => {
  assert.equal(sessionSecret({ AHA_SESSION_SECRET: 'z'.repeat(40) }).toString(), 'z'.repeat(40));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-secret-'));
  const first = sessionSecret({}, home);
  assert.ok(first.length >= 32);
  assert.deepEqual(sessionSecret({}, home), first, 'the same key on the next start');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'session-secret')).mode & 0o777, 0o600);
  // Too short a configured key is ignored rather than used
  assert.notEqual(sessionSecret({ AHA_SESSION_SECRET: 'short' }, home).toString(), 'short');
});

test('which providers a server can use', () => {
  assert.deepEqual(providersFor({}), { github: false, google: false });
  assert.deepEqual(providersFor({ GITHUB_CLIENT_ID: 'g' }), { github: true, google: false });
  assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: 'x' }), { github: false, google: false }, 'a Google client needs its secret too');
  assert.deepEqual(providersFor({ GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'y', NEXT_PUBLIC_GITHUB_CLIENT_ID: 'z' }), { github: true, google: true });
});

test('a Google ID token is checked for issuer, audience, expiry and a verified email', () => {
  assert.deepEqual(readIdToken(jwt(claims()), 'client-1'), ada);
  assert.equal(readIdToken(jwt(claims({ iss: 'https://evil.example' })), 'client-1'), null);
  assert.equal(readIdToken(jwt(claims({ aud: 'someone-elses-client' })), 'client-1'), null);
  assert.equal(readIdToken(jwt(claims({ exp: 1 })), 'client-1'), null);
  assert.equal(readIdToken(jwt(claims({ email_verified: false })), 'client-1'), null);
  assert.equal(readIdToken(jwt(claims({ email: undefined })), 'client-1'), null);
  assert.equal(readIdToken(jwt(claims({ picture: 'http://x/y.png' })), 'client-1')!.avatar, null);
  assert.equal(readIdToken(jwt(claims({ name: undefined })), 'client-1')!.name, 'ada@example.com');
  for (const junk of [null, 5, 'a.b', 'a.b.c', 'x.!!!.z']) assert.equal(readIdToken(junk, 'client-1'), null, String(junk));
});

test('Google’s poll answers become statuses', () => {
  assert.deepEqual(readGooglePoll({ error: 'authorization_pending' }, 'c'), { status: 'pending' });
  assert.deepEqual(readGooglePoll({ error: 'slow_down' }, 'c'), { status: 'pending', interval: 10 });
  assert.equal(readGooglePoll({ error: 'expired_token' }, 'c').status, 'expired');
  assert.equal(readGooglePoll({ error: 'access_denied' }, 'c').status, 'denied');
  assert.equal(readGooglePoll({ error: 'invalid_grant', error_description: 'Bad' }, 'c').status, 'error');
  assert.equal(readGooglePoll({ id_token: jwt(claims({ aud: 'other' })) }, 'client-1').status, 'error');
  assert.deepEqual(readGooglePoll({ id_token: jwt(claims()) }, 'client-1'), { status: 'done', account: ada });
});

test('the device flow talks to Google as documented', async () => {
  const real = globalThis.fetch;
  const seen: { url: string; body: URLSearchParams; type: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, body: new URLSearchParams(String(init?.body)), type: new Headers(init?.headers).get('content-type') });
    if (url.endsWith('/device/code')) return Response.json({ device_code: 'dc', user_code: 'ABCD-EFGH', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
    return Response.json({ id_token: jwt(claims()) });
  }) as typeof fetch;
  try {
    const started = await startGoogleDevice('client-1');
    assert.deepEqual(started, { deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://www.google.com/device', expiresIn: 1800, interval: 5 });
    assert.equal(seen[0].url, 'https://oauth2.googleapis.com/device/code');
    assert.equal(seen[0].body.get('scope'), 'openid email profile');
    assert.equal(seen[0].type, 'application/x-www-form-urlencoded');
    const done = await pollGoogleDevice('client-1', 'secret-1', 'dc');
    assert.equal(done.status, 'done');
    assert.equal(seen[1].url, 'https://oauth2.googleapis.com/token');
    assert.equal(seen[1].body.get('client_secret'), 'secret-1');
    assert.equal(seen[1].body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:device_code');
    globalThis.fetch = (async () => Response.json({ error: 'invalid_client', error_description: 'The OAuth client was not found.' }, { status: 401 })) as typeof fetch;
    assert.match(String((await startGoogleDevice('nope') as { error: string }).error), /OAuth client was not found/);
    globalThis.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
    assert.match((await startGoogleDevice('c') as { error: string }).error, /Could not reach Google/);
    assert.equal((await pollGoogleDevice('c', 's', 'd')).status, 'error');
  } finally {
    globalThis.fetch = real;
  }
});
