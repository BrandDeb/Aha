import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStep, emptyNight, nextStep, nightSummary, parseTasks, startTime, taskFinished, type NightShift } from '../src/lib/nightshift.ts';

const at = (h: number, m = 0) => new Date(2026, 9, 26, h, m).getTime();

test('tasks from text, and when the night starts', () => {
  assert.deepEqual(parseTasks('- Add tests for utils\n\n2. Update deps\n* x\n• Write the README section'), ['Add tests for utils', 'Update deps', 'Write the README section']);
  assert.equal(startTime({ startAt: 'now', armedAt: at(18) }), at(18));
  assert.equal(startTime({ startAt: '22:00', armedAt: at(18) }), at(22));
  assert.equal(startTime({ startAt: '01:30', armedAt: at(23) }), at(23) + (2 * 60 + 30) * 60_000, 'after midnight: the next day');
  assert.equal(startTime({ startAt: '22:00', armedAt: null }), null);
});

test('three queued tasks run one after another and end in a report', () => {
  let night: NightShift = { ...emptyNight(), startAt: '22:00', armedAt: at(18), tasks: ['a', 'b', 'c'].map((text, i) => ({ id: `t${i}`, text, status: 'queued' as const })) };
  assert.deepEqual(nextStep(night, at(21)), { kind: 'wait', until: at(22) }, 'not before the start time');
  let now = at(22);
  for (let i = 0; i < 3; i++) {
    const step = nextStep(night, now);
    assert.equal(step.kind, 'start');
    if (step.kind !== 'start') return;
    assert.equal(step.taskId, `t${i}`);
    assert.deepEqual(step.budget, { maxMillis: 30 * 60_000, maxTokens: 400_000 });
    night = applyStep(night, step, now, `p${i}`);
    assert.equal(nextStep(night, now + 60_000).kind, 'wait', 'one at a time');
    now += 20 * 60_000;
    night = taskFinished(night, `t${i}`, { reason: 'finished', tokens: 100_000 }, now);
  }
  const end = nextStep(night, now);
  assert.deepEqual(end, { kind: 'finish' });
  night = applyStep(night, end, now);
  const report = nightSummary(night);
  assert.match(report.headline, /3 done · 300k tokens/);
  assert.deepEqual(report.items.map((i) => [i.proposalId, i.status]), [['p0', 'done'], ['p1', 'done'], ['p2', 'done']]);
});

test('the budget stops a runaway task and what is left', () => {
  const budget = { perTaskMinutes: 30, perTaskTokens: 400_000, totalHours: 2, totalTokens: 500_000 };
  let night: NightShift = { tasks: ['runaway', 'second', 'third'].map((text, i) => ({ id: `t${i}`, text, status: 'queued' as const })), budget, startAt: 'now', armedAt: at(22) };
  // A task that never ends on its own is stopped past its time
  let step = nextStep(night, at(22));
  night = applyStep(night, step, at(22), 'p0');
  step = nextStep(night, at(22, 33));
  assert.deepEqual(step, { kind: 'stop', taskId: 't0', reason: 'Ran past its 30 min' });
  night = applyStep(night, step, at(22, 33));
  assert.equal(night.tasks[0].status, 'stopped');
  // Its proposal reports the tokens it used: the next task only gets what the night has left
  night = { ...night, tasks: night.tasks.map((t) => (t.id === 't0' ? { ...t, tokens: 400_000 } : t)) };
  step = nextStep(night, at(22, 34));
  assert.equal(step.kind === 'start' && step.budget.maxTokens, 100_000);
  night = applyStep(night, step, at(22, 34), 'p1');
  // That one hits its token budget (the agent stops itself)
  night = taskFinished(night, 't1', { reason: 'budget', tokens: 100_000 }, at(22, 50));
  assert.equal(night.tasks[1].status, 'stopped');
  // Nothing left for the third
  step = nextStep(night, at(22, 51));
  assert.deepEqual(step, { kind: 'finish', reason: "The night's 500,000 tokens are used up" });
  night = applyStep(night, step, at(22, 51));
  assert.deepEqual(night.tasks.map((t) => t.status), ['stopped', 'stopped', 'skipped']);
  assert.match(nightSummary(night).headline, /0 done, 2 stopped at the budget, 1 skipped · 500k tokens \(the night's 500,000 tokens are used up\)/);
});

test('the night deadline stops the task in progress; a missing model fails the task, not the night', () => {
  let night: NightShift = { tasks: [{ id: 'a', text: 'a', status: 'queued' }, { id: 'b', text: 'b', status: 'queued' }], budget: { perTaskMinutes: 600, perTaskTokens: 1e9, totalHours: 1, totalTokens: 1e9 }, startAt: 'now', armedAt: at(22) };
  night = applyStep(night, nextStep(night, at(22)), at(22));
  assert.equal(night.tasks[0].status, 'failed');
  const step = nextStep(night, at(22, 1));
  night = applyStep(night, step, at(22, 1), 'pb');
  assert.deepEqual(nextStep(night, at(23, 1)), { kind: 'stop', taskId: 'b', reason: "The night's 1 h ran out" });
  assert.equal(step.kind === 'start' && step.budget.maxMillis, 59 * 60_000, 'a task never gets more time than the night has left');
});
