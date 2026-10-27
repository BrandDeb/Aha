/**
 * The terminal's real commands: anything the built-in shell doesn't handle
 * (npm, go test, cargo, make, pytest…) runs in a shell on this machine, in the
 * same project folder Run uses, so installed dependencies and build output are
 * shared. The browser's files are written there first, and files the command
 * changes come back. Like Run, it executes on the host, so it is only on when
 * that is the user's own machine. Server only.
 */

import os from 'node:os';
import path from 'node:path';
import { LANGUAGES } from './languages.ts';
import { KEEP, RUN_PROJECTS, runEnv, type RunResult } from './polyglot.ts';
import { shellFor } from './pipelines/run.ts';
import { collectFiles, createJobPool, createKeyedLock, diffFiles, isSafeRelativePath, runStep, writeProject } from './proc.ts';
import { refreshBinPaths } from './toolchains.ts';
import { rootOf } from './folder.ts';

export interface ShellRequest {
  projectId: string;
  files: Record<string, string>;
  command: string;
  /** Directory inside the project to run in ('' for the root) */
  cwd: string;
  /** An opened folder (lib/folder.ts): the command runs in it, in place, and nothing is copied either way */
  folder?: string;
}

const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_FILES = 300;
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OUTPUT = 4 * 1024 * 1024;
const TIMEOUT_MS = 15 * 60_000;

export function parseShellRequest(body: unknown): ShellRequest | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  if (typeof input.projectId !== 'string' || !PROJECT_ID.test(input.projectId)) return { error: 'projectId is missing or invalid' };
  if (typeof input.command !== 'string' || !input.command.trim() || input.command.length > 4000 || input.command.includes('\0')) return { error: 'command must be a line of text' };
  const cwd = typeof input.cwd === 'string' ? input.cwd.replace(/^\/+|\/+$/g, '') : '';
  if (cwd && !isSafeRelativePath(cwd)) return { error: 'cwd must be a folder inside the project' };
  if (typeof input.folder === 'string') {
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(input.folder)) return { error: 'folder is invalid' };
    return { projectId: input.projectId, files: {}, command: input.command, cwd, folder: input.folder };
  }
  if (!input.files || typeof input.files !== 'object' || Array.isArray(input.files)) return { error: 'files must be an object of path -> content' };
  const entries = Object.entries(input.files as Record<string, unknown>);
  if (entries.length > MAX_FILES) return { error: `A project can have up to ${MAX_FILES} files` };
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, content] of entries) {
    if (!isSafeRelativePath(name) || typeof content !== 'string') return { error: `Invalid file: ${name.slice(0, 80)}` };
    total += Buffer.byteLength(content, 'utf8');
    files[name] = content;
  }
  if (total > MAX_BYTES) return { error: `Project exceeds ${MAX_BYTES / 1024 / 1024} MB` };
  return { projectId: input.projectId, files, command: input.command, cwd };
}

const pool = createJobPool(Number(process.env.AHA_SHELL_JOBS) || 3, 12, 'The server is busy running other commands. Try again in a moment.');
const lock = createKeyedLock();

