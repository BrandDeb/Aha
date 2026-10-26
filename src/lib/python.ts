/**
 * Python projects, managed with uv. Server only.
 *
 * The browser sends a project's files and an action (run, add, remove, sync,
 * lock, …). The server mirrors the files into a per-project directory, runs
 * uv there and reports what changed (pyproject.toml, uv.lock, files the
 * program wrote). Nothing is run through a shell, and the child process never
 * sees the server's own secrets.
 *
 * This executes the user's code on the machine running the studio. That is
 * the point of a local editor, but on a shared or public server set
 * NANOCLI_PYTHON=0 or run it inside a container.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { promisify } from 'node:util';
import { isValidProjectPath } from './compiler.ts';
import { UV_VERSION, installUv } from './uv-install.ts';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Limits and locations
// ---------------------------------------------------------------------------

/**
 * Where Python environments, caches and the downloaded uv live. A per-user folder, not the project:
 * environments are large, hold symlinks, and must not be picked up by the bundler or by git.
 */
export const NANOCLI_DIR = process.env.NANOCLI_HOME || path.join(os.homedir(), '.nanocli');
export const PY_PROJECTS = path.join(NANOCLI_DIR, 'python');
const PY_CACHE = path.join(NANOCLI_DIR, 'cache');
const UV_INSTALL_DIR = path.join(NANOCLI_DIR, 'bin');

export const MAX_PY_FILES = 200;
export const MAX_PY_PROJECT_BYTES = 5 * 1024 * 1024;
const MAX_RETURNED_FILE_BYTES = 256 * 1024;
const MAX_RETURNED_TOTAL_BYTES = 1536 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

/** Running a program, and installing packages (which is slower and rarely hangs) */
const RUN_TIMEOUT_MS = Number(process.env.NANOCLI_PY_TIMEOUT_MS) || 5 * 60_000;
const INSTALL_TIMEOUT_MS = Number(process.env.NANOCLI_PY_INSTALL_TIMEOUT_MS) || 20 * 60_000;
const MAX_PY_JOBS = Number(process.env.NANOCLI_PY_JOBS) || 3;
const MAX_QUEUED_JOBS = 12;

export function isPythonEnabled(): boolean {
  return process.env.NANOCLI_PYTHON !== '0';
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

export type PythonAction = 'run' | 'add' | 'remove' | 'sync' | 'lock' | 'init' | 'tree' | 'pin' | 'install-uv';

export interface PythonRequest {
  projectId: string;
  action: PythonAction;
  files: Record<string, string>;
  env: Record<string, string>;
  entry?: string;
  args?: string[];
  /** Packages for add / remove, or extra packages for one run (`uv run --with`) */
  packages?: string[];
  dev?: boolean;
  upgrade?: boolean;
  /** Python version for `pin`, e.g. 3.12 */
  version?: string;
  /** Project name for `init` */
  name?: string;
}

const ACTIONS: readonly PythonAction[] = ['run', 'add', 'remove', 'sync', 'lock', 'init', 'tree', 'pin', 'install-uv'];

/**
 * A package requirement: a name, optional extras and optional version
 * constraints. URLs, paths and anything else uv would read from disk or fetch
 * from elsewhere are not accepted.
 */
const VERSION_CLAUSE = String.raw`(?:===|==|~=|!=|<=|>=|<|>)\s*[A-Za-z0-9.*+!_-]+`;
const PACKAGE_SPEC = new RegExp(
  String.raw`^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?(?:\[[A-Za-z0-9._,-]+\])?(?:\s*${VERSION_CLAUSE}(?:\s*,\s*${VERSION_CLAUSE})*)?$`
);
const PACKAGE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

export const isPackageSpec = (value: unknown): value is string => typeof value === 'string' && value.length <= 120 && PACKAGE_SPEC.test(value);
export const isPackageName = (value: unknown): value is string => typeof value === 'string' && value.length <= 100 && PACKAGE_NAME.test(value);

/** Names user code must not be able to set: they change how programs load or where uv looks */
const BLOCKED_ENV = /^(?:PATH|HOME|USERPROFILE|SHELL|NODE_.*|NPM_.*|UV_.*|PYTHON.*|VIRTUAL_ENV|LD_.*|DYLD_.*|SYSTEM.*|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|XDG_.*|HF_HOME|TORCH_HOME)$/i;

export function parseEnv(input: unknown): { env: Record<string, string> } | { error: string } {
  if (input === undefined || input === null) return { env: {} };
  if (typeof input !== 'object' || Array.isArray(input)) return { error: 'env must be an object' };
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 32) return { error: 'At most 32 environment variables' };
  const env: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name)) return { error: `Invalid environment variable name: ${name.slice(0, 40)}` };
    if (BLOCKED_ENV.test(name)) return { error: `${name} can’t be set from the studio` };
    if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) return { error: `Invalid value for ${name}` };
    env[name] = value;
  }
  return { env };
}

