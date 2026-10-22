'use client';

/** Talking to /api/run: which languages this machine can run, and running a project in one of them. */

import { useCallback, useEffect, useState } from 'react';
import type { LanguageStatus } from '@/lib/polyglot';
import { getPythonEnv, pythonProjectId, streamCommand, type PythonDone, type PythonStream } from './python-client';

export type { LanguageStatus };

export interface RunOptions {
  /** Force a language; otherwise it is chosen from the entry file */
  language?: string;
  entry: string;
  args?: string[];
  stdin?: string;
}

export type RunOutcome = PythonDone & { ok: boolean; language?: string };

/** Run `files` in a language on the server, streaming output; returns what changed on disk */
export async function runProject(
  projectName: string,
  files: Record<string, string>,
  options: RunOptions,
  onOutput: (stream: PythonStream, text: string) => void,
  signal?: AbortSignal
): Promise<RunOutcome> {
  const done = await streamCommand(
    '/api/run',
    { projectId: pythonProjectId(projectName), language: options.language, entry: options.entry, args: options.args ?? [], stdin: options.stdin, files, env: getPythonEnv() },
    onOutput,
    signal
  );
  return { ...done, ok: done.code === 0 && !done.error };
}

export async function fetchLanguages(): Promise<{ enabled: boolean; languages: LanguageStatus[] } | null> {
  try {
    const response = await fetch('/api/run', { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export function useLanguages(): { status: { enabled: boolean; languages: LanguageStatus[] } | null; refresh: () => void } {
  const [status, setStatus] = useState<{ enabled: boolean; languages: LanguageStatus[] } | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchLanguages().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, [tick]);
  return { status, refresh: useCallback(() => setTick((n) => n + 1), []) };
}

// ---------------------------------------------------------------------------
// Toolchains the studio installs and keeps updated (/api/toolchains)
// ---------------------------------------------------------------------------

export interface ToolchainInfo {
  enabled: boolean;
  mise?: string | null;
  tools?: { tool: string; requested: string; version: string; update?: string; major?: string }[];
  autoUpdate?: boolean;
  autoInstall?: boolean;
  lastCheck?: number;
  lastUpdate?: { at: number; updated: string[] };
}

export async function fetchToolchains(): Promise<ToolchainInfo | null> {
  try {
    const response = await fetch('/api/toolchains', { cache: 'no-store' });
    return response.ok ? ((await response.json()) as ToolchainInfo) : null;
  } catch {
    return null;
  }
}

/** Install a language's toolchain, update everything, or move one tool to its next major version; streams progress */
export function toolchainCommand(body: { action: 'install'; language: string } | { action: 'update' } | { action: 'upgrade'; tool: string }, onOutput: (stream: PythonStream, text: string) => void, signal?: AbortSignal) {
  return streamCommand('/api/toolchains', body, onOutput, signal);
}

export async function saveToolchainSettings(patch: { autoUpdate?: boolean; autoInstall?: boolean }): Promise<void> {
  await fetch('/api/toolchains', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'settings', ...patch }) }).catch(() => {});
}
