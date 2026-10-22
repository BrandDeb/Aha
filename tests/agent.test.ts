import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Stage } from '../src/lib/agent/stage.ts';
import { workspaceTools, type AgentHost } from '../src/lib/agent/tools.ts';
import { compactMessages, runAgent, truncate, validateArgs } from '../src/lib/agent/loop.ts';
import { callModelFor, parseAnthropicTurn, parseOpenAiTurn, toAnthropicMessages, toOpenAiMessages } from '../src/lib/agent/model.ts';
import { systemPromptFor } from '../src/lib/agent/prompt.ts';
import { getProvider, type ResolvedProvider } from '../src/lib/ai-providers.ts';
import type { AgentEvent, CallModel, Message, ModelTurn, Tool, ToolCall } from '../src/lib/agent/types.ts';

const call = (name: string, args: Record<string, unknown> = {}, id = `${name}-${Math.random()}`): ToolCall => ({ id, name, args });
const say = (text: string): ModelTurn => ({ text, toolCalls: [], stop: 'end' });
const callTools = (...calls: ToolCall[]): ModelTurn => ({ text: '', toolCalls: calls, stop: 'tool_use' });

/** A model that plays back a script, recording what it was asked */
function scripted(turns: (ModelTurn | ((input: Parameters<CallModel>[0]) => ModelTurn))[]) {
  const seen: Parameters<CallModel>[0][] = [];
  let i = 0;
  const model: CallModel = async (input) => {
    seen.push({ ...input, messages: [...input.messages] });
    const next = turns[Math.min(i++, turns.length - 1)];
    return typeof next === 'function' ? next(input) : next;
  };
  return { model, seen };
}

