'use client';

/**
 * Works here = works in CI: with "Run CI on save" on, every save runs the
 * project's CI file on this machine in the background (the same lint, test and
 * build steps CI runs; a newer save cancels the run before it), and the status
 * bar shows how it went before you push. A failure goes to the debugger like
 * any other, so the agent can take it.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { pipelineFiles } from '@/lib/pipelines/parse';
import { failureReport, fetchPipelinesEnabled, runPipelineFile } from './pipelines-client';
import { filesKey } from './contracts-client';

const KEY = 'nanocli:ci-on-save';
const MAX_OUTPUT = 60_000;

export type CiState =
  | { status: 'idle' }
  | { status: 'running'; file: string; step?: string; started: number; key: string }
  | { status: 'passed' | 'failed'; file: string; step?: string; ms: number; at: number; key: string };

let state: CiState = { status: 'idle' };
let projects: Record<string, boolean> | null = null;
let enabled: boolean | null = null;
let controller: AbortController | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

function loadProjects(): Record<string, boolean> {
  if (projects) return projects;
  try {
    projects = JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    projects = {};
  }
  return projects!;
}
const settingsSnapshot = () => projects;
const stateSnapshot = () => state;
const enabledSnapshot = () => enabled;

export function useCiOnSave(projectName: string, files: Record<string, string>, hooks: { onFailure: (report: string) => void; onPassed: () => void }) {
  const settings = useSyncExternalStore(subscribe, settingsSnapshot, () => null);
  const current = useSyncExternalStore(subscribe, stateSnapshot, () => state);
  const serverRuns = useSyncExternalStore(subscribe, enabledSnapshot, () => null);
  const ciFiles = useMemo(() => pipelineFiles(files), [files]);
  const key = useMemo(() => filesKey(files), [files]);

  useEffect(() => {
    loadProjects();
    if (enabled === null) void fetchPipelinesEnabled().then((e) => {
      enabled = e;
      emit();
    });
    emit();
  }, []);

  const on = !!settings?.[projectName];
  const available = serverRuns === true && ciFiles.length > 0;

  const setOn = useCallback(
    (next: boolean) => {
      projects = { ...loadProjects(), [projectName]: next };
      try {
        localStorage.setItem(KEY, JSON.stringify(projects));
      } catch {}
      if (!next) {
        controller?.abort();
        state = { status: 'idle' };
      }
      emit();
    },
    [projectName]
  );

  /** Run the first CI file now, on these files (a run in progress is replaced) */
  const run = useCallback(async () => {
    const file = ciFiles[0];
    if (!file) return;
    controller?.abort();
    const mine = new AbortController();
    controller = mine;
    const runKey = filesKey(files);
    state = { status: 'running', file, started: Date.now(), key: runKey };
    emit();
    let output = '';
    const result = await runPipelineFile(projectName, files, file, undefined, (event) => {
      if (event.t === 'out') output = (output + event.d).slice(-MAX_OUTPUT);
      else if (event.t === 'step' && event.status === 'running' && state.status === 'running' && controller === mine) {
        state = { ...state, step: event.name };
        emit();
      }
    }, mine.signal);
    if (controller !== mine) return; // a newer save took over
    controller = null;
    if (result.error === 'stopped') {
      state = { status: 'idle' };
      emit();
      return;
    }
    const failedJob = result.jobs.find((j) => j.status === 'failed');
    const step = failedJob?.steps.find((s) => s.status === 'failed')?.name;
    state = { status: result.ok ? 'passed' : 'failed', file, step, ms: result.ms, at: Date.now(), key: runKey };
    emit();
    if (result.ok) hooks.onPassed();
    else {
      const report = failureReport(file, result, output);
      if (report) hooks.onFailure(report);
    }
  }, [ciFiles, files, projectName, hooks]);

  /** Called on every save */
  const onSave = useCallback(() => {
    if (on && available) void run();
  }, [on, available, run]);

  const stale = (current.status === 'passed' || current.status === 'failed') && current.key !== key;
  return { on, setOn, available, state: current, stale, run, onSave, ciFile: ciFiles[0] ?? null };
}
