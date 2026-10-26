import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeMoment, findStep, firstError, momentAt } from '../src/lib/live/rewind.ts';
import type { LiveStep } from '../src/lib/live/shared.ts';

const steps: LiveStep[] = [
  { file: 'main.ts', line: 1, values: { total: '0' } },
  { file: 'main.ts', line: 2, values: { n: '3' } },
  { file: 'main.ts', line: 3, values: { total: '3' } },
  { file: 'main.ts', line: 2, values: { n: '4' } },
  { file: 'main.ts', line: 3, values: { total: '7' } },
  { file: 'main.ts', line: 5, values: { out: 'total 7' } },
  { file: 'main.ts', line: 6, values: { threw: 'Error: boom' } },
];

test('rewind: the state at a moment is the latest value of each variable up to it', () => {
  const m = momentAt(steps, 3)!;
  assert.deepEqual(m.state.map((v) => `${v.name}=${v.value}${v.changed ? '*' : ''}`), ['n=4*', 'total=3']);
  assert.deepEqual(momentAt(steps, 5)!.effects, [{ kind: 'out', value: 'total 7' }]);
  assert.deepEqual(momentAt(steps, 5)!.printed, ['total 7']);
  assert.equal(momentAt(steps, 99)!.index, 6);
  assert.equal(momentAt([], 0), null);
});

test('rewind: jump to where a variable changes or a line runs, and to the crash', () => {
  assert.equal(findStep(steps, 0, 1, { name: 'total' }), 2);
  assert.equal(findStep(steps, 4, -1, { name: 'total' }), 2);
  assert.equal(findStep(steps, 0, 1, { line: 3 }), 2);
  assert.equal(findStep(steps, 5, 1, { name: 'n' }), null);
  assert.equal(firstError(steps), 6);
});

test('rewind: a moment described for the assistant', () => {
  const text = describeMoment(momentAt(steps, 4)!, steps.length, 'let total = 0;\nfor (const n of [3, 4]) {\n  total += n;\n}');
  assert.match(text, /^Step 5 of 7 of the run: main\.ts line 3: `total \+= n;`\./);
  assert.match(text, /- total = 7 \(just set\)/);
  assert.match(text, /- n = 4 \(set at main\.ts:2\)/);
});