/** A path in a Python project: like a build project path, and `.python-version` (written by `uv python pin`) */
export function isValidPythonPath(filePath: string): boolean {
  return filePath === '.python-version' || isValidProjectPath(filePath);
}

export function parsePythonRequest(body: unknown): PythonRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;

  const action = input.action as PythonAction;
  if (!ACTIONS.includes(action)) return { error: 'Unknown action' };
  if (action === 'install-uv') return { projectId: 'tooling', action, files: {}, env: {} };

  if (typeof input.projectId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(input.projectId)) return { error: 'Invalid projectId' };

  const files: Record<string, string> = {};
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) return { error: 'files must be an object of path -> content' };
  const entries = Object.entries(input.files as Record<string, unknown>);
  if (entries.length > MAX_PY_FILES) return { error: `A project can have at most ${MAX_PY_FILES} files` };
  let total = 0;
  for (const [filePath, content] of entries) {
    if (!isValidPythonPath(filePath)) return { error: `Invalid file path: ${filePath.slice(0, 80)}` };
    if (typeof content !== 'string') return { error: `File content must be a string: ${filePath}` };
    total += Buffer.byteLength(content, 'utf8');
    files[filePath] = content;
  }
  if (total > MAX_PY_PROJECT_BYTES) return { error: `Project exceeds ${MAX_PY_PROJECT_BYTES / 1024 / 1024} MB` };

  const parsedEnv = parseEnv(input.env);
  if ('error' in parsedEnv) return parsedEnv;

  const request: PythonRequest = { projectId: input.projectId, action, files, env: parsedEnv.env };

  if (action === 'run') {
    if (typeof input.entry !== 'string' || !(input.entry in files) || !/\.py$/.test(input.entry)) return { error: 'entry must be a .py file in the project' };
    request.entry = input.entry;
    const args = input.args ?? [];
    if (!Array.isArray(args) || args.length > 50 || args.some((a) => typeof a !== 'string' || a.length > 1000 || a.includes('\0'))) return { error: 'Invalid arguments' };
    request.args = args as string[];
  }

  if (action === 'add' || action === 'remove' || action === 'run') {
    const packages = input.packages ?? [];
    const valid = action === 'remove' ? isPackageName : isPackageSpec;
    if (!Array.isArray(packages) || packages.length > 30 || !packages.every(valid)) {
      return { error: action === 'remove' ? 'Invalid package name' : 'Invalid package: use a name with optional extras and version constraints, e.g. httpx>=0.27' };
    }
    if (action !== 'run' && packages.length === 0) return { error: 'Name at least one package' };
    request.packages = packages as string[];
    request.dev = input.dev === true;
  }

  if (action === 'lock') request.upgrade = input.upgrade === true;

  if (action === 'pin') {
    if (typeof input.version !== 'string' || !/^\d+\.\d+(?:\.\d+)?$/.test(input.version)) return { error: 'version must look like 3.12' };
    request.version = input.version;
  }

  if (action === 'init' || action === 'add') {
    request.name = typeof input.name === 'string' ? input.name : undefined;
  }

  return request;
}

// ---------------------------------------------------------------------------
// What to run
// ---------------------------------------------------------------------------

