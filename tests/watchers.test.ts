import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WATCHER_PRESETS,
  briefFor,
  changedPaths,
  cronMatches,
  decide,
  describeTrigger,
  eventFor,
  globToRegExp,
  nextCron,
  parseCron,
  parseWatchers,
  serializeWatchers,
  validate,
  type Cron,
  type Watcher,
  type WatcherRun,
} from '../src/lib/watchers.ts';

const cron = (expr: string) => {
  const c = parseCron(expr);
  if ('error' in c) throw new Error(c.error);
  return c as Cron;
};

const watcher = (patch: Partial<Watcher> = {}): Watcher => ({ id: 'w1', name: 'Test', task: 'Do the thing', trigger: { kind: 'interval', minutes: 60 }, mode: 'act', enabled: true, perDay: 3, ...patch });

test('cron: fields, lists, ranges, steps, names and errors', () => {
  const c = cron('*/15 8-10 * * 1-5');
  assert.deepEqual([...c.minute], [0, 15, 30, 45]);
  assert.deepEqual([...c.hour], [8, 9, 10]);
  assert.deepEqual([...c.weekday], [1, 2, 3, 4, 5]);
  assert.deepEqual([...cron('0 0 * * 7').weekday], [0], 'Sunday is 0 or 7');
  assert.deepEqual([...cron('@daily').hour], [0]);
  assert.match((parseCron('0 8 * *') as { error: string }).error, /five fields/);
  assert.match((parseCron('61 * * * *') as { error: string }).error, /between 0 and 59/);
  assert.match((parseCron('x * * * *') as { error: string }).error, /not a valid minute/);
});

test('cron: matching and the next run (local time)', () => {
  const weekdays8 = cron('0 8 * * 1-5');
  assert.equal(cronMatches(weekdays8, new Date(2026, 9, 26, 8, 0)), true, 'Monday 08:00');
  assert.equal(cronMatches(weekdays8, new Date(2026, 9, 25, 8, 0)), false, 'Sunday');
  const next = nextCron(weekdays8, new Date(2026, 9, 23, 9, 0)); // Friday 09:00
  assert.deepEqual([next?.getDate(), next?.getHours(), next?.getMinutes()], [26, 8, 0], 'skips the weekend to Monday');
  // Day of month and weekday both set: either matches
  const c = cron('0 12 1 * 1');
  assert.equal(cronMatches(c, new Date(2026, 9, 1, 12, 0)), true, 'the 1st (a Thursday)');
  assert.equal(cronMatches(c, new Date(2026, 9, 5, 12, 0)), true, 'a Monday');
  assert.equal(cronMatches(c, new Date(2026, 9, 6, 12, 0)), false);
});

test('globs and changed paths', () => {
  const re = globToRegExp('src/**/*.{ts,tsx}');
  assert.ok(re.test('src/a.ts'));
  assert.ok(re.test('src/deep/er/b.tsx'));
  assert.ok(!re.test('src/c.js'));
  assert.ok(!re.test('lib/a.ts'));
  assert.ok(globToRegExp('*.md').test('README.md'));
  assert.ok(!globToRegExp('*.md').test('docs/a.md'));
  assert.ok(globToRegExp('**').test('any/where.txt'));
  assert.deepEqual(changedPaths({ a: '1', b: '2', c: '3' }, { a: '1', b: '9', d: '4' }), ['b', 'c', 'd']);
});

test('events: schedule fires once for the last due minute; interval once per slot', () => {
  const w = watcher({ trigger: { kind: 'schedule', cron: '0 8 * * *' } });
  const base = { changed: [], files: {}, failure: null };
  const at = (h: number, m: number) => new Date(2026, 9, 26, h, m).getTime();
  assert.equal(eventFor(w, { ...base, lastCheck: at(7, 58), now: at(7, 59) }), null);
  const e = eventFor(w, { ...base, lastCheck: at(7, 59), now: at(8, 0) });
  assert.ok(e?.key.startsWith('w1:at:'));
  // Opening the studio at 10:00 after being closed since yesterday: one run for today's 08:00
  const late = eventFor(w, { ...base, lastCheck: at(0, 0) - 3 * 60 * 60_000, now: at(10, 0) });
  assert.equal(late?.key, e?.key, 'the same event, so it runs once');

  const every = watcher({ trigger: { kind: 'interval', minutes: 30 } });
  assert.equal(eventFor(every, { ...base, lastCheck: at(9, 5), now: at(9, 20) }), null);
  assert.ok(eventFor(every, { ...base, lastCheck: at(9, 20), now: at(9, 31) }));
  assert.equal(eventFor({ ...every, enabled: false }, { ...base, lastCheck: at(9, 20), now: at(9, 31) }), null, 'off');
});