function setup(files: Record<string, string> = { 'src/main.ts': 'console.log(1);\n', 'src/util.ts': 'export const a = 1;\n' }, extra: Partial<AgentHost> = {}) {
  const stage = new Stage(files);
  const host: AgentHost = { stage, entry: 'src/main.ts', ...extra };
  return { stage, host, tools: workspaceTools(host) };
}
const run = async (tools: Tool[], name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.run(args, {});

// ---------------------------------------------------------------------------

test('Stage: edits layer over the project and never change the original', () => {
  const base = { 'a.ts': 'one\n', 'b.ts': 'two\n' };
  const stage = new Stage(base);
  assert.equal(stage.write('a.ts', 'ONE\n'), null);
  assert.equal(stage.write('c.ts', 'three\n'), null);
  assert.equal(stage.delete('b.ts'), null);
  assert.deepEqual(stage.files(), { 'a.ts': 'ONE\n', 'c.ts': 'three\n' });
  assert.deepEqual(stage.changes(), { 'a.ts': 'modified', 'c.ts': 'added', 'b.ts': 'deleted' });
  assert.deepEqual(base, { 'a.ts': 'one\n', 'b.ts': 'two\n' });
  assert.deepEqual(stage.toPut(), { files: { 'a.ts': 'ONE\n', 'c.ts': 'three\n' }, removed: ['b.ts'] });
  assert.deepEqual(stage.toPut(['a.ts']), { files: { 'a.ts': 'ONE\n' }, removed: [] });
  assert.deepEqual(stage.diff('a.ts'), { before: 'one\n', after: 'ONE\n', added: 1, removed: 1 });
  stage.revert('b.ts');
  assert.equal(stage.read('b.ts'), 'two\n');
  stage.write('a.ts', 'one\n'); // writing the original back is no change
  assert.deepEqual(Object.keys(stage.changes()), ['c.ts']);
  stage.delete('c.ts'); // deleting something the agent added just forgets it
  assert.equal(stage.size, 0);
  stage.clear();
});

test('Stage: detects files the user changed while the agent worked', () => {
  const stage = new Stage({ 'a.ts': '1', 'b.ts': '2' });
  stage.write('a.ts', 'agent');
  stage.write('c.ts', 'new');
  assert.deepEqual(stage.conflicts({ 'a.ts': '1', 'b.ts': '2' }), []);
  assert.deepEqual(stage.conflicts({ 'a.ts': 'user edit', 'b.ts': '2' }), ['a.ts']);
  assert.deepEqual(stage.conflicts({ 'a.ts': '1', 'b.ts': '2', 'c.ts': 'user made it too' }), ['c.ts']);
});

test('Stage: rebasing onto the accepted project keeps only what is still pending', () => {
  const stage = new Stage({ 'a.ts': '1', 'b.ts': '2' });
  stage.write('a.ts', 'A');
  stage.write('b.ts', 'B');
  stage.delete('b.ts');
  stage.write('c.ts', 'C');
  stage.rebase({ 'a.ts': 'A', 'b.ts': '2' }); // the user accepted a.ts only
  assert.deepEqual(stage.changes(), { 'b.ts': 'deleted', 'c.ts': 'added' });
  assert.deepEqual(stage.files(), { 'a.ts': 'A', 'c.ts': 'C' });
  stage.rebase({ 'a.ts': 'A', 'c.ts': 'C' });
  assert.equal(stage.size, 0);
});

test('Stage: refuses bad paths, huge files and deleting what does not exist', () => {
  const stage = new Stage({});
  for (const path of ['../evil.ts', '/abs.ts', '.env', 'a b.ts', '']) assert.match(stage.write(path, 'x') ?? '', /not a valid project path/, path);
  assert.match(stage.write('big.ts', 'x'.repeat(600 * 1024)) ?? '', /larger than/);
  assert.match(stage.delete('nope.ts') ?? '', /does not exist/);
});

test('tools: reading, listing and searching see the staged view', async () => {
  const { tools, stage } = setup();
  stage.write('src/new.ts', 'export const fresh = true;\n');
  const list = await run(tools, 'list_files', {});
  assert.match(list.content, /src\/main\.ts .*\[entry\]/);
  assert.match(list.content, /src\/new\.ts .*\[added by you\]/);
  assert.match((await run(tools, 'list_files', { folder: 'src/' })).content, /util\.ts/);

  const read = await run(tools, 'read_file', { path: 'src/main.ts' });
  assert.equal(read.content, 'src/main.ts (2 lines)\n1 | console.log(1);\n2 | ');
  assert.equal((await run(tools, 'read_file', { path: 'nope.ts' })).ok, false);
  assert.match((await run(tools, 'read_file', { path: 'src/main.ts', start_line: 9 })).content, /only 2 lines/);

  assert.match((await run(tools, 'search', { query: 'FRESH' })).content, /src\/new\.ts:1: export const fresh/);
  assert.equal((await run(tools, 'search', { query: 'zzz' })).content, 'No matches.');
  assert.match((await run(tools, 'search', { query: '(', regex: true })).content, /Invalid regular expression/);
  assert.match((await run(tools, 'search', { query: 'const\\s+a', regex: true })).content, /util\.ts:1/);
});

test('tools: long files are read in windows', async () => {
  const { tools } = setup({ 'big.ts': Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n') });
  const first = await run(tools, 'read_file', { path: 'big.ts' });
  assert.match(first.content, /1000 lines\)/);
  assert.match(first.content, /\n400 \| line 400\n… 600 more lines \(ask for start_line=401\)$/);
  assert.match((await run(tools, 'read_file', { path: 'big.ts', start_line: 401, end_line: 403 })).content, /401 \| line 401\n402 \| line 402\n403 \| line 403\n… 597 more lines \(ask for start_line=404\)$/);
});

test('edit_file: exact, unique replacements with errors the model can act on', async () => {
  const { tools, stage } = setup({ 'a.ts': 'const x = 1;\nconst y = 1;\nfoo();\n' });
  assert.match((await run(tools, 'edit_file', { path: 'a.ts', old: 'const', new: 'let' })).content, /appears 2 times/);
  const hint = await run(tools, 'edit_file', { path: 'a.ts', old: 'foo( );', new: 'bar();' });
  assert.equal(hint.ok, false);
  assert.match((await run(tools, 'edit_file', { path: 'a.ts', old: 'const z', new: 'x' })).content, /not found/);
  assert.match((await run(tools, 'edit_file', { path: 'a.ts', old: 'foo();', new: 'foo();' })).content, /identical/);
  assert.match((await run(tools, 'edit_file', { path: 'a.ts', old: '', new: 'x' })).content, /must not be empty/);
  assert.match((await run(tools, 'edit_file', { path: 'zzz.ts', old: 'a', new: 'b' })).content, /does not exist/);

  const one = await run(tools, 'edit_file', { path: 'a.ts', old: 'foo();', new: 'bar($1);' });
  assert.deepEqual([one.ok, stage.read('a.ts')], [true, 'const x = 1;\nconst y = 1;\nbar($1);\n']); // "$1" stays literal
  const all = await run(tools, 'edit_file', { path: 'a.ts', old: 'const', new: 'let', replace_all: true });
  assert.match(all.content, /2 occurrences/);
  assert.equal(stage.read('a.ts'), 'let x = 1;\nlet y = 1;\nbar($1);\n');
  assert.equal(stage.size, 1);
});

test('edit_file: points at the nearest line when whitespace differs', async () => {
  const { tools } = setup({ 'a.ts': 'function f() {\n    return 1;\n}\n' });
  const result = await run(tools, 'edit_file', { path: 'a.ts', old: 'function f() {\n  return 1;\n}', new: 'x' });
  assert.equal(result.ok, false);
  assert.match(result.content, /line 1; the text around it differs/);
});

test('write_file and delete_file work on the stage only', async () => {
  const { tools, stage, host } = setup();
  assert.match((await run(tools, 'write_file', { path: 'src/z.ts', content: 'a\nb\n' })).content, /Created src\/z\.ts/);
  assert.match((await run(tools, 'write_file', { path: 'src/util.ts', content: 'export const a = 2;\n' })).content, /Replaced src\/util\.ts \(\+1 −1/);
  assert.equal((await run(tools, 'write_file', { path: '../x', content: '' })).ok, false);
  assert.equal((await run(tools, 'delete_file', { path: 'src/main.ts' })).ok, true);
  assert.equal((await run(tools, 'delete_file', { path: 'src/main.ts' })).ok, false);
  assert.deepEqual(stage.changes(), { 'src/z.ts': 'added', 'src/util.ts': 'modified', 'src/main.ts': 'deleted' });
  assert.equal(host.entry, 'src/main.ts');
});

test('build and run tools use the staged files; python merges what uv changes into the stage', async () => {
  const seen: Record<string, string>[] = [];
  const { tools, stage } = setup(undefined, {
    build: async (files) => (seen.push(files), { ok: true, text: 'Build succeeded' }),
    runProgram: async (_f, entry, args) => ({ ok: true, text: `ran ${entry} ${args.join(',')}` }),
    python: async () => ({ ok: true, text: 'added', changed: { 'pyproject.toml': '[project]\n' }, removed: ['src/util.ts'] }),
  });
  stage.write('src/main.ts', 'console.log(2);\n');
  assert.equal((await run(tools, 'build', {})).content, 'Build succeeded');
  assert.equal(seen[0]['src/main.ts'], 'console.log(2);\n');
  assert.equal((await run(tools, 'build', { entry: 'nope.ts' })).ok, false);
  assert.equal((await run(tools, 'run_program', { args: ['a', 'b'] })).content, 'ran src/main.ts a,b');
  await run(tools, 'python', { action: 'add', packages: ['httpx'] });
  assert.equal(stage.read('pyproject.toml'), '[project]\n');
  assert.equal(stage.has('src/util.ts'), false);
  assert.deepEqual(workspaceTools({ stage, entry: 'x' }).map((t) => t.name), ['update_plan', 'list_files', 'read_file', 'search', 'write_file', 'edit_file', 'delete_file']);
});

test('validateArgs reports missing and mistyped arguments precisely', () => {
  const spec = workspaceTools({ stage: new Stage({}), entry: 'x' }).find((t) => t.name === 'read_file')!;
  assert.equal(validateArgs(spec, { path: 'a' }), null);
  assert.match(validateArgs(spec, {})!, /Missing required argument “path”/);
  assert.match(validateArgs(spec, { path: 3 })!, /must be string, got number/);
  assert.match(validateArgs(spec, { path: 'a', start_line: 1.5 })!, /must be integer/);
  assert.match(validateArgs(spec, { __invalid: '{"path":' })!, /not valid JSON/);
  const py = workspaceTools({ stage: new Stage({}), entry: 'x', python: async () => ({ ok: true, text: '' }) }).find((t) => t.name === 'python')!;
  assert.match(validateArgs(py, { action: 'rm -rf' })!, /one of: run, add, remove, sync/);
});

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

test('loop: plans, edits, sees the build fail, fixes it, and reports', async () => {
  const buildCalls: string[] = [];
  const { host, tools, stage } = setup({ 'src/main.ts': 'const n: number = "x";\n' }, {
    build: async (files) => {
      buildCalls.push(files['src/main.ts']);
      const good = files['src/main.ts'].includes('42');
      return { ok: good, text: good ? 'Build succeeded' : 'src/main.ts:1:19 error SC2020: Type string is not assignable to number' };
    },
  });
  const plans: string[] = [];
  host.onPlan = (p) => plans.push(p);
  const { model, seen } = scripted([
    callTools(call('update_plan', { steps: '- [ ] fix the type error' })),
    callTools(call('read_file', { path: 'src/main.ts' })),
    callTools(call('build')),
    callTools(call('edit_file', { path: 'src/main.ts', old: '"x"', new: '"y"' })), // a wrong first attempt
    callTools(call('build')),
    callTools(call('edit_file', { path: 'src/main.ts', old: '"y"', new: '42' })),
    callTools(call('build')),
    say('Fixed: n is now 42; the build passes.'),
  ]);
  const events: AgentEvent[] = [];
  const result = await runAgent({ goal: 'Fix the build', system: 'sys', tools, callModel: model, onEvent: (e) => events.push(e) });

  assert.equal(result.reason, 'finished');
  assert.equal(result.summary, 'Fixed: n is now 42; the build passes.');
  assert.equal(stage.read('src/main.ts'), 'const n: number = 42;\n');
  assert.deepEqual(plans, ['- [ ] fix the type error']);
  assert.equal(buildCalls.length, 3);
  assert.equal(result.toolCalls, 7);
  assert.equal(events.filter((e) => e.type === 'result' && !e.result.ok).length, 2);
  assert.equal(events.at(-1)?.type, 'done');
  // The model saw the diagnostics and its own earlier calls in order
  const lastRequest = seen.at(-1)!;
  assert.equal(lastRequest.messages[0].role, 'user');
  assert.ok(lastRequest.messages.some((m) => m.role === 'tool' && m.content.includes('SC2020')));
  assert.equal(lastRequest.tools.length, tools.length);
});

test('loop: unknown tools and bad arguments come back as errors, not crashes', async () => {
  const { tools } = setup();
  const { model } = scripted([callTools(call('format_disk'), call('read_file', { path: 7 })), say('ok')]);
  const events: AgentEvent[] = [];
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: model, onEvent: (e) => events.push(e) });
  const results = events.filter((e): e is Extract<AgentEvent, { type: 'result' }> => e.type === 'result');
  assert.match(results[0].result.content, /no tool called “format_disk”.*read_file/);
  assert.match(results[1].result.content, /must be string/);
  assert.equal(result.reason, 'finished');
  assert.equal(result.toolCalls, 0, 'rejected calls do not spend the tool budget');
});

test('loop: a tool that throws is reported to the model', async () => {
  const boom: Tool = { name: 'boom', description: '', risk: 'read', parameters: { type: 'object', properties: {} }, run: async () => { throw new Error('disk on fire'); } };
  const { model, seen } = scripted([callTools(call('boom')), say('noted')]);
  await runAgent({ goal: 'x', system: 's', tools: [boom], callModel: model });
  assert.match(JSON.stringify(seen[1].messages), /The tool failed: disk on fire/);
});

test('loop: stops at the step budget and asks for an honest summary without tools', async () => {
  const { tools } = setup();
  const { model, seen } = scripted([
    (input) => (input.tools.length ? callTools(call('list_files', {}, `c${seen.length}`)) : say('I listed files repeatedly and did not finish.')),
  ]);
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: model, budget: { maxSteps: 3 } });
  assert.equal(result.reason, 'budget');
  assert.equal(result.steps, 3);
  assert.equal(result.summary, 'I listed files repeatedly and did not finish.');
  assert.equal(seen.at(-1)!.tools.length, 0, 'the wrap-up turn has no tools');
  assert.match((seen.at(-1)!.messages.at(-1) as { content: string }).content, /used all 3 steps/);
});

