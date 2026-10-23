import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

process.env.NANOCLI_HOME = mkdtempSync(path.join(tmpdir(), 'nanocli-live-'));
const { instrument } = await import('../src/lib/live/instrument.ts');
const { runLive, parseLiveRequest } = await import('../src/lib/live/run.ts');

const TS = `import { total } from './cart';

const prices = [3, 4, 5];
let sum = 0;
for (const p of prices) {
  sum += p;
}
if (sum > 100) {
  console.log('big');
} else {
  console.log('small', total(prices));
}
const double = (x: number) => x * 2;
console.log(double(sum));
`;
const CART = `export function total(items: number[]): number {
  let t = 0;
  for (let i = 0; i < items.length; i++) t += items[i];
  return t;
}
`;

test('instrumenting keeps the program and marks its statements', () => {
  const { code, statementLines } = instrument(0, 'main.ts', TS);
  assert.deepEqual(statementLines, [3, 4, 5, 6, 8, 9, 11, 13, 14]);
  assert.match(code, /__h\(0, 3\)/);
  assert.match(code, /__v\(0, 6, "sum", sum\)/);
  assert.match(code, /require\("\.\/cart"\)/, 'imports become CommonJS requires');
});

test('live values: hits, values, loop variables, returns, lines never run', async () => {
  const r = await runLive({ projectId: 'live-test-ts1', files: { 'main.ts': TS, 'cart.ts': CART }, entry: 'main.ts', args: [] });
  assert.equal(r.ok, true, r.error ?? r.output);
  assert.match(r.output, /small 12\n24/);
  const main = r.files['main.ts'];
  assert.equal(main.lines[6].hits, 3);
  assert.deepEqual(main.lines[6].values.sum.first, ['3', '7', '12']);
  assert.deepEqual(main.lines[5].values.p.first, ['3', '4', '5'], 'the loop variable of each iteration');
  assert.equal(main.lines[9], undefined, 'the branch that was never taken');
  assert.ok(main.statementLines.includes(9));
  assert.equal(main.lines[13].values.return.last, '24', 'what the arrow returned');
  const cart = r.files['cart.ts'];
  assert.equal(cart.lines[4].values.return.last, '12');
  assert.equal(cart.lines[3].hits, 4, 'the loop once, its one-line body three times');
  assert.deepEqual(cart.lines[3].values.t.first, ['3', '7', '12']);
  assert.equal(main.lines[13].values.double, undefined, 'a function value says nothing');
  assert.equal(main.lines[11].values.out.last, 'small 12', 'what a line printed, even when it called into another file first');
  assert.equal(main.lines[14].values.out.last, '24');
});

test('live values: a program that never ends still shows the start of the run', async () => {
  const r = await runLive({ projectId: 'live-test-ts2', files: { 'main.js': 'let i = 0;\nwhile (true) {\n  i++;\n}\n' }, entry: 'main.js', args: [] }, { timeoutMs: 8000 });
  assert.equal(r.truncated, true);
  assert.ok(r.files['main.js'].lines[3].hits > 1000);
});

test('live values: Python, by line, with what changed', async () => {
  const py = 'def total(items):\n    t = 0\n    for x in items:\n        t += x\n    return t\n\nprices = [3, 4, 5]\nresult = total(prices)\nif result > 100:\n    print("big")\nprint(result)\n';
  const r = await runLive({ projectId: 'live-test-py1', files: { 'main.py': py }, entry: 'main.py', args: [] });
  assert.equal(r.ok, true, r.error ?? r.output);
  assert.equal(r.output.trim(), '12');
  const lines = r.files['main.py'].lines;
  assert.equal(lines[4].hits, 3);
  assert.deepEqual(lines[4].values.t.first, ['3', '7', '12']);
  assert.equal(lines[5].values.return.last, '12');
  assert.equal(lines[8].values.result.last, '12');
  assert.equal(lines[10], undefined, 'never ran');
  assert.equal(lines[11].values.out.last, '12', 'what it printed');
  assert.ok(r.files['main.py'].statementLines.includes(10));
});

test('requests: only supported entry files', () => {
  assert.match((parseLiveRequest({ projectId: 'abcdefgh1', files: { 'main.go': '' }, entry: 'main.go' }) as { error: string }).error, /TypeScript, JavaScript and Python/);
  assert.ok(!('error' in parseLiveRequest({ projectId: 'abcdefgh1', files: { 'a.ts': '' }, entry: 'a.ts', args: ['x'] })));
});

test('live values: top-level await, ES module files, and where an error was thrown', async () => {
  const tla = await runLive({ projectId: 'live-test-ts3', files: { 'main.mts': "import { two } from './two.mts';\nconst v = await Promise.resolve(two());\nconsole.log(v);\n", 'two.mts': 'export const two = () => 2;\n', 'package.json': '{"type":"module"}' }, entry: 'main.mts', args: [] });
  assert.equal(tla.ok, true, tla.output);
  assert.equal(tla.files['main.mts'].lines[2].values.v.last, '2');
  const err = await runLive({ projectId: 'live-test-ts4', files: { 'main.ts': "function f(): number {\n  throw new Error('boom');\n}\nf();\n" }, entry: 'main.ts', args: [] });
  assert.equal(err.ok, false);
  assert.equal(err.files['main.ts'].lines[2].values.threw.last, 'Error: boom');
  assert.match(err.output, /at f \(main\.ts\)/, 'the trace names the project file');
  assert.doesNotMatch(err.output, /__h|\.nanocli-live|node:internal/);
});

test('live values: Python errors land on the line that raised them', async () => {
  const r = await runLive({ projectId: 'live-test-py2', files: { 'main.py': 'def f(x):\n    return 10 / x\n\nf(0)\n' }, entry: 'main.py', args: [] });
  assert.equal(r.ok, false);
  assert.equal(r.files['main.py'].lines[2].values.threw.last, 'ZeroDivisionError: division by zero');
  assert.equal(r.files['main.py'].lines[2].values.return, undefined, 'a function that raised returned nothing');
  assert.doesNotMatch(r.output, /tracer\.py|runpy/);
});

test('display: a line reads as its values, a loop as a sequence, and unrun lines are listed', async () => {
  const { liveView, liveSummary } = await import('../src/lib/live/display.ts');
  const view = liveView({
    statementLines: [1, 2, 3, 4],
    lines: {
      1: { hits: 1, values: { prices: { n: 1, first: ['[3, 4, 5]'], last: '[3, 4, 5]' } } },
      2: { hits: 5, values: { sum: { n: 5, first: ['3', '7', '12', '20', '30'], last: '30' } } },
      3: { hits: 1, values: { threw: { n: 1, first: ['Error: boom'], last: 'Error: boom' }, out: { n: 1, first: ['hi'], last: 'hi' } } },
    },
  });
  assert.deepEqual(view.unrun, [4]);
  assert.equal(view.lines[0].text, 'prices = [3, 4, 5]');
  assert.equal(view.lines[1].text, 'sum = 3, 7, 12, … 30   ×5');
  assert.equal(view.lines[2].kind, 'threw');
  assert.equal(view.lines[2].text, '✕ Error: boom   → hi');
  assert.equal(liveSummary({ ok: true, files: {}, output: '', code: 0, ms: 140 }), 'Ran in 140 ms');
  assert.match(liveSummary({ ok: false, files: {}, output: '', code: 124, ms: 4100, truncated: true }), /start of the run/);
});
