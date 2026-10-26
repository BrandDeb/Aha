/**
 * Running programs on behalf of the browser, safely enough for a local tool:
 * output and time limits, killing a whole process tree, a cap on concurrent
 * jobs, one job at a time per project, and syncing a project's files to a
 * folder and back. Shared by the language runner and the dev servers.
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    return;
  }
  const pid = child.pid;
  try {
    process.kill(-pid, 'SIGTERM'); // the whole process group: the tool and whatever it started
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

export interface StepOptions {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  timeoutMs: number;
  /** Shared across the steps of one run: bytes of output still allowed */
  budget: { left: number };
  maxOutputBytes: number;
  onOutput: (stream: 'stdout' | 'stderr' | 'info', text: string) => void;
  signal?: AbortSignal;
  /** Text to feed the program's standard input (it is closed afterwards) */
  stdin?: string;
}

export interface StepOutcome {
  code: number | null;
  timedOut: boolean;
  truncated: boolean;
  aborted: boolean;
  /** The program could not be started at all (not installed, not executable) */
  spawnError?: NodeJS.ErrnoException;
}

export function runStep(options: StepOptions): Promise<StepOutcome> {
  const { file, args, cwd, env, timeoutMs, budget, maxOutputBytes, onOutput, signal } = options;
  return new Promise((resolve) => {
    let timedOut = false;
    let truncated = false;
    let aborted = false;
    let spawnError: NodeJS.ErrnoException | undefined;
    const child = spawn(file, args, {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    if (options.stdin !== undefined) child.stdin?.end(options.stdin);

    const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
    const forward = (stream: 'stdout' | 'stderr') => (chunk: Buffer) => {
      if (truncated) return;
      budget.left -= chunk.length;
      if (budget.left < 0) {
        truncated = true;
        onOutput('info', `Output limit reached (${Math.round(maxOutputBytes / 1024 / 1024)} MB); stopping.`);
        killTree(child);
        return;
      }
      onOutput(stream, decoders[stream].write(chunk));
    };
    child.stdout?.on('data', forward('stdout'));
    child.stderr?.on('data', forward('stderr'));

    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, timeoutMs);
    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();

    const finish = (code: number | null) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      for (const stream of ['stdout', 'stderr'] as const) {
        const rest = decoders[stream].end();
        if (rest) onOutput(stream, rest);
      }
      resolve({ code, timedOut, truncated, aborted, spawnError });
    };
    child.on('error', (error) => {
      spawnError = error as NodeJS.ErrnoException;
      finish(null);
    });
    child.on('close', (code) => finish(code));
  });
}

/** Run to completion and return the text it printed; never throws */
export function capture(file: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { cwd: options.cwd, env: options.env ?? process.env, timeout: options.timeoutMs ?? 8000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? ((error as NodeJS.ErrnoException).code as unknown as number) : null) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim() });
    });
  });
}

/** At most `max` jobs at once; extra jobs wait, up to `maxQueued`, then are refused */
export function createJobPool(max: number, maxQueued: number, busyMessage: string) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return {
    get active() {
      return active;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= max) {
        if (waiting.length >= maxQueued) throw new Error(busyMessage);
        await new Promise<void>((resolve) => waiting.push(resolve));
      } else {
        active++;
      }
      try {
        return await task();
      } finally {
        const next = waiting.shift();
        if (next) next(); // hand the slot straight to the next job
        else active--;
      }
    },
  };
}

/** Tasks with the same key run one after another */
export function createKeyedLock() {
  const locks = new Map<string, Promise<unknown>>();
  return async function lock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    locks.set(key, run);
    try {
      return await run;
    } finally {
      if (locks.get(key) === run) locks.delete(key);
    }
  };
}

/** Relative paths the browser may write: no escaping the folder, no odd characters; dotfiles are allowed (.gitignore, .env.example) */
export const isSafeRelativePath = (p: string): boolean =>
  p.length > 0 && p.length <= 200 && !p.includes('\0') && /^(?:[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*\/|\.[A-Za-z0-9_][A-Za-z0-9_.@+-]*\/)*\.?[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/.test(p) && !p.split('/').some((part) => part === '..' || part === '.');

export interface SyncOptions {
  /** Top-level entries to leave alone (installed dependencies, caches) */
  keep?: Set<string>;
  /** Replace everything else (default) or only add and overwrite files */
  merge?: boolean;
}

/** Make the folder match the files the browser sent */
export async function writeProject(dir: string, files: Record<string, string>, options: SyncOptions = {}): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const wanted = new Set<string>();
  for (const relative of Object.keys(files)) wanted.add(relative);
  if (!options.merge) {
    // Remove files the browser no longer has, but never the kept folders
    const walk = async (current: string, prefix: string): Promise<void> => {
      for (const entry of await fs.readdir(current, { withFileTypes: true })) {
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (!prefix && options.keep?.has(entry.name)) continue;
        if (entry.isDirectory()) {
          await walk(path.join(current, entry.name), relative);
          if (!(await fs.readdir(path.join(current, entry.name))).length) await fs.rmdir(path.join(current, entry.name)).catch(() => {});
        } else if (!wanted.has(relative)) {
          await fs.rm(path.join(current, entry.name), { force: true });
        }
      }
    };
    await walk(dir, '');
  }
  for (const [relative, content] of Object.entries(files)) {
    if (!isSafeRelativePath(relative)) continue;
    const target = path.resolve(dir, relative);
    if (!target.startsWith(dir + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Don't rewrite identical files: watchers (dev servers) treat every write as a change
    const existing = await fs.readFile(target, 'utf8').catch(() => null);
    if (existing !== content) await fs.writeFile(target, content, 'utf8');
  }
}

export interface CollectOptions {
  skipDirs: Set<string>;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  skipFile?: (name: string) => boolean;
}

/** Text files in the folder, for sending back to the browser */
export async function collectFiles(dir: string, options: CollectOptions): Promise<{ files: Record<string, string>; skipped: string[] }> {
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  const walk = async (current: string, prefix: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!options.skipDirs.has(entry.name)) await walk(path.join(current, entry.name), relative);
        continue;
      }
      if (!entry.isFile() || options.skipFile?.(entry.name)) continue;
      const full = path.join(current, entry.name);
      try {
        const stat = await fs.stat(full);
        if (!isSafeRelativePath(relative) || stat.size > options.maxFileBytes || total + stat.size > options.maxTotalBytes || Object.keys(files).length >= options.maxFiles) {
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

/** What changed between the files the browser sent and the folder afterwards */
export function diffFiles(before: Record<string, string>, after: Record<string, string>, skipped: string[]): { changed: Record<string, string>; removed: string[] } {
  const changed: Record<string, string> = {};
  for (const [name, content] of Object.entries(after)) if (before[name] !== content) changed[name] = content;
  // A file that was skipped (too large, binary) isn't "removed"
  const removed = Object.keys(before).filter((name) => !(name in after) && !skipped.includes(name));
  return { changed, removed };
}