test('loop: stops at the time and tool-call budgets', async () => {
  const { tools } = setup();
  let clock = 0;
  const { model } = scripted([callTools(call('list_files', {}, 'a')), say('time is up')]);
  const timed = await runAgent({ goal: 'x', system: 's', tools, callModel: model, budget: { maxMillis: 1000 }, now: () => (clock += 600) });
  assert.equal(timed.reason, 'budget');
  assert.equal(timed.summary, 'time is up');

  const { model: m2 } = scripted([(i) => (i.tools.length ? callTools(call('list_files', {}, 'x1'), call('list_files', { folder: 'src' }, 'x2')) : say('stopped'))]);
  const capped = await runAgent({ goal: 'x', system: 's', tools, callModel: m2, budget: { maxToolCalls: 2 } });
  assert.equal(capped.reason, 'budget');
  assert.equal(capped.toolCalls, 2);
});

test('loop: gives up after too many failed builds in a row and reports', async () => {
  let builds = 0;
  let edits = 0;
  const { tools } = setup(undefined, { build: async () => ({ ok: false, text: `error ${++builds}` }) });
  // Each round tries a different edit, then builds again
  const { model, seen } = scripted([(i) => (i.tools.length ? (builds === edits ? callTools(call('write_file', { path: 'src/main.ts', content: `v${++edits}` })) : callTools(call('build'))) : say('Still failing with error 5.'))]);
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: model, budget: { maxFixAttempts: 4 } });
  assert.equal(result.reason, 'budget');
  assert.equal(builds, 5, 'the limit is attempts after the first failure');
  assert.equal(result.summary, 'Still failing with error 5.');
  assert.equal(seen.at(-1)!.tools.length, 0);
});

