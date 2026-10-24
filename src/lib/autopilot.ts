/**
 * Autopilot: the studio looking after itself while it runs.
 *
 *   Self-healing  every 10 minutes it checks disk space, build leftovers, caches and its own
 *                 memory and responsiveness, and applies the doctor's safe fixes when needed
 *                 (cleaning build leftovers, pruning package caches, removing idle Python
 *                 environments); a server that has grown too large or stopped responding
 *                 restarts itself (under the supervisor) when nothing is running.
 *   Self-updating opt-in: when the studio is idle it fast-forwards to the latest version,
 *                 rebuilds and restarts; after the restart it checks itself, and the
 *                 supervisor puts the previous version back if the new one doesn't come up.
 *
 * Everything it does is written to a journal (Settings → Maintenance). The decisions are
 * pure functions; the scheduler below gathers the facts and acts on them. Server only.
 */

import { promises as fs, statfsSync } from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { NANOCLI_DIR } from './connectors/env.ts';

export interface AutopilotSettings {
  /** Apply safe repairs automatically (default on) */
  autoRepair: boolean;
  /** Update automatically when idle (default off) */
  autoUpdate: boolean;
}

export interface JournalEntry {
  at: number;
  kind: 'repair' | 'restart' | 'update' | 'verify' | 'rollback' | 'error';
  message: string;
}

export interface AutopilotState extends AutopilotSettings {
  journal: JournalEntry[];
  lastUpdateCheck?: number;
  /** Set before restarting into a new version; cleared once it proves healthy */
  pendingVerify?: { from: string; to: string; at: number };
}

export interface Snapshot {
  /** Free bytes on the disk the studio keeps its files on */
  freeDisk: number;
  tempBytes: number;
  cacheBytes: number;
  envBytes: number;
  rss: number;
  /** Mean event-loop delay over the last interval, ms */
  loopDelayMs: number;
  /** Since the last request that does work (not static files) */
  idleMs: number;
  supervised: boolean;
}

export type Action = { kind: 'clean-temp' | 'prune-uv-cache' | 'remove-python-envs'; why: string } | { kind: 'restart'; why: string };

const GB = 1024 ** 3;
const MB = 1024 ** 2;
export const LIMITS = {
  lowDisk: 2 * GB,
  veryLowDisk: 1 * GB,
  temp: 1 * GB,
  cache: 5 * GB,
  rss: 2 * GB,
  loopDelayMs: 500,
  idleForRestartMs: 10 * 60_000,
  idleForUpdateMs: 30 * 60_000,
  updateEveryMs: 6 * 60 * 60_000,
  verifyAfterMs: 90_000,
};

const size = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / MB)} MB`);

/** What to repair now, most urgent first */
export function decideRepairs(s: Snapshot, settings: AutopilotSettings): Action[] {
  if (!settings.autoRepair) return [];
  const actions: Action[] = [];
  const lowDisk = s.freeDisk < LIMITS.lowDisk;
  if (s.tempBytes > LIMITS.temp || (lowDisk && s.tempBytes > 0)) actions.push({ kind: 'clean-temp', why: `${size(s.tempBytes)} of build leftovers${lowDisk ? `, ${size(s.freeDisk)} free` : ''}` });
  if (s.cacheBytes > LIMITS.cache || (lowDisk && s.cacheBytes > 100 * MB)) actions.push({ kind: 'prune-uv-cache', why: `${size(s.cacheBytes)} of package caches${lowDisk ? `, ${size(s.freeDisk)} free` : ''}` });
  if (s.freeDisk < LIMITS.veryLowDisk && s.envBytes > 100 * MB) actions.push({ kind: 'remove-python-envs', why: `only ${size(s.freeDisk)} free; Python environments are rebuilt on demand` });
  // A restart only when it can come back by itself, and never in the middle of someone's work
  if (s.supervised && s.idleMs >= LIMITS.idleForRestartMs) {
    if (s.rss > LIMITS.rss) actions.push({ kind: 'restart', why: `the server grew to ${size(s.rss)}` });
    else if (s.loopDelayMs > LIMITS.loopDelayMs) actions.push({ kind: 'restart', why: `the server was slow to respond (${Math.round(s.loopDelayMs)} ms delays)` });
  }
  return actions;
}

/** Whether to look for (and apply) an update now */
export function shouldAutoUpdate(state: AutopilotState, s: Pick<Snapshot, 'idleMs' | 'supervised'>, now: number): boolean {
  return state.autoUpdate && s.supervised && !state.pendingVerify && s.idleMs >= LIMITS.idleForUpdateMs && now - (state.lastUpdateCheck ?? 0) >= LIMITS.updateEveryMs;
}

/** Add to the journal, newest first, keeping the last 50 */
export const record = (state: AutopilotState, entry: Omit<JournalEntry, 'at'>, now = Date.now()): AutopilotState => ({ ...state, journal: [{ ...entry, at: now }, ...state.journal].slice(0, 50) });

// ---------------------------------------------------------------------------
// State on disk (shared with the supervisor, which reads pendingVerify)
// ---------------------------------------------------------------------------

export const statePath = () => path.join(NANOCLI_DIR, 'autopilot.json');

const DEFAULTS: AutopilotState = { autoRepair: process.env.NANOCLI_AUTOREPAIR !== '0', autoUpdate: process.env.NANOCLI_AUTOUPDATE === '1', journal: [] };

export async function readState(): Promise<AutopilotState> {
  try {
    const raw = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    return { ...DEFAULTS, ...raw, journal: Array.isArray(raw.journal) ? raw.journal : [] };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function writeState(state: AutopilotState): Promise<void> {
  await fs.mkdir(NANOCLI_DIR, { recursive: true });
  const tmp = `${statePath()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, statePath());
}

