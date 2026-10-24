'use client';

/**
 * Records how each proposal turns out (lib/agent/outcomes.ts), per project, in this browser:
 * when it finishes (verified or not, and what went wrong) and when you accept or discard it.
 */

import { useCallback, useEffect, useState } from 'react';
import { upsertOutcome, type Outcome } from '@/lib/agent/outcomes';
import { laneOf, verdict, type Proposal } from './proposals';

const KEY = (project: string) => `nanocli:outcomes:${project}`;
const IMPROVED_KEY = (project: string) => `nanocli:improved-at:${project}`;

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked: the record is only for this session
  }
}

/** A finished proposal as an outcome (null while it's still working) */
export function outcomeOf(p: Proposal): Outcome | null {
  if (p.status === 'working' || !p.outcome) return null;
  const evidence = laneOf(p)?.evidence;
  const errors = p.log
    .filter((e) => e.kind === 'tool' && e.result && !e.result.ok)
    .map((e) => `${e.call?.name ?? 'tool'}: ${(e.result!.content.split('\n').find((l) => l.trim()) ?? '').slice(0, 200)}`)
    .slice(0, 5);
  return {
    id: p.id,
    at: p.createdAt,
    origin: p.origin ?? 'you',
    ...(p.task ? { kind: p.task } : {}),
    title: p.goal.replace(/^Worker · /, '').slice(0, 140),
    verified: !!evidence && verdict(evidence).verified,
    reason: p.outcome.reason,
    decision: p.status === 'accepted' ? 'accepted' : p.status === 'discarded' ? 'discarded' : null,
    errors,
  };
}

export function useOutcomes(projectName: string, proposals: Proposal[]) {
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [lastImprovedAt, setLastImprovedAt] = useState(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- storage is only readable in the browser */
    setOutcomes(load<Outcome[]>(KEY(projectName), []));
    setLastImprovedAt(load<number>(IMPROVED_KEY(projectName), 0));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [projectName]);

  // Record each proposal as it finishes and as you decide on it
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derived from proposals as they change
    setOutcomes((prev) => {
      let next = prev;
      for (const p of proposals) {
        const outcome = outcomeOf(p);
        if (!outcome) continue;
        const existing = next.find((o) => o.id === outcome.id);
        // Keep a decision once made (a restored proposal shows as review again)
        const merged = existing?.decision && !outcome.decision ? { ...outcome, decision: existing.decision } : outcome;
        if (existing && JSON.stringify(existing) === JSON.stringify(merged)) continue;
        next = upsertOutcome(next, merged);
      }
      if (next !== prev) save(KEY(projectName), next);
      return next;
    });
  }, [proposals, projectName]);

  const markImproved = useCallback(() => {
    const now = Date.now();
    setLastImprovedAt(now);
    save(IMPROVED_KEY(projectName), now);
  }, [projectName]);

  return { outcomes, lastImprovedAt, markImproved };
}