test('loop: a passing build resets the fix-attempt count', async () => {
  let n = 0;
  let edits = 0;
  const { tools } = setup(undefined, { build: async () => ({ ok: ++n % 3 === 0, text: n % 3 === 0 ? 'ok' : 'bad' }) });
  const turns = [...Array.from({ length: 9 }, () => (i: unknown) => (void i, n === edits ? callTools(call('write_file', { path: 'a.ts', content: `v${++edits}` })) : callTools(call('build')))), say('done')];
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: scripted(turns as never).model, budget: { maxFixAttempts: 2 } });
  assert.equal(result.reason, 'finished');
});

test('loop: an unchanged build that fails again is a repeat, but a build after an edit is not', async () => {
  let builds = 0;
  const { tools } = setup(undefined, { build: async () => ({ ok: false, text: `error ${++builds}` }) });
  const events: AgentEvent[] = [];
  const stalled = await runAgent({ goal: 'x', system: 's', tools, callModel: scripted([(i) => (i.tools.length ? callTools(call('build')) : say('stuck'))]).model, budget: { maxFixAttempts: 99 }, onEvent: (e) => events.push(e) });
  assert.equal(stalled.reason, 'stuck');
  assert.equal(builds, 5);
});

test('loop: repeating the same failing call is warned about, then stopped', async () => {
  const { tools } = setup();
  const { model } = scripted([(i) => (i.tools.length ? callTools(call('read_file', { path: 'missing.ts' })) : say('I could not find missing.ts.'))]);
  const events: AgentEvent[] = [];
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: model, onEvent: (e) => events.push(e) });
  assert.equal(result.reason, 'stuck');
  const results = events.filter((e): e is Extract<AgentEvent, { type: 'result' }> => e.type === 'result');
  assert.equal(results.length, 5);
  assert.match(results[2].result.content, /third time this exact call has failed/);
  assert.doesNotMatch(results[1].result.content, /third time/);
});

