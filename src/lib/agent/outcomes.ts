/**
 * Continuous improvement, supervised. The studio keeps a record of how the
 * agent's work turns out in each project: did it verify, did you accept or
 * discard it, what kept going wrong. From that record:
 *
 *   - the worker ranks task kinds you keep accepting above the ones you keep
 *     discarding, and
 *   - when results slip, the worker proposes an "improve how the agent works
 *     here" task: the agent studies its own recent failures and proposes changes
 *     to the project's instructions, lessons and skills (agent/, AGENTS.md).
 *
 * The loop improves the agent's harness, never your code on its own, and every
 * change is a proposal you review. Pure: no storage or model calls here.
 */

export type OutcomeOrigin = 'you' | 'debug' | 'worker' | 'watcher';

export interface Outcome {
  id: string;
  at: number;
  origin: OutcomeOrigin;
  /** The worker's task kind, when the worker started it */
  kind?: string;
  /** What the task was, in short */
  title: string;
  verified: boolean;
  /** How the run ended: finished, budget, stuck, error… */
  reason: string;
  /** What you did with it; null until you decide */
  decision: 'accepted' | 'discarded' | null;
  /** First lines of tool calls that failed during the run (a few) */
  errors: string[];
}

export interface OutcomeSummary {
  total: number;
  verified: number;
  accepted: number;
  discarded: number;
  /** Recurring failure messages, most frequent first */
  recurring: { message: string; count: number }[];
}

export const MAX_OUTCOMES = 200;

/** Add or replace an outcome (by id), newest first, capped */
export function upsertOutcome(list: Outcome[], outcome: Outcome): Outcome[] {
  return [outcome, ...list.filter((o) => o.id !== outcome.id)].slice(0, MAX_OUTCOMES);
}

/** Error lines compare equal across runs once numbers, paths and quoted names are blanked */
export const normalizeError = (line: string) =>
  line
    .replace(/(["'`“”‘’]).*?\1/g, '"…"')
    .replace(/(?:[\w.-]+\/)+[\w.-]+/g, '<path>')
    .replace(/\d+/g, 'N')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);

export function summarize(outcomes: Outcome[]): OutcomeSummary {
  const counts = new Map<string, number>();
  for (const o of outcomes) for (const e of new Set(o.errors.map(normalizeError))) if (e) counts.set(e, (counts.get(e) ?? 0) + 1);
  return {
    total: outcomes.length,
    verified: outcomes.filter((o) => o.verified).length,
    accepted: outcomes.filter((o) => o.decision === 'accepted').length,
    discarded: outcomes.filter((o) => o.decision === 'discarded').length,
    recurring: [...counts.entries()].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([message, count]) => ({ message, count })),
  };
}

export const IMPROVE_AFTER = 6;

/**
 * Time to improve the harness: enough new results since the last improvement, and they
 * are not going well (fewer than three in four verified, several discarded, or the same
 * error keeps coming back).
 */
export function needsImprovement(outcomes: Outcome[], lastImprovedAt: number): boolean {
  const recent = outcomes.filter((o) => o.at > lastImprovedAt && o.kind !== 'improve');
  if (recent.length < IMPROVE_AFTER) return false;
  const s = summarize(recent);
  return s.verified / s.total < 0.75 || s.discarded >= 3 || s.recurring.some((r) => r.count >= 3);
}

/** How much the worker should favour a task kind: 0.5 (always discarded) to 1.5 (always accepted); 1 without a record */
export function kindWeight(outcomes: Outcome[], kind: string): number {
  const decided = outcomes.filter((o) => o.origin === 'worker' && o.kind === kind && o.decision);
  if (decided.length < 3) return 1;
  return 0.5 + decided.filter((o) => o.decision === 'accepted').length / decided.length;
}

/** The improvement task's brief: the evidence, and the rules for changing the harness */
export function improvementBrief(outcomes: Outcome[], lastImprovedAt: number): string {
  const recent = outcomes.filter((o) => o.at > lastImprovedAt && o.kind !== 'improve').slice(0, 30);
  const s = summarize(recent);
  const lines = recent.slice(0, 15).map((o) => `- ${o.verified ? 'verified' : 'NOT verified'}${o.decision ? `, ${o.decision}` : ''} (${o.reason}): ${o.title.slice(0, 100)}${o.errors[0] ? ` — e.g. ${o.errors[0].slice(0, 120)}` : ''}`);
  const recurring = s.recurring.map((r) => `- ${r.count}× ${r.message}`);
  return [
    `Improve how you (the coding agent) work in this project, based on your own recent results.`,
    ``,
    `Recent tasks: ${s.total}, verified ${s.verified}, accepted ${s.accepted}, discarded ${s.discarded}.`,
    lines.join('\n'),
    recurring.length ? `\nErrors that kept coming back:\n${recurring.join('\n')}` : '',
    ``,
    `Find the causes that a better harness would have prevented (missing knowledge about this codebase, a wrong habit, a recurring tool mistake, a missing verification step) and fix them only in:`,
    `- agent/prompt.md (standing instructions for this project)`,
    `- agent/lessons.md (short lessons, each citing the evidence above)`,
    `- agent/skills/<name>/SKILL.md (a step-by-step skill for a task kind that keeps failing)`,
    `- AGENTS.md (project conventions)`,
    ``,
    `Rules:`,
    `- Do not change any source code, tests or configuration: only the files above.`,
    `- Every change must point to evidence in the results above; no generic advice.`,
    `- Keep it short: a few precise lines beat a page of rules. Remove or correct lessons that the results show are wrong.`,
    `- Finish with what you changed and which failures each change addresses.`,
  ]
    .filter((l) => l !== '')
    .join('\n');
}
