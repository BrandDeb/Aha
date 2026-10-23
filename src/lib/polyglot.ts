/**
 * Running a project in one of the languages from languages.ts: find the
 * toolchain, put the browser's files in a folder, run the compile and run
 * steps with limits, and hand back what the program printed and wrote.
 * Like the Python runner, this executes code on the machine hosting the
 * studio: it is only available when that is the user's own machine.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listensOnLoopbackOnly } from './host.ts';
import { detectLanguage, getLanguage, LANGUAGES, OUT_DIR, type Language, type LangStep } from './languages.ts';
import { capture, collectFiles, createJobPool, createKeyedLock, diffFiles, isSafeRelativePath, runStep, writeProject } from './proc.ts';
import { applyManaged, getToolchainState, installFor, MANAGED, refreshBinPaths } from './toolchains.ts';
import { bundledZigDir, withBundledZig } from './zig.ts';

export const NANOCLI_DIR = process.env.NANOCLI_HOME || path.join(os.homedir(), '.nanocli');
export const RUN_PROJECTS = path.join(NANOCLI_DIR, 'run');
const CACHE = path.join(NANOCLI_DIR, 'cache');

export const MAX_RUN_FILES = 300;
const MAX_RUN_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_RETURNED_FILE_BYTES = 512 * 1024;
const MAX_RETURNED_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_STDIN = 100 * 1024;
/** Read each run, so a test (or an operator) can shorten the limits without restarting */
const timeoutScale = () => Number(process.env.NANOCLI_RUN_TIMEOUT_SCALE) || 1;
const pool = createJobPool(Number(process.env.NANOCLI_RUN_JOBS) || 3, 12, 'The server is busy running other programs. Try again in a moment.');
const lock = createKeyedLock();

/** On by default when the studio listens on this machine only; NANOCLI_RUN=0 turns it off, =1 forces it on */
export function isRunEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NANOCLI_RUN === '0') return false;
  if (env.NANOCLI_RUN === '1') return true;
  return listensOnLoopbackOnly(env);
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface RunRequest {
  language?: string;
  projectId: string;
  entry: string;
  args: string[];
  files: Record<string, string>;
  env: Record<string, string>;
  stdin?: string;
}

const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const BLOCKED_ENV = /^(?:PATH|HOME|USERPROFILE|SHELL|NODE_.*|NPM_.*|LD_.*|DYLD_.*|SYSTEM.*|COMSPEC|PATHEXT|TEMP|TMP|TMPDIR|XDG_.*|GO(?:ROOT|PATH|CACHE|FLAGS|PROXY)|CARGO.*|RUST.*|JAVA.*|DOTNET.*|ZIG.*|GEM_.*|BUNDLE.*|PYTHON.*|PERL5?LIB|RUBY.*)$/i;

export function parseRunRequest(body: unknown): RunRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)) return { error: 'projectId is missing or invalid' };
  if (typeof input.entry !== 'string' || !isSafeRelativePath(input.entry)) return { error: 'entry must be a file path inside the project' };
  if (input.language !== undefined && (typeof input.language !== 'string' || !getLanguage(input.language))) return { error: 'Unknown language' };

  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) return { error: 'files must be an object of path -> content' };
  const entries = Object.entries(input.files as Record<string, unknown>);
  if (!entries.length || entries.length > MAX_RUN_FILES) return { error: `A project can have 1 to ${MAX_RUN_FILES} files` };
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, content] of entries) {
    if (!isSafeRelativePath(name)) return { error: `Invalid file path: ${name.slice(0, 80)}` };
    if (typeof content !== 'string') return { error: `File content must be a string: ${name}` };
    total += Buffer.byteLength(content, 'utf8');
    files[name] = content;
  }
  if (total > MAX_RUN_BYTES) return { error: `Project exceeds ${MAX_RUN_BYTES / 1024 / 1024} MB` };
  if (!(input.entry in files)) return { error: 'entry must name a file in the project' };

  const rawArgs = input.args ?? [];
  if (!Array.isArray(rawArgs) || rawArgs.length > 50 || rawArgs.some((a) => typeof a !== 'string' || a.length > 1000 || a.includes('\0'))) return { error: 'args must be a list of short strings' };

  const env: Record<string, string> = {};
  if (input.env !== undefined) {
    if (!input.env || typeof input.env !== 'object' || Array.isArray(input.env)) return { error: 'env must be an object' };
    const pairs = Object.entries(input.env as Record<string, unknown>);
    if (pairs.length > 40) return { error: 'Too many environment variables' };
    for (const [name, value] of pairs) {
      if (!ENV_NAME.test(name) || typeof value !== 'string' || value.length > 4000 || value.includes('\0')) return { error: `Invalid environment variable: ${name.slice(0, 40)}` };
      if (BLOCKED_ENV.test(name)) return { error: `${name} can’t be set from the studio` };
      env[name] = value;
    }
  }
  if (input.stdin !== undefined && (typeof input.stdin !== 'string' || input.stdin.length > MAX_STDIN)) return { error: 'stdin must be text up to 100 KB' };
  return { language: input.language as string | undefined, projectId: input.projectId, entry: input.entry, args: rawArgs as string[], files, env, stdin: input.stdin as string | undefined };
}

