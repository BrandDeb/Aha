'use client';

/**
 * Talking to /api/pipelines (running a CI file on this machine) and to the
 * GitHub Actions routes (the runs of the linked branch, their logs, re-runs).
 */

import type { WorkflowJob, WorkflowRun } from '@/lib/pipelines/report';
import type { JobReport, PipelineEvent, PipelineResult } from '@/lib/pipelines/run';
import { pythonProjectId } from './python-client';

export { describeResult, failureReport, latestPerWorkflow, remoteFailureBrief } from '@/lib/pipelines/report';
export type { JobReport, PipelineEvent, PipelineResult, WorkflowJob, WorkflowRun };

export async function fetchPipelinesEnabled(): Promise<boolean> {
  try {
    const response = await fetch('/api/pipelines', { cache: 'no-store' });
    return response.ok && (await response.json()).enabled === true;
  } catch {
    return false;
  }
}

const failed = (error: string): PipelineResult => ({ ok: false, jobs: [], ms: 0, error });

/** Run a CI file (or one job) against `files`, streaming job, step and output events */
export async function runPipelineFile(projectName: string, files: Record<string, string>, file: string, job: string | undefined, onEvent: (event: PipelineEvent) => void, signal?: AbortSignal): Promise<PipelineResult> {
  let response: Response;
  try {
    response = await fetch('/api/pipelines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ projectId: pythonProjectId(projectName), files, file, job }), signal });
  } catch (error) {
    return failed((error as Error).name === 'AbortError' ? 'stopped' : 'Could not reach the studio server.');
  }
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    return failed(data.error || `The server answered ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done: PipelineResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.t === 'done') {
        const { t: _t, ...result } = event;
        done = result as PipelineResult;
      } else onEvent(event as PipelineEvent);
    } catch {
      // a partial line; the final event is what matters
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
    return failed((error as Error).name === 'AbortError' ? 'stopped' : 'The connection was interrupted.');
  }
  return done ?? failed('The run ended without a result.');
}

// ---------------------------------------------------------------------------
// GitHub Actions
// ---------------------------------------------------------------------------

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: 'no-store', ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Request failed (${response.status})`), { status: data.status ?? response.status });
  return data as T;
}

const base = (owner: string, repo: string) => `/api/github/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions`;
export const fetchRuns = (owner: string, repo: string, branch: string) => getJson<{ runs: WorkflowRun[] }>(`${base(owner, repo)}?branch=${encodeURIComponent(branch)}`).then((d) => d.runs);
export const fetchRunJobs = (owner: string, repo: string, run: number) => getJson<{ jobs: WorkflowJob[] }>(`${base(owner, repo)}?run=${run}`).then((d) => d.jobs);
export const fetchJobLog = (owner: string, repo: string, job: number) => getJson<{ log: string }>(`${base(owner, repo)}?job=${job}`).then((d) => d.log);
export const rerunFailed = (owner: string, repo: string, run: number) => getJson(`${base(owner, repo)}`, { method: 'POST', body: JSON.stringify({ action: 'rerun', run }) });
