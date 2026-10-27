import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const launch = require('../scripts/launch-key.js');

const KEY = launch.newKey();
const req = (url: string, headers: Record<string, string> = {}, method = 'GET') => ({ method, url, headers });
const cookie = (key = KEY, port = 3000) => ({ cookie: `theme=dark; ${launch.cookieName(port)}=${key}` });

test('keys are long, random and safe in a link', () => {
  const a = launch.newKey();
  assert.notEqual(a, launch.newKey());
  assert.ok(a.length >= 32);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
});

test('routes that run programs or touch files need the key', () => {
  for (const url of ['/api/shell', '/api/run', '/api/python?x=1', '/api/devserver', '/api/debug', '/api/connectors', '/api/doctor', '/api/update', '/api/folder/read', '/api/lsp', '/api/toolchains']) {
    assert.deepEqual(launch.decide(req(url), KEY, 3000), { action: 'deny' }, url);
    assert.deepEqual(launch.decide(req(url, cookie()), KEY, 3000), { action: 'pass' }, url);
  }
  // Scripts can send it as a header instead
  assert.deepEqual(launch.decide(req('/api/shell', { 'x-aha-key': KEY }, 'POST'), KEY, 3000), { action: 'pass' });
});

test('pages, compiling and hosted-safe routes stay open', () => {
  for (const url of ['/', '/studio', '/api/compile', '/api/health', '/api/ai', '/api/github/user', '/api/solc', '/api/supply-chain', '/_next/static/x.js', '/api/shellfish']) {
    assert.deepEqual(launch.decide(req(url), KEY, 3000), { action: 'pass' }, url);
  }
});

test('a wrong key, another port’s cookie or a near miss is refused', () => {
  assert.deepEqual(launch.decide(req('/api/shell', cookie(launch.newKey())), KEY, 3000), { action: 'deny' });
  assert.deepEqual(launch.decide(req('/api/shell', cookie(KEY, 4000)), KEY, 3000), { action: 'deny' });
  assert.deepEqual(launch.decide(req('/api/shell', cookie(KEY.slice(0, -1))), KEY, 3000), { action: 'deny' });
  assert.deepEqual(launch.decide(req('/api/shell', { 'x-aha-key': '' }), KEY, 3000), { action: 'deny' });
});

test('the launch link swaps the key for a cookie and drops it from the address', () => {
  const v = launch.decide(req(`/studio?x=1&aha_key=${KEY}`), KEY, 3000);
  assert.equal(v.action, 'unlock');
  assert.equal(v.location, '/studio?x=1');
  assert.equal(v.cookie, `aha_key_3000=${KEY}; HttpOnly; SameSite=Strict; Path=/`);
  assert.equal(launch.decide(req(`/?aha_key=${KEY}`), KEY, 3000).location, '/');
});

test('an old link is turned away, unless the window already has the key', () => {
  const old = launch.newKey();
  assert.deepEqual(launch.decide(req(`/?aha_key=${old}`), KEY, 3000), { action: 'unlock-failed', location: '/' });
  assert.deepEqual(launch.decide(req(`/?aha_key=${old}`, cookie()), KEY, 3000), { action: 'unlock', location: '/' });
  // Only page loads set the cookie; a form post with the key in its URL changes nothing
  assert.deepEqual(launch.decide(req(`/?aha_key=${KEY}`, {}, 'POST'), KEY, 3000), { action: 'pass' });
});

test('the launch file is private to this user, and a stale one reads as none', () => {
  const env = { AHA_HOME: mkdtempSync(path.join(tmpdir(), 'aha-launch-')) };
  const info = { url: 'http://localhost:3000', port: 3000, key: KEY, pid: process.pid, startedAt: 1 };
  assert.equal(launch.writeLaunchFile(info, env), true);
  if (process.platform !== 'win32') assert.equal(statSync(launch.launchFile(env)).mode & 0o777, 0o600);
  assert.deepEqual(launch.readLaunchFile(env), info);
  assert.equal(launch.readLaunchFile(env, () => false), null);
  assert.equal(launch.launchUrl('http://localhost:3000/', 'a b'), 'http://localhost:3000/?aha_key=a%20b');
  // Another studio's file is left alone; ours is removed
  launch.removeLaunchFile(process.pid + 1, env);
  assert.ok(launch.readLaunchFile(env));
  launch.removeLaunchFile(process.pid, env);
  assert.equal(launch.readLaunchFile(env), null);
  writeFileSync(launch.launchFile(env), 'not json');
  assert.equal(launch.readLaunchFile(env), null);
});
