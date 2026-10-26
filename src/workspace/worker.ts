'use client';

/**
 * The worker, running: it watches the project, keeps a ranked queue of useful
 * tasks (lib/worker.ts), and in Autonomous mode takes the next one whenever
 * you pause typing: on a private copy, as a background proposal you review.
 * It stops on its own when a task needs your OK, when the hourly budget is
 * spent, or when its last tasks didn't come out verified.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { editorProblems } from '@/components/CodeEditor';
import { verdict } from '@/lib/agent/evidence';
import { problemOf } from '@/lib/agent/problems';
import { discoverTasks, nextTask, recentCount, type WorkerTask } from '@/lib/worker';
import { improvementBrief, kindWeight, needsImprovement, summarize } from '@/lib/agent/outcomes';
import { useOutcomes } from './outcomes-client';
import { laneOf, useProposals, type Proposal } from './proposals';

export type WorkerMode = 'off' | 'suggest' | 'auto';

export interface WorkerSettings {
  mode: WorkerMode;
  /** What you are building: the worker takes the next step toward it */
  focus: string;
  /** Best: each task races the current setup against variations and keeps the best (Harness²-style) */
  quality: 'fast' | 'best';
  perHour: number;
}

export type WorkerStatus =
  | { kind: 'off' }
  | { kind: 'suggesting' }
  | { kind: 'waiting-for-you'; reason: string }
  | { kind: 'working'; proposal: Proposal }
  | { kind: 'idle' }
  | { kind: 'paused'; reason: string };

const SETTINGS_KEY = 'aha:worker';
const DONE_KEY = (project: string) => `aha:worker-done:${project}`;
const DEFAULTS: WorkerSettings = { mode: 'off', focus: '', quality: 'fast', perHour: 6 };
/** You are typing: wait until you pause this long */
const IDLE_MS = 12_000;
/** It doesn't pile up work: once this many of its results wait for your review, it waits for you */
const MAX_UNREVIEWED = 3;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

interface Options {
  projectName: string;
  files: Record<string, string>;
  entry: string;
  /** The current failure, unless the debugger already has it */
  failure: { signature: string; title: string; brief: string } | null;
  /** Contracts that are broken now (checked commands that failed, and patterns) */
  brokenContracts?: { id: string; rule: string; report: string; signature?: string }[];
  /** A task became a proposal */
  onStart?: (task: WorkerTask, proposalId: string) => void;
}

