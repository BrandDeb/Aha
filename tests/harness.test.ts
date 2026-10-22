import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdits, cleanEdits, COMPOSER_PROMPT, editedFiles, harnessPrompt, isHarnessFile, LESSONS_FILE, maxModelCalls, parseVariants, PROPOSER_PROMPT, runHarnessLoop, scoreSignals, type HarnessEvent } from '../src/lib/agent/harness.ts';
import { Stage } from '../src/lib/agent/stage.ts';
import { systemPromptFor } from '../src/lib/agent/prompt.ts';
import type { AgentHost } from '../src/lib/agent/tools.ts';
import type { CallModel, ModelTurn, ToolCall } from '../src/lib/agent/types.ts';
import { DEFAULT_BUDGET } from '../src/lib/agent/types.ts';

const call = (name: string, args: Record<string, unknown> = {}, id = `${name}-${Math.random()}`): ToolCall => ({ id, name, args });
const say = (text: string): ModelTurn => ({ text, toolCalls: [], stop: 'end' });
const tools = (...calls: ToolCall[]): ModelTurn => ({ text: '', toolCalls: calls, stop: 'tool_use' });

const files = { 'src/main.ts': 'const n: number = "x";\n', 'AGENTS.md': 'Use 2 spaces.\n' };

/** A host whose build passes only once the file no longer contains the bad string */
const makeHost = (stage: Stage): AgentHost => ({
  stage,
  entry: 'src/main.ts',
  build: async (f) => (f['src/main.ts'].includes('"x"') ? { ok: false, text: 'SC0001 Type string is not assignable to number' } : { ok: true, text: 'Build succeeded' }),
});

test('harness files: edits apply to the harness only and appear in the system prompt', () => {
  const edits = { prompt: 'Always run build after every edit.', tools: 'Prefer edit_file.', skills: { 'fix-types': '# Fixing type errors\nRead the error first.' }, notes_append: 'Build with scriptc.' };
  const after = applyEdits(files, edits);
  assert.equal(after['src/main.ts'], files['src/main.ts']);
  assert.equal(after['agent/prompt.md'], 'Always run build after every edit.\n');
  assert.equal(after['agent/skills/fix-types.md'], '# Fixing type errors\nRead the error first.\n');
  assert.equal(after['AGENTS.md'], 'Use 2 spaces.\n\nBuild with scriptc.\n');
  assert.deepEqual(Object.keys(editedFiles(files, edits)).sort(), ['AGENTS.md', 'agent/prompt.md', 'agent/skills/fix-types.md', 'agent/tools.md']);
  assert.deepEqual(editedFiles(files, {}), {});

  const system = systemPromptFor(after);
  assert.match(system, /Project notes \(AGENTS\.md\):\nUse 2 spaces\.\n\nBuild with scriptc\./);
  assert.match(system, /Project instructions \(agent\/prompt\.md\):\nAlways run build/);
  assert.match(system, /Tool guidance \(agent\/tools\.md\):\nPrefer edit_file\./);
  assert.match(system, /<skills>\n[\s\S]*- fix-types: Fixing type errors/);
  assert.equal(harnessPrompt(files), '');
  assert.ok(isHarnessFile('agent/x.md') && isHarnessFile('AGENTS.md') && !isHarnessFile('src/a.ts'));
});

test('cleanEdits keeps only text a harness may hold', () => {
  assert.deepEqual(cleanEdits(null), {});
  assert.deepEqual(cleanEdits({ prompt: 5, tools: '  ', skills: 'x', run: 'rm -rf /', script: 'x' }), {});
  const edits = cleanEdits({ prompt: ' hi ', skills: { 'ok-name': 'body', 'Bad Name': 'x', '../evil': 'x', empty: '' }, notes_append: 'n' });
  assert.deepEqual(edits, { prompt: 'hi', notes_append: 'n', skills: { 'ok-name': 'body' } });
  assert.equal(cleanEdits({ prompt: 'x'.repeat(9000) }).prompt!.length, 4000);
  assert.equal(Object.keys(cleanEdits({ skills: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`s${i}`, 'b'])) }).skills!).length, 5);
});

test('parseVariants reads fenced JSON, de-duplicates names, caps the count and rejects nonsense', () => {
  const json = JSON.stringify({ variants: [{ name: 'Verify First', rationale: 'r', edits: { prompt: 'p' } }, { name: 'verify first', edits: { tools: 't' } }, { name: 'empty', edits: {} }, { name: 'third', edits: { notes_append: 'n' } }] });
  const parsed = parseVariants('Sure!\n```json\n' + json + '\n```', 2);
  assert.ok(Array.isArray(parsed));
  assert.deepEqual((parsed as { id: string }[]).map((v) => v.id), ['verify-first', 'variant-2']);
  assert.match((parseVariants('no json here', 2) as { error: string }).error, /did not answer with JSON/);
  assert.match((parseVariants('{"variants":"x"}', 2) as { error: string }).error, /no variants/);
  assert.match((parseVariants('{"variants":[{"name":"a","edits":{"script":"x"}}]}', 2) as { error: string }).error, /no usable changes/);
  assert.equal((parseVariants('{"variants":[{"name":"baseline","edits":{"prompt":"p"}}]}', 1) as { id: string }[])[0].id, 'variant-1', 'cannot take the baseline’s name');
});