test('loop: commands that leave the sandbox need approval', async () => {
  const ran: string[] = [];
  const exec: Tool = { name: 'python', description: '', risk: 'exec', parameters: { type: 'object', properties: {} }, run: async () => (ran.push('x'), { ok: true, content: 'ran' }) };
  const turns = () => scripted([callTools(call('python')), say('done')]);

  // No approver: refused
  let seenMessages: Message[] = [];
  const refused = turns();
  await runAgent({ goal: 'x', system: 's', tools: [exec], callModel: async (i) => { seenMessages = i.messages; return refused.model(i); } });
  assert.deepEqual(ran, []);
  assert.match(JSON.stringify(seenMessages), /did not allow this action/);

  // Declined
  const events: AgentEvent[] = [];
  await runAgent({ goal: 'x', system: 's', tools: [exec], callModel: turns().model, approve: async () => false, onEvent: (e) => events.push(e) });
  assert.deepEqual(ran, []);
  assert.deepEqual(events.filter((e) => e.type === 'approval').map((e) => (e as { approved: boolean }).approved), [false]);

  // Approved, and the approver is told what is being asked
  const asked: string[] = [];
  const result = await runAgent({ goal: 'x', system: 's', tools: [exec], callModel: turns().model, approve: async (c, spec) => (asked.push(`${c.name}:${spec.risk}`), true) });
  assert.deepEqual(asked, ['python:exec']);
  assert.deepEqual(ran, ['x']);
  assert.equal(result.reason, 'finished');

  // The user can choose to trust a risk level for the run
  await runAgent({ goal: 'x', system: 's', tools: [exec], callModel: turns().model, autoApprove: ['read', 'stage', 'build', 'exec'] });
  assert.equal(ran.length, 2);
});

