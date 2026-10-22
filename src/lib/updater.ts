/**
 * Updating the studio from its own git checkout, with the user's approval.
 * Only fast-forwards a clean working tree (so local work is never merged,
 * stashed or overwritten), reinstalls dependencies only when they changed,
 * rebuilds for production, and puts the checkout back exactly as it was if any
 * step fails. Nothing here runs unless the user presses "Update".
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export interface UpdateCommit {
  sha: string;
  subject: string;
  author: string;
  date: string;
}

export interface UpdateStatus {
  /** False when this isn't a git checkout (a container, a copied folder) */
  supported: boolean;
  /** Why not, or why it can't be applied right now */
  note?: string;
  branch?: string;
  upstream?: string;
  current?: string;
  latest?: string;
  behind: number;
  ahead: number;
  dirty: boolean;
  commits: UpdateCommit[];
  canApply: boolean;
  /** The server was started by the supervisor, so it can restart itself */
  supervised: boolean;
  checkedAt: number;
  /** The fetch failed (offline, private remote); the numbers are from the last successful one */
  fetchError?: string;
}

export interface UpdateResult {
  ok: boolean;
  from?: string;
  to?: string;
  steps: string[];
  restartRequired: boolean;
  rolledBack?: boolean;
  error?: string;
}

export type Exec = (file: string, args: string[], options: { cwd: string; timeoutMs: number; onOutput?: (text: string) => void }) => Promise<{ code: number; output: string }>;

/** Run a program, collecting its output; never throws */
export const defaultExec: Exec = (file, args, { cwd, timeoutMs, onOutput }) =>
  new Promise((resolve) => {
    const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never', npm_config_loglevel: 'error' };
    const child = execFile(file, args, { cwd, env, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' && /^npm|^npx/.test(file) }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as NodeJS.ErrnoException).code === 'number' ? ((error as NodeJS.ErrnoException).code as unknown as number) : 1) : 0;
      resolve({ code, output: `${stdout}${stderr}`.trim() || (error ? error.message : '') });
    });
    if (onOutput) {
      child.stdout?.on('data', (d: Buffer) => onOutput(d.toString()));
      child.stderr?.on('data', (d: Buffer) => onOutput(d.toString()));
    }
  });

const MANIFESTS = ['package.json', 'package-lock.json'];
const RESTART_FILES = ['server.js', 'next.config.ts', 'next.config.js', 'next.config.mjs', 'scripts/supervise.js'];
const lastLines = (text: string, n = 12) => text.split('\n').slice(-n).join('\n');

async function git(exec: Exec, cwd: string, args: string[], timeoutMs = 20_000) {
  return exec('git', args, { cwd, timeoutMs });
}

export async function getUpdateStatus(options: { cwd?: string; fetch?: boolean; exec?: Exec; now?: () => number } = {}): Promise<UpdateStatus> {
  const cwd = options.cwd ?? process.cwd();
  const exec = options.exec ?? defaultExec;
  const base: UpdateStatus = { supported: false, behind: 0, ahead: 0, dirty: false, commits: [], canApply: false, supervised: process.env.NANOCLI_SUPERVISED === '1', checkedAt: (options.now ?? Date.now)() };

  if (!fs.existsSync(path.join(cwd, '.git'))) return { ...base, note: 'This copy of the studio isn’t a git checkout, so it can’t update itself. If you run it in a container, pull the new image instead.' };
  const inside = await git(exec, cwd, ['rev-parse', '--is-inside-work-tree']);
  if (inside.code !== 0) return { ...base, note: 'git isn’t available, or this folder isn’t a git checkout.' };

  const branch = (await git(exec, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).output;
  if (branch === 'HEAD') return { ...base, note: 'You are on a detached commit; check out a branch to follow updates.' };
  const upstream = await git(exec, cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (upstream.code !== 0) return { ...base, branch, note: `The branch “${branch}” doesn’t track a remote branch (git branch --set-upstream-to=origin/${branch}).` };

  let fetchError: string | undefined;
  if (options.fetch) {
    const fetched = await git(exec, cwd, ['fetch', '--quiet', '--prune'], 45_000);
    if (fetched.code !== 0) fetchError = lastLines(fetched.output, 3) || 'git fetch failed.';
  }

  const current = (await git(exec, cwd, ['rev-parse', 'HEAD'])).output;
  const latest = (await git(exec, cwd, ['rev-parse', '@{u}'])).output;
  const counts = (await git(exec, cwd, ['rev-list', '--left-right', '--count', 'HEAD...@{u}'])).output.split(/\s+/).map(Number);
  const [ahead = 0, behind = 0] = counts;
  const dirty = (await git(exec, cwd, ['status', '--porcelain', '--untracked-files=no'])).output.length > 0;
  const log = behind
    ? (await git(exec, cwd, ['log', '--format=%H%x1f%s%x1f%an%x1f%cI', '-n', '30', 'HEAD..@{u}'])).output
    : '';
  const commits = log
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, author, date] = line.split('\x1f');
      return { sha, subject, author, date };
    });

  let note: string | undefined;
  if (behind && dirty) note = 'You have uncommitted changes. Commit or stash them first; the update never touches them.';
  else if (behind && ahead) note = 'You have commits that aren’t on the remote branch, so this can’t be a simple fast-forward. Merge or rebase by hand.';
  return {
    ...base,
    supported: true,
    note,
    branch,
    upstream: upstream.output,
    current,
    latest,
    behind,
    ahead,
    dirty,
    commits,
    canApply: behind > 0 && !dirty && ahead === 0,
    fetchError,
  };
}

