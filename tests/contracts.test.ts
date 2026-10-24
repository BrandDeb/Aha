import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContracts, CONTRACTS_FILE, contractsOf, describeContracts, globToRegExp, parseContracts, serializeContracts, type Contract } from '../src/lib/contracts.ts';
import { Stage } from '../src/lib/agent/stage.ts';
import { workspaceTools } from '../src/lib/agent/tools.ts';
import { chipsFor, evidenceFrom, verdict } from '../src/lib/agent/evidence.ts';
import { isHarnessFile } from '../src/lib/agent/harness.ts';
import { systemPromptFor } from '../src/lib/agent/prompt.ts';
import type { AgentEvent } from '../src/lib/agent/types.ts';

const RULES: Omit<Contract, 'id'>[] = [
  { rule: 'No console.log in src', kind: 'forbid', pattern: 'console\\.log\\(', files: 'src/**/*.ts' },
  { rule: 'Every source file has the header', kind: 'require', pattern: '^// Copyright', files: 'src/**/*.ts' },
  { rule: 'The tests pass', kind: 'command', command: 'npm test', expect: 'pass' },
];
const contractsFile = JSON.stringify({ contracts: RULES });
const project = {
  [CONTRACTS_FILE]: contractsFile,
  'src/main.ts': '// Copyright Acme\nimport { add } from "./lib/add";\nprocess.stdout.write(String(add(1, 2)));\n',
  'src/lib/add.ts': '// Copyright Acme\nexport const add = (a: number, b: number) => a + b;\n',
  'scripts/debug.ts': 'console.log("fine here");\n',
};

test('globs: folders, any depth, alternatives', () => {
  assert.ok(globToRegExp('src/**/*.ts').test('src/main.ts'));
  assert.ok(globToRegExp('src/**/*.ts').test('src/a/b/c.ts'));
  assert.ok(!globToRegExp('src/**/*.ts').test('scripts/x.ts'));
  assert.ok(!globToRegExp('src/*.ts').test('src/a/b.ts'));
  assert.ok(globToRegExp('**/*.{ts,tsx}').test('a/b.tsx'));
  assert.ok(globToRegExp('**/*').test('README.md'));
});

test('parsing: ids from the rule, every mistake explained', () => {
  const parsed = parseContracts(contractsFile);
  assert.ok('contracts' in parsed);
  assert.deepEqual(parsed.contracts.map((c) => c.id), ['no-console-log-in-src', 'every-source-file-has-the-header', 'the-tests-pass']);
  assert.match((parseContracts('{') as { error: string }).error, /not valid JSON/);
  assert.match((parseContracts('{"contracts":[{"rule":"x","kind":"maybe"}]}') as { error: string }).error, /forbid, require or command/);
  assert.match((parseContracts('{"contracts":[{"rule":"x","kind":"forbid","pattern":"("}]}') as { error: string }).error, /not a valid regular expression/);
  assert.match((parseContracts('{"contracts":[{"rule":"x","kind":"command"}]}') as { error: string }).error, /no "command"/);
  // round trip
  assert.deepEqual(parseContracts(serializeContracts(parsed.contracts)), parsed);
});

test('checking: patterns where they apply, commands through the runner, skipped without one', async () => {
  const ok = await checkContracts(project, async () => ({ code: 0, output: '3 tests pass' }));
  assert.deepEqual(ok.map((r) => r.status), ['pass', 'pass', 'pass'], describeContracts(ok));
  const noRunner = await checkContracts(project);
  assert.equal(noRunner[2].status, 'skip');

  const broken = { ...project, 'src/lib/add.ts': 'export const add = (a: number, b: number) => {\n  console.log(a, b);\n  return a + b;\n};\n' };
  const results = await checkContracts(broken, async () => ({ code: 1, output: 'FAIL add\n1 failed' }));
  assert.deepEqual(results.map((r) => r.status), ['fail', 'fail', 'fail']);
  assert.deepEqual(results[0].where, [{ path: 'src/lib/add.ts', line: 2, text: 'console.log(a, b);' }]);
  assert.deepEqual(results[1].where, [{ path: 'src/lib/add.ts' }]);
  assert.match(results[2].detail, /exited with 1:\n[\s\S]*FAIL add/);
  const text = describeContracts(results);
  assert.match(text, /^3 of 3 contracts are broken\./);
  assert.equal(results[0].detail, "Found in src/lib/add.ts");
  assert.match(text, /src\/lib\/add\.ts:2 {2}console\.log/);

  const unavailable = await checkContracts(project, async () => ({ code: null, output: '', unavailable: true, error: 'not here' }));
  assert.equal(unavailable[2].status, 'skip');
  const unreadable = await checkContracts({ [CONTRACTS_FILE]: '{"contracts": 3}' });
  assert.equal(unreadable[0].status, 'fail', 'a broken contracts file is never silently ignored');
});