// ---------------------------------------------------------------------------
// Environment and toolchains
// ---------------------------------------------------------------------------

/** Host variables a toolchain legitimately needs; nothing else is inherited */
const INHERITED = [
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'windir', 'ComSpec', 'TEMP', 'TMP', 'TMPDIR',
  'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS', 'REQUESTS_CA_BUNDLE', 'CURL_CA_BUNDLE',
  // Where toolchains were installed (not credentials)
  'RUSTUP_HOME', 'JAVA_HOME', 'GOROOT', 'DOTNET_ROOT', 'JAVA_TOOL_OPTIONS',
];

export function runEnv(host: Record<string, string | undefined>, projectDir: string, user: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of INHERITED) if (host[key] !== undefined) env[key] = host[key] as string;
  // rustup keeps toolchains under the real home; without this the private HOME below would hide them
  if (!env.RUSTUP_HOME && fsSync.existsSync(path.join(os.homedir(), '.rustup'))) env.RUSTUP_HOME = path.join(os.homedir(), '.rustup');
  const home = path.join(projectDir, '.home');
  const base = withBundledZig({
    ...env,
    HOME: home,
    USERPROFILE: home,
    // Caches shared between projects, so a second run doesn't download everything again
    GOCACHE: path.join(CACHE, 'go-build'),
    GOPATH: path.join(CACHE, 'gopath'),
    GOFLAGS: '-buildvcs=false',
    CARGO_HOME: path.join(CACHE, 'cargo'),
    npm_config_cache: path.join(CACHE, 'npm'),
    npm_config_update_notifier: 'false',
    BUN_INSTALL_CACHE_DIR: path.join(CACHE, 'bun'),
    NUGET_PACKAGES: path.join(CACHE, 'nuget'),
    DOTNET_CLI_HOME: home,
    DOTNET_NOLOGO: '1',
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    ZIG_GLOBAL_CACHE_DIR: path.join(CACHE, 'zig'),
    NO_COLOR: '1',
  });
  // Toolchains the studio installed (mise) come after the system's own
  return { ...applyManaged(base, (bin, systemPath) => which(bin, systemPath) !== null), ...user };
}

/** The first executable named `bin` on PATH (or null); no process is started */
export function which(bin: string, envPath: string, windows = process.platform === 'win32'): string | null {
  const exts = windows ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';') : [''];
  for (const folder of envPath.split(path.delimiter)) {
    if (!folder) continue;
    for (const e of exts) {
      const candidate = path.join(folder, bin + e.toLowerCase());
      const alt = path.join(folder, bin + e);
      for (const file of [candidate, alt]) {
        try {
          fsSync.accessSync(file, windows ? fsSync.constants.F_OK : fsSync.constants.X_OK);
          if (fsSync.statSync(file).isFile()) return file;
        } catch {
          // not here
        }
      }
    }
  }
  return null;
}

