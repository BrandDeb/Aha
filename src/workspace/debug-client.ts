'use client';

/**
 * The debugger in the browser: breakpoints (kept per project in this browser), the running session (polled while it
 * lives), and the commands. Small stores read with useSyncExternalStore, so the editor gutter, the Debug panel and
 * hover values all see the same state.
 */

import { useSyncExternalStore } from 'react';
import type { DebugOutput, DebugState, DebugVariable, StepKind } from '@/lib/debug/types';

/* ------------------------------------------------------------------ breakpoints */

const BP_KEY = 'aha:breakpoints';
type Breakpoints = Record<string, number[]>;
const EMPTY_BP: Breakpoints = {};
let project = '';
let breakpoints: Breakpoints = EMPTY_BP;
const bpListeners = new Set<() => void>();

function loadBreakpoints(name: string) {
  project = name;
  try {
    const all = JSON.parse(localStorage.getItem(BP_KEY) ?? '{}') as Record<string, Breakpoints>;
    breakpoints = all[name] ?? EMPTY_BP;
  } catch {
    breakpoints = EMPTY_BP;
  }
  bpListeners.forEach((l) => l());
}

function saveBreakpoints(next: Breakpoints) {
  breakpoints = next;
  try {
    const all = JSON.parse(localStorage.getItem(BP_KEY) ?? '{}') as Record<string, Breakpoints>;
    all[project] = next;
    localStorage.setItem(BP_KEY, JSON.stringify(all));
  } catch {
    // storage blocked: they last for this tab
  }
  bpListeners.forEach((l) => l());
  const s = session;
  if (s && (s.status === 'running' || s.status === 'paused')) void post({ id: s.id, action: 'breakpoints', file: lastChanged, lines: next[lastChanged] ?? [] }).catch(() => {});
}

let lastChanged = '';

/** Switch to a project's breakpoints (call from an effect when the project changes) */
export function loadProjectBreakpoints(name: string) {
  if (name !== project) loadBreakpoints(name);
}

export function toggleBreakpoint(file: string, line: number) {
  const lines = new Set(breakpoints[file] ?? []);
  if (lines.has(line)) lines.delete(line);
  else lines.add(line);
  lastChanged = file;
  const { [file]: _, ...rest } = breakpoints;
  saveBreakpoints(lines.size ? { ...rest, [file]: [...lines].sort((a, b) => a - b) } : rest);
}

export function clearBreakpoints(file?: string) {
  if (file) {
    lastChanged = file;
    const { [file]: _, ...rest } = breakpoints;
    saveBreakpoints(rest);
  } else {
    for (const f of Object.keys(breakpoints)) {
      lastChanged = f;
      const { [f]: _, ...rest } = breakpoints;
      saveBreakpoints(rest);
    }
  }
}

const subscribeBp = (l: () => void) => (bpListeners.add(l), () => bpListeners.delete(l));
export const useBreakpoints = () => useSyncExternalStore(subscribeBp, () => breakpoints, () => EMPTY_BP);

/* ------------------------------------------------------------------ the session */

let session: DebugState | null = null;
let output: DebugOutput[] = [];
let starting = false;
let error = '';
const listeners = new Set<() => void>();
let snapshot: { session: DebugState | null; output: DebugOutput[]; starting: boolean; error: string } = { session, output, starting, error };
const emit = () => {
  snapshot = { session, output, starting, error };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const SERVER: typeof snapshot = { session: null, output: [], starting: false, error: '' };
export const useDebugSession = () => useSyncExternalStore(subscribe, () => snapshot, () => SERVER);

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch('/api/debug', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(data.error ?? `The debugger answered ${response.status}`));
  return data;
}

let polling = 0;
async function poll(id: string, token: number) {
  let since = output.at(-1)?.seq ?? 0;
  while (token === polling && session?.id === id) {
    try {
      const response = await fetch(`/api/debug?id=${id}&since=${since}`, { cache: 'no-store' });
      if (response.status === 404) {
        session = session && { ...session, status: 'exited', frames: [], scopes: [] };
        emit();
        return;
      }
      const next = (await response.json()) as DebugState;
      if (token !== polling) return;
      const fresh = next.output ?? [];
      if (fresh.length) {
        output = [...output, ...fresh].slice(-2000);
        since = fresh.at(-1)!.seq;
      }
      const changed = JSON.stringify({ ...next, output: [] }) !== JSON.stringify({ ...session, output: [] });
      session = next;
      if (changed || fresh.length) emit();
      if (next.status === 'exited' || next.status === 'failed') return;
    } catch {
      // a blip: try again
    }
    await new Promise((r) => setTimeout(r, session?.status === 'paused' ? 600 : 250));
  }
}

export interface DebugTarget {
  projectId: string;
  entry: string;
  files: Record<string, string>;
  args?: string[];
  env?: Record<string, string>;
}

export async function startDebugging(target: DebugTarget) {
  if (session && (session.status === 'running' || session.status === 'paused' || session.status === 'starting')) await stopDebugging();
  starting = true;
  error = '';
  output = [];
  session = null;
  emit();
  try {
    const state = (await post({ action: 'start', ...target, args: target.args ?? [], env: target.env ?? {}, breakpoints })) as unknown as DebugState;
    session = state;
    output = state.output ?? [];
    if (state.status === 'failed') error = state.error ?? 'The debugger could not start';
    void poll(state.id, ++polling);
  } catch (e) {
    error = (e as Error).message;
  } finally {
    starting = false;
    emit();
  }
}

const act = async (body: Record<string, unknown>) => {
  if (!session) return null;
  try {
    error = '';
    return await post({ id: session.id, ...body });
  } catch (e) {
    error = (e as Error).message;
    emit();
    return null;
  }
};

export const continueDebugging = () => act({ action: 'continue' });
export const pauseDebugging = () => act({ action: 'pause' });
export const stepDebugging = (kind: StepKind) => act({ action: 'step', kind });

export async function stopDebugging() {
  await act({ action: 'stop' });
  if (session) session = { ...session, status: 'exited', frames: [], scopes: [], exitCode: null };
  polling++;
  emit();
}

export async function selectFrame(frameId: string) {
  const r = await act({ action: 'frame', frameId });
  if (r && session) {
    session = { ...session, frameId, scopes: r.scopes as DebugState['scopes'] };
    emit();
  }
}

export async function expandVariable(ref: string): Promise<DebugVariable[]> {
  const r = await act({ action: 'children', ref });
  return (r?.variables as DebugVariable[]) ?? [];
}

/** Read an expression in the selected frame; null when not paused */
export async function evaluateExpression(expression: string): Promise<DebugVariable | null> {
  if (session?.status !== 'paused') return null;
  try {
    const r = await post({ id: session.id, action: 'evaluate', expression });
    return r.result as DebugVariable;
  } catch {
    return null;
  }
}

/** For the editor's hover, outside React */
export const currentDebugSession = () => session;
export const subscribeDebugSession = subscribe;

/** The line the program is stopped on, for one file */
export function pausedLineIn(state: DebugState | null, file: string): number | null {
  if (state?.status !== 'paused') return null;
  const frame = state.frames.find((f) => f.id === state.frameId) ?? state.frames[0];
  return frame?.file === file ? frame.line : null;
}