let applying = false;

/** Fast-forward, reinstall if dependencies changed, rebuild if this is a production server; undo everything on failure */
export async function applyUpdate(options: { cwd?: string; exec?: Exec; production?: boolean; onProgress?: (text: string) => void } = {}): Promise<UpdateResult> {
  const cwd = options.cwd ?? process.cwd();
  const exec = options.exec ?? defaultExec;
  const say = options.onProgress ?? (() => {});
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const result: UpdateResult = { ok: false, steps: [], restartRequired: false };
  if (applying) return { ...result, error: 'An update is already running.' };
  applying = true;
  const step = (text: string) => {
    result.steps.push(text);
    say(`${text}\n`);
  };
  try {
    step('Checking the remote…');
    const status = await getUpdateStatus({ cwd, exec, fetch: true });
    if (!status.supported) return { ...result, error: status.note };
    if (status.fetchError) return { ...result, error: `Could not reach the remote: ${status.fetchError}` };
    if (!status.behind) return { ...result, ok: true, from: status.current, to: status.current, steps: [...result.steps, 'Already up to date.'] };
    if (!status.canApply) return { ...result, error: status.note ?? 'The update can’t be applied automatically.' };

    const from = status.current!;
    result.from = from;
    step(`Updating ${status.branch}: ${status.behind} new commit${status.behind > 1 ? 's' : ''}…`);
    const merged = await git(exec, cwd, ['merge', '--ff-only', '@{u}'], 60_000);
    if (merged.code !== 0) return { ...result, error: `git could not fast-forward: ${lastLines(merged.output, 4)}` };
    const to = (await git(exec, cwd, ['rev-parse', 'HEAD'])).output;
    result.to = to;

    const changed = (await git(exec, cwd, ['diff', '--name-only', `${from}..${to}`])).output.split('\n').filter(Boolean);
    const depsChanged = changed.some((f) => MANIFESTS.includes(f));
    result.restartRequired = production || changed.some((f) => RESTART_FILES.includes(f)) || depsChanged;

    const rollback = async (why: string): Promise<UpdateResult> => {
      step('Something failed; putting the previous version back…');
      await git(exec, cwd, ['reset', '--hard', from], 60_000);
      if (depsChanged) await exec('npm', ['ci', '--no-audit', '--no-fund'], { cwd, timeoutMs: 15 * 60_000 });
      return { ...result, ok: false, to: from, rolledBack: true, restartRequired: false, error: why };
    };

    if (depsChanged) {
      step('Installing dependencies…');
      const install = await exec('npm', [fs.existsSync(path.join(cwd, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund'], { cwd, timeoutMs: 15 * 60_000, onOutput: say });
      if (install.code !== 0) return rollback(`Installing dependencies failed:\n${lastLines(install.output)}`);
    }
    if (production) {
      step('Building…');
      const build = await exec('npm', ['run', 'build'], { cwd, timeoutMs: 15 * 60_000, onOutput: say });
      if (build.code !== 0) return rollback(`The build failed:\n${lastLines(build.output)}`);
    }
    step(result.restartRequired ? 'Updated. Restart the studio to use the new version.' : 'Updated. The running studio picks the changes up by itself.');
    return { ...result, ok: true };
  } finally {
    applying = false;
  }
}
