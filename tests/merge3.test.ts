import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conflictCount, hasMarkers, joinMerge, matchLines, merge3, mergeProjects } from '../src/lib/merge3.ts';

const L = (...l: string[]) => l.join('\n');

test('matchLines finds the longest run of equal lines', () => {
  assert.deepEqual(matchLines(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd']), [[0, 0], [2, 2], [3, 3]]);
  assert.deepEqual(matchLines([], ['a']), []);
  assert.deepEqual(matchLines(['a', 'b'], ['b', 'a']).length, 1);
  // Random cases: every pair is equal and strictly increasing
  for (let n = 0; n < 200; n++) {
    const rand = () => Array.from({ length: Math.floor(Math.random() * 30) }, () => 'abcde'[Math.floor(Math.random() * 5)]);
    const a = rand();
    const b = rand();
    const pairs = matchLines(a, b);
    pairs.forEach(([i, j], k) => {
      assert.equal(a[i], b[j]);
      if (k) assert.ok(i > pairs[k - 1][0] && j > pairs[k - 1][1]);
    });
  }
});

test('changes in different places merge on their own', () => {
  const base = L('import x', '', 'function a() {', '  return 1', '}', '', 'function b() {', '  return 2', '}', '');
  const ours = base.replace('return 1', 'return 10');
  const theirs = base.replace('return 2', 'return 20').replace('import x', 'import x\nimport y');
  const chunks = merge3(base, ours, theirs);
  assert.equal(conflictCount(chunks), 0);
  assert.equal(joinMerge(chunks), L('import x', 'import y', '', 'function a() {', '  return 10', '}', '', 'function b() {', '  return 20', '}', ''));
});

test('the same change on both sides is not a conflict; different changes to one line are', () => {
  const base = L('a', 'b', 'c');
  assert.equal(conflictCount(merge3(base, L('a', 'B', 'c'), L('a', 'B', 'c'))), 0);
  const chunks = merge3(base, L('a', 'mine', 'c'), L('a', 'theirs', 'c'));
  assert.equal(conflictCount(chunks), 1);
  assert.deepEqual(chunks[1], { kind: 'conflict', base: ['b'], ours: ['mine'], theirs: ['theirs'] });
  assert.equal(joinMerge(chunks), L('a', '<<<<<<< yours', 'mine', '=======', 'theirs', '>>>>>>> theirs', 'c'));
  assert.ok(hasMarkers(joinMerge(chunks)));
  assert.equal(joinMerge(chunks, ['ours']), L('a', 'mine', 'c'));
  assert.equal(joinMerge(chunks, ['theirs']), L('a', 'theirs', 'c'));
  assert.equal(joinMerge(chunks, ['both']), L('a', 'mine', 'theirs', 'c'));
  assert.equal(joinMerge(chunks, ['base']), L('a', 'b', 'c'));
});

test('one side unchanged takes the other whole; additions at both ends combine', () => {
  const base = L('x', 'y');
  assert.equal(joinMerge(merge3(base, base, L('x', 'y', 'z'))), L('x', 'y', 'z'));
  assert.equal(joinMerge(merge3(base, L('w', 'x', 'y'), base)), L('w', 'x', 'y'));
  assert.equal(joinMerge(merge3(base, L('w', 'x', 'y'), L('x', 'y', 'z'))), L('w', 'x', 'y', 'z'));
  assert.equal(joinMerge(merge3('', 'a', 'a')), 'a');
  assert.equal(conflictCount(merge3('', 'a', 'b')), 1, 'both created the file differently');
});

test('whole projects: theirs, ours, merged, conflicts and deletions', () => {
  const base = { 'a.ts': L('1', '2', '3'), 'b.ts': 'b', 'c.ts': 'c', 'gone.ts': 'g', 'edit-vs-delete.ts': 'e' };
  const ours = { 'a.ts': L('1x', '2', '3'), 'b.ts': 'b-mine', 'c.ts': 'c', 'gone.ts': 'g', 'edit-vs-delete.ts': 'e2', 'new-mine.ts': 'n' };
  const theirs = { 'a.ts': L('1', '2', '3y'), 'b.ts': 'b-theirs', 'c.ts': 'c-theirs', 'edit-vs-delete.ts': undefined as unknown as string, 'new-theirs.ts': 't' };
  delete (theirs as Record<string, string>)['edit-vs-delete.ts'];
  const r = mergeProjects(base, ours, theirs);
  assert.equal(r.files['a.ts'], L('1x', '2', '3y'));
  assert.equal(r.files['c.ts'], 'c-theirs');
  assert.deepEqual(r.removed, ['gone.ts']);
  assert.equal(r.files['new-mine.ts'], 'n');
  assert.equal(r.files['new-theirs.ts'], 't');
  assert.deepEqual(r.conflicts.map((c) => c.path), ['b.ts', 'edit-vs-delete.ts']);
  assert.deepEqual(r.summary, { theirs: ['c.ts', 'gone.ts', 'new-theirs.ts'], merged: ['a.ts'], ours: ['new-mine.ts'] });
  assert.ok(hasMarkers(r.files['b.ts']));
});

test('large files merge quickly', () => {
  const base = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
  const ours = [...base];
  ours[100] = 'ours';
  const theirs = [...base];
  theirs[19000] = 'theirs';
  const started = Date.now();
  const chunks = merge3(base.join('\n'), ours.join('\n'), theirs.join('\n'));
  assert.equal(conflictCount(chunks), 0);
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
  const merged = joinMerge(chunks).split('\n');
  assert.deepEqual([merged[100], merged[19000]], ['ours', 'theirs']);
});
