'use client';

/**
 * Talking to /api/python from the browser: stream a command's output, keep a
 * stable id per project (so its environment survives reloads), and remember
 * the environment variables the user wants programs to see.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type PythonStream = 'stdout' | 'stderr' | 'info';

export interface PythonCommand {
  action: 'run' | 'add' | 'remove' | 'sync' | 'lock' | 'init' | 'tree' | 'pin';
  entry?: string;
  args?: string[];
  packages?: string[];
  dev?: boolean;
  upgrade?: boolean;
  version?: string;
  name?: string;
}

export interface PythonDone {
  code: number | null;
  ms: number;
  changed: Record<string, string>;
  removed: string[];
  skipped: string[];
  timedOut?: boolean;
  truncated?: boolean;
  error?: string;
  uv?: string;
}

export type PythonOutcome = PythonDone & { ok: boolean };

const failure = (error: string): PythonDone => ({ code: null, ms: 0, changed: {}, removed: [], skipped: [], error });

/** POST a command and read the newline-delimited JSON stream it answers with */
export function streamPython(body: Record<string, unknown>, onOutput: (stream: PythonStream, text: string) => void, signal?: AbortSignal): Promise<PythonDone> {
  return streamCommand('/api/python', body, onOutput, signal);
}

/** The same protocol for any route that streams `{ t: 'out' }` lines and one `{ t: 'done' }` (Python and the other languages) */
export async function streamCommand(
  url: string,
  body: Record<string, unknown>,
  onOutput: (stream: PythonStream, text: string) => void,
  signal?: AbortSignal
): Promise<PythonDone> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return failure('stopped');
    return failure('Could not reach the studio server.');
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    return failure(data.error || `The server answered ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: PythonDone | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.t === 'out') onOutput(event.s, event.d);
      else if (event.t === 'done') done = event;
    } catch {
      // a partial or garbled line; the final event is what matters
    }
  };
  try {
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handle);
    }
    handle(buffer);
  } catch (error) {
    if ((error as Error).name === 'AbortError') return failure('stopped');
    return failure('The connection was interrupted.');
  }
  return done ?? failure('The connection closed before the command finished.');
}

// ---------------------------------------------------------------------------
// Per-project id
// ---------------------------------------------------------------------------

const IDS_KEY = 'aha:pyids';

/** A stable id for a project name, so the server keeps its environment between commands */
export function pythonProjectId(name: string): string {
  let ids: Record<string, string> = {};
  try {
    ids = JSON.parse(localStorage.getItem(IDS_KEY) ?? '{}');
  } catch {
    // storage blocked: fall through to a fresh id
  }
  if (!ids[name]) {
    ids[name] = crypto.randomUUID();
    try {
      localStorage.setItem(IDS_KEY, JSON.stringify(ids));
    } catch {
      // keep it for this session only
    }
  }
  return ids[name];
}

// ---------------------------------------------------------------------------
// Environment variables for programs (API keys and so on)
// ---------------------------------------------------------------------------

const ENV_KEY = 'aha:pyenv';
const envListeners = new Set<() => void>();
let envCache: Record<string, string> | null = null;
const NO_ENV: Record<string, string> = {};

export function getPythonEnv(): Record<string, string> {
  if (envCache) return envCache;
  try {
    const stored = JSON.parse(localStorage.getItem(ENV_KEY) ?? '{}');
    envCache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  } catch {
    envCache = {};
  }
  return envCache as Record<string, string>;
}

export function setPythonEnv(next: Record<string, string>): void {
  envCache = next;
  try {
    localStorage.setItem(ENV_KEY, JSON.stringify(next));
  } catch {
    // storage blocked: keep it for this tab
  }
  envListeners.forEach((l) => l());
}

export function usePythonEnv(): Record<string, string> {
  return useSyncExternalStore(
    (listener) => {
      envListeners.add(listener);
      return () => envListeners.delete(listener);
    },
    getPythonEnv,
    () => NO_ENV
  );
}

// ---------------------------------------------------------------------------
// Server status
// ---------------------------------------------------------------------------

export interface PythonStatus {
  enabled: boolean;
  uv: { version: string; source: 'env' | 'system' | 'installed' } | null;
  pythons: string[];
}

export function usePythonStatus(): { status: PythonStatus | null; refresh: () => void } {
  const [status, setStatus] = useState<PythonStatus | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch('/api/python')
      .then((r) => r.json())
      .then((s: PythonStatus) => live && setStatus(s))
      .catch(() => live && setStatus({ enabled: false, uv: null, pythons: [] }));
    return () => {
      live = false;
    };
  }, [tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  return { status, refresh };
}
