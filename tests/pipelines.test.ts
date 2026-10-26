/* eslint-disable @typescript-eslint/no-explicit-any -- the assertions walk parsed YAML documents, which are untyped */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';

process.env.AHA_HOME = mkdtempSync(path.join(tmpdir(), 'aha-ci-'));
const { detectStacks } = await import('../src/lib/pipelines/stack.ts');
const { deployAvailability, generatePipeline } = await import('../src/lib/pipelines/generate.ts');
const { condition, evaluate, expand, jobOrder, parsePipeline, pipelineFiles } = await import('../src/lib/pipelines/parse.ts');
const { parseEnvFile, parsePipelineRunRequest, runPipeline } = await import('../src/lib/pipelines/run.ts');
type Pipeline = import('../src/lib/pipelines/parse.ts').Pipeline;
type Generated = import('../src/lib/pipelines/generate.ts').Generated;

const vite = {
  'package.json': JSON.stringify({ name: 'site', scripts: { dev: 'vite', build: 'vite build', lint: 'eslint .', test: 'vitest run' }, devDependencies: { vite: '^7', react: '^19' } }),
  'package-lock.json': '{}',
  'index.html': '<div id="root"></div>',
  'tsconfig.json': '{}',
};

test('stacks: read from the project’s own files', () => {
  const [node] = detectStacks(vite);
  assert.equal(node.name, 'Vite · React · npm');
  assert.deepEqual(node.install, ['npm ci']);
  assert.deepEqual(node.checks.map((c) => c.run), ['npm run lint', 'npx tsc --noEmit', 'npm run test', 'npm run build']);
  assert.equal(node.staticDir, 'dist');
  assert.equal(node.setup.at(-1)!.with!.cache, 'npm');

  const noLock = detectStacks({ 'package.json': JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' }, dependencies: { a: '1' } }) })[0];
  assert.deepEqual(noLock.install, ['npm install --no-audit --no-fund'], 'no lockfile: npm install, and no cache');
  assert.equal(noLock.setup[0].with!.cache, undefined);
  assert.equal(noLock.checks.length, 0, 'the npm placeholder test script is not a test');

  assert.equal(detectStacks({ 'pnpm-lock.yaml': '', 'package.json': '{"scripts":{"build":"tsc"},"dependencies":{"a":"1"}}' })[0].setup[0].uses.split('@')[0], 'pnpm/action-setup');
  assert.equal(detectStacks({ 'src/main.ts': 'console.log(1)' })[0].id, 'scriptc', 'a bare TypeScript project is scriptc');
  const py = detectStacks({ 'pyproject.toml': '[project]\nname="x"\nrequires-python=">=3.12"\ndependencies=["pytest","ruff"]\n', 'uv.lock': '', 'tests/test_x.py': '' })[0];
  assert.equal(py.name, 'Python · uv');
  assert.deepEqual(py.install, ['uv sync --locked']);
  assert.deepEqual(py.checks.map((c) => c.run), ['uvx ruff check .', 'uv run pytest']);
  assert.equal(py.setup[0].with!['python-version'], '3.12');
  assert.equal(detectStacks({ 'go.mod': 'module x\n\ngo 1.24\n' })[0].setup[0].with!['go-version'], '1.24');
  assert.match(detectStacks({ 'Cargo.toml': '[package]\nname = "tool"\n' })[0].binary!.output('x', '.exe'), /target\/release\/tool\.exe/);
  assert.deepEqual(detectStacks({ 'package.json': '{"scripts":{"dev":"vite"},"devDependencies":{"vite":"1"}}', 'pyproject.toml': '[project]\nname="api"\n' }).map((s) => s.id), ['node', 'python'], 'a web app with a Python API: both');
  assert.deepEqual(detectStacks({ 'README.md': '' }), []);
});

test('GitHub Actions: checks on every push and PR, deploys only from main', () => {
  const stacks = detectStacks(vite);
  const plain = generatePipeline(stacks, vite, { provider: 'github' }) as Generated;
  assert.equal(plain.path, '.github/workflows/ci.yml');
  assert.match(plain.content, /^# GitHub Actions for Vite/);
  assert.match(plain.content, /\n {2}pull_request:\n/, 'idiomatic empty triggers');
  const doc = yaml.load(plain.content) as Record<string, any>;
  assert.deepEqual(Object.keys(doc.jobs), ['check']);
  assert.deepEqual(doc.permissions, { contents: 'read' });
  assert.deepEqual(doc.jobs.check.steps.map((s: any) => s.uses?.split('@')[0] ?? s.run), ['actions/checkout', 'actions/setup-node', 'npm ci', 'npm run lint', 'npx tsc --noEmit', 'npm run test', 'npm run build']);

  const pages = yaml.load((generatePipeline(stacks, vite, { provider: 'github', deploy: 'pages', branch: 'trunk' }) as Generated).content) as Record<string, any>;
  assert.equal(pages.jobs.deploy.if, "github.event_name == 'push' && github.ref == 'refs/heads/trunk'");
  assert.deepEqual(pages.jobs.deploy.permissions, { contents: 'read', pages: 'write', 'id-token': 'write' });
  assert.equal(pages.jobs.deploy.steps.find((s: any) => s.uses?.startsWith('actions/upload-pages-artifact')).with.path, 'dist');
  assert.equal(pages.jobs.deploy.steps.filter((s: any) => s.run).map((s: any) => s.run).join(','), 'npm ci,npm run build', 'the deploy only builds');

  const vercel = generatePipeline(stacks, vite, { provider: 'github', deploy: 'vercel' }) as Generated;
  assert.deepEqual(vercel.secrets, ['VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID']);
  assert.ok(!/secrets\.\w+ \}\}[^\n]*\n[^\n]*VERCEL_TOKEN=/.test(vercel.content));

  const go = { 'go.mod': 'module x\n\ngo 1.24\n', 'main.go': 'package main' };
  const release = yaml.load((generatePipeline(detectStacks(go), go, { provider: 'github', deploy: 'release', name: 'My Tool' }) as Generated).content) as Record<string, any>;
  assert.deepEqual(release.on.push.tags, ['v*']);
  assert.deepEqual(release.jobs.release.strategy.matrix.os, ['ubuntu-latest', 'macos-latest', 'windows-latest']);
  assert.match(release.jobs.release.steps.find((s: any) => s.name === 'Build the binary').run, /-o my-tool\$\{\{ runner\.os == 'Windows' && '\.exe' \|\| '' \}\}/);

  assert.deepEqual(deployAvailability('docker', stacks[0], vite, 'github'), { ok: false, reason: 'Needs a Dockerfile. Ask the agent to write one, then come back.' });
  assert.equal(deployAvailability('release', stacks[0], vite, 'github').ok, false);
  assert.equal(deployAvailability('pages', detectStacks(go)[0], go, 'github').ok, false);
  assert.match((generatePipeline([], {}, { provider: 'github' }) as { error: string }).error, /could not tell/);
});

test('GitLab CI: stages, images, and deploys on the default branch', () => {
  const stacks = detectStacks(vite);
  const doc = yaml.load((generatePipeline(stacks, vite, { provider: 'gitlab', deploy: 'pages' }) as Generated).content) as Record<string, any>;
  assert.deepEqual(doc.stages, ['check', 'deploy']);
  assert.equal(doc.check.image, 'node:24');
  assert.deepEqual(doc.check.script, ['npm ci', 'npm run lint', 'npx tsc --noEmit', 'npm run test', 'npm run build']);
  assert.deepEqual(doc.pages.artifacts.paths, ['public']);
  assert.equal(doc.pages.script.at(-1), 'rm -rf public && mv dist public');
  assert.deepEqual(doc.pages.rules, [{ if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH' }]);
  const rust = { 'Cargo.toml': '[package]\nname="t"\n' };
  assert.equal((yaml.load((generatePipeline(detectStacks(rust), rust, { provider: 'gitlab' }) as Generated).content) as any).check.script[0], 'rustup component add clippy rustfmt');
});

test('expressions: the subset workflows use', () => {
  const ctx: Record<string, any> = { github: { ref: 'refs/heads/main', event_name: 'push' }, runner: { os: 'Windows' }, matrix: { node: '22' } };
  const resolve = (p: string[]) => p.reduce<any>((v, k) => v?.[k], ctx);
  assert.equal(evaluate("github.event_name == 'push' && github.ref == 'refs/heads/main'", resolve), true);
  assert.equal(evaluate("runner.os == 'Windows' && '.exe' || ''", resolve), '.exe');
  assert.equal(evaluate("startsWith(github.ref, 'refs/tags/v')", resolve), false);
  assert.equal(evaluate("contains(fromJSON('[\"a\",\"b\"]'), 'b') && !false", resolve), true);
  assert.equal(evaluate("format('node-{0}', matrix.node)", resolve), 'node-22');
  assert.equal(evaluate("'it''s' == 'IT''S'", resolve), true, 'quotes escape by doubling; == ignores case');
  assert.equal(expand('v${{ matrix.node }}-${{ unknown.thing }}', resolve), 'v22-');
  assert.equal(condition(undefined, resolve, { failed: true }), false, 'after a failure, steps stop');
  assert.equal(condition('always()', resolve, { failed: true }), true);
  assert.equal(condition('${{ failure() }}', resolve, { failed: true }), true);
  assert.equal(condition("github.ref == 'refs/heads/main'", resolve, { failed: true }), false, 'a plain condition implies success()');
  const gl = (p: string[]) => ({ CI_COMMIT_BRANCH: 'local', CI_DEFAULT_BRANCH: 'main' } as Record<string, string>)[p[1]];
  assert.equal(evaluate('$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH', gl), false);
  assert.equal(evaluate('$CI_COMMIT_BRANCH =~ /^loc/ && $MISSING == null', gl), true);
});

test('parsing: local plans, skipped deploys, job order', () => {
  const stacks = detectStacks(vite);
  const generated = generatePipeline(stacks, vite, { provider: 'github', deploy: 'pages' }) as Generated;
  const p = parsePipeline(generated.path, generated.content) as Pipeline;
  assert.deepEqual(p.jobs.map((j) => [j.id, j.needs]), [['check', []], ['deploy', ['check']]]);
  assert.deepEqual(p.jobs[0].steps.map((s) => s.kind), ['checkout', 'setup', 'run', 'run', 'run', 'run', 'run']);
  assert.equal(p.jobs[0].steps[1].tool, 'node');
  assert.match(p.jobs[1].steps.at(-1)!.note!, /deploys run on GitHub/);
  assert.deepEqual(jobOrder(p, 'deploy').map((j) => j.id), ['check', 'deploy']);
  assert.deepEqual(pipelineFiles({ ...vite, [generated.path]: '', '.gitlab-ci.yml': '', '.github/workflows/sub/x.yml': '' }), ['.github/workflows/ci.yml', '.gitlab-ci.yml']);

  const gitlab = parsePipeline('.gitlab-ci.yml', [
    'stages: [build, test, deploy]',
    'variables: { GREETING: hi }',
    '.base: { image: node:24, before_script: [npm ci] }',
    'build: { extends: .base, stage: build, script: [npm run build] }',
    'test: { extends: .base, stage: test, script: [npm test], after_script: [echo done] }',
    'deploy: { stage: deploy, script: [./deploy.sh], rules: [{ if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH" }] }',
    'release: { stage: deploy, script: [x], when: manual }',
  ].join('\n')) as Pipeline;
  assert.deepEqual(gitlab.jobs.map((j) => j.id), ['build', 'test', 'deploy', 'release']);
  assert.deepEqual(gitlab.jobs[1].steps.map((s) => s.run), ['npm ci', 'npm test', 'echo done']);
  assert.deepEqual(gitlab.jobs[1].needs, ['build'], 'a stage waits for the earlier ones');
  assert.match(gitlab.jobs[2].skip!, /rules don’t match a local run/);
  assert.match(gitlab.jobs[3].skip!, /manual/);
  assert.equal(gitlab.jobs[0].env.GREETING, 'hi');
  assert.match((parsePipeline('.github/workflows/x.yml', 'jobs: [') as { error: string }).error, /isn’t valid YAML/);
});

test('requests: only CI files, inside the project', () => {
  const ok = { projectId: 'abcdefgh12', files: { '.gitlab-ci.yml': 'x: 1' }, file: '.gitlab-ci.yml' };
  assert.ok(!('error' in parsePipelineRunRequest(ok)));
  assert.match((parsePipelineRunRequest({ ...ok, file: 'deploy.sh' }) as { error: string }).error, /workflow/);
  assert.match((parsePipelineRunRequest({ ...ok, files: { '../x': '', '.gitlab-ci.yml': '' } }) as { error: string }).error, /Invalid file path/);
  assert.match((parsePipelineRunRequest({ ...ok, file: '.github/workflows/ci.yml' }) as { error: string }).error, /isn’t in the project/);
  assert.deepEqual(parseEnvFile('A=1\nB<<EOF\nline 1\nline 2\nEOF\nC=x=y'), { A: '1', B: 'line 1\nline 2', C: 'x=y' });
});

test('local run: steps in order, env and outputs between steps, failures stop the job, deploys skipped', { skip: process.platform === 'win32' }, async () => {
  const workflow = [
    'name: CI',
    'on: [push]',
    'env: { GREETING: hello }',
    'jobs:',
    '  check:',
    '    runs-on: ubuntu-latest',
    '    strategy: { matrix: { node: [22, 24] } }',
    '    steps:',
    '      - uses: actions/checkout@v7',
    '      - uses: actions/cache@v4',
    '      - id: first',
    '        run: |',
    '          echo "WHO=world" >> "$GITHUB_ENV"',
    '          echo "answer=42" >> "$GITHUB_OUTPUT"',
    '          test -f src/app.txt',
    '      - name: Use them',
    '        run: echo "$GREETING $WHO ${{ steps.first.outputs.answer }} node-${{ matrix.node }} ci=$CI"',
    '      - name: Fails',
    '        run: exit 3',
    '      - name: Never',
    '        run: echo never',
    '      - name: Cleanup',
    '        if: always()',
    '        run: echo cleanup',
    '  deploy:',
    '    needs: check',
    "    if: github.ref == 'refs/heads/main'",
    '    runs-on: ubuntu-latest',
    '    steps: [{ run: echo deploying }]',
  ].join('\n');
  const events: any[] = [];
  let output = '';
  const result = await runPipeline(
    { projectId: 'pipeline-test-1', files: { '.github/workflows/ci.yml': workflow, 'src/app.txt': 'x' }, file: '.github/workflows/ci.yml' },
    { onEvent: (e) => { events.push(e); if (e.t === 'out') output += e.d; } }
  );
  assert.equal(result.ok, false);
  const [check, deploy] = result.jobs;
  assert.deepEqual(check.steps.map((s) => `${s.name}:${s.status}`), ['actions/checkout@v7:passed', 'actions/cache@v4:skipped', 'echo "WHO=world" >> "$GITHUB_ENV":passed', 'Use them:passed', 'Fails:failed', 'Never:skipped', 'Cleanup:passed']);
  assert.match(output, /hello world 42 node-22 ci=true/);
  assert.match(output, /cleanup/);
  assert.equal(check.steps[4].code, 3);
  assert.equal(deploy.status, 'skipped');
  assert.match(deploy.reason!, /check failed/);
  assert.ok(events.some((e) => e.t === 'job' && e.status === 'running'));

  // Fixed: the deploy is skipped by its condition, not by the failure
  const fixed = workflow.replace('run: exit 3', 'run: echo ok');
  const again = await runPipeline({ projectId: 'pipeline-test-1', files: { '.github/workflows/ci.yml': fixed, 'src/app.txt': 'x' }, file: '.github/workflows/ci.yml' }, { onEvent: () => {} });
  assert.equal(again.ok, true);
  assert.match(again.jobs[1].reason!, /Runs only on GitHub when: github\.ref == 'refs\/heads\/main'/);
});

test('GitHub Actions: runs, jobs, logs without timestamps, re-runs', async () => {
  const { getJobLog, listRunJobs, listWorkflowRuns, rerunFailedJobs } = await import('../src/lib/github.ts');
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url} auth=${(init?.headers as Record<string, string>)?.Authorization ? 'yes' : 'no'}`);
    if (url.includes('/actions/runs?')) return new Response(JSON.stringify({ workflow_runs: [{ id: 7, name: 'CI', status: 'completed', conclusion: 'failure', head_sha: 'abc1234def', event: 'push', html_url: 'https://github.com/o/r/actions/runs/7', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:01:00Z', path: '.github/workflows/ci.yml' }] }));
    if (url.includes('/runs/7/jobs')) return new Response(JSON.stringify({ jobs: [{ id: 9, name: 'check', status: 'completed', conclusion: 'failure', html_url: 'u', steps: [{ name: 'Test', number: 4, status: 'completed', conclusion: 'failure' }] }] }));
    if (url.includes('/jobs/9/logs')) return new Response('2026-10-01T00:00:01.1234567Z npm test\n2026-10-01T00:00:02.0000000Z AssertionError: 0 !== 4\n');
    if (url.includes('rerun-failed-jobs')) return new Response(null, { status: 201 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  try {
    const runs = await listWorkflowRuns('t', 'o', 'r', 'main');
    assert.deepEqual([runs[0].id, runs[0].conclusion, runs[0].headSha, runs[0].path], [7, 'failure', 'abc1234def', '.github/workflows/ci.yml']);
    const jobs = await listRunJobs('t', 'o', 'r', 7);
    assert.equal(jobs[0].steps[0].conclusion, 'failure');
    assert.equal(await getJobLog('t', 'o', 'r', 9), 'npm test\nAssertionError: 0 !== 4\n');
    await rerunFailedJobs('t', 'o', 'r', 7);
    assert.ok(calls.some((c) => c.startsWith('POST https://api.github.com/repos/o/r/actions/runs/7/rerun-failed-jobs auth=yes')));
    await assert.rejects(listWorkflowRuns('t', 'o', 'r', 'bad branch name'), /Invalid branch/);
    await assert.rejects(listWorkflowRuns('t', '../x', 'r', 'main'), /Invalid repository/);
  } finally {
    globalThis.fetch = original;
  }
});

test('the agent: run_pipeline reproduces and proves, and counts as a check', async () => {
  const { Stage } = await import('../src/lib/agent/stage.ts');
  const { workspaceTools } = await import('../src/lib/agent/tools.ts');
  const stage = new Stage({ '.github/workflows/ci.yml': 'jobs: {}', 'a.js': 'x' });
  const seen: string[] = [];
  const tools = workspaceTools({ stage, entry: 'a.js', pipelineFiles: ['.github/workflows/ci.yml'], runPipeline: async (files, file, job) => (seen.push(`${file}:${job}:${files['a.js']}`), { ok: true, text: 'Pipeline passed' }) });
  const tool = tools.find((t) => t.name === 'run_pipeline')!;
  assert.equal(tool.risk, 'exec', 'it runs commands: the user is asked first');
  assert.equal(tool.verify, true);
  stage.write('a.js', 'y');
  const result = await tool.run({ job: 'check' }, { signal: new AbortController().signal } as never);
  assert.deepEqual([result.ok, seen], [true, ['.github/workflows/ci.yml:check:y']], 'runs the staged files');
  assert.equal((await tool.run({ file: '.gitlab-ci.yml' }, { signal: new AbortController().signal } as never)).ok, false);
  assert.equal(workspaceTools({ stage, entry: 'a.js' }).some((t) => t.name === 'run_pipeline'), false, 'only for projects with CI');
  const { latestPerWorkflow, remoteFailureBrief, failureReport } = await import('../src/lib/pipelines/report.ts');
  const run = { id: 1, name: 'CI', status: 'completed', conclusion: 'failure', headSha: 'abcdef123', event: 'push', url: 'https://x', createdAt: '', updatedAt: '', path: '.github/workflows/ci.yml' };
  assert.equal(latestPerWorkflow([run, { ...run, id: 0 }]).length, 1);
  const brief = remoteFailureBrief(run, { id: 2, name: 'check', status: 'completed', conclusion: 'failure', url: '', steps: [{ name: 'Test', number: 1, status: 'completed', conclusion: 'failure' }] }, 'AssertionError', '.github/workflows/ci.yml');
  assert.match(brief, /job “check”, step “Test” \(commit abcdef1/);
  assert.match(brief, /run_pipeline \(file \.github\/workflows\/ci\.yml/);
  assert.match(failureReport('ci.yml', { ok: false, ms: 1, jobs: [{ id: 'check', name: 'c', status: 'failed', ms: 1, steps: [{ name: 'Test', status: 'failed', ms: 1, note: 'Exited with code 1', run: 'npm test' }] }] }, 'boom')!, /job check · step “Test” failed \(Exited with code 1\)\n\$ npm test\nboom/);
});
