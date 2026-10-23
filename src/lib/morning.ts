/**
 * The morning report: what happened while you were away, in the order you
 * would act on it. What the worker and the debugger finished (and whether it
 * is proven), what waits on you, what is broken now, and the next step.
 * Opens on its own after a long absence; any time from ⌘K. Pure.
 */

export interface ReportProposal {
  id: string;
  goal: string;
  status: 'working' | 'review' | 'accepted' | 'discarded';
  origin?: 'you' | 'debug' | 'worker';
  createdAt: number;
  /** "Verified", "Breaks a contract"… */
  headline?: string;
  verified?: boolean;
  review?: 'approve' | 'concerns' | 'block';
  waiting?: boolean;
}

export interface ReportInput {
  /** When you were last here */
  since: number;
  now: number;
  proposals: ReportProposal[];
  brokenContracts: string[];
  failure?: { title: string; source: string } | null;
  ci?: { status: 'passed' | 'failed'; step?: string } | null;
  nextTask?: { title: string; reason: string } | null;
  workerMode?: 'off' | 'suggest' | 'auto';
}

export type ReportAction = { kind: 'proposal'; id: string } | { kind: 'panel'; panel: 'contracts' | 'ci' | 'worker' | 'agent' } | { kind: 'debug' };

export interface ReportItem {
  label: string;
  detail?: string;
  tone: 'good' | 'bad' | 'warn' | 'neutral';
  action?: ReportAction;
}

export interface MorningReport {
  headline: string;
  sections: { title: string; items: ReportItem[] }[];
  /** Nothing happened and nothing needs you */
  quiet: boolean;
}

/** How long away counts as "away": the report opens on its own after this */
export const AWAY_MS = 4 * 60 * 60_000;

export function awayFor(ms: number): string {
  const h = Math.round(ms / 3_600_000);
  if (h < 1) return 'a little while';
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

const WHO: Record<NonNullable<ReportProposal['origin']>, string> = { you: 'For you', debug: 'Debugger', worker: 'Worker' };

export function morningReport(input: ReportInput): MorningReport {
  const sections: MorningReport['sections'] = [];
  const recent = input.proposals.filter((p) => p.createdAt >= input.since);

  // 1. Waiting on you: a question, or finished work to review (newest first)
  const waiting: ReportItem[] = [];
  for (const p of input.proposals.filter((x) => x.status === 'working' && x.waiting)) {
    waiting.push({ label: p.goal, detail: 'Asking to run something', tone: 'warn', action: { kind: 'proposal', id: p.id } });
  }
  for (const p of input.proposals.filter((x) => x.status === 'review').sort((a, b) => b.createdAt - a.createdAt)) {
    const reviewer = p.review === 'block' ? ' · reviewer blocks' : p.review === 'concerns' ? ' · reviewer has concerns' : p.review === 'approve' ? ' · reviewer approves' : '';
    waiting.push({
      label: p.goal,
      detail: `${p.origin ? `${WHO[p.origin]} · ` : ''}${p.headline ?? 'Ready'}${reviewer}`,
      tone: p.verified && p.review !== 'block' ? 'good' : p.review === 'block' || p.headline === 'Breaks a contract' ? 'bad' : 'warn',
      action: { kind: 'proposal', id: p.id },
    });
  }
  if (waiting.length) sections.push({ title: 'Waiting on you', items: waiting.slice(0, 8) });

  // 2. Broken now
  const broken: ReportItem[] = [];
  if (input.failure) broken.push({ label: input.failure.title, detail: `The last ${input.failure.source} failed`, tone: 'bad', action: { kind: 'debug' } });
  if (input.ci?.status === 'failed') broken.push({ label: `CI fails here${input.ci.step ? ` at “${input.ci.step}”` : ''}`, detail: 'It would fail on push too', tone: 'bad', action: { kind: 'panel', panel: 'ci' } });
  for (const rule of input.brokenContracts.slice(0, 5)) broken.push({ label: rule, detail: 'Contract broken', tone: 'bad', action: { kind: 'panel', panel: 'contracts' } });
  if (broken.length) sections.push({ title: 'Broken now', items: broken });

  // 3. What got done while you were away (decided ones; the open ones are above)
  const done = recent.filter((p) => p.status === 'accepted' || p.status === 'discarded');
  if (done.length) {
    sections.push({
      title: 'Done while you were away',
      items: done.slice(0, 6).map((p) => ({ label: p.goal, detail: p.status === 'accepted' ? 'Accepted' : 'Discarded', tone: 'neutral' as const, action: { kind: 'proposal' as const, id: p.id } })),
    });
  }

  // 4. Next
  const next: ReportItem[] = [];
  if (input.nextTask) next.push({ label: input.nextTask.title, detail: input.nextTask.reason, tone: 'neutral', action: { kind: 'panel', panel: 'worker' } });
  if (!broken.length && input.ci?.status === 'passed') next.push({ label: 'CI passes here', detail: 'Safe to push', tone: 'good', action: { kind: 'panel', panel: 'ci' } });
  if (next.length) sections.push({ title: 'Next', items: next });

  const finished = recent.filter((p) => p.status !== 'working').length;
  const verified = recent.filter((p) => p.status !== 'working' && p.verified).length;
  const parts = [
    finished ? `${finished} proposal${finished === 1 ? '' : 's'} finished${verified ? `, ${verified} verified` : ''}` : null,
    waiting.length ? `${waiting.length} wait${waiting.length === 1 ? 's' : ''} on you` : null,
    broken.length ? `${broken.length} thing${broken.length === 1 ? '' : 's'} broken` : null,
  ].filter(Boolean);
  const quiet = !parts.length;
  const away = awayFor(input.now - input.since);
  const headline = quiet
    ? `All quiet for the ${away} you were away${input.workerMode === 'off' ? ': the worker is off' : ''}.`
    : `While you were away (${away}): ${parts.join(' · ')}.`;
  return { headline, sections, quiet };
}