/** A valid, lowercase project name for pyproject.toml */
export function projectName(requested?: string): string {
  const cleaned = (requested ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return /^[a-z]/.test(cleaned) ? cleaned : `app-${cleaned || 'project'}`.replace(/-+$/, '');
}

export interface UvStep {
  args: string[];
  timeoutMs: number;
  /** Heading printed before the step's output */
  label?: string;
}

/** The uv invocations for a request, in order. `error` when it can't work yet. */
export function uvSteps(request: PythonRequest, hasPyproject: boolean): UvStep[] | { error: string } {
  const install = INSTALL_TIMEOUT_MS;
  const pkgs = request.packages ?? [];
  const needsProject = (): { error: string } => ({ error: 'This project has no pyproject.toml yet. Create one first (uv init), or add a package to create it.' });

  switch (request.action) {
    case 'init':
      return hasPyproject
        ? { error: 'This project already has a pyproject.toml.' }
        : [{ args: ['init', '--bare', '--no-workspace', '--name', projectName(request.name)], timeoutMs: 60_000 }];
    case 'add': {
      const steps: UvStep[] = [];
      if (!hasPyproject) steps.push({ args: ['init', '--bare', '--no-workspace', '--name', projectName(request.name)], timeoutMs: 60_000 });
      steps.push({ args: ['add', ...(request.dev ? ['--dev'] : []), ...pkgs], timeoutMs: install });
      return steps;
    }
    case 'remove':
      return hasPyproject ? [{ args: ['remove', ...(request.dev ? ['--dev'] : []), ...pkgs], timeoutMs: install }] : needsProject();
    case 'sync':
      return hasPyproject ? [{ args: ['sync'], timeoutMs: install }] : needsProject();
    case 'lock':
      return hasPyproject ? [{ args: ['lock', ...(request.upgrade ? ['--upgrade'] : [])], timeoutMs: install }] : needsProject();
    case 'tree':
      return hasPyproject ? [{ args: ['tree'], timeoutMs: install }] : needsProject();
    case 'pin':
      return [{ args: ['python', 'pin', request.version ?? ''], timeoutMs: install }];
    case 'run': {
      const withs = pkgs.flatMap((p) => ['--with', p]);
      const entry = request.entry ?? '';
      const args = request.args ?? [];
      // With a project, install first (slow, own timeout) and then run without re-syncing,
      // so installing a large package can't eat the program's run time
      return hasPyproject
        ? [
            { args: ['sync'], timeoutMs: install },
            { args: ['run', '--no-sync', ...withs, entry, ...args], timeoutMs: RUN_TIMEOUT_MS },
          ]
        : [{ args: ['run', '--no-project', ...withs, entry, ...args], timeoutMs: install }];
    }
    default:
      return { error: 'Unknown action' };
  }
}

// ---------------------------------------------------------------------------
// The child environment
// ---------------------------------------------------------------------------

/** Host variables a toolchain legitimately needs; nothing else is inherited */
const INHERITED = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  // Proxies and certificate bundles, so installs work on restricted networks
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
];

/**
 * The environment for uv and the user's program: a short allow-list from the
 * host, a private HOME, shared caches, then the variables the user set.
 * ANTHROPIC_API_KEY, GITHUB_CLIENT_SECRET and the rest of the server's
 * environment are deliberately left out.
 */
export function childEnv(host: NodeJS.ProcessEnv, projectDir: string, user: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED) if (host[key] !== undefined) env[key] = host[key] as string;
  const home = path.join(projectDir, '.home');
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    UV_CACHE_DIR: path.join(PY_CACHE, 'uv'),
    UV_PYTHON_INSTALL_DIR: path.join(NANOCLI_DIR, 'python-installs'),
    UV_NO_PROGRESS: '1',
    XDG_CACHE_HOME: path.join(PY_CACHE, 'xdg'),
    HF_HOME: path.join(PY_CACHE, 'huggingface'),
    TORCH_HOME: path.join(PY_CACHE, 'torch'),
    NO_COLOR: '1',
    PYTHONUNBUFFERED: '1',
    PYTHONUTF8: '1',
    PYTHONIOENCODING: 'utf-8',
    ...user,
  };
}

// ---------------------------------------------------------------------------
// Finding uv
// ---------------------------------------------------------------------------

export interface UvInfo {
  bin: string;
  version: string;
  source: 'env' | 'system' | 'installed';
}

let uvFound: UvInfo | null = null;

async function probe(bin: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 15_000, windowsHide: true });
    const match = /^uv (\S+)/.exec(stdout.trim());
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

/** uv from UV_BIN, the PATH, or the copy the studio downloaded; null when none works */
export async function resolveUv(): Promise<UvInfo | null> {
  if (uvFound && (await probe(uvFound.bin))) return uvFound;
  uvFound = null;
  const exe = process.platform === 'win32' ? 'uv.exe' : 'uv';
  const candidates: [string, UvInfo['source']][] = [
    ...(process.env.UV_BIN ? [[process.env.UV_BIN, 'env'] as [string, UvInfo['source']]] : []),
    ['uv', 'system'],
    [path.join(UV_INSTALL_DIR, UV_VERSION, exe), 'installed'],
  ];
  for (const [bin, source] of candidates) {
    const version = await probe(bin);
    if (version) {
      uvFound = { bin, version, source };
      return uvFound;
    }
  }
  return null;
}

/** Download uv into the studio's own folder (official release, checksum verified) */
export async function installManagedUv(onProgress: (message: string) => void): Promise<UvInfo> {
  await installUv(UV_INSTALL_DIR, onProgress);
  const info = await resolveUv();
  if (!info) throw new Error('uv was installed but could not be started.');
  return info;
}