test('loop: abort stops promptly, including during a model call', async () => {
  const { tools } = setup();
  const pre = new AbortController();
  pre.abort();
  assert.equal((await runAgent({ goal: 'x', system: 's', tools, callModel: scripted([say('x')]).model, signal: pre.signal })).reason, 'aborted');

  const during = new AbortController();
  const slow: CallModel = ({ signal }) =>
    new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const pending = runAgent({ goal: 'x', system: 's', tools, callModel: slow, signal: during.signal });
  setTimeout(() => during.abort(), 10);
  assert.equal((await pending).reason, 'aborted');
});

test('loop: retries a busy model once, then reports other failures', async () => {
  const { tools } = setup();
  let n = 0;
  const flaky: CallModel = async () => {
    if (++n === 1) throw new Error('Groq rate limit reached: slow down');
    return say('hello');
  };
  const events: AgentEvent[] = [];
  const result = await runAgent({ goal: 'x', system: 's', tools, callModel: flaky, sleep: async () => {}, onEvent: (e) => events.push(e) });
  assert.equal(result.reason, 'finished');
  assert.ok(events.some((e) => e.type === 'notice'));

  const broken = await runAgent({ goal: 'x', system: 's', tools, callModel: async () => { throw new Error('Gemini rejected the API key'); }, sleep: async () => {} });
  assert.equal(broken.reason, 'error');
  assert.match(broken.summary, /rejected the API key/);

  let tries = 0;
  const always = await runAgent({ goal: 'x', system: 's', tools, callModel: async () => { tries++; throw new Error('503 overloaded'); }, sleep: async () => {}, modelRetries: 2 });
  assert.equal(always.reason, 'error');
  assert.equal(tries, 3);
});