/** The first alternative that is installed: its command and leading arguments */
export function resolveTool(alternatives: string[][], envPath: string): { file: string; prefix: string[] } | null {
  for (const [bin, ...prefix] of alternatives) {
    const file = which(bin, envPath);
    if (file) return { file, prefix };
  }
  return null;
}

export interface LanguageStatus {
  id: string;
  name: string;
  available: boolean;
  version?: string;
  tool?: string;
  install: Language['install'];
  note?: string;
  /** The studio can install it with mise (and keep it updated) */
  installable?: { size: string };
  /** Installed by the studio rather than found on the system */
  managed?: boolean;
}

const statusCache = new Map<string, { at: number; status: LanguageStatus }>();

async function probeLanguage(language: Language): Promise<LanguageStatus> {
  const cached = statusCache.get(language.id);
  if (cached && Date.now() - cached.at < 30_000) return cached.status;
  const env = runEnv(process.env, os.tmpdir(), {});
  const tool = resolveTool(language.tools, env.PATH ?? env.Path ?? '');
  let version: string | undefined;
  if (tool) {
    const out = await capture(tool.file, [...tool.prefix, ...language.versionArgs], { env: env as NodeJS.ProcessEnv, timeoutMs: 8000 });
    // Some tools print banners ("Picked up JAVA_TOOL_OPTIONS") before the version: take the first line that has a number
    version = out.output.split('\n').find((line) => /\d+\.\d+/.test(line))?.trim().slice(0, 100);
  }
  const managed = MANAGED[language.id];
  const status: LanguageStatus = {
    id: language.id,
    name: language.name,
    available: !!tool,
    version,
    tool: tool ? path.basename(tool.file) : undefined,
    install: language.install,
    note: language.note,
    installable: managed ? { size: managed.size } : undefined,
    managed: tool ? tool.file.startsWith(path.join(NANOCLI_DIR, 'mise') + path.sep) : undefined,
  };
  statusCache.set(language.id, { at: Date.now(), status });
  return status;
}

export async function getLanguageStatuses(): Promise<LanguageStatus[]> {
  await refreshBinPaths();
  return Promise.all(LANGUAGES.map(probeLanguage));
}

/** Forget cached statuses (after a toolchain was installed or updated) */
export const clearLanguageStatuses = () => statusCache.clear();

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface RunResult {
  language?: string;
  code: number | null;
  ms: number;
  changed: Record<string, string>;
  removed: string[];
  skipped: string[];
  timedOut?: boolean;
  truncated?: boolean;
  error?: string;
}

export interface RunHooks {
  onOutput: (stream: 'stdout' | 'stderr' | 'info', text: string) => void;
  signal?: AbortSignal;
}

/** Top-level folders that hold dependencies, build output and caches: kept between runs, never sent back */
export const KEEP = new Set(['node_modules', 'target', '.home', OUT_DIR, 'vendor', '.dart_tool', '_build', 'deps', 'bin', 'obj', '.gradle', '.venv', '__pycache__']);

export function installHint(language: Language): string {
  const platform = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'mac' : 'linux';
  return `${language.name} isn’t installed (looked for ${language.tools.map((t) => t.join(' ')).join(', ')}).\nInstall it with: ${language.install[platform]}`;
}