test('scoreSignals rewards verified, efficient, finished work and explains itself', () => {
  const full = { finished: true, buildOk: true, runOk: true, failedChecks: 0, steps: 3, toolCalls: 5, changedFiles: 1 };
  const good = scoreSignals(full, DEFAULT_BUDGET);
  assert.ok(good.score >= 90, String(good.score));
  assert.ok(good.evidence.includes('the last build passed'));
  const sloppy = scoreSignals({ ...full, buildOk: null, runOk: null, steps: 20 }, DEFAULT_BUDGET);
  assert.ok(sloppy.score < good.score - 30);
  assert.ok(sloppy.evidence.includes('changed code without ever building it'));
  const failing = scoreSignals({ finished: false, buildOk: false, runOk: null, failedChecks: 5, steps: 25, toolCalls: 30, changedFiles: 1 }, DEFAULT_BUDGET);
  assert.ok(failing.score < 10);
  assert.ok(failing.evidence.includes('did not finish within its budget'));
  assert.equal(scoreSignals({ ...full, changedFiles: 0 }, DEFAULT_BUDGET).evidence.includes('proposed no changes to the project'), true);
  assert.ok(good.score <= 100 && failing.score >= 0);
});

test('maxModelCalls bounds the cost of a run', () => {
  assert.equal(maxModelCalls(2, { maxSteps: 10 }), 2 + 3 * 11);
  assert.ok(maxModelCalls(1) > maxModelCalls(0));
});

/**
 * A model that behaves differently depending on the harness it is given: with the
 * "verify" instruction in its system prompt it fixes the file and builds; without
 * it, it edits but forgets to build. It also plays the proposer and composer.
 */
function scriptedModel(log: { proposer: number; composer: number; agent: number; systems: string[] }, options: { badJson?: boolean } = {}): CallModel {
  return async ({ system, messages }) => {
    if (system === PROPOSER_PROMPT) {
      log.proposer++;
      if (options.badJson) return say('I think you should add more tests.');
      const asked = (messages[0] as { content: string }).content;
      const n = Number(/Propose (\d+) variant/.exec(asked)?.[1] ?? 1);
      const variants = [
        { name: 'verify-first', rationale: 'Always build after editing', edits: { prompt: 'VERIFY: run build after every edit and fix what it reports.', notes_append: 'Types: build catches them.' } },
        { name: 'chatty', rationale: 'Explain more', edits: { prompt: 'Explain your reasoning at length.' } },
      ].slice(0, n);
      return say(JSON.stringify({ variants }));
    }
    if (system === COMPOSER_PROMPT) {
      log.composer++;
      return say(JSON.stringify({ pick: 'verify-first', adopt: { prompt: 'VERIFY: run build after every edit and fix what it reports.', script: 'rm -rf /' }, lessons: ['Building after each edit finished the task (verify-first).'] }));
    }
    log.agent++;
    log.systems.push(system);
    const verifies = system.includes('VERIFY:');
    const toolResults = messages.filter((m) => m.role === 'tool').length;
    if (toolResults === 0) return tools(call('edit_file', { path: 'src/main.ts', old: '"x"', new: '42' }));
    if (verifies && toolResults === 1) return tools(call('build'));
    return say(verifies ? 'Fixed and the build passes.' : 'Edited the file.');
  };
}

test('the loop probes the baseline and variants on private copies, and picks the one that verified its work', async () => {
  const log = { proposer: 0, composer: 0, agent: 0, systems: [] as string[] };
  const events: HarnessEvent[] = [];
  const result = await runHarnessLoop({ goal: 'Fix the type error', files, makeHost, callModel: scriptedModel(log), system: systemPromptFor, k: 2, mode: 'parallel', onEvent: (e) => events.push(e) });

  assert.deepEqual(result.probes.map((p) => p.variant.id), ['baseline', 'verify-first', 'chatty']);
  assert.equal(log.proposer, 1, 'parallel mode proposes once');
  assert.equal(log.composer, 1);
  const byId = Object.fromEntries(result.probes.map((p) => [p.variant.id, p]));
  assert.ok(byId['verify-first'].score > byId.baseline.score + 20, `${byId['verify-first'].score} vs ${byId.baseline.score}`);
  assert.ok(byId['verify-first'].evidence.includes('the last build passed'));
  assert.ok(byId.baseline.evidence.includes('changed code without ever building it'));
  assert.equal(result.best.variant.id, 'verify-first');

  // Probes were isolated from each other and from the project
  assert.equal(files['src/main.ts'], 'const n: number = "x";\n');
  assert.equal(byId.baseline.stage.read('agent/prompt.md'), undefined);
  assert.match(byId['verify-first'].stage.read('agent/prompt.md')!, /^VERIFY:/);
  assert.equal(byId.chatty.stage.read('src/main.ts'), 'const n: number = 42;\n');
  assert.ok(log.systems.some((s) => s.includes('VERIFY:')) && log.systems.some((s) => !s.includes('VERIFY:')), 'each probe ran with its own harness');

  // The result: the best probe's project change plus only what the composer kept, never a script
  assert.equal(result.stage.read('src/main.ts'), 'const n: number = 42;\n');
  assert.deepEqual(result.adopt, { prompt: 'VERIFY: run build after every edit and fix what it reports.' });
  assert.equal(result.stage.read('agent/prompt.md'), 'VERIFY: run build after every edit and fix what it reports.\n');
  assert.equal(result.stage.read('AGENTS.md'), files['AGENTS.md'], 'notes the composer did not keep are not adopted');
  assert.match(result.stage.read(LESSONS_FILE)!, /Building after each edit finished the task \(verify-first\)\. \(goal: “Fix the type error”; best score \d+, baseline \d+\)/);
  assert.deepEqual(Object.keys(result.stage.changes()).sort(), ['agent/lessons.md', 'agent/prompt.md', 'src/main.ts']);
  assert.deepEqual(result.lessons, ['Building after each edit finished the task (verify-first).']);
  assert.ok(result.modelCalls > 3);
  assert.deepEqual(events.filter((e) => e.type === 'probe-done').map((e) => (e as { id: string }).id), ['baseline', 'verify-first', 'chatty']);
  assert.equal(events.at(-1)?.type, 'done');
});

