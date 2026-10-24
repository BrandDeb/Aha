/**
 * Running a project's CI pipeline on this machine: the project's files go in a
 * folder (dependencies are kept between runs), and each job's steps run in a
 * shell the way the CI service would run them: `bash -eo pipefail` (PowerShell
 * on Windows), the job and step environment, CI=true, and GITHUB_ENV,
 * GITHUB_PATH and GITHUB_OUTPUT honoured between steps. Like the language
 * runner, this executes the project's commands on the host, so it is only
 * available when that is the user's own machine. Server only.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getLanguage } from '../languages.ts';
import { cleanupRunProjects, installHint, isRunEnabled, RUN_PROJECTS, runEnv, which } from '../polyglot.ts';
import { createJobPool, createKeyedLock, isSafeRelativePath, runStep, writeProject } from '../proc.ts';
import { getToolchainState, installFor, MANAGED, refreshBinPaths } from '../toolchains.ts';
import { condition, expand, GITLAB_LOCAL, isPipelineFile, jobOrder, parsePipeline, type PipelineJob, type PipelineStep, type Resolver } from './parse.ts';

export { isRunEnabled as isPipelineRunEnabled };

export interface PipelineRunRequest {
  projectId: string;
  files: Record<string, string>;
  /** The CI file to run (.github/workflows/x.yml or .gitlab-ci.yml) */
  file: string;
  /** One job (with the jobs it needs); all jobs when absent */
  job?: string;
}

const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_FILES = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

export function parsePipelineRunRequest(body: unknown): PipelineRunRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)) return { error: 'projectId is missing or invalid' };
  if (typeof input.file !== 'string' || !isPipelineFile(input.file)) return { error: 'file must be a workflow in .github/workflows/ or .gitlab-ci.yml' };
  if (input.job !== undefined && (typeof input.job !== 'string' || input.job.length > 100)) return { error: 'job must be a job id' };
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) return { error: 'files must be an object of path -> content' };
  const entries = Object.entries(input.files as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_FILES) return { error: `A project can have 1 to ${MAX_FILES} files` };
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, content] of entries) {
    if (!isSafeRelativePath(name)) return { error: `Invalid file path: ${name.slice(0, 80)}` };
    if (typeof content !== 'string') return { error: `File content must be a string: ${name}` };
    total += Buffer.byteLength(content, 'utf8');
    files[name] = content;
  }
  if (total > MAX_BYTES) return { error: `Project exceeds ${MAX_BYTES / 1024 / 1024} MB` };
  if (!(input.file in files)) return { error: `${input.file} isn’t in the project` };
  return { projectId: input.projectId, files, file: input.file, job: input.job as string | undefined };
}

export type StepStatus = 'passed' | 'failed' | 'skipped';

export interface StepReport {
  name: string;
  status: StepStatus;
  ms: number;
  note?: string;
  code?: number | null;
  /** The command, for a failure brief */
  run?: string;
}

export interface JobReport {
  id: string;
  name: string;
  status: StepStatus;
  reason?: string;
  steps: StepReport[];
  ms: number;
}

export type PipelineEvent =
  | { t: 'job'; id: string; name: string; status: 'running' | StepStatus; reason?: string; notes?: string[] }
  | { t: 'step'; job: string; index: number; name: string; status: 'running' | StepStatus; ms?: number; note?: string; code?: number | null }
  | { t: 'out'; s: 'stdout' | 'stderr' | 'info'; d: string };

export interface PipelineResult {
  ok: boolean;
  jobs: JobReport[];
  ms: number;
  error?: string;
}

const pool = createJobPool(Number(process.env.NANOCLI_PIPELINE_JOBS) || 2, 6, 'The server is busy running other pipelines. Try again in a moment.');
const lock = createKeyedLock();
/** Folders kept between local CI runs (dependencies, build caches) and never synced from the browser */
const KEEP = new Set(['node_modules', 'target', '.home', '.venv', 'vendor', 'deps', '_build', '.gradle', 'obj', 'bin', 'dist', 'build', '.next', '__pycache__', '.dart_tool', 'out', 'cache', '.nanocli-ci']);

