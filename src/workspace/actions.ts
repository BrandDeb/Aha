'use client';

import { createContext, useContext } from 'react';
import type { CompileResult } from '@/lib/compiler-browser';
import type { CompileTarget } from '@/types';
import type { PythonCommand, PythonOutcome, PythonStream } from './python-client';
import type { RunOptions, RunOutcome as LanguageOutcome } from './run-client';

export interface RunOutcome {
  ok: boolean;
  code?: number;
  ms?: number;
  memoryBytes?: number;
  message?: string;
}

export interface WorkspaceActions {
  /** Build the project (or a given entry) for a target */
  compile: (options?: { target?: CompileTarget; entry?: string; quiet?: boolean }) => Promise<CompileResult | null>;
  /** Build to WASM and run it in the browser, streaming output */
  run: (
    args: string[],
    onOutput: (stream: 'stdout' | 'stderr', line: string) => void,
    options?: { entry?: string; signal?: AbortSignal }
  ) => Promise<RunOutcome>;
  /** Format a file (defaults to the active one) */
  format: (path?: string) => Promise<boolean>;
  /** Save a version (and format on save if enabled) */
  save: () => Promise<void>;
  /** Show a side-by-side diff */
  showDiff: (diff: { title: string; path: string; original: string; modified: string }) => void;
  /** Open a panel in the right sidebar */
  openPanel: (panel: PanelId) => void;
  downloadArtifact: (result?: CompileResult | null) => Promise<void>;
  /** Run a Python command with uv; file changes it makes are merged into the project */
  python: (command: PythonCommand, onOutput?: (stream: PythonStream, text: string) => void, signal?: AbortSignal) => Promise<PythonOutcome>;
  /** Run the project in another language (Go, Rust, Java, C, Ruby…) on this machine; files the program writes are merged into the project */
  runLanguage: (options: RunOptions, onOutput?: (stream: PythonStream, text: string) => void, signal?: AbortSignal) => Promise<LanguageOutcome>;
  /** Open a build artifact in the output viewer (defaults to the last build) */
  inspect: (result?: CompileResult | null) => void;
}

export type PanelId = 'build' | 'git' | 'ai' | 'agent' | 'history' | 'graph' | 'package' | 'python' | 'languages' | 'worker' | 'kit' | 'ci';

export const ActionsContext = createContext<WorkspaceActions | null>(null);

export function useActions(): WorkspaceActions {
  const value = useContext(ActionsContext);
  if (!value) throw new Error('useActions must be used inside the workspace');
  return value;
}