test('sequential mode proposes one variant at a time, after seeing earlier results', async () => {
  const log = { proposer: 0, composer: 0, agent: 0, systems: [] as string[] };
  const result = await runHarnessLoop({ goal: 'g', files, makeHost, callModel: scriptedModel(log), system: systemPromptFor, k: 2, mode: 'sequential' });
  assert.equal(log.proposer, 2);
  assert.equal(result.probes.length, 3);
});

test('when nothing beats the baseline nothing is adopted, and the baseline’s own work is the result', async () => {
  const log = { proposer: 0, composer: 0, agent: 0, systems: [] as string[] };
  // A model that ignores the harness entirely: every probe behaves the same
  const model: CallModel = async (input) => {
    if (input.system === PROPOSER_PROMPT) return say(JSON.stringify({ variants: [{ name: 'noop', edits: { prompt: 'hello' } }] }));
    if (input.system === COMPOSER_PROMPT) {
      log.composer++;
      return say('{}');
    }
    const results = input.messages.filter((m) => m.role === 'tool').length;
    return results === 0 ? tools(call('edit_file', { path: 'src/main.ts', old: '"x"', new: '1' })) : say('done');
  };
  const result = await runHarnessLoop({ goal: 'g', files, makeHost, callModel: model, system: systemPromptFor, k: 1, mode: 'parallel' });
  assert.equal(result.best.variant.id, 'baseline');
  assert.equal(log.composer, 0, 'no need to compose when nothing improved');
  assert.deepEqual(result.adopt, {});
  assert.deepEqual(Object.keys(result.stage.changes()), ['src/main.ts']);
});

test('a proposer that does not answer in JSON leaves just the baseline, with a notice', async () => {
  const log = { proposer: 0, composer: 0, agent: 0, systems: [] as string[] };
  const events: HarnessEvent[] = [];
  const result = await runHarnessLoop({ goal: 'g', files, makeHost, callModel: scriptedModel(log, { badJson: true }), system: systemPromptFor, k: 2, mode: 'parallel', onEvent: (e) => events.push(e) });
  assert.equal(result.probes.length, 1);
  assert.ok(events.some((e) => e.type === 'notice' && /Only the baseline was tried/.test(e.text)));
});

test('probes never run host commands, and a stopped loop stops', async () => {
  const exec = { ran: 0 };
  const host = (stage: Stage): AgentHost => ({ ...makeHost(stage), python: async () => (exec.ran++, { ok: true, text: 'ran' }) });
  const model: CallModel = async (input) => {
    if (input.system === PROPOSER_PROMPT) return say('{"variants":[]}');
    return input.messages.some((m) => m.role === 'tool') ? say('done') : tools(call('python', { action: 'run' }));
  };
  await runHarnessLoop({ goal: 'g', files, makeHost: host, callModel: model, system: systemPromptFor, k: 1, mode: 'parallel' });
  assert.equal(exec.ran, 0);

  const controller = new AbortController();
  controller.abort();
  const result = await runHarnessLoop({ goal: 'g', files, makeHost, callModel: model, system: systemPromptFor, k: 2, mode: 'sequential', signal: controller.signal });
  assert.equal(result.probes[0].run.reason, 'aborted');
  assert.equal(result.probes.length, 1);
});

test('concurrency runs probes side by side without mixing them up', async () => {
  const log = { proposer: 0, composer: 0, agent: 0, systems: [] as string[] };
  const result = await runHarnessLoop({ goal: 'g', files, makeHost, callModel: scriptedModel(log), system: systemPromptFor, k: 2, mode: 'parallel', concurrency: 3 });
  assert.deepEqual(result.probes.map((p) => p.variant.id), ['baseline', 'verify-first', 'chatty']);
  assert.equal(result.best.variant.id, 'verify-first');
});