/** The binary each setup action stands for */
const TOOL_BIN: Record<string, string[]> = {
  node: ['node'],
  python: ['python3', 'python'],
  uv: ['uv'],
  go: ['go'],
  java: ['java'],
  csharp: ['dotnet'],
  rust: ['cargo'],
  bun: ['bun'],
  deno: ['deno'],
  pnpm: ['pnpm'],
  ruby: ['ruby'],
  php: ['php'],
  elixir: ['mix'],
  dart: ['dart'],
  solidity: ['forge'],
  zig: ['zig'],
};

const OS_NAME = process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux';

/** The GitHub context of a manual local run */
export function githubResolver(ctx: { workspace: string; env: Record<string, string>; matrix?: Record<string, string>; outputs: Record<string, Record<string, string>>; outcomes: Record<string, string>; missingSecrets: Set<string> }): Resolver {
  const github: Record<string, string> = {
    event_name: 'workflow_dispatch',
    ref: 'refs/heads/local',
    ref_name: 'local',
    ref_type: 'branch',
    head_ref: '',
    base_ref: '',
    sha: 'local',
    repository: 'local/project',
    repository_owner: 'local',
    actor: 'you',
    workflow: 'CI',
    workspace: ctx.workspace,
    run_id: '0',
    run_number: '0',
    run_attempt: '1',
    server_url: 'https://github.com',
    api_url: 'https://api.github.com',
    token: '',
  };
  return (p) => {
    const [root, key, sub, leaf] = p;
    switch (root) {
      case 'github':
        return key === 'event' ? {} : github[key];
      case 'runner':
        return { os: OS_NAME, arch: process.arch === 'arm64' ? 'ARM64' : 'X64', temp: path.join(ctx.workspace, '.home', 'tmp'), name: 'local', environment: 'self-hosted' }[key];
      case 'env':
        return ctx.env[key];
      case 'matrix':
        return ctx.matrix?.[key];
      case 'secrets':
        if (key !== 'GITHUB_TOKEN') ctx.missingSecrets.add(key);
        return '';
      case 'vars':
      case 'inputs':
        return undefined;
      case 'steps':
        if (sub === 'outputs') return ctx.outputs[key]?.[leaf];
        if (sub === 'outcome' || sub === 'conclusion') return ctx.outcomes[key];
        return undefined;
      case 'job':
        return key === 'status' ? 'success' : undefined;
      default:
        return undefined;
    }
  };
}

/** KEY=value lines and KEY<<DELIM heredocs, as written to GITHUB_ENV / GITHUB_OUTPUT */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const heredoc = /^([A-Za-z_][A-Za-z0-9_-]*)<<(.+)$/.exec(lines[i]);
    if (heredoc) {
      const body: string[] = [];
      for (i++; i < lines.length && lines[i] !== heredoc[2]; i++) body.push(lines[i]);
      out[heredoc[1]] = body.join('\n');
      continue;
    }
    const eq = lines[i].indexOf('=');
    if (eq > 0) out[lines[i].slice(0, eq)] = lines[i].slice(eq + 1);
  }
  return out;
}

/** The shell and arguments for a run step, like GitHub's defaults */
export function shellFor(shell: string | undefined, script: string, envPath: string, windows = process.platform === 'win32'): { file: string; args: string[] } | { error: string } {
  const pick = (...names: string[]) => names.map((n) => which(n, envPath, windows)).find(Boolean) ?? null;
  const name = shell?.split(/\s+/)[0];
  if (name === 'pwsh' || name === 'powershell' || (!name && windows)) {
    const ps = name === 'powershell' ? pick('powershell') : pick('pwsh', 'powershell');
    if (ps) return { file: ps, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', `$ErrorActionPreference = 'Stop'\n${script}\nif ((Test-Path -LiteralPath variable:/LASTEXITCODE)) { exit $LASTEXITCODE }`] };
    if (!name) {
      const cmd = pick('cmd');
      if (cmd) return { file: cmd, args: ['/D', '/S', '/C', script] };
    }
    return { error: 'PowerShell isn’t installed on this machine.' };
  }
  if (name === 'cmd') {
    const cmd = pick('cmd');
    return cmd ? { file: cmd, args: ['/D', '/S', '/C', script] } : { error: 'cmd isn’t available on this machine.' };
  }
  if (name === 'python') {
    const py = pick('python3', 'python');
    return py ? { file: py, args: ['-c', script] } : { error: 'Python isn’t installed on this machine.' };
  }
  if (name === 'sh') {
    const sh = pick('sh');
    return sh ? { file: sh, args: ['-e', '-c', script] } : { error: 'sh isn’t available on this machine.' };
  }
  const bash = pick('bash');
  if (bash) return { file: bash, args: ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script] };
  const sh = pick('sh');
  return sh ? { file: sh, args: ['-e', '-c', script] } : { error: 'No shell (bash or sh) found on this machine.' };
}

