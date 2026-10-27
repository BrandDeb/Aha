import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTrace, testPathFor, traceBrief, traceKind } from '../src/lib/tracefix.ts';

const PY = `Traceback (most recent call last):
  File "/srv/app/main.py", line 12, in <module>
    print(cart.total([]))
  File "/srv/app/cart.py", line 4, in total
    return sum(items) / len(items)
ZeroDivisionError: division by zero`;

const NODE = `TypeError: Cannot read properties of undefined (reading 'price')
    at total (/var/task/src/cart.js:3:42)
    at Array.reduce (<anonymous>)
    at handler (/var/task/src/index.js:8:15)
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)`;

const pyFiles = { 'main.py': 'import cart\n\nprint(cart.total([]))\n', 'cart.py': 'def total(items):\n    """Average price"""\n\n    return sum(items) / len(items)\n' };
const nodeFiles = { 'src/index.js': "import { total } from './cart.js';\n", 'src/cart.js': 'export function total(items) {\n  return items.reduce(\n    (n, i) => n + i.price, 0);\n}\n' };

test('traceKind tells Python, Node and plain logs apart', () => {
  assert.equal(traceKind(PY), 'python');
  assert.equal(traceKind(NODE), 'node');
  assert.equal(traceKind('2026-10-27 ERROR payment failed for order 42'), 'log');
});

test('Python frames map to project files, innermost first, with the exception as the title', () => {
  const t = parseTrace(PY, Object.keys(pyFiles));
  assert.equal(t.kind, 'python');
  assert.equal(t.title, 'ZeroDivisionError: division by zero');
  assert.deepEqual(t.frames, [{ file: 'cart.py', line: 4 }, { file: 'main.py', line: 12 }]);
});

test('Node frames map to project files, skip internals, raise first', () => {
  const t = parseTrace(NODE, Object.keys(nodeFiles));
  assert.equal(t.kind, 'node');
  assert.match(t.title, /^TypeError: Cannot read properties of undefined/);
  assert.deepEqual(t.frames, [{ file: 'src/cart.js', line: 3, column: 42 }, { file: 'src/index.js', line: 8, column: 15 }]);
});

test('the Node title is the error line, whatever words it uses', () => {
  const t = parseTrace('TypeError: Reduce of empty array with no initial value\n    at Array.reduce (<anonymous>)\n    at average (/var/task/src/stats.js:2:13)\n    at Runtime.handle (file:///var/runtime/index.mjs:1173:29)', ['src/stats.js']);
  assert.equal(t.title, 'TypeError: Reduce of empty array with no initial value');
  assert.equal(parseTrace('Error [ERR_MODULE_NOT_FOUND]: Cannot find module x\n    at resolve (/app/a.js:1:1)', []).title, 'Error [ERR_MODULE_NOT_FOUND]: Cannot find module x');
});

test('a Sentry issue link is recognised, alone or with a trace', () => {
  const alone = parseTrace('https://acme.sentry.io/issues/4512345678/?project=1', []);
  assert.deepEqual(alone.sentry, { url: 'https://acme.sentry.io/issues/4512345678/?project=1', issue: '4512345678' });
  assert.equal(alone.title, 'Sentry issue 4512345678');
  const old = parseTrace(`${NODE}\nhttps://sentry.io/organizations/acme/issues/99/`, Object.keys(nodeFiles));
  assert.equal(old.sentry?.issue, '99');
  assert.match(old.title, /^TypeError/);
});

test('testPathFor puts the test beside the module, named per ecosystem', () => {
  assert.equal(testPathFor('cart.py', 'python'), 'test_cart.py');
  assert.equal(testPathFor('app/billing/cart.py', 'python'), 'app/billing/test_cart.py');
  assert.equal(testPathFor('src/cart.js', 'node'), 'src/cart.test.js');
  assert.equal(testPathFor('src/cart.mjs', 'node'), 'src/cart.test.mjs');
});

test('the Python brief asks for a unittest that fails first, run with the python tool', () => {
  const brief = traceBrief(parseTrace(PY, Object.keys(pyFiles)), pyFiles);
  assert.match(brief, /^Fix this production error \(Python\): ZeroDivisionError/);
  assert.match(brief, /cart\.py:4\n```\n.*>   4 \|     return sum\(items\) \/ len\(items\)/s);
  assert.match(brief, /`test_cart\.py` with unittest/);
  assert.match(brief, /python tool \(action "run", entry "test_cart\.py"\)/);
  assert.match(brief, /before changing any code/);
  assert.match(brief, /fails with the same error/);
  assert.match(brief, /Keep the test/);
});

test('the Node brief asks for a node:test file run with run_code', () => {
  const brief = traceBrief(parseTrace(NODE, Object.keys(nodeFiles)), nodeFiles);
  assert.match(brief, /\(Node\.js\)/);
  assert.match(brief, /`src\/cart\.test\.js` with node:test/);
  assert.match(brief, /run_code \(entry "src\/cart\.test\.js"\)/);
});

test('a Sentry link uses the connector when it is connected, and says so when not', () => {
  const t = parseTrace('https://acme.sentry.io/issues/77/', []);
  assert.match(traceBrief(t, {}, { sentryConnected: true }), /use the Sentry connector's tools to read the issue/);
  assert.match(traceBrief(t, {}), /not connected/);
  assert.doesNotMatch(traceBrief(t, {}), /What was pasted/);
});

test('a log with no project frames tells the agent to search', () => {
  const brief = traceBrief(parseTrace('ERROR payment failed: card_declined', ['app.py']), { 'app.py': '' });
  assert.match(brief, /None of the frames match/);
});