export async function updateSettings(patch: Partial<AutopilotSettings>): Promise<AutopilotState> {
  const state = { ...(await readState()), ...patch };
  await writeState(state);
  return state;
}

// ---------------------------------------------------------------------------
// The running server: activity, measurements, the schedule
// ---------------------------------------------------------------------------

/** server.js records when the last request that does work arrived (shared through globalThis) */
const g = globalThis as { __nanocliLastActivity?: number };
export const idleMs = (now = Date.now()) => now - (g.__nanocliLastActivity ?? now - LIMITS.idleForUpdateMs);

let loop: ReturnType<typeof monitorEventLoopDelay> | null = null;

function freeDisk(): number {
  try {
    const s = statfsSync(NANOCLI_DIR);
    return s.bavail * s.bsize;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

export async function snapshot(): Promise<Snapshot> {
  const { folderSize } = await import('./doctor.ts');
  const { TEMP_DIR } = await import('./compiler.ts');
  const { PY_PROJECTS } = await import('./python.ts');
  const [tempBytes, cacheBytes, envBytes] = await Promise.all([folderSize(TEMP_DIR), folderSize(path.join(NANOCLI_DIR, 'cache')), folderSize(PY_PROJECTS)]);
  const loopDelayMs = loop ? loop.mean / 1e6 : 0;
  loop?.reset();
  return { freeDisk: freeDisk(), tempBytes, cacheBytes, envBytes, rss: process.memoryUsage().rss, loopDelayMs, idleMs: idleMs(), supervised: process.env.NANOCLI_SUPERVISED === '1' };
}

const RESTART_CODE = 75;
let running = false;

/** One round: repairs, then (if enabled and idle) an update */
export async function tick(now = Date.now()): Promise<void> {
  if (running) return;
  running = true;
  try {
    let state = await readState();
    const snap = await snapshot();
    const { applyFix } = await import('./doctor.ts');
    for (const action of decideRepairs(snap, state)) {
      if (action.kind === 'restart') {
        state = record(state, { kind: 'restart', message: `Restarted: ${action.why}.` }, now);
        await writeState(state);
        setTimeout(() => process.exit(RESTART_CODE), 200);
        return;
      }
      const result = await applyFix(action.kind);
      state = record(state, { kind: result.ok ? 'repair' : 'error', message: `${result.message} (${action.why})` }, now);
    }
    if (shouldAutoUpdate(state, snap, now)) {
      state = { ...state, lastUpdateCheck: now };
      const { applyUpdate } = await import('./updater.ts');
      const result = await applyUpdate();
      if (result.ok && result.from && result.to && result.from !== result.to) {
        state = record(state, { kind: 'update', message: `Updated ${result.from.slice(0, 7)} → ${result.to.slice(0, 7)}${result.restartRequired ? '; restarting' : ''}.` }, now);
        if (result.restartRequired) {
          state = { ...state, pendingVerify: { from: result.from, to: result.to, at: now } };
          await writeState(state);
          setTimeout(() => process.exit(RESTART_CODE), 200);
          return;
        }
      } else if (!result.ok) {
        state = record(state, { kind: result.rolledBack ? 'rollback' : 'error', message: `Update not applied: ${(result.error ?? 'unknown error').split('\n')[0]}` }, now);
      }
    }
    await writeState(state);
  } catch (error) {
    console.warn(`> Autopilot: ${(error as Error).message}`);
  } finally {
    running = false;
  }
}

/** After a restart into a new version: once it has served for a while, it's good */
async function verifyUpdate(): Promise<void> {
  const state = await readState();
  if (!state.pendingVerify) return;
  const port = process.env.PORT || '3000';
  const ok = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(10_000) })
    .then((r) => r.ok)
    .catch(() => false);
  // Not ok: stay pending; if the server can't stay up, the supervisor rolls back
  if (ok) await writeState(record({ ...state, pendingVerify: undefined }, { kind: 'verify', message: `Version ${state.pendingVerify.to.slice(0, 7)} is running well.` }));
}

let scheduled = false;

export function scheduleAutopilot(): void {
  if (scheduled || process.env.NANOCLI_AUTOPILOT === '0') return;
  scheduled = true;
  loop = monitorEventLoopDelay({ resolution: 50 });
  loop.enable();
  setTimeout(() => void verifyUpdate(), LIMITS.verifyAfterMs).unref();
  setTimeout(() => void tick(), 2 * 60_000).unref();
  setInterval(() => void tick(), 10 * 60_000).unref();
}