export async function runPipeline(request: PipelineRunRequest, hooks: { onEvent: (event: PipelineEvent) => void; signal?: AbortSignal }): Promise<PipelineResult> {
  const started = Date.now();
  const parsed = parsePipeline(request.file, request.files[request.file]);
  if ('error' in parsed) return { ok: false, jobs: [], ms: 0, error: parsed.error };
  const order = jobOrder(parsed, request.job);
  if (request.job && !order.some((j) => j.id === request.job)) return { ok: false, jobs: [], ms: 0, error: `No job named “${request.job}” in ${request.file}` };
  if (!order.length) return { ok: false, jobs: [], ms: 0, error: `${request.file} has no jobs` };
  void cleanupRunProjects();

  return pool.run(() =>
    lock(request.projectId, async () => {
      const dir = path.join(RUN_PROJECTS, `${request.projectId}-ci`);
      await writeProject(dir, request.files, { keep: KEEP });
      await refreshBinPaths();
      const ciDir = path.join(dir, '.nanocli-ci');
      await fs.mkdir(path.join(dir, '.home', 'tmp'), { recursive: true });
      await fs.mkdir(ciDir, { recursive: true });

      const reports: JobReport[] = [];
      const budget = { left: MAX_OUTPUT_BYTES };
      const out = (s: 'stdout' | 'stderr' | 'info', d: string) => hooks.onEvent({ t: 'out', s, d });
      for (const job of order) {
        const failedNeed = job.needs.find((n) => reports.find((r) => r.id === n)?.status === 'failed');
        const report = await runJob(job, { dir, ciDir, provider: parsed.provider, budget, out, hooks, skipBecause: failedNeed ? `${failedNeed} failed` : undefined });
        reports.push(report);
        if (hooks.signal?.aborted) break;
      }
      const ok = reports.every((r) => r.status !== 'failed') && !hooks.signal?.aborted;
      return { ok, jobs: reports, ms: Date.now() - started, ...(hooks.signal?.aborted ? { error: 'stopped' } : {}) };
    })
  );
}

/** A file a step may have written to (missing reads as empty); run folders aren't part of the app, so the bundler skips the path */
const readText = (file: string) => fs.readFile(/* turbopackIgnore: true */ file, 'utf8').catch(() => '');

interface JobContext {
  dir: string;
  ciDir: string;
  provider: 'github' | 'gitlab';
  budget: { left: number };
  out: (s: 'stdout' | 'stderr' | 'info', d: string) => void;
  hooks: { onEvent: (event: PipelineEvent) => void; signal?: AbortSignal };
  skipBecause?: string;
}