export function useWorker({ projectName, files, entry, failure, brokenContracts, onStart }: Options) {
  const proposals = useProposals();
  const [settings, setSettingsState] = useState<WorkerSettings>(DEFAULTS);
  const [done, setDone] = useState<{ keys: string[]; focusSteps: number }>({ keys: [], focusSteps: 0 });
  const [pausedReason, setPausedReason] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [started, setStarted] = useState<number[]>([]);
  const lastEdit = useRef(0);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- storage is only readable in the browser */
    setSettingsState(read(SETTINGS_KEY, DEFAULTS));
    setDone(read(DONE_KEY(projectName), { keys: [], focusSteps: 0 }));
    setPausedReason(null);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [projectName]);

  // Your edits, and opening the page: the worker waits until you pause
  useEffect(() => {
    lastEdit.current = Date.now();
  }, [files]);

  // Re-evaluate every few seconds (editor problems and idleness change without a render)
  useEffect(() => {
    if (settings.mode === 'off') return;
    const timer = setInterval(() => setTick((n) => n + 1), 4000);
    return () => clearInterval(timer);
  }, [settings.mode]);

  const setSettings = useCallback((patch: Partial<WorkerSettings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      } catch {
        // this session only
      }
      return next;
    });
    if (patch.mode) setPausedReason(null);
  }, []);

  const remember = useCallback(
    (key: string, focusStep: boolean) => {
      setDone((prev) => {
        const next = { keys: [...prev.keys, key].slice(-500), focusSteps: prev.focusSteps + (focusStep ? 1 : 0) };
        try {
          localStorage.setItem(DONE_KEY(projectName), JSON.stringify(next));
        } catch {
          // this session only
        }
        return next;
      });
    },
    [projectName]
  );

  // The agent's track record here: ranks task kinds, and says when to improve the agent itself
  const { outcomes, lastImprovedAt, markImproved } = useOutcomes(projectName, proposals.proposals);
  const improve = useMemo(
    () => (needsImprovement(outcomes, lastImprovedAt) ? { key: `improve:${lastImprovedAt}`, brief: improvementBrief(outcomes, lastImprovedAt), reason: 'Its recent results here could be better' } : null),
    [outcomes, lastImprovedAt]
  );
  const weights = useMemo(() => Object.fromEntries((['contract', 'problem', 'focus', 'todo', 'tests', 'improve'] as const).map((k) => [k, kindWeight(outcomes, k)])), [outcomes]);

  const queue = useMemo<WorkerTask[]>(() => {
    if (settings.mode === 'off') return [];
    const doneKeys = new Set(done.keys);
    return discoverTasks({ files, entry, focus: settings.focus, problems: editorProblems(), failure, brokenContracts, focusSteps: done.focusSteps, improve, weights }).filter((t) => !doneKeys.has(t.key));
    // tick: editor problems are read fresh every few seconds
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, entry, settings.mode, settings.focus, failure, brokenContracts, done, tick, improve, weights]);

  const workerProposals = proposals.proposals.filter((p) => p.origin === 'worker');
  const current = workerProposals.find((p) => p.status === 'working');

  /** Start a task now (from the queue, or the autonomous loop) */
  const start = useCallback(
    (task: WorkerTask, auto: boolean) => {
      const id = proposals.ask(task.brief, { label: `Worker · ${task.title}`, background: true, quiet: auto, origin: 'worker', task: task.kind, approaches: settings.quality === 'best' ? 2 : 0 });
      if (!id) {
        if (auto) setPausedReason('Choose a model in the Agent tab: the worker uses it.');
        return false;
      }
      setStarted((prev) => [...prev.slice(-50), Date.now()]);
      remember(task.key, task.kind === 'focus');
      if (task.kind === 'improve') markImproved();
      onStart?.(task, id);
      return true;
    },
    [proposals, settings.quality, remember, onStart, markImproved]
  );

  const skip = useCallback((task: WorkerTask) => remember(task.key, task.kind === 'focus'), [remember]);

  // The autonomous loop
  const anyWorking = proposals.proposals.some((p) => p.status === 'working');
  const waitingOnYou = workerProposals.find((p) => p.status === 'working' && p.pending);
  useEffect(() => {
    if (settings.mode !== 'auto' || pausedReason || anyWorking) return;
    // The model provider itself refused (key, quota, model, network): another task would fail the same way
    const last = workerProposals.find((p) => p.status !== 'working');
    const problem = last && last.outcome?.reason !== 'finished' ? problemOf(last.outcome?.summary) : null;
    if (problem && last && Date.now() - last.createdAt < 60 * 60_000) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a decision the loop makes once
      setPausedReason(`${problem.title}. ${problem.detail} Then resume.`);
      return;
    }
    // Its last three tasks came out unverified: stop and let you look
    const finished = workerProposals.filter((p) => p.status !== 'working').slice(0, 3);
    if (finished.length === 3 && finished.every((p) => { const e = laneOf(p)?.evidence; return !e || !verdict(e).verified; })) {
      setPausedReason('Its last three tasks were not verified. Review them, then resume.');
      return;
    }
    if (workerProposals.filter((p) => p.status === 'review').length >= MAX_UNREVIEWED) return;
    if (recentCount(started) >= settings.perHour) return;
    if (Date.now() - lastEdit.current < IDLE_MS) return;
    const task = nextTask(queue, new Set(done.keys));
    if (task) start(task, true);
    // tick re-runs this check while nothing else changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.mode, settings.perHour, pausedReason, anyWorking, queue, done, tick, start, started]);

  const unreviewed = workerProposals.filter((p) => p.status === 'review').length;
  const status: WorkerStatus =
    settings.mode === 'off'
      ? { kind: 'off' }
      : waitingOnYou
        ? { kind: 'waiting-for-you', reason: 'It needs your OK to run something' }
        : current
          ? { kind: 'working', proposal: current }
          : settings.mode === 'auto' && unreviewed >= MAX_UNREVIEWED
            ? { kind: 'waiting-for-you', reason: `Review its last ${unreviewed} results to let it continue` }
            : pausedReason
            ? { kind: 'paused', reason: pausedReason }
            : settings.mode === 'suggest'
              ? { kind: 'suggesting' }
              : { kind: 'idle' };

  return {
    settings,
    setSettings,
    status,
    queue,
    results: workerProposals,
    record: summarize(outcomes),
    budgetLeft: Math.max(0, settings.perHour - recentCount(started)),
    start: (task: WorkerTask) => start(task, false),
    skip,
    resume: () => setPausedReason(null),
  };
}

export type WorkerHandle = ReturnType<typeof useWorker>;