test('the agent: told the rules, given check_contracts, and its proposals judged by them', async () => {
  assert.match(systemPromptFor(project), /must stay true[\s\S]*- No console\.log in src/);
  assert.equal(contractsOf({}).contracts.length, 0);
  assert.doesNotMatch(systemPromptFor({ 'a.ts': '' }), /contracts/);

  const stage = new Stage(project);
  const commands: string[] = [];
  const tools = workspaceTools({ stage, entry: 'src/main.ts', runContractCommand: async (files, command) => {
    commands.push(command);
    return { code: files['src/lib/add.ts'].includes('console.log') ? 1 : 0, output: 'pass' };
  } });
  const check = tools.find((t) => t.name === 'check_contracts')!;
  assert.equal(check.risk, 'exec', 'a command contract runs on the host');
  assert.equal((await check.run({}, {} as never)).ok, true);
  stage.write('src/lib/add.ts', '// Copyright Acme\nexport const add = (a: number, b: number) => { console.log(a); return a + b; };\n');
  const failed = await check.run({}, {} as never);
  assert.equal(failed.ok, false);
  assert.match(failed.content, /✕ No console\.log in src/);
  assert.deepEqual(commands, ['npm test', 'npm test'], 'against the staged files');

  const run = { reason: 'finished' as const, steps: 3, toolCalls: 3, usage: { input: 1, output: 1 }, ms: 10 };
  const events = (ok: boolean): AgentEvent[] => [
    { type: 'tool', call: { id: 'b', name: 'build', args: {} }, risk: 'build' },
    { type: 'result', call: { id: 'b', name: 'build', args: {} }, result: { ok: true, content: '' } },
    { type: 'tool', call: { id: 'c', name: 'check_contracts', args: {} }, risk: 'exec' },
    { type: 'result', call: { id: 'c', name: 'check_contracts', args: {} }, result: { ok, content: '' } },
  ] as AgentEvent[];
  const bad = evidenceFrom(run, events(false), stage, isHarnessFile);
  assert.deepEqual(bad.contracts, { total: 3, broken: ['No console.log in src'], checked: false });
  assert.equal(verdict(bad).headline, 'Breaks a contract');
  assert.ok(chipsFor(bad).some((c) => c.label === 'breaks 1 contract' && c.tone === 'bad'));

  const fixed = new Stage(project);
  fixed.write('src/lib/add.ts', '// Copyright Acme\nexport const add = (a: number, b: number) => a + b + 0;\n');
  const good = evidenceFrom(run, events(true), fixed, isHarnessFile);
  assert.deepEqual(verdict(good), { verified: true, headline: 'Verified' });
  assert.ok(chipsFor(good).some((c) => c.label === 'contracts ✓ 3/3'));

  // Loosening a rule is never quietly verified
  const loosened = new Stage(project);
  loosened.write('src/lib/add.ts', '// Copyright Acme\nexport const add = (a: number, b: number) => a + b + 0;\n');
  loosened.write(CONTRACTS_FILE, JSON.stringify({ contracts: RULES.slice(1) }));
  const sneaky = evidenceFrom(run, events(true), loosened, isHarnessFile);
  assert.equal(sneaky.contractsChanged, true);
  assert.equal(verdict(sneaky).headline, 'Changes a contract: review carefully');
});

test('the worker: a broken contract is the next task after a failure, keyed so moving a line does not repeat it', async () => {
  const { discoverTasks } = await import('../src/lib/worker.ts');
  const tasks = discoverTasks({
    files: { 'src/a.ts': '// TODO: something later\n' },
    failure: { signature: 's', title: 'boom', brief: 'fix boom' },
    brokenContracts: [{ id: 'no-console', rule: 'No console.log in src', report: '✕ No console.log in src — Found in src/a.ts\n    src/a.ts:3', signature: 'src/a.ts' }],
    problems: [{ file: 'src/a.ts', line: 1, message: 'x' }],
  });
  assert.deepEqual(tasks.map((t) => t.kind).slice(0, 3), ['failure', 'contract', 'problem']);
  const contract = tasks[1];
  assert.match(contract.brief, /never by changing the contract/);
  assert.match(contract.brief, /check_contracts/);
  const moved = discoverTasks({ files: {}, brokenContracts: [{ id: 'no-console', rule: 'r', report: 'different line numbers', signature: 'src/a.ts' }] });
  assert.equal(moved[0].key, contract.key);
});