async function runJob(job: PipelineJob, ctx: JobContext): Promise<JobReport> {
  const started = Date.now();
  const { hooks, out } = ctx;
  const skip = (reason: string): JobReport => {
    hooks.onEvent({ t: 'job', id: job.id, name: job.name, status: 'skipped', reason });
    return { id: job.id, name: job.name, status: 'skipped', reason, steps: [], ms: 0 };
  };
  if (ctx.skipBecause) return skip(`Not run: ${ctx.skipBecause}`);
  if (job.skip) return skip(job.skip);

  const missingSecrets = new Set<string>();
  const outputs: Record<string, Record<string, string>> = {};
  const outcomes: Record<string, string> = {};
  let env: Record<string, string> = runEnv(process.env, ctx.dir, {});
  const local = { CI: 'true', NANOCLI_CI: '1', ...(ctx.provider === 'github' ? { GITHUB_ACTIONS: 'true', GITHUB_WORKSPACE: ctx.dir, RUNNER_OS: OS_NAME, RUNNER_TEMP: path.join(ctx.dir, '.home', 'tmp') } : { ...GITLAB_LOCAL, CI_PROJECT_DIR: ctx.dir }) };
  const jobEnv: Record<string, string> = { ...local };
  const resolver = () => githubResolver({ workspace: ctx.dir, env: { ...jobEnv }, matrix: job.matrix, outputs, outcomes, missingSecrets });
  for (const [k, v] of Object.entries(job.env)) jobEnv[k] = ctx.provider === 'github' ? expand(v, resolver()) : v;

  if (ctx.provider === 'github' && job.if && !condition(job.if, resolver(), { failed: false })) {
    return skip(`Runs only on GitHub when: ${job.if.replace(/^\$\{\{\s*|\s*\}\}$/g, '')}`);
  }

  hooks.onEvent({ t: 'job', id: job.id, name: job.name, status: 'running', notes: job.notes });
  const steps: StepReport[] = [];
  let failed = false;
  const deadline = Date.now() + job.timeoutMs;

  for (let index = 0; index < job.steps.length; index++) {
    const step = job.steps[index];
    const stepStarted = Date.now();
    const report = (status: StepStatus, extra: Partial<StepReport> = {}) => {
      const r: StepReport = { name: step.name, status, ms: Date.now() - stepStarted, ...extra };
      steps.push(r);
      hooks.onEvent({ t: 'step', job: job.id, index, name: step.name, status, ms: r.ms, note: r.note, code: r.code });
      return r;
    };
    const runs = ctx.provider === 'github' ? condition(step.if, resolver(), { failed }) : step.if === 'always()' || !failed;
    if (!runs || hooks.signal?.aborted) {
      report('skipped', { note: failed ? 'Skipped after an earlier failure' : `Condition not met: ${step.if}` });
      continue;
    }
    if (step.kind === 'checkout' || step.kind === 'skip') {
      report(step.kind === 'checkout' ? 'passed' : 'skipped', { note: step.note });
      continue;
    }
    hooks.onEvent({ t: 'step', job: job.id, index, name: step.name, status: 'running', note: step.note });
    if (step.kind === 'setup') {
      const problem = await ensureTool(step, env, out, hooks.signal);
      if (problem === 'installed') env = runEnv(process.env, ctx.dir, {});
      if (problem && problem !== 'installed') {
        out('stderr', `${problem}\n`);
        report('failed', { note: problem });
        failed = true;
        continue;
      }
      report('passed', { note: step.note });
      continue;
    }

    // A run step: fresh GITHUB_ENV / GITHUB_OUTPUT / GITHUB_PATH files for it
    const files = { GITHUB_ENV: path.join(ctx.ciDir, `env-${index}`), GITHUB_OUTPUT: path.join(ctx.ciDir, `output-${index}`), GITHUB_PATH: path.join(ctx.ciDir, `path-${index}`), GITHUB_STEP_SUMMARY: path.join(ctx.ciDir, `summary-${index}`) };
    for (const f of Object.values(files)) await fs.writeFile(/* turbopackIgnore: true */ f, '');
    const r = resolver();
    const script = ctx.provider === 'github' ? expand(step.run ?? '', r) : (step.run ?? '');
    const stepEnv: Record<string, string> = { ...env, ...jobEnv, ...(ctx.provider === 'github' ? files : {}) };
    for (const [k, v] of Object.entries(step.env)) stepEnv[k] = ctx.provider === 'github' ? expand(v, r) : v;
    const wd = step.workingDirectory ? (ctx.provider === 'github' ? expand(step.workingDirectory, r) : step.workingDirectory) : '';
    const cwd = path.resolve(ctx.dir, wd);
    if (!(cwd === ctx.dir || cwd.startsWith(ctx.dir + path.sep))) {
      report('failed', { note: `working-directory “${wd}” is outside the project` });
      failed = true;
      continue;
    }
    const shell = shellFor(step.shell, script, stepEnv.PATH ?? stepEnv.Path ?? '');
    if ('error' in shell) {
      out('stderr', `${shell.error}\n`);
      report('failed', { note: shell.error, run: script });
      failed = true;
      continue;
    }
    out('info', `$ ${script.trim().split('\n').join('\n  ')}\n`);
    const left = deadline - Date.now();
    const outcome = await runStep({ file: shell.file, args: shell.args, cwd, env: stepEnv, timeoutMs: Math.max(1000, left), budget: ctx.budget, maxOutputBytes: MAX_OUTPUT_BYTES, onOutput: out, signal: hooks.signal });
    if (outcome.timedOut) out('info', `The job reached its time limit (${Math.round(job.timeoutMs / 60_000)} min).\n`);

    // What the step left for the next ones
    const stepId = step.id ?? String(index);
    if (ctx.provider === 'github') {
      const added = parseEnvFile(await readText(files.GITHUB_ENV));
      Object.assign(jobEnv, added);
      outputs[stepId] = parseEnvFile(await readText(files.GITHUB_OUTPUT));
      const extraPath = (await readText(files.GITHUB_PATH)).split(/\r?\n/).filter(Boolean);
      if (extraPath.length) env = { ...env, PATH: [...extraPath.map((p) => path.resolve(cwd, p)), env.PATH ?? ''].join(path.delimiter) };
    }
    const passed = outcome.code === 0 && !outcome.timedOut && !outcome.aborted && !outcome.truncated && !outcome.spawnError;
    outcomes[stepId] = passed ? 'success' : 'failure';
    if (passed) report('passed');
    else {
      const note = outcome.spawnError ? `Could not start the shell: ${outcome.spawnError.message}` : outcome.aborted ? 'Stopped' : outcome.timedOut ? 'Timed out' : outcome.truncated ? 'Too much output' : `Exited with code ${outcome.code}`;
      report('failed', { note: step.continueOnError ? `${note} (continue-on-error)` : note, code: outcome.code, run: script });
      if (!step.continueOnError) failed = true;
    }
    if (hooks.signal?.aborted) break;
  }

  if (missingSecrets.size) out('info', `Secrets aren’t available locally and were left empty: ${[...missingSecrets].join(', ')}\n`);
  const status: StepStatus = failed ? 'failed' : 'passed';
  hooks.onEvent({ t: 'job', id: job.id, name: job.name, status });
  return { id: job.id, name: job.name, status, steps, ms: Date.now() - started };
}

