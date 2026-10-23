/**
 * Pipeline results in words: for the agent (what ran, what failed and what it
 * printed), for the debugger (the failing step as a failure report), and the
 * brief for a failure on GitHub Actions. Pure, shared by the browser and tests.
 */

import type { PipelineResult } from './run.ts';

export interface WorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  headSha: string;
  event: string;
  url: string;
  createdAt: string;
  updatedAt: string;
  path: string;
}

export interface WorkflowJob {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  url: string;
  steps: { name: string; number: number; status: string; conclusion: string | null }[];
}

/** The run, in words, for the agent: each job's steps, and what the failing step printed */
export function describeResult(result: PipelineResult, output: string, maxOutput = 6000): string {
  if (result.error && !result.jobs.length) return `Could not run the pipeline: ${result.error}`;
  const lines = [result.ok ? `Pipeline passed in ${Math.round(result.ms / 1000)} s.` : 'Pipeline failed.'];
  for (const job of result.jobs) {
    lines.push(`Job ${job.id}: ${job.status}${job.reason ? ` (${job.reason})` : ''}`);
    for (const step of job.steps) lines.push(`  ${step.status === 'passed' ? '✓' : step.status === 'failed' ? '✗' : '–'} ${step.name}${step.note ? ` — ${step.note}` : ''}`);
  }
  if (!result.ok) lines.push('', 'Output (tail):', output.length > maxOutput ? `…${output.slice(-maxOutput)}` : output);
  return lines.join('\n').trim();
}

/** What failed, as a failure report for the debugger: the step, its command and the output */
export function failureReport(file: string, result: PipelineResult, output: string): string | null {
  const job = result.jobs.find((j) => j.status === 'failed');
  if (!job) return result.ok || result.error === 'stopped' ? null : `Pipeline ${file}: ${result.error ?? 'failed'}`;
  const step = job.steps.find((s) => s.status === 'failed');
  return [`Pipeline ${file} · job ${job.id} · step “${step?.name ?? '?'}” failed${step?.note ? ` (${step.note})` : ''}`, step?.run ? `$ ${step.run.trim()}` : '', output.slice(-12_000)].filter(Boolean).join('\n');
}

/** The latest run of each workflow (runs come newest first) */
export function latestPerWorkflow(runs: WorkflowRun[]): WorkflowRun[] {
  const seen = new Set<string>();
  return runs.filter((r) => {
    const key = r.path || r.name;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The brief for a failure on GitHub: the log of the failing step, and how to reproduce it here */
export function remoteFailureBrief(run: WorkflowRun, job: WorkflowJob, log: string, localFile: string | null): string {
  const step = job.steps.find((s) => s.conclusion === 'failure');
  return [
    `CI is failing on GitHub Actions: the “${run.name}” workflow, job “${job.name}”${step ? `, step “${step.name}”` : ''} (commit ${run.headSha.slice(0, 7)}, ${run.url}).`,
    `Log (tail):\n\`\`\`\n${log.trim().slice(-8000)}\n\`\`\``,
    [
      'Method:',
      localFile
        ? `1. Reproduce: run_pipeline (file ${localFile}${job.name ? `, the job that matches “${job.name}”` : ''}) and confirm the same failure. If it passes here, compare this machine with the CI environment (versions, OS, missing files, secrets) using the log.`
        : '1. Reproduce: run the failing command with the tools you have (build, run_code, python) and confirm the same failure.',
      '2. Find the root cause in the code or the CI file. Fix the code when the code is wrong; change the CI file only when the CI file is wrong.',
      '3. Make the smallest change that fixes it, with no unrelated edits.',
      '4. Verify with run_pipeline (or the same command) that it now passes.',
      'Finish with three short lines: the root cause, the fix, and the evidence that it works. The user commits and pushes the fix from the Git tab.',
    ].join('\n'),
  ].join('\n\n');
}
