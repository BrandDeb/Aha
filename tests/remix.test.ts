import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { fetchRepo, guessEntry, outlineOf, parseRemixSource, readTar, remixBrief, remixName, snapshotFromTarball } from '../src/lib/remix.ts';

/** A tar archive in memory: ustar headers, long names through pax records */
function tar(entries: { name: string; data: string | Uint8Array }[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  const header = (name: string, size: number, type: string, prefix = '') => {
    const h = new Uint8Array(512);
    const put = (s: string, at: number) => h.set(new TextEncoder().encode(s), at);
    put(name, 0);
    put('0000644\0', 100);
    put(size.toString(8).padStart(11, '0') + '\0', 124);
    put(type, 156);
    put('ustar\0', 257);
    put(prefix, 345);
    return h;
  };
  const pad = (d: Uint8Array) => {
    const out = new Uint8Array(Math.ceil(d.length / 512) * 512);
    out.set(d);
    return out;
  };
  for (const e of entries) {
    const data = typeof e.data === 'string' ? new TextEncoder().encode(e.data) : e.data;
    if (e.name.length > 100) {
      const rec = ` path=${e.name}\n`;
      const record = new TextEncoder().encode(`${rec.length + String(rec.length).length + 1}${rec}`.replace(/^(\d+)/, (n) => String(Number(n))));
      blocks.push(header('pax', record.length, 'x'), pad(record));
      blocks.push(header(e.name.slice(-90), data.length, '0'));
    } else blocks.push(header(e.name, data.length, '0'));
    blocks.push(pad(data));
  }
  blocks.push(new Uint8Array(1024));
  const out = new Uint8Array(blocks.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const b of blocks) {
    out.set(b, at);
    at += b.length;
  }
  return out;
}

test('sources: repositories by name or URL, anything else as a site', () => {
  assert.deepEqual(parseRemixSource('vercel/next.js'), { kind: 'repo', owner: 'vercel', repo: 'next.js' });
  assert.deepEqual(parseRemixSource('https://github.com/owner/app/tree/dev'), { kind: 'repo', owner: 'owner', repo: 'app', ref: 'dev' });
  assert.deepEqual(parseRemixSource('github.com/owner/app.git'), { kind: 'repo', owner: 'owner', repo: 'app' });
  assert.deepEqual(parseRemixSource('stripe.com/pricing'), { kind: 'site', url: 'https://stripe.com/pricing' });
  assert.equal(parseRemixSource('ftp://example.com'), null);
  assert.equal(parseRemixSource('not a thing'), null);
});

test('a repository tarball becomes text files: top folder dropped, junk and binaries skipped, licence read', () => {
  const long = `app-main/src/${'deep/'.repeat(20)}file.ts`;
  const tgz = gzipSync(tar([
    { name: 'app-main/README.md', data: '# App' },
    { name: 'app-main/LICENSE', data: '\nMIT License\n\nCopyright' },
    { name: 'app-main/src/main.ts', data: 'console.log(1)' },
    { name: 'app-main/node_modules/x/index.js', data: 'x' },
    { name: 'app-main/logo.png', data: new Uint8Array([137, 80, 78, 71]) },
    { name: 'app-main/data.bin', data: new Uint8Array([1, 0, 2]) },
    { name: long, data: 'export {}' },
  ]));
  const snap = snapshotFromTarball(new Uint8Array(tgz));
  assert.deepEqual(Object.keys(snap.files).sort(), ['LICENSE', 'README.md', `src/${'deep/'.repeat(20)}file.ts`, 'src/main.ts']);
  assert.deepEqual(snap.skipped, ['data.bin', 'logo.png', 'node_modules/x/index.js']);
  assert.equal(snap.license, 'MIT License');
  assert.equal(guessEntry(snap.files), 'src/main.ts');
  assert.equal(readTar(tar([{ name: 'a', data: 'b' }]))[0].path, 'a');
});

test('fetching tries HEAD, then main and master; a missing repository says so', async () => {
  const seen: string[] = [];
  const body = gzipSync(tar([{ name: 'r-master/index.js', data: '1' }]));
  const fake = async (url: string) => {
    seen.push(url);
    return url.endsWith('/master') ? new Response(body) : new Response('no', { status: 404 });
  };
  const got = await fetchRepo({ kind: 'repo', owner: 'o', repo: 'r' }, fake);
  assert.deepEqual(seen.map((u) => u.split('/').pop()), ['HEAD', 'main', 'master']);
  assert.equal(got.ref, 'master');
  assert.deepEqual(got.files, { 'index.js': '1' });
  await assert.rejects(fetchRepo({ kind: 'repo', owner: 'o', repo: 'gone' }, async () => new Response('', { status: 404 })), /is it public/);
});

test('a site becomes an outline, and the brief asks for an original rebuild', () => {
  const html = '<html><head><title>Acme Pricing</title></head><body><nav><a href="/">Home</a><a href="/docs">Docs</a></nav><h1>Simple <b>pricing</b></h1><h2>Starter</h2><p>Free forever.</p><h2>Pro</h2></body></html>';
  const o = outlineOf(html, 'https://acme.test/pricing');
  assert.equal(o.title, 'Acme Pricing');
  assert.deepEqual(o.nav, ['Home', 'Docs']);
  assert.deepEqual(o.headings, [{ level: 1, text: 'Simple pricing' }, { level: 2, text: 'Starter' }, { level: 2, text: 'Pro' }]);
  const site = { kind: 'site' as const, url: 'https://acme.test/pricing' };
  const brief = remixBrief(site, 'make it for a bakery', { outline: o });
  assert.match(brief, /inspired by https:\/\/acme\.test\/pricing \("Acme Pricing"\)/);
  assert.match(brief, /What to do: make it for a bakery/);
  assert.match(brief, /- Navigation: Home · Docs\n- Simple pricing\n {2}- Starter/);
  assert.match(brief, /Do not copy its logo, brand name/);
  assert.equal(remixName(site, o), 'acme-pricing-remix');
  const repo = remixBrief({ kind: 'repo', owner: 'o', repo: 'r' }, '', { license: null });
  assert.match(repo, /no licence file: all rights reserved/);
  assert.match(repo, /credit the original repository/);
});
