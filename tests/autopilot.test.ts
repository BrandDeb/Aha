import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.AHA_HOME = mkdtempSync(path.join(tmpdir(), 'aha-autopilot-'));
const { decideRepairs, LIMITS, record, readState, shouldAutoUpdate, updateSettings } = await import('../src/lib/autopilot.ts');
type Snapshot = import('../src/lib/autopilot.ts').Snapshot;
const { healScript, healStaleCode, STALE_CODE } = await import('../src/lib/self-heal.ts');
const require = createRequire(import.meta.url);
const { rollbackUnverifiedUpdate, supervise } = require('../scripts/supervise.js');

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const healthy: Snapshot = { freeDisk: 50 * GB, tempBytes: 10 * MB, cacheBytes: 500 * MB, envBytes: 300 * MB, rss: 200 * MB, loopDelayMs: 20, idleMs: 60 * 60_000, supervised: true };
const on = { autoRepair: true, autoUpdate: false };

test('a healthy studio is left alone', () => {
  assert.deepEqual(decideRepairs(healthy, on), []);
});

test('repairs: leftovers, caches, then environments as the disk gets tighter', () => {
  assert.deepEqual(decideRepairs({ ...healthy, tempBytes: 2 * GB }, on).map((a) => a.kind), ['clean-temp']);
  assert.deepEqual(decideRepairs({ ...healthy, cacheBytes: 6 * GB }, on).map((a) => a.kind), ['prune-uv-cache']);
  assert.deepEqual(decideRepairs({ ...healthy, freeDisk: 1.5 * GB }, on).map((a) => a.kind), ['clean-temp', 'prune-uv-cache']);
  assert.deepEqual(decideRepairs({ ...healthy, freeDisk: 0.5 * GB }, on).map((a) => a.kind), ['clean-temp', 'prune-uv-cache', 'remove-python-envs']);
  assert.match(decideRepairs({ ...healthy, freeDisk: 0.5 * GB }, on)[0].why, /512 MB free/);
  assert.deepEqual(decideRepairs({ ...healthy, tempBytes: 2 * GB }, { ...on, autoRepair: false }), [], 'off means off');
});

test('restarts: only under the supervisor, only when idle', () => {
  const big = { ...healthy, rss: 3 * GB };
  assert.deepEqual(decideRepairs(big, on).map((a) => a.kind), ['restart']);
  assert.match(decideRepairs(big, on)[0].why, /grew to 3\.0 GB/);
  assert.deepEqual(decideRepairs({ ...big, supervised: false }, on), [], 'nothing would start it again');
  assert.deepEqual(decideRepairs({ ...big, idleMs: 60_000 }, on), [], 'someone is working');
  assert.match(decideRepairs({ ...healthy, loopDelayMs: 900 }, on)[0].why, /slow to respond/);
});

test('updates: opt-in, idle, supervised, at most every six hours, never while one is unverified', async () => {
  const now = 10 * LIMITS.updateEveryMs;
  const state = { ...(await readState()), autoUpdate: true };
  assert.equal(shouldAutoUpdate(state, healthy, now), true);
  assert.equal(shouldAutoUpdate({ ...state, autoUpdate: false }, healthy, now), false);
  assert.equal(shouldAutoUpdate(state, { ...healthy, idleMs: 60_000 }, now), false);
  assert.equal(shouldAutoUpdate(state, { ...healthy, supervised: false }, now), false);
  assert.equal(shouldAutoUpdate({ ...state, lastUpdateCheck: now - 60_000 }, healthy, now), false);
  assert.equal(shouldAutoUpdate({ ...state, pendingVerify: { from: 'a', to: 'b', at: now } }, healthy, now), false);
});

test('settings and the journal persist; the journal keeps the latest 50', async () => {
  const saved = await updateSettings({ autoUpdate: true });
  assert.equal(saved.autoUpdate, true);
  assert.equal((await readState()).autoUpdate, true);
  let state = await readState();
  for (let i = 0; i < 60; i++) state = record(state, { kind: 'repair', message: `#${i}` }, i);
  assert.equal(state.journal.length, 50);
  assert.equal(state.journal[0].message, '#59');
});

test('browser: out-of-date code reloads once a minute at most; other errors never', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  let reloads = 0;
  const reload = () => void reloads++;
  for (const m of ['ChunkLoadError: Loading chunk 42 failed.', 'Failed to fetch dynamically imported module: /x.js', 'Failed to load chunk /_next/static/chunks/a.js']) assert.ok(STALE_CODE.test(m), m);
  assert.equal(healStaleCode('TypeError: x is undefined', storage, reload, 1000), false);
  assert.equal(healStaleCode('ChunkLoadError: Loading chunk 7 failed.', storage, reload, 1000), true);
  assert.equal(healStaleCode('ChunkLoadError: Loading chunk 7 failed.', storage, reload, 30_000), false, 'not again within a minute');
  assert.equal(healStaleCode('ChunkLoadError: Loading chunk 7 failed.', storage, reload, 70_000), true);
  assert.equal(reloads, 2);
  assert.doesNotThrow(() => new Function(healScript), 'the inline script is valid JavaScript');
});

test('supervisor: a second crash can trigger a repair, then the studio starts again at once', async () => {
  let starts = 0;
  let repaired = 0;
  const run = supervise({
    command: process.execPath,
    args: ['-e', 'process.exit(1)'],
    baseDelayMs: 10,
    maxCrashes: 3,
    log: () => {},
    onRepeatedCrash: () => {
      repaired++;
      return repaired === 1;
    },
  });
  const origin = run.done.then((code: number) => code);
  const code = await origin;
  starts = repaired;
  assert.equal(code, 1, 'gives up when repairs stop helping');
  assert.ok(starts >= 2, 'asked to repair after repeated crashes');
});

test('rollback: only an unverified update, only if the checkout is still that update', () => {
  const file = path.join(process.env.AHA_HOME!, 'autopilot.json');
  const from = 'a'.repeat(40);
  const to = 'b'.repeat(40);
  const calls: string[] = [];
  const fakeRun = (head: string) => (command: string, args: string[]) => {
    calls.push(`${command} ${args.join(' ')}`);
    if (args[0] === 'rev-parse') return { ok: true, output: `${head}\n` };
    if (args[0] === 'diff') return { ok: true, output: 'package-lock.json\n' };
    return { ok: true, output: '' };
  };
  writeFileSync(file, JSON.stringify({ autoRepair: true, autoUpdate: true, journal: [], pendingVerify: { from, to, at: 1 } }));
  assert.equal(rollbackUnverifiedUpdate('/repo', () => {}, fakeRun(to)), true);
  assert.ok(calls.includes(`git reset --hard ${from}`));
  assert.ok(calls.includes('npm ci --no-audit --no-fund'), 'dependencies changed: reinstalled');
  const after = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(after.pendingVerify, undefined);
  assert.equal(after.journal[0].kind, 'rollback');

  // Someone moved the checkout since: hands off
  calls.length = 0;
  writeFileSync(file, JSON.stringify({ journal: [], pendingVerify: { from, to, at: 1 } }));
  assert.equal(rollbackUnverifiedUpdate('/repo', () => {}, fakeRun('c'.repeat(40))), false);
  assert.ok(!calls.some((c) => c.startsWith('git reset')));
  // Nothing pending: nothing to do
  writeFileSync(file, JSON.stringify({ journal: [] }));
  assert.equal(rollbackUnverifiedUpdate('/repo', () => {}, fakeRun(to)), false);
});
