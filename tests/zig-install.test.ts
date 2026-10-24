import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

// The studio home is read when the module loads
const home = mkdtempSync(path.join(tmpdir(), 'nanocli-home-'));
process.env.NANOCLI_HOME = home;
const { ensureZig, packageFiles, verifyIntegrity, zigHome, zigPackage } = await import('../src/lib/zig-install.ts');

/** A minimal npm tarball: ustar entries under package/, gzipped */
function tarball(files: Record<string, string>): Buffer {
  const blocks: Buffer[] = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write('0000644\0', 100);
    header.write('0000000\0', 108);
    header.write('0000000\0', 116);
    header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    header.write('00000000000\0', 136);
    header.write('        ', 148);
    header.write('0', 156);
    header.write('ustar\0', 257);
    header.write('00', 263);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

const integrity = (data: Buffer) => `sha512-${createHash('sha512').update(data).digest('base64')}`;

function fakeRegistry(packages: Record<string, { tgz: Buffer; integrity?: string }>) {
  const calls: string[] = [];
  const fetchImpl = async (url: string) => {
    calls.push(url);
    for (const [name, pkg] of Object.entries(packages)) {
      const meta = `https://registry.npmjs.org/${name.replace('/', '%2f')}/0.17.0`;
      const tarballUrl = `https://registry.npmjs.org/${name}/-/x-0.17.0.tgz`;
      if (url === meta) return new Response(JSON.stringify({ dist: { tarball: tarballUrl, integrity: pkg.integrity ?? integrity(pkg.tgz) } }));
      if (url === tarballUrl) return new Response(new Uint8Array(pkg.tgz));
    }
    return new Response('not found', { status: 404 });
  };
  return { fetchImpl, calls };
}

function studioRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'studio-'));
  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ optionalDependencies: { '@zigc/lib': '0.17.0' } }));
  return root;
}

test('integrity: sha512 from the registry, nothing else', () => {
  const data = Buffer.from('zig');
  assert.equal(verifyIntegrity(data, integrity(data)), true);
  assert.equal(verifyIntegrity(Buffer.from('zag'), integrity(data)), false);
  assert.equal(verifyIntegrity(data, 'sha1-abc'), false);
});

test('a package may not write outside its folder', () => {
  assert.throws(() => packageFiles(tarball({ 'package/../../evil': 'x' })), /Unsafe path/);
  assert.deepEqual(Object.keys(packageFiles(tarball({ 'package/bin/zig': '#!', 'other/x': 'ignored' }))), ['bin/zig']);
});

test('fetched once, verified, laid out where the compiler looks, then reused', async () => {
  const root = studioRoot();
  const registry = fakeRegistry({
    '@zigc/lib': { tgz: tarball({ 'package/compiler_rt.zig': '// rt', 'package/std/std.zig': '// std' }) },
    [zigPackage()]: { tgz: tarball({ 'package/bin/zig': '#!/bin/sh\necho zig', 'package/package.json': '{}' }) },
  });
  const logs: string[] = [];
  const found = await ensureZig({ root, fetchImpl: registry.fetchImpl, log: (l) => logs.push(l) });
  assert.equal(found, zigHome('0.17.0'));
  const bin = path.join(found, 'node_modules', zigPackage(), 'bin', process.platform === 'win32' ? 'zig.exe' : 'zig');
  if (process.platform !== 'win32') assert.equal(readFileSync(bin, 'utf8'), '#!/bin/sh\necho zig');
  assert.ok(existsSync(path.join(found, 'node_modules', '@zigc', 'lib', 'std', 'std.zig')));
  assert.match(logs[0], /about 90 MB/);
  // Second time: nothing downloaded
  const before = registry.calls.length;
  if (process.platform !== 'win32') assert.equal(await ensureZig({ root, fetchImpl: registry.fetchImpl }), found);
  assert.equal(registry.calls.length, before);
  rmSync(root, { recursive: true, force: true });
});

test('a tampered download is refused and leaves nothing behind', async () => {
  rmSync(path.join(home, 'zig'), { recursive: true, force: true });
  const root = studioRoot();
  const registry = fakeRegistry({ '@zigc/lib': { tgz: tarball({ 'package/compiler_rt.zig': 'x' }), integrity: integrity(Buffer.from('something else')) } });
  await assert.rejects(ensureZig({ root, fetchImpl: registry.fetchImpl, log: () => {} }), /doesn't match the registry's checksum/);
  assert.equal(existsSync(path.join(zigHome('0.17.0'), 'node_modules', '@zigc', 'lib')), false);
  rmSync(root, { recursive: true, force: true });
});

test('a zig installed with the studio is used as is', async () => {
  const root = studioRoot();
  const bin = path.join(root, 'node_modules', zigPackage(), 'bin');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(bin, { recursive: true });
  writeFileSync(path.join(bin, process.platform === 'win32' ? 'zig.exe' : 'zig'), '');
  assert.equal(await ensureZig({ root, fetchImpl: async () => { throw new Error('no network needed'); } }), root);
  rmSync(root, { recursive: true, force: true });
});
