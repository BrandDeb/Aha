/**
 * Reading CI files (GitHub Actions workflows and .gitlab-ci.yml) into jobs and
 * steps the studio can run on this machine: `run:` and `script:` lines run in
 * a shell, toolchain setup actions become "make sure this toolchain is here",
 * and the rest (caches, artifacts, deploys) only runs on the CI service, so
 * it is skipped with a note. `if:` conditions and `${{ … }}` expressions are
 * evaluated against a local context (a manual run of the current files), so
 * deploy jobs that only run on pushes to main are skipped as they would be.
 * Pure: shared by the browser (to list jobs) and the server (to run them).
 */

import yaml from 'js-yaml';

export type StepKind = 'run' | 'setup' | 'checkout' | 'skip';

export interface PipelineStep {
  /** The step's `id:`, for steps.<id>.outputs */
  id?: string;
  name: string;
  kind: StepKind;
  /** Shell script (run steps) */
  run?: string;
  uses?: string;
  /** Toolchain a setup step stands for (a languages.ts id, or uv / pnpm) */
  tool?: string;
  shell?: string;
  workingDirectory?: string;
  env: Record<string, string>;
  /** Raw `if:` (GitHub expression or GitLab "always") */
  if?: string;
  continueOnError?: boolean;
  /** Why it is skipped, or what it does differently here */
  note?: string;
}

export interface PipelineJob {
  id: string;
  name: string;
  needs: string[];
  steps: PipelineStep[];
  env: Record<string, string>;
  /** Raw job condition (GitHub `if:`); GitLab rules are decided while parsing */
  if?: string;
  /** Set when the job never runs locally (manual, deploy-only rules…) */
  skip?: string;
  matrix?: Record<string, string>;
  timeoutMs: number;
  notes: string[];
}

export interface Pipeline {
  provider: 'github' | 'gitlab';
  path: string;
  name: string;
  jobs: PipelineJob[];
  notes: string[];
}

export const isPipelineFile = (path: string) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(path) || path === '.gitlab-ci.yml';
export const pipelineFiles = (files: Record<string, string>) => Object.keys(files).filter(isPipelineFile).sort();

const DEFAULT_TIMEOUT_MS = 20 * 60_000;
const MAX_TIMEOUT_MS = 60 * 60_000;

// ---------------------------------------------------------------------------
// Expressions: the subset of the GitHub Actions expression language (and of
// GitLab's rules:if) that workflows actually use
// ---------------------------------------------------------------------------

type Value = string | number | boolean | null | Value[] | { [key: string]: Value };
export type Resolver = (path: string[]) => Value | undefined;
export interface StatusContext {
  /** An earlier step failed */
  failed: boolean;
}

