import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awayFor, morningReport, type ReportProposal } from '../src/lib/morning.ts';

const H = 3_600_000;
const now = 100 * H;
const since = now - 9 * H;
const p = (over: Partial<ReportProposal>): ReportProposal => ({ id: 'x', goal: 'g', status: 'review', createdAt: now - H, ...over });

test('the morning report: what waits on you first, then what is broken, done and next', () => {
  const r = morningReport({
    since,
    now,
    proposals: [
      p({ id: 'a', goal: 'Add tests for cart.ts', origin: 'worker', headline: 'Verified', verified: true, review: 'approve' }),
      p({ id: 'b', goal: 'Fix: TypeError', origin: 'debug', headline: 'Breaks a contract', verified: false, createdAt: now - 2 * H }),
      p({ id: 'c', goal: 'Resolve TODO', status: 'accepted', origin: 'worker' }),
      p({ id: 'd', goal: 'Old one', status: 'accepted', createdAt: since - H }),
      p({ id: 'e', goal: 'Run npm install?', status: 'working', waiting: true }),
    ],
    brokenContracts: ['No console.log in src'],
    failure: { title: 'Error: boom', source: 'run' },
    ci: { status: 'failed', step: 'Test' },
    nextTask: { title: 'Add tests for api.ts', reason: 'No test covers it yet' },
    workerMode: 'auto',
  });
  assert.deepEqual(r.sections.map((s) => s.title), ['Waiting on you', 'Broken now', 'Done while you were away', 'Next']);
  const waiting = r.sections[0].items;
  assert.deepEqual(waiting.map((i) => i.label), ['Run npm install?', 'Add tests for cart.ts', 'Fix: TypeError']);
  assert.equal(waiting[1].detail, 'Worker · Verified · reviewer approves');
  assert.equal(waiting[1].tone, 'good');
  assert.equal(waiting[2].tone, 'bad');
  assert.deepEqual(waiting[1].action, { kind: 'proposal', id: 'a' });
  assert.deepEqual(r.sections[1].items.map((i) => i.label), ['Error: boom', 'CI fails here at “Test”', 'No console.log in src']);
  assert.deepEqual(r.sections[2].items.map((i) => i.label), ['Resolve TODO'], 'only what happened while you were away');
  assert.equal(r.headline, 'While you were away (9 hours): 3 proposals finished, 1 verified · 3 wait on you · 3 things broken.');
  assert.equal(r.quiet, false);
});

test('a quiet morning says so', () => {
  const r = morningReport({ since, now, proposals: [], brokenContracts: [], workerMode: 'off', ci: { status: 'passed' } });
  assert.equal(r.quiet, true);
  assert.equal(r.headline, 'All quiet for the 9 hours you were away: the worker is off.');
  assert.deepEqual(r.sections.map((s) => s.title), ['Next']);
  assert.equal(awayFor(50 * H), '2 days');
});