export async function runShell(request: ShellRequest, hooks: { onOutput: (stream: 'stdout' | 'stderr' | 'info', text: string) => void; signal?: AbortSignal }): Promise<RunResult> {
  const started = Date.now();
  return pool.run(() =>
    lock(request.folder ?? request.projectId, async () => {
      if (request.folder) return runInFolder(request, hooks, started);
      const dir = path.join(RUN_PROJECTS, request.projectId);
      // Dependencies, build output and caches stay in the folder; they are never sent back as project files
      const keep = new Set([...KEEP, ...LANGUAGES.flatMap((l) => l.buildDirs ?? []), 'dist', 'build', '.next', '.aha-ci']);
      await writeProject(dir, request.files, { keep });
      await refreshBinPaths();
      const env: Record<string, string> = { ...runEnv(process.env, dir, {}), TERM: 'dumb', AHA_TERMINAL: '1' };
      const shell = shellFor(undefined, request.command, env.PATH ?? env.Path ?? '');
      const result = (partial: Partial<RunResult>): RunResult => ({ code: null, ms: Date.now() - started, changed: {}, removed: [], skipped: [], ...partial });
      if ('error' in shell) return result({ error: shell.error });
      const cwd = path.resolve(dir, request.cwd);
      if (!(cwd === dir || cwd.startsWith(dir + path.sep))) return result({ error: 'cwd is outside the project' });
      const outcome = await runStep({ file: shell.file, args: shell.args, cwd, env, timeoutMs: TIMEOUT_MS, budget: { left: MAX_OUTPUT }, maxOutputBytes: MAX_OUTPUT, onOutput: hooks.onOutput, signal: hooks.signal });
      const { files: after, skipped } = await collectFiles(dir, { skipDirs: keep, maxFiles: MAX_FILES, maxFileBytes: 512 * 1024, maxTotalBytes: 4 * 1024 * 1024, skipFile: (name) => name.endsWith('.pyc') });
      const { changed, removed } = diffFiles(request.files, after, skipped);
      return result({
        code: outcome.code,
        changed,
        removed,
        skipped,
        timedOut: outcome.timedOut || undefined,
        truncated: outcome.truncated || undefined,
        error: outcome.spawnError ? `Could not start the shell: ${outcome.spawnError.message}` : outcome.aborted ? 'stopped' : undefined,
      });
    })
  );
}

/** A command in an opened folder: the files are already there, and the folder's watcher reports what it changes */
async function runInFolder(request: ShellRequest, hooks: { onOutput: (stream: 'stdout' | 'stderr' | 'info', text: string) => void; signal?: AbortSignal }, started: number): Promise<RunResult> {
  const result = (partial: Partial<RunResult>): RunResult => ({ code: null, ms: Date.now() - started, changed: {}, removed: [], skipped: [], ...partial });
  let dir: string;
  try {
    dir = rootOf(request.folder);
  } catch (error) {
    return result({ error: error instanceof Error ? error.message : 'That folder is not open' });
  }
  await refreshBinPaths();
  const env: Record<string, string> = { ...folderEnv(runEnv(process.env, dir, {})), TERM: 'dumb', AHA_TERMINAL: '1' };
  const shell = shellFor(undefined, request.command, env.PATH ?? env.Path ?? '');
  if ('error' in shell) return result({ error: shell.error });
  const cwd = path.resolve(dir, request.cwd);
  if (!(cwd === dir || cwd.startsWith(dir + path.sep))) return result({ error: 'cwd is outside the project' });
  const outcome = await runStep({ file: shell.file, args: shell.args, cwd, env, timeoutMs: TIMEOUT_MS, budget: { left: MAX_OUTPUT }, maxOutputBytes: MAX_OUTPUT, onOutput: hooks.onOutput, signal: hooks.signal });
  return result({
    code: outcome.code,
    timedOut: outcome.timedOut || undefined,
    truncated: outcome.truncated || undefined,
    error: outcome.spawnError ? `Could not start the shell: ${outcome.spawnError.message}` : outcome.aborted ? 'stopped' : undefined,
  });
}

/**
 * A scratch copy gets a private HOME and the studio's shared caches; the user's own project gets their real home and
 * caches, as in their own terminal (and nothing like `.home/` appears in it). Server secrets still stay out: the
 * variables are runEnv's allow-list.
 */
export function folderEnv(env: Record<string, string>, host: Record<string, string | undefined> = process.env, home = os.homedir()): Record<string, string> {
  const out: Record<string, string> = { ...env, HOME: home, USERPROFILE: home, DOTNET_CLI_HOME: home };
  for (const key of ['GOCACHE', 'GOPATH', 'CARGO_HOME', 'npm_config_cache', 'BUN_INSTALL_CACHE_DIR', 'NUGET_PACKAGES', 'ZIG_GLOBAL_CACHE_DIR']) {
    if (host[key] !== undefined) out[key] = host[key] as string;
    else delete out[key];
  }
  return out;
}
