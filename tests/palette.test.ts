import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paletteOrder, SUGGESTED } from '../src/workspace/palette.ts';

const cmd = (id: string, s = 0) => ({ kind: 'command' as const, id, s });
const file = (id: string, s = 0.5) => ({ kind: 'file' as const, id, s });

test('palette: empty shows recent, then suggested, then files, then the rest', () => {
  const items = [cmd('build.output.wat'), cmd('prefs.settings'), cmd('file.new-project'), cmd('agent.ask'), cmd('view.zen'), file('src/main.ts')];
  const order = paletteOrder(items, '', ['view.zen']);
  assert.deepEqual(order.map((i) => `${i.section}:${i.id}`), ['Recent:view.zen', 'Suggested:file.new-project', 'Suggested:agent.ask', 'Suggested:prefs.settings', 'Files:src/main.ts', 'Commands:build.output.wat']);
  assert.equal(SUGGESTED[0], 'file.new-project');
});

test('palette: typing ranks every match by score and drops misses', () => {
  const order = paletteOrder([cmd('a', 5), cmd('b', Infinity), file('c', 0.5)], 'x', []);
  assert.deepEqual(order.map((i) => i.id), ['c', 'a']);
  assert.deepEqual(order.map((i) => i.section), ['Files', 'Commands']);
});
