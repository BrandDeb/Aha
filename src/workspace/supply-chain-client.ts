'use client';

/**
 * The supply-chain guard in the browser: the dependencies a proposal adds are looked up once (through
 * /api/supply-chain) and remembered for the session. The name checks need no lookup, so a typosquat is found at once;
 * the registry's facts arrive a moment later, and the risk score is computed again when they do. The checker (with its
 * lists of popular names) loads the first time a change touches a manifest, not with the studio.
 */

import { useSyncExternalStore } from 'react';
import type { NewDependency, PackageFacts, SupplyFinding } from '@/lib/supply-chain';

type Checker = typeof import('@/lib/supply-chain');
let checker: Checker | null = null;
let loading = false;
const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Pipfile|Cargo\.toml|go\.mod|Gemfile|composer\.json)$/;

type Entry = { state: 'pending' } | { state: 'done'; facts: PackageFacts | null };

const entries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let version = 0;
const queued: NewDependency[] = [];

const keyOf = (d: Pick<NewDependency, 'ecosystem' | 'name' | 'spec'>) => `${d.ecosystem}:${checker!.normalizeName(d.ecosystem, d.name)}@${d.spec}`;
const changed = () => {
  version++;
  listeners.forEach((l) => l());
};

function flush() {
  const batch = queued.splice(0, 30);
  if (!batch.length) return;
  void fetch('/api/supply-chain', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deps: batch.map(({ ecosystem, name, spec }) => ({ ecosystem, name, spec })) }) })
    .then(async (r) => (r.ok ? ((await r.json()) as { facts: PackageFacts[] }).facts : null))
    .catch(() => null)
    .then((facts) => {
      // No answer (offline, or a static host): the name checks still stand, and nothing waits on the lookup
      batch.forEach((d, i) => entries.set(keyOf(d), { state: 'done', facts: facts?.[i] ?? null }));
      changed();
      if (queued.length) flush();
    });
}

/** What the guard knows about the dependencies these changes add; `pending` while the registry hasn't answered */
export function supplyChainOf(files: { path: string; kind: string; before: string; after: string }[]): { findings: SupplyFinding[]; pending: boolean; checked: number } {
  if (!files.some((f) => MANIFEST.test(f.path))) return { findings: [], pending: false, checked: 0 };
  if (!checker) {
    if (!loading) {
      loading = true;
      void import('@/lib/supply-chain').then((m) => {
        checker = m;
        changed();
      });
    }
    return { findings: [], pending: true, checked: 0 };
  }
  const { assessDependency, newDependencies, sortFindings } = checker;
  const deps = newDependencies(files);
  let pending = false;
  const findings: SupplyFinding[] = [];
  for (const d of deps) {
    const key = keyOf(d);
    let entry = entries.get(key);
    if (!entry) {
      entry = { state: 'pending' };
      entries.set(key, entry);
      queued.push(d);
      // Not during render: the lookup starts right after
      if (queued.length === 1) queueMicrotask(flush);
    }
    if (entry.state === 'pending') pending = true;
    findings.push(...assessDependency(d, entry.state === 'done' ? entry.facts : null));
  }
  return { findings: sortFindings(findings), pending, checked: deps.length };
}

/** Re-render when a lookup finishes */
export function useSupplyChainVersion(): number {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => version,
    () => 0
  );
}
