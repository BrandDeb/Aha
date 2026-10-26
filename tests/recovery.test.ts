import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CRASHES_KEY, LAST_GOOD_KEY, WORKSPACE_KEY, exportWorkspace, hasLastGood, markHealthy, recordCrash, resetSettings, restoreLastGood } from '../src/workspace/recovery.ts';

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
  removeItem(k: string) { this.data.delete(k); }
}

const workspace = (files: Record<string, string>) => JSON.stringify({ project: { name: 'p', files, folders: [], entry: 'a.ts' }, tabs: [], active: 'a.ts' });

test('a workspace that stayed up becomes the version to fall back to', () => {
  const s = new MemoryStorage();
  s.setItem(WORKSPACE_KEY, workspace({ 'a.ts': '1' }));
  s.setItem(CRASHES_KEY, '[1,2]');
  markHealthy(s);
  assert.equal(s.getItem(LAST_GOOD_KEY), workspace({ 'a.ts': '1' }));
  assert.equal(s.getItem(CRASHES_KEY), null, 'a healthy start clears the crash count');
  assert.equal(hasLastGood(s), true);
});

test('markHealthy never overwrites the good copy with something broken or empty', () => {
  const s = new MemoryStorage();
  s.setItem(LAST_GOOD_KEY, workspace({ 'a.ts': 'good' }));
  for (const bad of ['{not json', '{}', JSON.stringify({ project: { files: {} } }), JSON.stringify({ project: {} }), 'null']) {
    s.setItem(WORKSPACE_KEY, bad);
    markHealthy(s);
    assert.equal(s.getItem(LAST_GOOD_KEY), workspace({ 'a.ts': 'good' }), bad);
  }
});

test('restoring brings back the good copy and keeps the broken one aside', () => {
  const s = new MemoryStorage();
  s.setItem(LAST_GOOD_KEY, workspace({ 'a.ts': 'good' }));
  s.setItem(WORKSPACE_KEY, '{corrupt');
  assert.equal(restoreLastGood(s), true);
  assert.equal(s.getItem(WORKSPACE_KEY), workspace({ 'a.ts': 'good' }));
  assert.equal(s.getItem(`${WORKSPACE_KEY}:before-restore`), '{corrupt');
  assert.equal(restoreLastGood(new MemoryStorage()), false, 'nothing to restore');
});

test('crashes are counted within a ten minute window', () => {
  const s = new MemoryStorage();
  const t = 1_000_000;
  assert.equal(recordCrash(s, t), 1);
  assert.equal(recordCrash(s, t + 60_000), 2);
  assert.equal(recordCrash(s, t + 120_000), 3);
  assert.equal(recordCrash(s, t + 13 * 60_000), 1, 'older crashes no longer count');
  s.setItem(CRASHES_KEY, 'garbage');
  assert.equal(recordCrash(s, t), 1);
});

test('resetting settings leaves projects and keys alone', () => {
  const s = new MemoryStorage();
  s.setItem('aha:settings', '{"appearance":{}}');
  s.setItem('aha:appearance-vars', '{}');
  s.setItem(WORKSPACE_KEY, workspace({ 'a.ts': '1' }));
  s.setItem('aha:ai', '{"keys":{"groq":"k"}}');
  s.setItem('aha:connectors', '[]');
  resetSettings(s);
  assert.deepEqual([...s.data.keys()].sort(), ['aha:ai', 'aha:connectors', WORKSPACE_KEY].sort());
});

test('export hands over the workspace, or the good copy when it is gone', () => {
  const s = new MemoryStorage();
  assert.equal(exportWorkspace(s), null);
  s.setItem(LAST_GOOD_KEY, workspace({ 'a.ts': 'good' }));
  assert.equal(exportWorkspace(s), workspace({ 'a.ts': 'good' }));
  s.setItem(WORKSPACE_KEY, workspace({ 'a.ts': 'current' }));
  assert.equal(exportWorkspace(s), workspace({ 'a.ts': 'current' }));
});
