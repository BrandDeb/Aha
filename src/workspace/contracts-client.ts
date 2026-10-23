'use client';

/**
 * Contracts in the studio: command contracts run through the real-shell route
 * (/api/shell) in the project's folder on this machine, against whichever
 * files are being checked: yours, or a proposal's.
 */

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { checkContracts, checkPattern, contractCounts, contractsOf, CONTRACTS_FILE, type CommandRunner, type ContractResult } from '@/lib/contracts';
import { pythonProjectId, streamCommand } from './python-client';

const MAX_OUTPUT = 200_000;
const TIMEOUT_MS = 5 * 60_000;

let shellEnabled: Promise<boolean> | null = null;
/** Whether this server runs commands (cached for the page) */
export function commandsEnabled(): Promise<boolean> {
  shellEnabled ??= fetch('/api/shell', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : { enabled: false }))
    .then((s: { enabled?: boolean }) => !!s.enabled)
    .catch(() => false);
  return shellEnabled;
}

/** A command runner for `files` of a project */
export function contractRunner(projectName: string, files: Record<string, string>): CommandRunner {
  return async (command, signal) => {
    if (!(await commandsEnabled())) return { code: null, output: '', unavailable: true, error: 'Command contracts run on your own machine (the desktop app or a local server)' };
    let output = '';
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), TIMEOUT_MS);
    signal?.addEventListener('abort', () => timeout.abort());
    const done = await streamCommand('/api/shell', { projectId: pythonProjectId(projectName), files, command, cwd: '' }, (_s, text) => {
      if (output.length < MAX_OUTPUT) output += text;
    }, timeout.signal);
    clearTimeout(timer);
    const error = done.error === 'stopped' && !signal?.aborted ? `Stopped after ${TIMEOUT_MS / 60_000} min` : done.error;
    return { code: done.code, output, error: error || (done.timedOut ? 'Timed out' : undefined) };
  };
}

// ---------------------------------------------------------------------------
// How the project's contracts stand: pattern contracts are checked on every
// change (instant), command contracts when you check them; their last results
// are kept, and marked stale once the files change.
// ---------------------------------------------------------------------------

type Checked = { project: string; key: string; at: number; results: ContractResult[] };
let lastChecked: Checked | null = null;
let checking = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => lastChecked;
const checkingSnapshot = () => checking;

/** A cheap fingerprint of the project's files: results are stale once it changes */
export function filesKey(files: Record<string, string>): string {
  let h = 0x811c9dc5;
  for (const path of Object.keys(files).sort()) {
    const text = `${path}\0${files[path]}\0`;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface ContractView extends ContractResult {
  /** A command result from before the latest changes */
  stale?: boolean;
  /** When it was last checked (commands) */
  at?: number;
}

export function useContracts(projectName: string, files: Record<string, string>) {
  const last = useSyncExternalStore(subscribe, snapshot, () => null);
  const running = useSyncExternalStore(subscribe, checkingSnapshot, () => false);
  const key = useMemo(() => filesKey(files), [files]);
  const { contracts, error } = useMemo(() => contractsOf(files), [files]);

  const views = useMemo<ContractView[]>(() => {
    if (error) return [{ id: 'contracts-file', rule: `${CONTRACTS_FILE} can be read`, kind: 'require', status: 'fail', detail: error }];
    const mine = last && last.project === projectName ? last : null;
    return contracts.map((c) => {
      if (c.kind !== 'command') return checkPattern(c, files);
      const previous = mine?.results.find((r) => r.id === c.id && r.kind === 'command');
      if (!previous) return { id: c.id, rule: c.rule, kind: c.kind, status: 'skip', detail: 'Not checked yet' };
      return { ...previous, rule: c.rule, at: mine!.at, stale: mine!.key !== key };
    });
  }, [contracts, error, files, last, projectName, key]);

  const checkAll = useCallback(async () => {
    if (checking) return lastChecked?.results ?? [];
    checking = true;
    emit();
    try {
      const results = await checkContracts(files, contractRunner(projectName, files));
      lastChecked = { project: projectName, key: filesKey(files), at: Date.now(), results };
      return results;
    } finally {
      checking = false;
      emit();
    }
  }, [files, projectName]);

  const counts = contractCounts(views.map((v) => (v.stale ? { ...v, status: 'skip' as const } : v)));
  return { contracts, error, views, counts, running, checkAll };
}
