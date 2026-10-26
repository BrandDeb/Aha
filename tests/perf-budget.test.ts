import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baselineFrom, checkBudget, formatReport, p95, type Measurements } from '../src/lib/perf-budget.ts';

const today: Measurements = {
  routes: [
    { path: '/', jsBytes: 400_000, jsRequests: 20 },
    { path: '/docs', jsBytes: 150_000, jsRequests: 8 },
  ],
  editorReadyMs: 1200,
  keystrokeP95Ms: 24,
  heapMB: 60,
};

test('within budget: today against its own baseline', () => {
  const rows = checkBudget(today, baselineFrom(today));
  assert.equal(rows.length, 7);
  assert.ok(rows.every((r) => r.ok));
  assert.match(formatReport(rows), /within budget/);
});

test('over budget: sizes allow 5%, timings 50%, requests at least one more', () => {
  const budget = baselineFrom(today);
  const worse: Measurements = {
    routes: [
      { path: '/', jsBytes: 400_000 * 1.06, jsRequests: 21 },
      { path: '/docs', jsBytes: 150_000 * 1.04, jsRequests: 10 },
      { path: '/new-page', jsBytes: 9_999_999, jsRequests: 99 },
    ],
    editorReadyMs: 1200 * 1.4,
    keystrokeP95Ms: 24 * 1.6,
    heapMB: 60 * 1.1,
  };
  const rows = checkBudget(worse, budget);
  const over = rows.filter((r) => !r.ok).map((r) => r.metric);
  assert.deepEqual(over, ['/ JavaScript', '/docs script requests', 'Keystroke p95 (20 files open)', 'Heap after 20 files']);
  assert.ok(!rows.some((r) => r.metric.startsWith('/new-page')), 'a route without a baseline is not judged');
  const report = formatReport(rows);
  assert.match(report, /4 over/);
  assert.match(report, /\| \/ JavaScript \| 414\.1 KB \| 410\.2 KB \| \*\*over\*\* \|/);
  assert.match(report, /npm run perf -- --update/);
});

test('p95 counts unreported fast events at the threshold', () => {
  assert.equal(p95([]), 0);
  assert.equal(p95([100], 99), 16, 'one slow event in a hundred is the 1%');
  assert.equal(p95([100, 90, 80, 70, 60, 50], 14), 90, 'the 19th of 20');
  assert.equal(p95([10, 20, 30]), 30);
});
