import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipsFor, evidenceFrom, verdict, type Evidence } from '../src/lib/agent/evidence.ts';
import { isHarnessFile } from '../src/lib/agent/harness.ts';
import { Stage } from '../src/lib/agent/stage.ts';
import type { AgentEvent, ToolCall } from '../src/lib/agent/types.ts';

const run = { reason: 'finished' as const, steps: 4, toolCalls: 6, usage: { input: 9000, output: 3400 }, ms: 4200 };
const call = (name: string, id: string): ToolCall => ({ id, name, args: {} });
const checked = (...results: [string, boolean][]): AgentEvent[] =>
  results.flatMap(([name, ok], i) => [
    { type: 'tool', call: call(name, `c${i}`), risk: 'build' },
    { type: 'result', call: call(name, `c${i}`), result: { ok, content: ok ? 'ok' : 'error' } },
  ]) as AgentEvent[];

function staged(): Stage {
  const stage = new Stage({ 'src/main.ts': 'a\nb\n', 'README.md': 'hi\n' });
  stage.write('src/main.ts', 'a\nB\nc\n');
  stage.write('src/new.ts', 'x\n');
  stage.write('agent/lessons.md', '- build first\n');
  return stage;
}

test('evidence: the last build and run decide, earlier failures are counted', () => {
  const e = evidenceFrom(run, checked(['build', false], ['build', true], ['run_program', true], ['read_file', false]), staged(), isHarnessFile);
  assert.equal(e.build, true);
  assert.equal(e.run, true);
  assert.equal(e.failedChecks, 1, 'read_file is not a check');
  assert.equal(e.files, 2, 'harness files are not project changes');
  assert.equal(e.tokens, 12_400);
  assert.deepEqual(verdict(e), { verified: true, headline: 'Verified' });
  const labels = chipsFor(e).map((c) => c.label);
  assert.ok(labels.includes('built ✓') && labels.includes('ran ✓') && labels.includes('1 failed attempt'));
  assert.ok(labels.includes('12k tokens'), labels.join(', '));
});

test('evidence: unchecked, failing, unfinished and empty work is never verified', () => {
  const base = evidenceFrom(run, [], staged(), isHarnessFile);
  assert.equal(verdict(base).headline, 'Not checked: review carefully');
  assert.ok(chipsFor(base).some((c) => c.label === 'not checked' && c.tone === 'warn'));
  const failed: Evidence = { ...base, build: true, run: false };
  assert.equal(verdict(failed).verified, false);
  assert.equal(verdict({ ...base, build: true, reason: 'budget' }).headline, 'Unfinished: review carefully');
  assert.equal(verdict({ ...base, files: 0 }).headline, 'No changes to the project');
});

test('stage: serialize and restore keep edits and conflict detection', () => {
  const stage = staged();
  stage.delete('README.md');
  const saved = JSON.parse(JSON.stringify(stage.serialize()));

  // The project as it is after a reload: unchanged
  const same = Stage.restore({ 'src/main.ts': 'a\nb\n', 'README.md': 'hi\n' }, saved);
  assert.deepEqual(same.changes(), stage.changes());
  assert.equal(same.read('src/main.ts'), 'a\nB\nc\n');
  assert.deepEqual(same.conflicts({ 'src/main.ts': 'a\nb\n', 'README.md': 'hi\n' }), []);

  // The user edited main.ts meanwhile: the restored stage notices
  const moved = Stage.restore({ 'src/main.ts': 'user edit\n', 'README.md': 'hi\n' }, saved);
  assert.deepEqual(moved.conflicts({ 'src/main.ts': 'user edit\n', 'README.md': 'hi\n' }), ['src/main.ts']);
  assert.equal(moved.diff('src/main.ts').before, 'a\nb\n', 'the diff is against what the agent saw');
});

test('stage: restore ignores malformed storage', () => {
  const stage = Stage.restore({ 'a.ts': '1' }, { edits: [['a.ts', 2 as unknown as string]], before: {} });
  assert.equal(stage.size, 0);
  assert.equal(Stage.restore({}, {} as never).size, 0);
});