test('loop: a refusal ends the run as declined; follow-ups carry history', async () => {
  const { tools } = setup();
  const refused = await runAgent({ goal: 'x', system: 's', tools, callModel: async () => ({ text: 'I can’t help with that.', toolCalls: [], stop: 'refusal' }) });
  assert.equal(refused.reason, 'declined');

  const { model, seen } = scripted([say('first'), say('second')]);
  const one = await runAgent({ goal: 'one', system: 's', tools, callModel: model });
  await runAgent({ goal: 'two', system: 's', tools, callModel: model, history: one.messages });
  assert.deepEqual(seen[1].messages.map((m) => m.role), ['user', 'assistant', 'user']);
});

test('truncate and compactMessages keep the conversation within bounds', () => {
  assert.equal(truncate('short'), 'short');
  const long = truncate('a'.repeat(20_000), 1000);
  assert.ok(long.length < 1100);
  assert.match(long, /19000 characters omitted/);

  const messages: Message[] = [];
  for (let i = 0; i < 20; i++) messages.push({ role: 'tool', callId: `c${i}`, name: 'read_file', content: 'x'.repeat(10_000), ok: true });
  const compact = compactMessages(messages, 50_000);
  assert.match((compact[0] as { content: string }).content, /earlier output removed/);
  assert.equal((compact.at(-1) as { content: string }).content.length, 10_000, 'recent results are kept whole');
  assert.equal(compactMessages(messages.slice(0, 2), 50_000).length, 2);
  assert.equal(messages[0].role === 'tool' && messages[0].content.length, 10_000, 'the original is not modified');
});

test('project notes (AGENTS.md) join the system prompt', () => {
  assert.doesNotMatch(systemPromptFor({ 'a.ts': '' }), /Project notes/);
  assert.match(systemPromptFor({ 'AGENTS.md': 'Use 2-space indent.' }), /Project notes \(AGENTS\.md\):\nUse 2-space indent\./);
  assert.match(systemPromptFor({ 'AGENTS.md': 'x'.repeat(9000) }), /truncated/);
});

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

const conversation: Message[] = [
  { role: 'user', content: 'fix it' },
  { role: 'assistant', content: 'Looking.', toolCalls: [{ id: 'c1', name: 'read_file', args: { path: 'a.ts' } }, { id: 'c2', name: 'search', args: { query: 'x' } }] },
  { role: 'tool', callId: 'c1', name: 'read_file', content: '1 | x', ok: true },
  { role: 'tool', callId: 'c2', name: 'search', content: 'No matches.', ok: false },
];

test('OpenAI format: tool calls carry JSON-string arguments and results use tool_call_id', () => {
  const wire = toOpenAiMessages('SYS', conversation) as Record<string, unknown>[];
  assert.deepEqual(wire[0], { role: 'system', content: 'SYS' });
  assert.deepEqual(wire[2], {
    role: 'assistant',
    content: 'Looking.',
    tool_calls: [
      { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } },
      { id: 'c2', type: 'function', function: { name: 'search', arguments: '{"query":"x"}' } },
    ],
  });
  assert.deepEqual(wire[3], { role: 'tool', tool_call_id: 'c1', content: '1 | x' });
  assert.equal((toOpenAiMessages('s', [{ role: 'assistant', content: '', toolCalls: [{ id: 'a', name: 'n', args: {} }] }])[1] as { content: unknown }).content, null);
});

test('OpenAI replies: tool calls (string or object arguments), text, truncation and filters', () => {
  const calls = parseOpenAiTurn({
    choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 't1', function: { name: 'read_file', arguments: '{"path":"a.ts"}' } }, { function: { name: 'search', arguments: { query: 'q' } } }] } }],
    usage: { prompt_tokens: 10, completion_tokens: 3 },
  });
  assert.deepEqual(calls.toolCalls, [{ id: 't1', name: 'read_file', args: { path: 'a.ts' } }, { id: 'call_1', name: 'search', args: { query: 'q' } }]);
  assert.deepEqual([calls.stop, calls.usage], ['tool_use', { input: 10, output: 3 }]);
  assert.equal(parseOpenAiTurn({ choices: [{ finish_reason: 'stop', message: { content: 'done' } }] }).text, 'done');
  assert.equal(parseOpenAiTurn({ choices: [{ finish_reason: 'length', message: { content: 'cut' } }] }).stop, 'length');
  assert.equal(parseOpenAiTurn({ choices: [{ finish_reason: 'content_filter', message: { content: '' } }] }).stop, 'refusal');
  const garbled = parseOpenAiTurn({ choices: [{ message: { tool_calls: [{ id: 'g', function: { name: 'edit_file', arguments: '{"path": "a' } }] } }] });
  assert.match(String(garbled.toolCalls[0].args.__invalid), /"path"/);
  assert.throws(() => parseOpenAiTurn({}), /empty response/);
});

