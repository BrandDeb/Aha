import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverTasks, findTodos, nextTask, recentCount, untestedFiles } from '../src/lib/worker.ts';

const files = {
  'src/main.ts': "import { total } from './cart';\n// TODO: read the cart from a file instead of hard-coding it\nconsole.log(total([{ price: 2 }, { price: 3 }]));\n",
  'src/cart.ts': 'export interface Item { price: number }\n\nexport function total(items: Item[]): number {\n  let sum = 0;\n  for (const item of items) sum += item.price;\n  return sum;\n}\n\nexport const empty = (items: Item[]) => items.length === 0;\n',
  'src/util.py': '# FIXME: handle negative numbers\ndef double(x):\n    return x * 2\n',
  'README.md': '# TODO in docs is not code\n',
  'node_modules/x/index.js': '// TODO: not ours\n',
};

test('TODOs: comments in code, any comment style, never generated folders or docs', () => {
  const todos = findTodos(files);
  assert.deepEqual(todos.map((t) => `${t.file}:${t.line} ${t.tag}`), ['src/main.ts:2 TODO', 'src/util.py:1 FIXME']);
  assert.equal(todos[0].text, 'read the cart from a file instead of hard-coding it');
  assert.equal(findTodos({ 'a.ts': '// TODO\n// TODO: add retries\n' }).length, 1, 'an empty TODO is not a task');
});

test('untested: files with logic that no test mentions', () => {
  assert.deepEqual(untestedFiles(files, 'src/main.ts'), ['src/cart.ts']);
  assert.deepEqual(untestedFiles({ ...files, 'src/cart.test.ts': "import { total } from './cart';" }, 'src/main.ts'), []);
  assert.deepEqual(untestedFiles({ 'vite.config.ts': 'export default defineConfig({ plugins: [react()] }) // ' + 'x\n'.repeat(10) }), []);
});

test('tasks: a failure first, then editor problems, the focus, TODOs, tests', () => {
  const tasks = discoverTasks({
    files,
    entry: 'src/main.ts',
    focus: 'a CLI that totals a shopping cart from a JSON file',
    problems: [{ file: 'src/cart.ts', line: 5, message: "Type 'string' is not assignable to type 'number'." }, { file: 'gone.ts', line: 1, message: 'x' }],
    failure: { signature: 'abc', title: 'TypeError: x is undefined', brief: 'Debug and fix this…' },
  });
  assert.deepEqual(tasks.map((t) => t.kind), ['failure', 'problem', 'focus', 'todo', 'todo', 'tests']);
  assert.equal(tasks[0].brief, 'Debug and fix this…');
  assert.match(tasks[1].title, /Fix 1 problem in src\/cart\.ts/, 'problems in files that no longer exist are dropped');
  assert.match(tasks[2].brief, /single most valuable next step[\s\S]*Verify your work/);
  assert.equal(tasks[3].kind, 'todo');
  assert.match(tasks[3].title, /^FIXME/, 'FIXME outranks TODO');
  for (const t of tasks) assert.ok(t.key && t.title && t.reason && t.brief, t.kind);
});

test('the queue never repeats a task, and each focus step is new', () => {
  const ctx = { files, focus: 'build it' };
  const first = discoverTasks(ctx);
  const done = new Set([first[0].key]);
  assert.notEqual(nextTask(first, done)?.key, first[0].key);
  assert.notEqual(discoverTasks({ ...ctx, focusSteps: 1 }).find((t) => t.kind === 'focus')!.key, first.find((t) => t.kind === 'focus')!.key);
  assert.equal(nextTask(first, new Set(first.map((t) => t.key))), null);
});

test('budget: tasks started in the last hour', () => {
  const now = 10 * 60 * 60_000;
  assert.equal(recentCount([now - 1000, now - 30 * 60_000, now - 2 * 60 * 60_000], now), 2);
});