export async function runLanguage(request: RunRequest, hooks: RunHooks): Promise<RunResult> {
  const started = Date.now();
  const paths = Object.keys(request.files);
  const language = request.language ? getLanguage(request.language) : detectLanguage(request.entry, paths);
  const result = (partial: Partial<RunResult>): RunResult => ({ language: language?.id, code: null, ms: Date.now() - started, changed: {}, removed: [], skipped: [], ...partial });
  if (!language) return result({ error: `The studio doesn’t know how to run ${path.basename(request.entry)}.` });

  return pool.run(() =>
    lock(request.projectId, async () => {
      const projectDir = path.join(RUN_PROJECTS, request.projectId);
      // Plus the folders this language's tools generate (Foundry's out/, Gleam's build/…)
      const keep = new Set([...KEEP, ...(language.buildDirs ?? [])]);
      await writeProject(projectDir, request.files, { keep });
      await refreshBinPaths();
      await fs.mkdir(path.join(projectDir, '.home'), { recursive: true });
      await fs.mkdir(path.join(projectDir, OUT_DIR), { recursive: true });
      for (const shared of ['go-build', 'gopath', 'cargo', 'npm', 'bun', 'nuget', 'zig']) await fs.mkdir(path.join(CACHE, shared), { recursive: true });

      const plan = language.plan({
        entry: request.entry,
        paths,
        read: (p) => request.files[p],
        hasDir: (name) => fsSync.existsSync(path.join(projectDir, name)),
        args: request.args,
        windows: process.platform === 'win32',
      });
      if ('error' in plan) return result({ error: plan.error });

      // Every tool this plan needs must be installed before anything runs. Missing ones the studio
      // can provide are installed now (once; later runs reuse them), unless that is switched off.
      let env = runEnv(process.env, projectDir, request.env);
      const missing = () => plan.find((step) => step.tool && !resolveTool(step.tool, env.PATH ?? env.Path ?? ''));
      if (missing() && MANAGED[language.id] && (await getToolchainState()).autoInstall) {
        hooks.onOutput('info', `${language.name} isn’t installed yet: installing it for the studio (first run only).\n`);
        const installed = await installFor(language.id, (text) => hooks.onOutput('info', text), hooks.signal);
        if (!installed.ok) return result({ error: `${installed.error}\n\n${installHint(language)}` });
        statusCache.delete(language.id);
        env = runEnv(process.env, projectDir, request.env);
      }
      const resolved: { step: LangStep; file: string; prefix: string[] }[] = [];
      for (const step of plan) {
        if (!step.tool) {
          resolved.push({ step, file: path.join(projectDir, OUT_DIR, `main${process.platform === 'win32' ? '.exe' : ''}`), prefix: [] });
          continue;
        }
        const tool = resolveTool(step.tool, env.PATH ?? env.Path ?? '');
        if (!tool) return result({ error: installHint(language) });
        resolved.push({ step, ...tool });
      }

      const budget = { left: MAX_OUTPUT_BYTES };
      let last: Awaited<ReturnType<typeof runStep>> | null = null;
      for (const { step, file, prefix } of resolved) {
        hooks.onOutput('info', `$ ${[step.label].join(' ')}\n`);
        last = await runStep({
          file,
          args: [...prefix, ...step.args],
          cwd: projectDir,
          env,
          timeoutMs: step.timeoutMs * timeoutScale(),
          budget,
          maxOutputBytes: MAX_OUTPUT_BYTES,
          onOutput: hooks.onOutput,
          signal: hooks.signal,
          stdin: step === resolved[resolved.length - 1].step ? request.stdin : undefined,
        });
        if (last.spawnError) {
          hooks.onOutput('stderr', `${last.spawnError.message}\n`);
          break;
        }
        if (last.timedOut) hooks.onOutput('info', `Timed out after ${Math.round((step.timeoutMs * timeoutScale()) / 1000)}s.\n`);
        if (last.code !== 0 || last.aborted || last.timedOut || last.truncated) break;
      }

      const { files: after, skipped } = await collectFiles(projectDir, {
        skipDirs: keep,
        maxFiles: MAX_RUN_FILES,
        maxFileBytes: MAX_RETURNED_FILE_BYTES,
        maxTotalBytes: MAX_RETURNED_TOTAL_BYTES,
        skipFile: (name) => name.endsWith('.pyc'),
      });
      const { changed, removed } = diffFiles(request.files, after, skipped);
      return result({
        code: last?.code ?? null,
        changed,
        removed,
        skipped,
        timedOut: last?.timedOut || undefined,
        truncated: last?.truncated || undefined,
        error: last?.spawnError ? `Could not start ${language.name}: ${last.spawnError.message}` : last?.aborted ? 'stopped' : undefined,
      });
    })
  );
}

/** Delete project folders nobody has touched for a week (they are rebuilt from the browser's copy on demand) */
export async function cleanupRunProjects(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    const now = Date.now();
    for (const entry of await fs.readdir(RUN_PROJECTS)) {
      const target = path.join(RUN_PROJECTS, entry);
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

export { bundledZigDir };
