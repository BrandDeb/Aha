'use client';

/**
 * Watchers, running: every 30 seconds (and while the studio is open) each watcher is checked against what happened
 * since the last check: its schedule, the files that changed, the current failure. lib/watchers.ts decides whether to
 * start a background proposal, suggest it, or hold back, and every decision is kept so the panel can show it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { WATCHERS_FILE, briefFor, changedPaths, decide, eventFor, parseWatchers, serializeWatchers, type Watcher, type WatcherEvent, type WatcherRun } from '@/lib/watchers';
import { useProposals } from './proposals';
import { useWorkspace } from './store';
import { useToast } from './toasts';

const RUNS_KEY = (project: string) => `aha:watcher-runs:${project}`;
const CHECK_KEY = (project: string) => `aha:watcher-check:${project}`;
const TICK_MS = 20_000;
/** You are typing: changes are looked at once you pause this long */
const IDLE_MS = 8_000;
const KEEP_RUNS = 200;

function readRuns(project: string): WatcherRun[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RUNS_KEY(project)) ?? '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function readCheck(project: string): number {
  try {
    const at = Number(localStorage.getItem(CHECK_KEY(project)));
    return Number.isFinite(at) && at > 0 ? at : Date.now();
  } catch {
    return Date.now();
  }
}

function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // this session only
  }
}

export const watcherTask = (id: string) => `watcher:${id}`;

export function useWatchers(failure: { signature: string; title: string } | null) {
  const { project, dispatch } = useWorkspace();
  const proposals = useProposals();
  const { notify } = useToast();
  const watchers = useMemo(() => parseWatchers(project.files[WATCHERS_FILE]), [project.files]);
  const [runs, setRuns] = useState<WatcherRun[]>([]);
  const [tick, setTick] = useState(0);
  const lastCheck = useRef(0);
  const snapshot = useRef<Record<string, string> | null>(null);
  /** Events that should start but had to wait for the agent to be free */
  const waiting = useRef(new Map<string, { watcher: Watcher; event: WatcherEvent }>());

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- storage is only readable in the browser */
    setRuns(readRuns(project.name));
    /* eslint-enable react-hooks/set-state-in-effect */
    lastCheck.current = readCheck(project.name);
    snapshot.current = null;
    waiting.current.clear();
  }, [project.name]);

  const record = useCallback(
    (run: WatcherRun) =>
      setRuns((prev) => {
        // The same hold-back again (you keep typing while its result waits): one line with a count, not many
        const last = prev[0];
        const again = last && run.action === 'skipped' && last.action === 'skipped' && last.watcherId === run.watcherId && last.reason === run.reason;
        const next = (again ? [{ ...run, count: (last.count ?? 1) + 1 }, ...prev.slice(1)] : [run, ...prev]).slice(0, KEEP_RUNS);
        store(RUNS_KEY(project.name), JSON.stringify(next));
        return next;
      }),
    [project.name]
  );

  const save = useCallback((list: Watcher[]) => dispatch({ type: 'put', files: { [WATCHERS_FILE]: serializeWatchers(list) } }), [dispatch]);

  const launch = useCallback(
    (w: Watcher, event: WatcherEvent, reason: string) => {
      const id = proposals.ask(briefFor(w, event), { label: `Watcher · ${w.name}`, background: true, quiet: true, origin: 'watcher', task: watcherTask(w.id), approaches: 0 });
      if (!id) {
        record({ watcherId: w.id, at: Date.now(), key: event.key, event: event.summary, action: 'skipped', reason: 'No model chosen: pick one in the Agent tab' });
        return null;
      }
      record({ watcherId: w.id, at: Date.now(), key: event.key, event: event.summary, action: 'started', reason, proposalId: id });
      return id;
    },
    [proposals, record]
  );

  /** Start it now, whatever its trigger */
  const runNow = useCallback((w: Watcher) => launch(w, { key: `${w.id}:manual:${Date.now()}`, summary: 'You started it' }, 'You started it'), [launch]);

  const enabled = watchers.some((w) => w.enabled);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [enabled]);

  // Your edits: changes are looked at once you pause, and a new failure is looked at right away
  const lastEdit = useRef(0);
  useEffect(() => {
    lastEdit.current = Date.now();
    if (!enabled) return;
    const timer = setTimeout(() => setTick((n) => n + 1), IDLE_MS + 100);
    return () => clearTimeout(timer);
  }, [project.files, enabled]);
  useEffect(() => {
    if (!enabled || !failure) return;
    const timer = setTimeout(() => setTick((n) => n + 1), 0);
    return () => clearTimeout(timer);
  }, [failure, enabled]);

  const busy = proposals.proposals.some((p) => p.status === 'working');
  useEffect(() => {
    const now = Date.now();
    const before = snapshot.current;
    if (!enabled || !before) {
      snapshot.current = project.files;
      lastCheck.current = now;
      store(CHECK_KEY(project.name), String(now));
      return;
    }
    // Still typing: look again once you pause (the changes keep adding up until then)
    if (now - lastEdit.current < IDLE_MS) return;
    snapshot.current = project.files;
    const changed = changedPaths(before, project.files);
    const ctx = { now, lastCheck: lastCheck.current, changed, files: project.files, failure };
    lastCheck.current = now;
    store(CHECK_KEY(project.name), String(now));

    const found = new Map(waiting.current);
    for (const w of watchers) {
      const event = eventFor(w, ctx);
      if (event) found.set(event.key, { watcher: w, event });
    }
    waiting.current.clear();
    for (const { watcher: w, event } of found.values()) {
      const live = watchers.find((x) => x.id === w.id);
      if (!live?.enabled) continue;
      const unreviewed = proposals.proposals.some((p) => p.task === watcherTask(live.id) && (p.status === 'working' || p.status === 'review'));
      const d = decide(live, event, { now, history: runs, files: project.files, failure, unreviewed });
      if (d.action === 'ignore') continue;
      if (d.action === 'skip') record({ watcherId: live.id, at: now, key: event.key, event: event.summary, action: 'skipped', reason: d.reason });
      else if (d.action === 'suggest') {
        record({ watcherId: live.id, at: now, key: event.key, event: event.summary, action: 'suggested', reason: d.reason });
        notify({ kind: 'info', title: `${live.name}: ${event.summary}`, detail: live.task.slice(0, 140), action: { label: 'Start', run: () => launch(live, { ...event, key: `${event.key}:go` }, 'You started it from a suggestion') } });
      } else if (busy) waiting.current.set(event.key, { watcher: live, event });
      else launch(live, event, d.reason);
    }
    // Checked on the timer, after you pause typing, and when a failure appears
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, enabled]);

  const toggle = useCallback((id: string, patch: Partial<Watcher>) => save(watchers.map((w) => (w.id === id ? { ...w, ...patch } : w))), [watchers, save]);
  const remove = useCallback((id: string) => save(watchers.filter((w) => w.id !== id)), [watchers, save]);
  const upsert = useCallback((w: Watcher) => save(watchers.some((x) => x.id === w.id) ? watchers.map((x) => (x.id === w.id ? w : x)) : [...watchers, w]), [watchers, save]);

  return { watchers, runs, runNow, toggle, remove, upsert, active: watchers.filter((w) => w.enabled).length };
}

export type WatchersHandle = ReturnType<typeof useWatchers>;