type Token = { t: 'str' | 'num' | 'id' | 'var' | 'op' | 're'; v: string };

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < expr.length) {
    const c = expr[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === "'" || c === '"') {
      let j = i + 1;
      let s = '';
      while (j < expr.length) {
        if (expr[j] === c && expr[j + 1] === c && c === "'") {
          s += c;
          j += 2;
        } else if (expr[j] === c) break;
        else s += expr[j++];
      }
      tokens.push({ t: 'str', v: s });
      i = j + 1;
    } else if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      const m = /^-?\d+(?:\.\d+)?/.exec(expr.slice(i))!;
      tokens.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (c === '$') {
      const m = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/.exec(expr.slice(i));
      if (!m) throw new Error(`Unexpected "$" in ${expr}`);
      tokens.push({ t: 'var', v: m[1] });
      i += m[0].length;
    } else if (c === '/' && tokens.length && tokens[tokens.length - 1].v === '=~') {
      const m = /^\/((?:\\.|[^/])*)\/[a-z]*/.exec(expr.slice(i));
      if (!m) throw new Error(`Bad regular expression in ${expr}`);
      tokens.push({ t: 're', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(expr.slice(i))!;
      tokens.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else {
      const two = expr.slice(i, i + 2);
      if (['==', '!=', '&&', '||', '<=', '>=', '=~', '!~'].includes(two)) {
        tokens.push({ t: 'op', v: two });
        i += 2;
      } else if ('()[].,!<>*'.includes(c)) {
        tokens.push({ t: 'op', v: c });
        i++;
      } else throw new Error(`Unexpected "${c}" in ${expr}`);
    }
  }
  return tokens;
}

const truthy = (v: Value | undefined) => !(v === undefined || v === null || v === false || v === 0 || v === '' || (typeof v === 'number' && Number.isNaN(v)));
const text = (v: Value | undefined): string => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
const loose = (a: Value | undefined, b: Value | undefined) => {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  if ((a ?? null) === null || (b ?? null) === null) return (a ?? null) === (b ?? null);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return a === b;
};

/** Evaluate an expression. `resolve` answers context lookups (github.ref, matrix.os, $CI_COMMIT_BRANCH…) */
export function evaluate(expr: string, resolve: Resolver, status: StatusContext = { failed: false }): Value | undefined {
  const tokens = tokenize(expr);
  let pos = 0;
  const peek = () => tokens[pos];
  const eat = (v?: string) => {
    const t = tokens[pos];
    if (!t || (v !== undefined && t.v !== v)) throw new Error(`Expected ${v ?? 'a value'} in ${expr}`);
    pos++;
    return t;
  };

  const or = (): Value | undefined => {
    let left = and();
    while (peek()?.v === '||') {
      eat();
      const right = and();
      left = truthy(left) ? left : right;
    }
    return left;
  };
  const and = (): Value | undefined => {
    let left = compare();
    while (peek()?.v === '&&') {
      eat();
      const right = compare();
      left = truthy(left) ? right : left;
    }
    return left;
  };
  const compare = (): Value | undefined => {
    const left = unary();
    const op = peek()?.v;
    if (op && ['==', '!=', '<', '>', '<=', '>=', '=~', '!~'].includes(op) && peek().t === 'op') {
      eat();
      if (op === '=~' || op === '!~') {
        const re = eat();
        const m = /^\/((?:\\.|[^/])*)\/([a-z]*)$/.exec(re.v);
        const matched = !!m && new RegExp(m[1], m[2].replace(/[^ims]/g, '')).test(text(left));
        return op === '=~' ? matched : !matched;
      }
      const right = unary();
      if (op === '==') return loose(left, right);
      if (op === '!=') return !loose(left, right);
      const a = Number(left);
      const b = Number(right);
      return op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : a >= b;
    }
    return left;
  };
  const unary = (): Value | undefined => {
    if (peek()?.v === '!') {
      eat();
      return !truthy(unary());
    }
    return primary();
  };
  const call = (name: string, args: (Value | undefined)[]): Value => {
    switch (name.toLowerCase()) {
      case 'always':
        return true;
      case 'success':
        return !status.failed;
      case 'failure':
        return status.failed;
      case 'cancelled':
        return false;
      case 'startswith':
        return text(args[0]).toLowerCase().startsWith(text(args[1]).toLowerCase());
      case 'endswith':
        return text(args[0]).toLowerCase().endsWith(text(args[1]).toLowerCase());
      case 'contains':
        return Array.isArray(args[0]) ? args[0].some((x) => loose(x, args[1])) : text(args[0]).toLowerCase().includes(text(args[1]).toLowerCase());
      case 'format':
        return text(args[0]).replace(/\{(\d+)\}/g, (_, i) => text(args[Number(i) + 1]));
      case 'join':
        return Array.isArray(args[0]) ? args[0].map(text).join(args[1] === undefined ? ',' : text(args[1])) : text(args[0]);
      case 'tojson':
        return JSON.stringify(args[0] ?? null);
      case 'fromjson':
        try {
          return JSON.parse(text(args[0])) as Value;
        } catch {
          return null;
        }
      case 'hashfiles':
        return 'local';
      default:
        throw new Error(`Unknown function ${name}()`);
    }
  };
  const primary = (): Value | undefined => {
    const t = eat();
    if (t.v === '(' && t.t === 'op') {
      const v = or();
      eat(')');
      return v;
    }
    if (t.t === 'str') return t.v;
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'var') return resolve(['$', t.v]);
    if (t.t === 'id') {
      if (t.v === 'true') return true;
      if (t.v === 'false') return false;
      if (t.v === 'null') return null;
      if (peek()?.v === '(') {
        eat('(');
        const args: (Value | undefined)[] = [];
        while (peek()?.v !== ')') {
          args.push(or());
          if (peek()?.v === ',') eat(',');
        }
        eat(')');
        return call(t.v, args);
      }
      const path = [t.v];
      while (peek()?.v === '.' || peek()?.v === '[') {
        if (eat().v === '.') path.push(eat().v);
        else {
          path.push(text(or()));
          eat(']');
        }
      }
      return resolve(path);
    }
    throw new Error(`Unexpected "${t.v}" in ${expr}`);
  };

  const value = or();
  if (pos < tokens.length) throw new Error(`Unexpected "${tokens[pos].v}" in ${expr}`);
  return value;
}

/** Replace each ${{ expression }} in a string */
export function expand(value: string, resolve: Resolver): string {
  return value.replace(/\$\{\{\s*([\s\S]*?)\s*\}\}/g, (_, expr: string) => {
    try {
      return text(evaluate(expr, resolve));
    } catch {
      return '';
    }
  });
}

/** Evaluate an `if:` (with or without ${{ }}); a bare status-free condition gets success() in front, as on GitHub */
export function condition(raw: string | undefined, resolve: Resolver, status: StatusContext): boolean {
  if (raw === undefined || raw === '') return !status.failed;
  const expr = raw.trim().replace(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/, '$1');
  try {
    const usesStatus = /\b(?:always|success|failure|cancelled)\s*\(/i.test(expr);
    const value = truthy(evaluate(expr, resolve, status));
    return usesStatus ? value : value && !status.failed;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// GitHub Actions
// ---------------------------------------------------------------------------

/** Setup actions, and the toolchain each stands for */
const SETUP: [RegExp, string][] = [
  [/^actions\/setup-node@/, 'node'],
  [/^actions\/setup-python@/, 'python'],
  [/^astral-sh\/setup-uv@/, 'uv'],
  [/^actions\/setup-go@/, 'go'],
  [/^actions\/setup-java@/, 'java'],
  [/^actions\/setup-dotnet@/, 'csharp'],
  [/^(?:dtolnay\/rust-toolchain|actions-rs\/toolchain|actions-rust-lang\/setup-rust-toolchain)@/, 'rust'],
  [/^oven-sh\/setup-bun@/, 'bun'],
  [/^denoland\/setup-deno@/, 'deno'],
  [/^pnpm\/action-setup@/, 'pnpm'],
  [/^ruby\/setup-ruby@/, 'ruby'],
  [/^shivammathur\/setup-php@/, 'php'],
  [/^erlef\/setup-beam@/, 'elixir'],
  [/^dart-lang\/setup-dart@/, 'dart'],
  [/^foundry-rs\/foundry-toolchain@/, 'solidity'],
  [/^(?:mlugg|goto-bus-stop)\/setup-zig@/, 'zig'],
];

const SERVICE_ONLY: [RegExp, string][] = [
  [/^actions\/(?:cache|upload-artifact|download-artifact)@/, 'caches and artifacts live on GitHub'],
  [/^actions\/(?:configure-pages|upload-pages-artifact|deploy-pages)@/, 'deploys run on GitHub'],
  [/^docker\//, 'image builds and pushes run on GitHub'],
  [/^softprops\/action-gh-release@|^ncipollo\/release-action@/, 'releases are published on GitHub'],
  [/^superfly\/flyctl-actions/, 'deploys run on GitHub'],
  [/^codecov\//, 'coverage uploads run on GitHub'],
  [/^github\/codeql-action\//, 'code scanning runs on GitHub'],
];

const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : typeof v === 'object' ? undefined : String(v));
const strMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (str(x) !== undefined) out[k] = str(x)!;
  return out;
};
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : typeof v === 'string' ? [v] : []);

function githubStep(raw: Record<string, unknown>, index: number): PipelineStep {
  const env = strMap(raw.env);
  const base = { id: str(raw.id), env, if: str(raw.if), continueOnError: raw['continue-on-error'] === true, workingDirectory: str(raw['working-directory']), shell: str(raw.shell) };
  const uses = str(raw.uses);
  if (typeof raw.run === 'string') return { ...base, name: str(raw.name) ?? raw.run.split('\n')[0].slice(0, 80), kind: 'run', run: raw.run };
  if (uses) {
    const name = str(raw.name) ?? uses;
    if (/^actions\/checkout@/.test(uses)) return { ...base, name, kind: 'checkout', uses, note: 'The project’s files are already here' };
    const setup = SETUP.find(([re]) => re.test(uses));
    if (setup) return { ...base, name, kind: 'setup', uses, tool: setup[1], note: 'Uses the toolchain on this machine (installed if the studio can)' };
    const service = SERVICE_ONLY.find(([re]) => re.test(uses));
    return { ...base, name, kind: 'skip', uses, note: service ? `Skipped here: ${service[1]}` : `Skipped here: ${uses.split('@')[0]} is an action that only runs on GitHub` };
  }
  return { ...base, name: str(raw.name) ?? `Step ${index + 1}`, kind: 'skip', note: 'Nothing to run' };
}

function parseGithub(path: string, doc: Record<string, unknown>): Pipeline {
  const notes: string[] = [];
  const env = strMap(doc.env);
  const jobs: PipelineJob[] = [];
  const rawJobs = doc.jobs && typeof doc.jobs === 'object' ? (doc.jobs as Record<string, Record<string, unknown>>) : {};
  for (const [id, job] of Object.entries(rawJobs)) {
    if (!job || typeof job !== 'object') continue;
    const jobNotes: string[] = [];
    let matrix: Record<string, string> | undefined;
    const rawMatrix = (job.strategy as Record<string, unknown> | undefined)?.matrix;
    if (rawMatrix && typeof rawMatrix === 'object') {
      matrix = {};
      for (const [k, v] of Object.entries(rawMatrix as Record<string, unknown>)) {
        if (k === 'include' || k === 'exclude') continue;
        if (Array.isArray(v) && v.length) matrix[k] = String(v[0]);
      }
      const combo = Object.entries(matrix).map(([k, v]) => `${k}: ${v}`).join(', ');
      if (combo) jobNotes.push(`Runs the first matrix combination here (${combo})`);
    }
    if (typeof job.uses === 'string') {
      jobs.push({ id, name: str(job.name) ?? id, needs: list(job.needs), steps: [], env: {}, timeoutMs: DEFAULT_TIMEOUT_MS, notes: jobNotes, skip: `Calls the reusable workflow ${job.uses}, which runs on GitHub` });
      continue;
    }
    if (job.services) jobNotes.push(`Services (${Object.keys(job.services as object).join(', ')}) aren’t started here`);
    if (job.container) jobNotes.push('Runs on this machine, not in the job’s container');
    const runsOn = str(job['runs-on']) ?? '';
    if (/windows|macos/i.test(runsOn)) jobNotes.push(`Written for ${runsOn}; runs on this machine`);
    const defaults = (job.defaults as { run?: Record<string, unknown> } | undefined)?.run ?? (doc.defaults as { run?: Record<string, unknown> } | undefined)?.run;
    const steps = (Array.isArray(job.steps) ? job.steps : []).map((s, i) => githubStep((s ?? {}) as Record<string, unknown>, i));
    for (const step of steps) {
      step.workingDirectory ??= str(defaults?.['working-directory']);
      step.shell ??= str(defaults?.shell);
    }
    const minutes = Number(job['timeout-minutes']);
    jobs.push({
      id,
      name: str(job.name) ?? id,
      needs: list(job.needs),
      steps,
      env: { ...env, ...strMap(job.env) },
      if: str(job.if),
      matrix,
      timeoutMs: Math.min(minutes > 0 ? minutes * 60_000 : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      notes: jobNotes,
    });
  }
  if (!jobs.length) notes.push('No jobs found.');
  return { provider: 'github', path, name: str(doc.name) ?? path.replace(/^.*\//, ''), jobs, notes };
}

// ---------------------------------------------------------------------------
// GitLab CI
// ---------------------------------------------------------------------------

const GITLAB_RESERVED = new Set(['stages', 'variables', 'default', 'include', 'workflow', 'image', 'services', 'before_script', 'after_script', 'cache', 'types', 'spec']);
/** What a manual local run looks like to GitLab rules */
export const GITLAB_LOCAL: Record<string, string> = { CI: 'true', CI_PIPELINE_SOURCE: 'web', CI_COMMIT_BRANCH: 'local', CI_COMMIT_REF_NAME: 'local', CI_DEFAULT_BRANCH: 'main', CI_COMMIT_SHA: 'local', CI_COMMIT_SHORT_SHA: 'local' };

const scriptLines = (v: unknown): string[] => (Array.isArray(v) ? v.flat(Infinity as 1).map(String) : typeof v === 'string' ? [v] : []);

function parseGitlab(path: string, doc: Record<string, unknown>): Pipeline {
  const notes: string[] = [];
  const stages = list(doc.stages).length ? list(doc.stages) : ['build', 'test', 'deploy'];
  const defaults = (doc.default ?? {}) as Record<string, unknown>;
  const globalVars = strMap(doc.variables);
  const templates = doc as Record<string, Record<string, unknown>>;
  if (doc.include) notes.push('Included files aren’t read here; only the jobs in this file run.');

  const resolveJob = (job: Record<string, unknown>, depth = 0): Record<string, unknown> => {
    if (!job.extends || depth > 3) return job;
    const parents = list(job.extends).map((name) => resolveJob(templates[name] ?? {}, depth + 1));
    return Object.assign({}, ...parents, job);
  };

  const jobs: (PipelineJob & { stage: number })[] = [];
  for (const [id, raw] of Object.entries(doc)) {
    if (GITLAB_RESERVED.has(id) || id.startsWith('.') || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const job = resolveJob(raw as Record<string, unknown>);
    if (!('script' in job) && !('trigger' in job)) continue;
    const jobNotes: string[] = [];
    const vars = { ...globalVars, ...strMap(job.variables) };
    const resolve: Resolver = (p) => (p[0] === '$' ? (vars[p[1]] ?? GITLAB_LOCAL[p[1]]) : undefined);
    let skip: string | undefined;
    if (job.trigger) skip = 'Triggers another pipeline on GitLab';
    else if (job.when === 'manual') skip = 'A manual job: start it on GitLab';
    else if (Array.isArray(job.rules)) {
      const rule = (job.rules as Record<string, unknown>[]).find((r) => {
        if (typeof r?.if !== 'string') return !r?.changes && !r?.exists;
        try {
          return truthy(evaluate(r.if, resolve));
        } catch {
          return false;
        }
      });
      if (!rule || rule.when === 'never') skip = `Its rules don’t match a local run (${(job.rules as Record<string, unknown>[]).map((r) => str(r?.if)).filter(Boolean).join('; ') || 'rules'})`;
      else if (rule.when === 'manual') skip = 'A manual job: start it on GitLab';
    } else if (job.only || job.except) {
      const only = list((job.only as { refs?: unknown })?.refs ?? job.only);
      if (only.length && !only.some((r) => ['branches', 'web', 'pushes'].includes(r))) skip = `Runs on GitLab only for ${only.join(', ')}`;
    }
    const image = str((job.image as { name?: string })?.name ?? job.image) ?? str((defaults.image as { name?: string })?.name ?? defaults.image) ?? str(doc.image);
    if (image) jobNotes.push(`GitLab runs this in ${image}; here it runs on this machine`);
    const services = job.services ?? defaults.services ?? doc.services;
    if (services) jobNotes.push('Services aren’t started here');

    const before = scriptLines(job.before_script ?? defaults.before_script ?? doc.before_script);
    const after = scriptLines(job.after_script ?? defaults.after_script ?? doc.after_script);
    const step = (line: string, extra: Partial<PipelineStep> = {}): PipelineStep => ({ name: line.split('\n')[0].slice(0, 80), kind: 'run', run: line, env: {}, ...extra });
    const steps = [...before.map((l) => step(l)), ...scriptLines(job.script).map((l) => step(l)), ...after.map((l) => step(l, { if: 'always()', continueOnError: true }))];
    const timeout = /^(\d+)\s*m/.exec(str(job.timeout) ?? '')?.[1];
    const stage = str(job.stage) ?? 'test';
    jobs.push({
      id,
      name: id,
      needs: list(job.needs).length ? list(job.needs) : (job.needs as { job: string }[] | undefined)?.map?.((n) => n?.job).filter(Boolean) ?? [],
      steps,
      env: vars,
      skip,
      timeoutMs: Math.min(timeout ? Number(timeout) * 60_000 : DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
      notes: jobNotes,
      stage: stages.indexOf(stage) >= 0 ? stages.indexOf(stage) : stages.length,
    });
  }
  // Without `needs`, a job waits for every job of the earlier stages
  for (const job of jobs) if (!job.needs.length) job.needs = jobs.filter((j) => j.stage < job.stage).map((j) => j.id);
  jobs.sort((a, b) => a.stage - b.stage);
  if (!jobs.length) notes.push('No jobs found.');
  return { provider: 'gitlab', path, name: 'GitLab CI', jobs: jobs.map(({ stage: _stage, ...j }) => j), notes };
}

export function parsePipeline(path: string, source: string): Pipeline | { error: string } {
  let doc: unknown;
  try {
    doc = yaml.load(source, { json: true });
  } catch (error) {
    return { error: `${path} isn’t valid YAML: ${(error as Error).message.split('\n')[0]}` };
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { error: `${path} is empty or not a mapping` };
  return path === '.gitlab-ci.yml' ? parseGitlab(path, doc as Record<string, unknown>) : parseGithub(path, doc as Record<string, unknown>);
}

/** Jobs in the order they run: dependencies first; with `only`, that job and what it needs */
export function jobOrder(pipeline: Pipeline, only?: string): PipelineJob[] {
  const byId = new Map(pipeline.jobs.map((j) => [j.id, j]));
  const order: PipelineJob[] = [];
  const seen = new Set<string>();
  const visit = (id: string, path: Set<string>) => {
    const job = byId.get(id);
    if (!job || seen.has(id) || path.has(id)) return;
    path.add(id);
    for (const need of job.needs) visit(need, path);
    seen.add(id);
    order.push(job);
  };
  if (only) visit(only, new Set());
  else for (const job of pipeline.jobs) visit(job.id, new Set());
  return order;
}