test('events: changes match the glob, ignore .nanocli, and key on the content', () => {
  const w = watcher({ trigger: { kind: 'change', glob: 'src/**' } });
  const ctx = { now: 1, lastCheck: 0, failure: null };
  assert.equal(eventFor(w, { ...ctx, changed: ['README.md', '.nanocli/x.json'], files: {} }), null);
  const a = eventFor(w, { ...ctx, changed: ['src/a.ts'], files: { 'src/a.ts': 'v1' } });
  const b = eventFor(w, { ...ctx, changed: ['src/a.ts'], files: { 'src/a.ts': 'v2' } });
  assert.deepEqual(a?.paths, ['src/a.ts']);
  assert.notEqual(a?.key, b?.key, 'a new edit is a new event');
  const f = watcher({ trigger: { kind: 'failure' } });
  assert.equal(eventFor(f, { ...ctx, changed: [], files: {} }), null);
  assert.equal(eventFor(f, { ...ctx, changed: [], files: {}, failure: { signature: 'sig', title: 'Boom' } })?.key, 'w1:failure:sig');
});

test('decide: idempotent, checks the premise, respects review and the daily budget', () => {
  const now = Date.now();
  const w = watcher({ perDay: 2 });
  const event = { key: 'w1:every:1', summary: 'Every hour' };
  const s = { now, history: [] as WatcherRun[], files: {}, failure: null, unreviewed: false };
  assert.deepEqual(decide(w, event, s), { action: 'start', reason: 'Every hour' });
  assert.equal(decide({ ...w, mode: 'suggest' }, event, s).action, 'suggest');
  const ran: WatcherRun = { watcherId: 'w1', at: now - 1000, key: 'w1:every:1', event: 'Every hour', action: 'started', reason: '' };
  assert.deepEqual(decide(w, event, { ...s, history: [ran] }), { action: 'ignore' }, 'the same event never runs twice');
  assert.match((decide(w, event, { ...s, unreviewed: true }) as { reason: string }).reason, /waits for your review/);
  const two = [0, 1].map((i) => ({ ...ran, key: `k${i}` }));
  assert.match((decide(w, event, { ...s, history: two }) as { reason: string }).reason, /budget \(2 a day\)/);
  const old = two.map((r) => ({ ...r, at: now - 25 * 60 * 60_000 }));
  assert.equal(decide(w, event, { ...s, history: old }).action, 'start', 'yesterday does not count');
  const skips = two.map((r) => ({ ...r, action: 'skipped' as const }));
  assert.equal(decide(w, event, { ...s, history: skips }).action, 'start', 'held-back runs do not use the budget');

  const f = watcher({ trigger: { kind: 'failure' } });
  const fe = { key: 'w1:failure:sig', summary: 'It failed' };
  assert.equal(decide(f, fe, { ...s, failure: { signature: 'sig' } }).action, 'start');
  assert.match((decide(f, fe, s) as { reason: string }).reason, /already fixed/);
  const c = watcher({ trigger: { kind: 'change', glob: 'src/**' } });
  assert.match((decide(c, { key: 'k', summary: 's', paths: ['src/gone.ts'] }, s) as { reason: string }).reason, /removed again/);
});

test('definitions: describe, validate, round-trip and presets', () => {
  assert.equal(describeTrigger({ kind: 'schedule', cron: '0 8 * * 1-5' }), 'Weekdays at 08:00');
  assert.equal(describeTrigger({ kind: 'schedule', cron: '30 18 * * *' }), 'Every day at 18:30');
  assert.equal(describeTrigger({ kind: 'schedule', cron: '0 9 * * 1' }), 'Monday at 09:00');
  assert.equal(describeTrigger({ kind: 'interval', minutes: 120 }), 'Every 2 hours while open');
  assert.equal(describeTrigger({ kind: 'change', glob: 'src/**' }), 'When src/** changes');
  assert.equal(validate(watcher({ name: ' ' })), 'Give it a name');
  assert.match(validate(watcher({ trigger: { kind: 'interval', minutes: 1 } })) ?? '', /5 minutes/);
  assert.match(validate(watcher({ trigger: { kind: 'schedule', cron: 'nope' } })) ?? '', /five fields/);
  const list = [watcher(), watcher({ id: 'w2', trigger: { kind: 'failure' }, mode: 'suggest', enabled: false })];
  assert.deepEqual(parseWatchers(serializeWatchers(list)), list);
  assert.deepEqual(parseWatchers('{"watchers":[{"id":"x"},{"id":"y","name":"n","task":"t","trigger":{"kind":"bogus"}}]}'), [], 'malformed ones are left out');
  assert.deepEqual(parseWatchers('not json'), []);
  for (const p of WATCHER_PRESETS) assert.equal(validate({ ...p, id: 'p', enabled: true }), null, p.name);
  const brief = briefFor(watcher(), { key: 'k', summary: 'src/a.ts changed', paths: ['src/a.ts'] });
  assert.match(brief, /Do the thing/);
  assert.match(brief, /Changed: src\/a.ts/);
  assert.match(brief, /change nothing/);
});