test('Anthropic format: tool_use blocks, and all results for a turn in one user message', () => {
  const wire = toAnthropicMessages(conversation) as { role: string; content: unknown }[];
  assert.equal(wire.length, 3);
  assert.deepEqual(wire[1].content, [
    { type: 'text', text: 'Looking.' },
    { type: 'tool_use', id: 'c1', name: 'read_file', input: { path: 'a.ts' } },
    { type: 'tool_use', id: 'c2', name: 'search', input: { query: 'x' } },
  ]);
  assert.deepEqual(wire[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'c1', content: '1 | x', is_error: false },
      { type: 'tool_result', tool_use_id: 'c2', content: 'No matches.', is_error: true },
    ],
  });
  const reply = parseAnthropicTurn({
    content: [{ type: 'text', text: 'Let me look. ' }, { type: 'tool_use', id: 'tu1', name: 'read_file', input: { path: 'a.ts' } }],
    stop_reason: 'tool_use',
    usage: { input_tokens: 5, output_tokens: 2 },
  });
  assert.deepEqual([reply.text, reply.toolCalls, reply.stop], ['Let me look. ', [{ id: 'tu1', name: 'read_file', args: { path: 'a.ts' } }], 'tool_use']);
  assert.equal(parseAnthropicTurn({ content: [{ type: 'text', text: 'x' }], stop_reason: 'max_tokens' }).stop, 'length');
  assert.equal(parseAnthropicTurn({ content: [], stop_reason: 'refusal' }).stop, 'refusal');
});

function target(id: string): ResolvedProvider {
  const provider = getProvider(id)!;
  return { provider, baseUrl: provider.baseUrl, apiKey: 'sk-test', model: 'm-1' };
}

test('callModelFor: posts the right request per provider and explains failures', async () => {
  const sent: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const reply = (payload: unknown, status = 200) => async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), headers: init!.headers as Record<string, string>, body: JSON.parse(String(init!.body)) });
    return new Response(JSON.stringify(payload), { status });
  };
  const tools = workspaceTools({ stage: new Stage({}), entry: 'x' }).slice(0, 2);

  const openai = callModelFor(target('groq'), reply({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }) as typeof fetch);
  assert.equal((await openai({ system: 'S', messages: conversation, tools })).text, 'hi');
  assert.equal(sent[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(sent[0].headers.Authorization, 'Bearer sk-test');
  assert.equal((sent[0].body.tools as unknown[]).length, 2);
  assert.equal(sent[0].body.model, 'm-1');

  const anthropic = callModelFor(target('anthropic'), reply({ content: [{ type: 'text', text: 'hey' }], stop_reason: 'end_turn' }) as typeof fetch);
  assert.equal((await anthropic({ system: 'S', messages: conversation, tools })).text, 'hey');
  assert.match(sent[1].url, /\/v1\/messages$/);
  assert.equal(sent[1].headers['x-api-key'], 'sk-test');
  assert.equal(sent[1].headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal((sent[1].body.tools as { input_schema: unknown }[])[0].input_schema !== undefined, true);

  const rejected = callModelFor(target('groq'), reply({ error: { message: 'Invalid API Key' } }, 401) as typeof fetch);
  await assert.rejects(rejected({ system: 'S', messages: conversation, tools }), /Groq rejected the API key/);
  const offline = callModelFor(target('ollama'), (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
  await assert.rejects(offline({ system: 'S', messages: conversation, tools }), /Couldn't reach Ollama/);
});