/** Make sure a setup action's toolchain is on this machine: null when it is, 'installed' after installing it, else what's wrong */
async function ensureTool(step: PipelineStep, env: Record<string, string>, out: (s: 'stdout' | 'stderr' | 'info', d: string) => void, signal?: AbortSignal): Promise<string | null> {
  const tool = step.tool ?? '';
  const bins = TOOL_BIN[tool] ?? [];
  const envPath = env.PATH ?? env.Path ?? '';
  const found = bins.map((b) => which(b, envPath)).find(Boolean);
  if (found) {
    out('info', `${step.name}: using ${found}\n`);
    return null;
  }
  if (tool === 'pnpm') return which('corepack', envPath) ? 'pnpm isn’t installed. Run “corepack enable pnpm” (or npm install --global pnpm) once.' : 'pnpm isn’t installed. Install it with: npm install --global pnpm';
  if (tool === 'uv' || tool === 'python') {
    const { resolveUv } = await import('../python.ts');
    const uv = await resolveUv();
    if (uv) {
      out('info', `${step.name}: using uv ${uv.version}\n`);
      return null;
    }
    return 'uv isn’t installed. Open the Python tab to let the studio download it, or install it from https://docs.astral.sh/uv/.';
  }
  const language = getLanguage(tool);
  if (MANAGED[tool] && (await getToolchainState()).autoInstall) {
    out('info', `${language?.name ?? tool} isn’t installed yet: installing it for the studio (first run only).\n`);
    const installed = await installFor(tool, (t) => out('info', t), signal);
    if (installed.ok) return 'installed';
    return installed.error ?? 'Install failed';
  }
  return language ? installHint(language) : `${tool} isn’t installed on this machine.`;
}
