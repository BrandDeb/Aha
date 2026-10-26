import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adoptLegacyEnv, migrateProjectFiles, migrateStorage, storageMigrationScript } from '../src/lib/legacy-names.ts';

function memoryStore(initial: Record<string, string>) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    get length() {
      return data.size;
    },
    // Browsers don't promise an order; sorted makes new keys land between old ones, shifting indices
    key: (i: number) => [...data.keys()].sort()[i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
}

test('browser storage: nanocli:* moves to aha:*, the new value wins, other keys stay', () => {
  const store = memoryStore({ 'nanocli:settings': '{"theme":"light"}', 'nanocli:worker-done:my-cli': '[]', 'aha:ai': 'new', 'nanocli:ai': 'old', other: 'x' });
  assert.equal(migrateStorage(store), 3);
  assert.deepEqual(Object.fromEntries(store.data), { 'aha:settings': '{"theme":"light"}', 'aha:worker-done:my-cli': '[]', 'aha:ai': 'new', other: 'x' });
  assert.equal(migrateStorage(store), 0, 'runs once');
});

test('the page script is self-contained and does the same', () => {
  const store = memoryStore({ 'nanocli:settings': '{}', 'nanocli:welcomed': '1', 'nanocli:workspace': '{}' });
  new Function('localStorage', storageMigrationScript)(store);
  assert.deepEqual([...store.data.keys()].sort(), ['aha:settings', 'aha:welcomed', 'aha:workspace']);
});

test('project files: .nanocli/ moves to .aha/ unless already there', () => {
  const files = { 'src/a.ts': 'a', '.nanocli/watchers.json': 'old', '.nanocli/why.json': 'why', '.aha/watchers.json': 'new' };
  assert.deepEqual(migrateProjectFiles(files), { 'src/a.ts': 'a', '.aha/watchers.json': 'new', '.aha/why.json': 'why' });
  const clean = { 'src/a.ts': 'a' };
  assert.equal(migrateProjectFiles(clean), clean, 'nothing to do: the same object');
});

test('settings variables: NANOCLI_* still work as AHA_*, a new one wins', () => {
  const env: Record<string, string | undefined> = { NANOCLI_PYTHON: '0', NANOCLI_HOME: '/old', AHA_HOME: '/new', PATH: '/bin' };
  assert.deepEqual(adoptLegacyEnv(env), ['AHA_PYTHON']);
  assert.equal(env.AHA_PYTHON, '0');
  assert.equal(env.AHA_HOME, '/new');
});
