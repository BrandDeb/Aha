import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isNotCrossSite, readJsonLimited } from '../src/lib/request-guard.ts';
import { isValidPath } from '../src/workspace/project.ts';

const req = (headers: Record<string, string>) => ({ headers: new Headers(headers) });

test('cross-site guard: scripts and the studio pass, other sites do not', () => {
  const base = 'http://localhost:3000';
  assert.ok(isNotCrossSite(req({ host: '127.0.0.1:3000' }), base), 'curl sends no Origin');
  assert.ok(isNotCrossSite(req({ host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-fetch-site': 'same-origin' }), base));
  assert.ok(isNotCrossSite(req({ host: 'internal:3000', origin: 'http://localhost:3000' }), base), 'the configured site behind a proxy');
  assert.ok(!isNotCrossSite(req({ host: '127.0.0.1:3000', origin: 'https://evil.example' }), base), 'text/plain CSRF carries the attacker Origin');
  assert.ok(!isNotCrossSite(req({ host: '127.0.0.1:3000', 'sec-fetch-site': 'cross-site' }), base), 'Origin stripped, fetch metadata still says cross-site');
  assert.ok(!isNotCrossSite(req({ host: '127.0.0.1:3000', origin: 'null' }), base), 'sandboxed frames send Origin: null');
  assert.ok(!isNotCrossSite(req({ host: 'evil.example:3000', origin: 'http://evil.example:3000' }), base), 'DNS rebinding: Origin and Host agree, but the name is not ours');
  assert.ok(isNotCrossSite(req({ host: 'localhost:3000', origin: 'http://localhost:3000' }), base));
});

test('bounded JSON bodies: oversize and chunked uploads stop early', async () => {
  const small = await readJsonLimited(new Request('http://x/', { method: 'POST', body: '{"a":1}' }), 100);
  assert.deepEqual(small, { ok: true, value: { a: 1 } });
  const declared = await readJsonLimited(new Request('http://x/', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999999' } }), 100);
  assert.equal(declared.ok ? 0 : declared.status, 413);
  // A stream without Content-Length that keeps going: read is cut off once past the limit
  let pulled = 0;
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulled++;
      controller.enqueue(new Uint8Array(64).fill(97));
      if (pulled > 10_000) controller.close();
    },
  });
  const chunked = await readJsonLimited(new Request('http://x/', { method: 'POST', body: endless, duplex: 'half' } as RequestInit), 1000);
  assert.equal(chunked.ok ? 0 : chunked.status, 413);
  assert.ok(pulled < 100, `stopped after ${pulled} chunks`);
  const broken = await readJsonLimited(new Request('http://x/', { method: 'POST', body: '{nope' }), 100);
  assert.equal(broken.ok ? 0 : broken.status, 400);
});

test('project paths: framework names and dotfiles yes, escapes no', () => {
  for (const ok of ['src/routes/+page.svelte', '.npmrc', '.env.example', 'node_modules/@types/x/index.d.ts', 'app/[id]x.ts'.replace('[id]', 'id'), '.python-version', 'a/b-c_d.e.ts']) assert.ok(isValidPath(ok), ok);
  for (const bad of ['../x', 'a/../../x', '/etc/passwd', 'a//b', 'a/./b', '', 'x'.repeat(201), 'a\\b', 'a b', 'a\0b', '..', '.', 'a/.']) assert.ok(!isValidPath(bad), JSON.stringify(bad));
});

test('security headers: CSP forbids framing, plugins and foreign scripts', async () => {
  const config = (await import('../next.config.ts')).default;
  const rules = await config.headers!();
  const headers = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]));
  const csp = headers['Content-Security-Policy'];
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.doesNotMatch(csp.match(/script-src[^;]*/)![0], /https?:|\*/, 'no remote script hosts');
  assert.equal(headers['X-Frame-Options'], 'DENY');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(config.poweredByHeader, false);
});
