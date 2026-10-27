/**
 * The night shift: tasks you queue before you leave, run one after another while you're away, each as a background
 * proposal, inside a budget for each task and for the whole night (time and tokens). What they did is waiting in the
 * morning report. Pure: the workspace asks it what to do next and records what happened.
 */

export type NightTaskStatus = 'queued' | 'running' | 'done' | 'stopped' | 'skipped' | 'failed';

export interface NightTask {
  id: string;
  text: string;
  status: NightTaskStatus;
  proposalId?: string;
  startedAt?: number;
  endedAt?: number;
  tokens?: number;
  /** Why it stopped or was skipped, in words */
  reason?: string;
}

export interface NightBudget {
  /** Longest one task may run */
  perTaskMinutes: number;
  /** Most tokens one task may use */
  perTaskTokens: number;
  /** When the whole night stops, counted from its start */
  totalHours: number;
  /** Most tokens all tasks together may use */
  totalTokens: number;
}

export interface NightShift {
  tasks: NightTask[];
  budget: NightBudget;
  /** "now", or a time of day "HH:MM" (the next one after it was armed) */
  startAt: string;
  /** Armed by you; null while you are still planning */
  armedAt: number | null;
  startedAt?: number;
  finishedAt?: number;
  /** Why the night ended early, if it did */
  ended?: string;
}

export const DEFAULT_NIGHT_BUDGET: NightBudget = { perTaskMinutes: 30, perTaskTokens: 400_000, totalHours: 8, totalTokens: 2_000_000 };

export const emptyNight = (): NightShift => ({ tasks: [], budget: DEFAULT_NIGHT_BUDGET, startAt: '22:00', armedAt: null });

/** When the night starts: right away, or the next time the clock shows startAt after arming */
export function startTime(night: Pick<NightShift, 'startAt' | 'armedAt'>): number | null {
  if (night.armedAt === null) return null;
  if (night.startAt === 'now') return night.armedAt;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(night.startAt);
  if (!m) return night.armedAt;
  const at = new Date(night.armedAt);
  at.setHours(Number(m[1]), Number(m[2]), 0, 0);
  if (at.getTime() < night.armedAt) at.setDate(at.getDate() + 1);
  return at.getTime();
}

/** Tasks from text: one per line, list markers and blank lines dropped */
export function parseTasks(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim())
    .filter((l) => l.length >= 3)
    .slice(0, 20);
}

export const usedTokens = (night: NightShift) => night.tasks.reduce((n, t) => n + (t.tokens ?? 0), 0);

export type NightStep =
  | { kind: 'wait'; until?: number }
  | { kind: 'start'; taskId: string; budget: { maxMillis: number; maxTokens: number } }
  /** The task running now has gone over the night's limits: stop it */
  | { kind: 'stop'; taskId: string; reason: string }
  | { kind: 'finish'; reason?: string };

/** What to do now. `running` is the task in progress, if any */
export function nextStep(night: NightShift, now: number): NightStep {
  const start = startTime(night);
  if (start === null || night.finishedAt) return { kind: 'wait' };
  if (now < start) return { kind: 'wait', until: start };
  const deadline = start + night.budget.totalHours * 3_600_000;
  const left = night.budget.totalTokens - usedTokens(night);
  const running = night.tasks.find((t) => t.status === 'running');
  if (running) {
    if (now >= deadline) return { kind: 'stop', taskId: running.id, reason: `The night's ${night.budget.totalHours} h ran out` };
    // A task that outlives its own time limit (the agent stops itself; this is the backstop)
    if (running.startedAt && now - running.startedAt > night.budget.perTaskMinutes * 60_000 + 2 * 60_000) return { kind: 'stop', taskId: running.id, reason: `Ran past its ${night.budget.perTaskMinutes} min` };
    return { kind: 'wait' };
  }
  const next = night.tasks.find((t) => t.status === 'queued');
  if (!next) return { kind: 'finish' };
  if (now >= deadline) return { kind: 'finish', reason: `The night's ${night.budget.totalHours} h ran out` };
  if (left <= 0) return { kind: 'finish', reason: `The night's ${night.budget.totalTokens.toLocaleString('en')} tokens are used up` };
  const minutes = Math.min(night.budget.perTaskMinutes, (deadline - now) / 60_000);
  return { kind: 'start', taskId: next.id, budget: { maxMillis: Math.max(60_000, Math.floor(minutes * 60_000)), maxTokens: Math.min(night.budget.perTaskTokens, left) } };
}

/** The night after a step was carried out */
export function applyStep(night: NightShift, step: NightStep, now: number, proposalId?: string): NightShift {
  if (step.kind === 'start') {
    if (!proposalId) return { ...night, tasks: night.tasks.map((t) => (t.id === step.taskId ? { ...t, status: 'failed', endedAt: now, reason: 'No model to run it: choose one in the Agent tab' } : t)) };
    return { ...night, startedAt: night.startedAt ?? now, tasks: night.tasks.map((t) => (t.id === step.taskId ? { ...t, status: 'running', startedAt: now, proposalId } : t)) };
  }
  if (step.kind === 'stop') return { ...night, tasks: night.tasks.map((t) => (t.id === step.taskId ? { ...t, status: 'stopped', endedAt: now, reason: step.reason } : t)) };
  if (step.kind === 'finish') {
    return {
      ...night,
      finishedAt: now,
      ...(step.reason ? { ended: step.reason } : {}),
      tasks: night.tasks.map((t) => (t.status === 'queued' ? { ...t, status: 'skipped', reason: step.reason ?? 'The night ended' } : t)),
    };
  }
  return night;
}

/** A task's proposal has finished: record how */
export function taskFinished(night: NightShift, taskId: string, outcome: { reason: string; tokens: number }, now: number): NightShift {
  return {
    ...night,
    tasks: night.tasks.map((t) => {
      if (t.id !== taskId || t.status !== 'running') return t;
      const status: NightTaskStatus = outcome.reason === 'finished' ? 'done' : outcome.reason === 'budget' || outcome.reason === 'aborted' ? 'stopped' : 'failed';
      const why = outcome.reason === 'budget' ? 'Stopped at its budget' : outcome.reason === 'aborted' ? 'Stopped' : outcome.reason === 'finished' ? undefined : `Ended: ${outcome.reason}`;
      return { ...t, status, endedAt: now, tokens: outcome.tokens, ...(why ? { reason: why } : {}) };
    }),
  };
}

/** One line per task for the morning report */
export function nightSummary(night: NightShift): { headline: string; items: { text: string; status: NightTaskStatus; detail: string; proposalId?: string }[] } {
  const count = (s: NightTaskStatus) => night.tasks.filter((t) => t.status === s).length;
  const parts = [`${count('done')} done`, count('stopped') && `${count('stopped')} stopped at the budget`, count('failed') && `${count('failed')} failed`, count('skipped') && `${count('skipped')} skipped`].filter(Boolean);
  const tokens = usedTokens(night);
  return {
    headline: `Night shift: ${parts.join(', ')}${tokens ? ` · ${Math.round(tokens / 1000)}k tokens` : ''}${night.ended ? ` (${night.ended.toLowerCase()})` : ''}`,
    items: night.tasks.map((t) => ({
      text: t.text,
      status: t.status,
      proposalId: t.proposalId,
      detail: [t.reason ?? (t.status === 'done' ? 'Finished: review the proposal' : t.status), t.tokens ? `${Math.round(t.tokens / 1000)}k tokens` : '', t.startedAt && t.endedAt ? `${Math.max(1, Math.round((t.endedAt - t.startedAt) / 60_000))} min` : ''].filter(Boolean).join(' · '),
    })),
  };
}
