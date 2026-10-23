import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeWhy, linesWritten, parseWhy, recordWhy, whyByLine, WHY_FILE } from '../src/lib/why.ts';

const before = 'export function total(items: number[]) {\n  let t = 0;\n  for (const x of items) t += x;\n  return t;\n}\n';
const after = 'export function total(items: number[]) {\n  if (items.length === 0) {\n    return 0;\n  }\n  let t = 0;\n  for (const x of items) t += x;\n  return t;\n}\n';

test('the lines a proposal wrote: meaningful ones, normalized, per file', () => {
  const written = linesWritten([
    { path: 'cart.ts', kind: 'modified', before, after },
    { path: 'gone.ts', kind: 'deleted', before: 'x', after: '' },
    { path: 'agent/lessons.md', kind: 'added', before: '', after: '- build first' },
  ], (p) => !p.startsWith('agent/'));
  assert.deepEqual(written, { 'cart.ts': ['if (items.length === 0) {', 'return 0;'] }, 'a lone brace is not worth remembering');
});

test('recorded newest first, and found again after the code moved and was re-indented', () => {
  let text = recordWhy(undefined, { id: 'a', at: 1000, goal: 'Handle an empty cart', origin: 'you', verdict: 'Verified', files: { 'cart.ts': ['if (items.length === 0) {', 'return 0;'] } });
  text = recordWhy(text, { id: 'b', at: 2000, goal: 'Return 0 explicitly', origin: 'worker', files: { 'cart.ts': ['return 0;'] } });
  const entries = parseWhy(text);
  assert.deepEqual(entries.map((e) => e.id), ['b', 'a']);
  const moved = '// header\n\nexport function total(items: number[]) {\n    if (items.length === 0) {\n        return 0;\n    }\n    return items.reduce((a, b) => a + b, 0);\n}\n';
  const lines = whyByLine(entries, 'cart.ts', moved);
  assert.equal(lines.get(4)?.id, 'a');
  assert.equal(lines.get(5)?.id, 'b', 'the newest entry that wrote a line explains it');
  assert.equal(lines.has(7), false, 'a line you wrote yourself has no entry');
  assert.equal(whyByLine(entries, 'other.ts', moved).size, 0);
  assert.match(describeWhy(entries[1], 1000 + 3 * 3600_000), /^\*\*Why this line:\*\* Handle an empty cart\n\nyou asked the agent · accepted 3 h ago · Verified/);
  assert.deepEqual(parseWhy('not json'), []);
  assert.equal(WHY_FILE, '.nanocli/why.json');
});
