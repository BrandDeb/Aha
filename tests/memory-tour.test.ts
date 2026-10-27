import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMemory, citedMemory, memoryPrompt, parseMemory, MEMORY_FILE } from '../src/lib/memory.ts';
import { buildTour, firstDefinition, importsOf } from '../src/lib/tour.ts';
import type { WhyEntry } from '../src/lib/why.ts';
import { systemPromptFor } from '../src/lib/agent/prompt.ts';
import { riskOf } from '../src/lib/agent/risk.ts';
import { Stage } from '../src/lib/agent/stage.ts';
import { workspaceTools } from '../src/lib/agent/tools.ts';

const added = (r: ReturnType<typeof addMemory>) => {
  assert.ok(!('error' in r), 'error' in r ? r.error : '');
  return r as { text: string; id: string; added: boolean };
};

test('memory: entries are filed by kind with the next free id', () => {
  const a = added(addMemory(undefined, 'convention', 'Money is stored in integer cents, never floats.', '2026-10-27'));
  assert.equal(a.id, 'm1');
  assert.match(a.text, /^# Project memory/);
  assert.match(a.text, /## Conventions\n\n- \[m1\] Money is stored in integer cents, never floats\. \(2026-10-27\)\n$/);
  const b = added(addMemory(a.text, 'decision', 'SQLite until there are more than ten users.'));
  const c = added(addMemory(b.text, 'convention', 'Every route validates its body with zod.'));
  assert.deepEqual(parseMemory(c.text).map((e) => `${e.id} ${e.kind}`), ['m1 convention', 'm3 convention', 'm2 decision']);
  assert.equal(parseMemory(c.text)[0].date, '2026-10-27');
  // Saying it again keeps the first
  const again = added(addMemory(c.text, 'convention', 'money is stored in integer cents — never floats'));
  assert.deepEqual([again.id, again.added], ['m1', false]);
  assert.equal(added(addMemory(c.text, 'gotcha', 'The CSV export times out above 10k rows.')).id, 'm4');
});

test('memory: what the user wrote around the entries is kept', () => {
  const mine = '# Project memory\n\nNotes for the team.\n\n## Gotchas\n\n- [m1] Port 3000 is taken by the old app.\n\nAsk Dana before touching billing.\n';
  const next = added(addMemory(mine, 'gotcha', 'The test database resets every night.'));
  assert.match(next.text, /Notes for the team\./);
  assert.match(next.text, /- \[m1\] Port 3000 is taken by the old app\.\n- \[m2\] The test database resets every night\./);
  assert.match(next.text, /Ask Dana before touching billing\./);
});

test('memory: refuses what is not one fact', () => {
  assert.ok('error' in addMemory(undefined, 'decision', 'ok'));
  assert.ok('error' in addMemory(undefined, 'decision', 'x'.repeat(301)));
  assert.ok('error' in addMemory(undefined, 'opinion' as never, 'Tabs are better than spaces.'));
});

test('memory: the agent is told it and its citations are found', () => {
  const text = added(addMemory(undefined, 'convention', 'Money is stored in integer cents, never floats.')).text;
  const entries = parseMemory(text);
  assert.match(memoryPrompt(entries), /Conventions:\n\[m1\] Money is stored in integer cents/);
  assert.match(systemPromptFor({ [MEMORY_FILE]: text, 'src/main.ts': '' }), /Project memory \(\.aha\/memory\.md\)[\s\S]*cite its id/);
  assert.equal(memoryPrompt([]), '');
  assert.deepEqual(citedMemory('Kept the total in cents [m1] and [m1] again; [m9] does not exist.', entries).map((e) => e.id), ['m1']);
});

test('the remember tool writes memory into the proposal, and memory edits hold auto-accept', async () => {
  const stage = new Stage({ 'src/main.ts': '' });
  const remember = workspaceTools({ stage, entry: 'src/main.ts' } as never).find((t) => t.name === 'remember')!;
  const signal = new AbortController().signal;
  const first = await remember.run({ kind: 'gotcha', text: 'The payment sandbox rejects amounts under 50 cents.' }, { signal } as never);
  assert.match(first.content, /Remembered as \[m1\]/);
  assert.match((await remember.run({ kind: 'gotcha', text: 'The payment sandbox rejects amounts under 50 cents.' }, { signal } as never)).content, /Already in memory as \[m1\]/);
  assert.equal((await remember.run({ kind: 'gotcha', text: 'no' }, { signal } as never)).ok, false);
  const after = stage.read(MEMORY_FILE)!;
  const risk = riskOf({ files: [{ path: MEMORY_FILE, kind: 'added', before: '', after, added: 5, removed: 0 }] });
  assert.ok(risk.factors.some((f) => f.label === "edits the agent's memory" && f.hold));
});

test('imports are followed in TypeScript, JavaScript and Python', () => {
  const files = {
    'src/main.ts': "import { total } from './cart';\nimport x from 'lodash';\nconst u = await import('./util.js');\n",
    'src/cart.ts': "export * from './money';\n",
    'src/money/index.ts': '',
    'src/util.ts': '',
    'app/main.py': 'from app.cart import total\nimport app.money\nfrom . import util\nfrom .db import connect\n',
    'app/cart.py': '',
    'app/money.py': '',
    'app/util.py': '',
    'app/db/__init__.py': '',
  };
  assert.deepEqual(importsOf('src/main.ts', files).sort(), ['src/cart.ts', 'src/util.ts']);
  assert.deepEqual(importsOf('src/cart.ts', files), ['src/money/index.ts']);
  assert.deepEqual(importsOf('app/main.py', files).sort(), ['app/cart.py', 'app/db/__init__.py', 'app/money.py', 'app/util.py']);
});

test('firstDefinition finds the first top-level definition', () => {
  assert.deepEqual(firstDefinition("import x from 'y';\n\nexport function total() {\n  const inner = 1;\n}\nexport class Cart {}\n"), { line: 3, names: ['total', 'Cart'] });
  assert.deepEqual(firstDefinition('import os\n\n\ndef main():\n    pass\n\nclass App:\n    def run(self): ...\n'), { line: 4, names: ['main', 'App'] });
  assert.deepEqual(firstDefinition('# just a comment\n'), { line: 1, names: [] });
});

test('a tour has five stops: the start, the hub, the work, the why, the tests', () => {
  const big = Array.from({ length: 40 }, (_, i) => `  line${i}();`).join('\n');
  const files = {
    'package.json': '{"name":"shop"}',
    'README.md': '# Shop',
    'src/main.ts': "import { checkout } from './checkout';\nimport { format } from './money';\n\nexport function main() {\n  checkout();\n}\n",
    'src/checkout.ts': `import { format } from './money';\nimport { save } from './db';\n\nexport function checkout() {\n${big}\n}\n`,
    'src/money.ts': 'export function format(cents: number) {\n  return `$${cents / 100}`;\n}\nexport const ZERO = 0;\n',
    'src/db.ts': "import { format } from './money';\nexport function save() {}\n",
    'src/checkout.test.ts': "import { test } from 'node:test';\ntest('checkout', () => {});\n",
    '.aha/memory.md': '# Project memory\n',
  };
  const why: WhyEntry[] = [
    { id: 'w1', at: Date.UTC(2026, 9, 20), goal: 'Round totals to the cent', origin: 'you', files: { 'src/db.ts': ['export function save() {}'] } },
    { id: 'w2', at: Date.UTC(2026, 9, 26), goal: 'Fix: TypeError in save', origin: 'debug', files: { 'src/db.ts': ['x'] } },
    // The studio's own files are history too, but not a stop
    { id: 'w3', at: Date.UTC(2026, 9, 26), goal: 'Remember the money rule', files: { '.aha/memory.md': ['a'], 'README.md': ['b'] } },
    { id: 'w4', at: Date.UTC(2026, 9, 26), goal: 'Remember more', files: { '.aha/memory.md': ['c'] } },
  ];
  const tour = buildTour(files, 'src/main.ts', why, Date.UTC(2026, 9, 27));
  assert.deepEqual(tour.map((s) => `${s.title}: ${s.file}:${s.line}`), [
    'Where it starts: src/main.ts:4',
    'What everything leans on: src/money.ts:1',
    'Where the work happens: src/checkout.ts:4',
    'Why it looks like this: src/db.ts:2',
    'How to check a change: src/checkout.test.ts:1',
  ]);
  assert.match(tour[0].points.join(' '), /pulls in src\/checkout\.ts, src\/money\.ts/);
  assert.match(tour[1].points[0], /^3 files import it: src\/checkout\.ts, src\/db\.ts, src\/main\.ts/);
  assert.match(tour[3].points.join(' '), /“Fix: TypeError in save” \(debug, 1 d ago\).*“Round totals to the cent” \(7 d ago\)/s);
});

test('a small project without history or tests still gets a tour', () => {
  const tour = buildTour({ 'main.py': 'import helpers\n\ndef main():\n    helpers.go()\n', 'helpers.py': 'def go():\n    pass\n', 'pyproject.toml': '[project]\nname = "x"\n', 'README.md': '# x' }, 'main.py');
  assert.deepEqual(tour.map((s) => s.title), ['Where it starts', 'What everything leans on', 'What it is built on', 'How to check a change']);
  assert.match(tour[2].points.join(' '), /no why-history/);
  assert.equal(buildTour({}, 'main.ts').length, 0);
});
