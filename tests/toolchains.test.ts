import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// The studio's toolchain folder lives under AHA_HOME: a throwaway one here
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-tools-'));
process.env.AHA_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));
const { applyManaged, checksumFor, compareVersions, installMise, MANAGED, miseAsset, miseBin, miseEnv, miseVersion, pinFor } = await import('../src/lib/toolchains.ts');
const { LANGUAGES } = await import('../src/lib/languages.ts');

test('pins: majors from 1.0, minors before it, channels as they are', () => {
  assert.equal(pinFor('1.27.3'), '1');
  assert.equal(pinFor('25.0.4+101.0.LTS'), '25');
  assert.equal(pinFor('0.16.0'), '0.16', 'zig 0.x minors break things, so they are the line');
  assert.equal(pinFor('v2.21.0'), '2');
  assert.equal(pinFor('mainnet-v1.81.1'), 'mainnet');
  assert.equal(pinFor('stable'), 'stable');
  assert.equal(pinFor('weird_version'), 'latest');
});

test('versions sort numerically', () => {
  assert.deepEqual(['1.9.0', '1.10.0', '1.2.3'].sort(compareVersions), ['1.2.3', '1.9.0', '1.10.0']);
  assert.ok(compareVersions('25.0.4+101', '25.0.4+9') > 0);
});

test('mise download: the right asset per platform, and its checksum from SHASUMS256.txt', () => {
  assert.equal(miseAsset('2026.10.17', 'linux', 'x64', false), 'mise-v2026.10.17-linux-x64.tar.gz');
  assert.equal(miseAsset('2026.10.17', 'linux', 'arm64', true), 'mise-v2026.10.17-linux-arm64-musl.tar.gz');
  assert.equal(miseAsset('2026.10.17', 'darwin', 'arm64'), 'mise-v2026.10.17-macos-arm64.tar.gz');
  assert.equal(miseAsset('2026.10.17', 'win32', 'x64'), 'mise-v2026.10.17-windows-x64.zip');
  assert.equal(miseAsset('2026.10.17', 'linux', 'ia32'), null);
  const sums = `${'a'.repeat(64)}  ./mise-v1-linux-x64.tar.gz\n${'b'.repeat(64)}  mise-v1-macos-arm64.tar.gz\nnot a line\n${'c'.repeat(63)}  short.tar.gz\n`;
  assert.equal(checksumFor(sums, 'mise-v1-linux-x64.tar.gz'), 'a'.repeat(64));
  assert.equal(checksumFor(sums, 'mise-v1-macos-arm64.tar.gz'), 'b'.repeat(64));
  assert.equal(checksumFor(sums, 'short.tar.gz'), null);
  assert.equal(checksumFor(sums, 'missing.zip'), null);
});

test('mise runs isolated: its own folders, never the user’s mise settings or ~/.rustup', () => {
  const env = miseEnv({ PATH: '/usr/bin', MISE_DATA_DIR: '/home/me/.local/share/mise', MISE_ENV: 'prod', HOME: '/home/me' });
  assert.ok(env.MISE_DATA_DIR.endsWith(path.join('mise', 'data')));
  assert.notEqual(env.MISE_DATA_DIR, '/home/me/.local/share/mise');
  assert.equal(env.MISE_ENV, undefined, 'the user’s MISE_* settings are dropped');
  assert.ok(env.MISE_RUSTUP_HOME.endsWith(path.join('mise', 'rustup')));
  assert.equal(env.MISE_YES, '1');
  assert.equal(env.PATH, '/usr/bin');
});

test('managed toolchains: after the system’s own on PATH, their variables only when the tool is theirs', () => {
  const managed = { paths: ['/studio/mise/data/installs/java/25/bin', '/studio/mise/data/installs/go/1/bin'], vars: { JAVA_HOME: '/studio/java', GOROOT: '/studio/go', RUSTUP_HOME: '/studio/rustup', CARGO_HOME: '/studio/cargo', EXTRA: 'x' } };
  const systemHas = new Set(['cargo']);
  const env = applyManaged({ PATH: '/usr/bin', CARGO_HOME: '/cache/cargo' }, (bin) => systemHas.has(bin), managed);
  assert.equal(env.PATH, '/usr/bin:/studio/mise/data/installs/java/25/bin:/studio/mise/data/installs/go/1/bin');
  assert.equal(env.JAVA_HOME, '/studio/java', 'no system java: the studio’s needs JAVA_HOME');
  assert.equal(env.RUSTUP_HOME, undefined, 'a system cargo keeps its own rustup');
  assert.equal(env.GOROOT, undefined, 'never point a go at another GOROOT');
  assert.equal(env.CARGO_HOME, '/cache/cargo', 'existing variables are not overwritten');
  assert.equal(env.EXTRA, 'x');
  const again = applyManaged({ PATH: '/usr/bin:/studio/mise/data/installs/go/1/bin' }, () => false, managed);
  assert.equal(again.PATH.split(':').filter((p) => p.includes('/go/')).length, 1, 'no duplicate entries');
});

test('every installable language exists, and what it needs is installable too', () => {
  const ids = new Set(LANGUAGES.map((l) => l.id));
  for (const [id, spec] of Object.entries(MANAGED)) {
    assert.ok(ids.has(id) || ['erlang', 'uv'].includes(id) || id === 'java', `${id} is a language or a shared runtime`);
    for (const need of spec.needs ?? []) assert.ok(MANAGED[need], `${id} needs ${need}, which must be installable`);
    assert.ok(spec.size, `${id} says how big it is`);
  }
});

test('mise installs from its mirror, checksum verified, and runs', { skip: process.env.AHA_TEST_NETWORK !== '1', timeout: 10 * 60_000 }, async () => {
  const lines: string[] = [];
  const version = await installMise((t) => lines.push(t));
  assert.match(version, /^\d{4}\.\d+\.\d+$/);
  assert.ok(lines.join('').includes('checksum verified'));
  assert.ok(miseBin().startsWith(home));
  assert.equal(await miseVersion(), version);
});