export const UV_INSTALL_HELP = [
  'uv isn’t installed. Install it with one of:',
  '  Windows:  winget install --id=astral-sh.uv -e',
  '  macOS / Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh',
  'or let the studio download it (official release, checksum verified).',
].join('\n');

export interface PythonStatus {
  enabled: boolean;
  uv: { version: string; source: UvInfo['source'] } | null;
  /** Python versions uv already has locally */
  pythons: string[];
}

export async function getPythonStatus(): Promise<PythonStatus> {
  if (!isPythonEnabled()) return { enabled: false, uv: null, pythons: [] };
  const uv = await resolveUv();
  if (!uv) return { enabled: true, uv: null, pythons: [] };
  let pythons: string[] = [];
  try {
    const { stdout } = await execFileAsync(uv.bin, ['python', 'list', '--only-installed'], {
      timeout: 20_000,
      windowsHide: true,
      env: childEnv(process.env, NANOCLI_DIR, {}) as NodeJS.ProcessEnv,
    });
    pythons = [...new Set([...stdout.matchAll(/cpython-(\d+\.\d+\.\d+)/g)].map((m) => m[1]))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  } catch {
    // listing is a nicety; the panel works without it
  }
  return { enabled: true, uv: { version: uv.version, source: uv.source }, pythons };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface PythonResult {
  /** Exit code of the last step, null when it never started or was killed */
  code: number | null;
  ms: number;
  /** Files created or changed (pyproject.toml, uv.lock, files the program wrote) */
  changed: Record<string, string>;
  /** Files the project had that are gone now */
  removed: string[];
  /** Files that were not returned (binary, too large, odd names) */
  skipped: string[];
  timedOut?: boolean;
  truncated?: boolean;
  error?: string;
}

export interface RunHooks {
  onOutput: (stream: 'stdout' | 'stderr' | 'info', text: string) => void;
  signal?: AbortSignal;
}

function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  const pid = child.pid;
  try {
    process.kill(-pid, 'SIGTERM'); // the whole process group: uv and whatever Python started
  } catch {
    child.kill('SIGTERM');
  }
  setTimeout(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }, 3000).unref();
}

interface SpawnOutcome {
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
  aborted: boolean;
}

