/**
 * What a run can prove about its own work: did it finish, did the build and
 * the program pass, how hard was it, what did it cost. Shown as chips on every
 * proposal, and used to decide whether a change is "verified" or needs a
 * closer look. Pure, so it is tested without a browser.
 */

import type { Stage } from './stage.ts';
import type { AgentEvent, AgentRun, StopReason } from './types.ts';

export interface Evidence {
  reason: StopReason;
  /** Last build: passed, failed, or never run */
  build: boolean | null;
  /** Last program run (WASM sandbox, uv, or the language runner) */
  run: boolean | null;
  failedChecks: number;
  steps: number;
  toolCalls: number;
  /** Project files changed (agent harness files aside) */
  files: number;
  linesAdded: number;
  linesRemoved: number;
  ms: number;
  tokens: number;
}

const CHECK_TOOLS = new Set(['build', 'run_program', 'run_code', 'python']);

export function evidenceFrom(run: Pick<AgentRun, 'reason' | 'steps' | 'toolCalls' | 'usage' | 'ms'>, events: AgentEvent[], stage: Stage, isHarnessFile: (p: string) => boolean = () => false): Evidence {
  let build: boolean | null = null;
  let ran: boolean | null = null;
  let failedChecks = 0;
  const names = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'tool') names.set(e.call.id, e.call.name);
    if (e.type !== 'result') continue;
    const name = names.get(e.call.id) ?? '';
    if (!CHECK_TOOLS.has(name)) continue;
    if (!e.result.ok) failedChecks++;
    if (name === 'build') build = e.result.ok;
    else ran = e.result.ok;
  }
  let linesAdded = 0;
  let linesRemoved = 0;
  const changed = Object.keys(stage.changes()).filter((p) => !isHarnessFile(p));
  for (const path of changed) {
    const d = stage.diff(path);
    linesAdded += d.added;
    linesRemoved += d.removed;
  }
  return { reason: run.reason, build, run: ran, failedChecks, steps: run.steps, toolCalls: run.toolCalls, files: changed.length, linesAdded, linesRemoved, ms: run.ms, tokens: run.usage.input + run.usage.output };
}

export type Tone = 'good' | 'bad' | 'warn' | 'neutral';
export interface Chip {
  label: string;
  tone: Tone;
  /** Longer explanation for a tooltip or a screen reader */
  detail: string;
}

const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : ms < 60_000 ? `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s` : `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`);
const compact = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n));

export function chipsFor(e: Evidence): Chip[] {
  const chips: Chip[] = [];
  if (e.build !== null) chips.push(e.build ? { label: 'built ✓', tone: 'good', detail: 'The last build passed' } : { label: 'build ✕', tone: 'bad', detail: 'The last build failed' });
  if (e.run !== null) chips.push(e.run ? { label: 'ran ✓', tone: 'good', detail: 'The last run exited successfully' } : { label: 'run ✕', tone: 'bad', detail: 'The last run failed' });
  if (e.build === null && e.run === null && e.files) chips.push({ label: 'not checked', tone: 'warn', detail: 'Nothing was built or run to check these changes' });
  if (e.failedChecks) chips.push({ label: `${e.failedChecks} failed attempt${e.failedChecks > 1 ? 's' : ''}`, tone: 'neutral', detail: 'Builds or runs that failed before the final state' });
  if (e.reason !== 'finished') {
    const why: Partial<Record<StopReason, string>> = { budget: 'stopped at its budget', stuck: 'stopped going in circles', aborted: 'stopped', declined: 'declined', error: 'failed' };
    chips.push({ label: why[e.reason] ?? e.reason, tone: e.reason === 'aborted' ? 'neutral' : 'warn', detail: 'The agent did not finish on its own' });
  }
  chips.push({ label: `${e.files} file${e.files === 1 ? '' : 's'} · +${e.linesAdded} −${e.linesRemoved}`, tone: 'neutral', detail: 'Size of the change' });
  chips.push({ label: `${e.steps} step${e.steps === 1 ? '' : 's'} · ${duration(e.ms)}`, tone: 'neutral', detail: `${e.toolCalls} tool calls` });
  if (e.tokens) chips.push({ label: `${compact(e.tokens)} tokens`, tone: 'neutral', detail: 'Tokens the model reported' });
  return chips;
}

/**
 * Verified: finished, changed something, and the last build or run that happened passed (and none
 * that happened last failed). Anything else can still be accepted, but the UI asks for a closer look.
 */
export function verdict(e: Evidence): { verified: boolean; headline: string } {
  if (!e.files) return { verified: false, headline: 'No changes to the project' };
  if (e.reason !== 'finished') return { verified: false, headline: 'Unfinished: review carefully' };
  if (e.build === false || e.run === false) return { verified: false, headline: 'The last check failed' };
  if (e.build === null && e.run === null) return { verified: false, headline: 'Not checked: review carefully' };
  return { verified: true, headline: 'Verified' };
}
