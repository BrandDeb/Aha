import { test } from 'node:test';
import assert from 'node:assert/strict';
import { improvementBrief, IMPROVE_AFTER, kindWeight, MAX_OUTCOMES, needsImprovement, normalizeError, summarize, upsertOutcome } from '../src/lib/agent/outcomes.ts';
import { discoverTasks } from '../src/lib/worker.ts';
type Outcome = import('../src/lib/agent/outcomes.ts').Outcome;

let n = 0;
const outcome = (o: Partial<Outcome> = {}): Outcome => ({ id: `p${++n}`, at: 1000 + n, origin: 'worker', kind: 'todo', title: 'Do a thing', verified: true, reason: 'finished', decision: null, errors: [], ...o });

test('the record: one entry per proposal, newest first, capped', () => {
  let list: Outcome[] = [];
  const a = outcome();
  list = upsertOutcome(list, a);
  list = upsertOutcome(list, { ...a, decision: 'accepted' });
  assert.equal(list.length, 1);
  assert.equal(list[0].decision, 'accepted');
  for (let i = 0; i < MAX_OUTCOMES + 20; i++) list = upsertOutcome(list, outcome());
  assert.equal(list.length, MAX_OUTCOMES);
});

test('the same error reads the same across runs', () => {
  assert.equal(normalizeError("run_command: src/app/page.tsx(12,4): Cannot find name 'foo'"), normalizeError("run_command: src/lib/x.ts(80,1): Cannot find name 'bar'"));
  const s = summarize([outcome({ errors: ['tsc: 3 errors in src/a.ts'] }), outcome({ errors: ['tsc: 5 errors in src/b.ts'] }), outcome({ errors: ['other'] })]);
  assert.deepEqual(s.recurring.map((r) => r.count), [2]);
});

test('improve only with enough new results that are not going well', () => {
  const good = Array.from({ length: IMPROVE_AFTER }, () => outcome());
  assert.equal(needsImprovement(good, 0), false, 'all verified');
  assert.equal(needsImprovement(good.slice(0, IMPROVE_AFTER - 1).map((o) => ({ ...o, verified: false })), 0), false, 'too few to judge');
  const shaky = good.map((o, i) => ({ ...o, verified: i % 2 === 0 }));
  assert.equal(needsImprovement(shaky, 0), true, 'half verified');
  assert.equal(needsImprovement(shaky, Number.MAX_SAFE_INTEGER), false, 'already improved since');
  assert.equal(needsImprovement(good.map((o, i) => ({ ...o, decision: i < 3 ? ('discarded' as const) : null })), 0), true, 'discarded three');
  assert.equal(needsImprovement(good.map((o, i) => ({ ...o, errors: i < 3 ? [`npm test: failed ${i}`] : [] })), 0), true, 'the same error three times');
  assert.equal(needsImprovement(shaky.map((o) => ({ ...o, kind: 'improve' })), 0), false, 'its own improvements do not count');
});

test('task kinds you accept rank higher, kinds you discard lower', () => {
  const record = [
    ...Array.from({ length: 3 }, () => outcome({ kind: 'tests', decision: 'accepted' })),
    ...Array.from({ length: 4 }, () => outcome({ kind: 'todo', decision: 'discarded' })),
  ];
  assert.equal(kindWeight(record, 'tests'), 1.5);
  assert.equal(kindWeight(record, 'todo'), 0.5);
  assert.equal(kindWeight(record, 'problem'), 1, 'no record, no change');
  assert.equal(kindWeight(record.slice(0, 2), 'tests'), 1, 'two decisions are not a pattern');

  const files = {
    'src/main.ts': "import { total } from './cart';\n// TODO: read the cart from a file\nconsole.log(total([]));\n",
    'src/cart.ts': 'export function total(items: { price: number }[]): number {\n  let sum = 0;\n  for (const item of items) sum += item.price;\n  return sum;\n}\n\nexport const empty = (items: unknown[]) => items.length === 0;\n',
  };
  const plain = discoverTasks({ files, entry: 'src/main.ts' });
  const weighted = discoverTasks({ files, entry: 'src/main.ts', weights: { todo: 0.5, tests: 1.5 } });
  assert.equal(plain[0].kind, 'todo');
  assert.equal(weighted[0].kind, 'tests', 'tests now come first');
});

test('the improvement task: the evidence, and only the harness may change', () => {
  const record = [outcome({ verified: false, reason: 'stuck', errors: ['npm test: 2 failing'] }), outcome({ verified: false, errors: ['npm test: 3 failing'] }), outcome({ decision: 'discarded' })];
  const brief = improvementBrief(record, 0);
  assert.match(brief, /Recent tasks: 3, verified 1/);
  assert.match(brief, /NOT verified \(stuck\)/);
  assert.match(brief, /2× npm test: N failing/);
  assert.match(brief, /agent\/lessons\.md/);
  assert.match(brief, /Do not change any source code/);
  const tasks = discoverTasks({ files: {}, entry: 'src/main.ts', improve: { key: 'improve:0', brief, reason: 'Its recent results here could be better' } });
  assert.deepEqual(tasks.map((t) => [t.kind, t.key]), [['improve', 'improve:0']]);
});