function spawnStep(bin: string, step: UvStep, cwd: string, env: Record<string, string>, budget: { left: number }, hooks: RunHooks): Promise<SpawnOutcome> {
  return new Promise((resolve) => {
    let timedOut = false;
    let truncated = false;
    let aborted = false;
    const child = spawn(bin, step.args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (truncated) return;
      budget.left -= chunk.length;
      if (budget.left < 0) {
        truncated = true;
        hooks.onOutput('info', `Output limit reached (${MAX_OUTPUT_BYTES / 1024 / 1024} MB); stopping.`);
        killTree(child);
        return;
      }
      hooks.onOutput(stream, decoders[stream].write(chunk));
    };
    child.stdout.on('data', forward('stdout'));
    child.stderr.on('data', forward('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, step.timeoutMs);
    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    hooks.signal?.addEventListener('abort', onAbort, { once: true });
    if (hooks.signal?.aborted) onAbort();

    const finish = (code: number | null) => {
      clearTimeout(timer);
      hooks.signal?.removeEventListener('abort', onAbort);
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = decoders[stream].end();
        if (rest) hooks.onOutput(stream, rest);
      }
      resolve({ code, timedOut, truncated, aborted });
    };
    child.on('error', (error) => {
      hooks.onOutput('stderr', `${error.message}\n`);
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

// One command at a time per project, and a cap on commands across all projects
const projectLocks = new Map<string, Promise<unknown>>();
let activeJobs = 0;
const waiting: (() => void)[] = [];

async function withJobSlot<T>(task: () => Promise<T>): Promise<T> {
  if (activeJobs >= MAX_PY_JOBS) {
    if (waiting.length >= MAX_QUEUED_JOBS) throw new Error('The server is busy running other Python jobs. Try again in a moment.');
    await new Promise<void>((resolve) => waiting.push(resolve));
  } else {
    activeJobs++;
  }
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next(); // hand the slot straight to the next job
    else activeJobs--;
  }
}

async function withProjectLock<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const previous = projectLocks.get(projectId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  projectLocks.set(projectId, run);
  try {
    return await run;
  } finally {
    if (projectLocks.get(projectId) === run) projectLocks.delete(projectId);
  }
}

/** Directories that hold the environment and caches, not the user's project */
const KEEP_ON_SYNC = new Set(['.venv', '.home']);
const SKIP_WHEN_COLLECTING = new Set(['.venv', '.home', '__pycache__', '.git', 'node_modules', '.cache', '.ruff_cache', '.pytest_cache', '.mypy_cache']);

/** Make the project directory match what the browser sent, leaving the environment alone */
async function writeProject(dir: string, files: Record<string, string>): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  for (const entry of await fs.readdir(dir)) {
    if (!KEEP_ON_SYNC.has(entry)) await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  }
  for (const [relative, content] of Object.entries(files)) {
    const target = path.resolve(dir, relative);
    if (!target.startsWith(dir + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
  }
}

/** Text files in the project directory, for sending back to the browser */
async function collectFiles(dir: string): Promise<{ files: Record<string, string>; skipped: string[] }> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;

  const walk = async (current: string, prefix: string): Promise<void> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_WHEN_COLLECTING.has(entry.name)) await walk(path.join(current, entry.name), relative);
        continue;
      }
      if (!entry.isFile() || entry.name.endsWith('.pyc')) continue;
      const full = path.join(current, entry.name);
      try {
        const stat = await fs.stat(full);
        if (!isValidPythonPath(relative) || stat.size > MAX_RETURNED_FILE_BYTES || total + stat.size > MAX_RETURNED_TOTAL_BYTES || Object.keys(files).length >= MAX_PY_FILES) {
          skipped.push(relative);
          continue;
        }
        const buffer = await fs.readFile(full);
        if (buffer.subarray(0, 8000).includes(0)) {
          skipped.push(relative);
          continue;
        }
        total += buffer.length;
        files[relative] = buffer.toString('utf8');
      } catch {
        // changed underneath us; leave it out
      }
    }
  };
  await walk(dir, '');
  return { files, skipped };
}

/** Run a request to completion, streaming output through the hooks */
export async function runPython(request: PythonRequest, hooks: RunHooks): Promise<PythonResult> {
  const started = Date.now();
  const empty = (error: string, code: number | null = null): PythonResult => ({ code, ms: Date.now() - started, changed: {}, removed: [], skipped: [], error });

  if (!isPythonEnabled()) return empty('Python support is turned off on this server (NANOCLI_PYTHON=0).');
  const uv = await resolveUv();
  if (!uv) return empty(UV_INSTALL_HELP);

  const hasPyproject = 'pyproject.toml' in request.files;
  const steps = uvSteps(request, hasPyproject);
  if ('error' in steps) return empty(steps.error);

  return withJobSlot(() =>
    withProjectLock(request.projectId, async () => {
      const dir = path.join(PY_PROJECTS, request.projectId);
      await writeProject(dir, request.files);
      const env = childEnv(process.env, dir, request.env);
      await fs.mkdir(env.HOME, { recursive: true });

      const budget = { left: MAX_OUTPUT_BYTES };
      let outcome: SpawnOutcome = { code: 0, timedOut: false, truncated: false, aborted: false };
      for (const step of steps) {
        if (step.label) hooks.onOutput('info', `${step.label}\n`);
        hooks.onOutput('info', `$ uv ${step.args.join(' ')}\n`);
        outcome = await spawnStep(uv.bin, step, dir, env, budget, hooks);
        if (outcome.code !== 0) break;
      }

      const after = await collectFiles(dir);
      const changed: Record<string, string> = {};
      for (const [file, content] of Object.entries(after.files)) {
        if (request.files[file] !== content) changed[file] = content;
      }
      // A file that was too big or binary to send back is still there: only report real deletions
      const skipped = new Set(after.skipped);
      const removed = Object.keys(request.files).filter((file) => !(file in after.files) && !skipped.has(file));
      await fs.utimes(dir, new Date(), new Date()).catch(() => undefined); // so cleanup sees recent use

      return {
        code: outcome.code,
        ms: Date.now() - started,
        changed,
        removed,
        skipped: after.skipped,
        ...(outcome.timedOut ? { timedOut: true } : {}),
        ...(outcome.truncated ? { truncated: true } : {}),
      };
    })
  );
}

/** Remove project directories that haven't been used for a while (environments are big) */
export async function cleanupPythonProjects(maxAgeMs: number = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const now = Date.now();
    for (const entry of await fs.readdir(PY_PROJECTS)) {
      const target = path.join(PY_PROJECTS, entry);
      try {
        if (now - (await fs.stat(target)).mtimeMs > maxAgeMs) await fs.rm(target, { recursive: true, force: true });
      } catch {
        // removed concurrently
      }
    }
  } catch {
    // nothing has run yet
  }
}
