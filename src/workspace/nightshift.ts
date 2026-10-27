'use client';

/**
 * The night shift, running: the plan is kept in this browser per project; every 15 seconds (and when a proposal
 * finishes) lib/nightshift.ts says what to do next: start the next task as a background proposal with its budget,
 * stop one that ran over, or end the night. Like watchers, it runs while the studio is open.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { applyStep, emptyNight, nextStep, taskFinished, type NightShift } from '@/lib/nightshift';
import { laneOf, useProposals } from './proposals';
import { useWorkspace } from './store';
import { useToast } from './toasts';

const KEY = (project: string) => `aha:night:${project}`;
const TICK_MS = 15_000;

function read(project: string): NightShift {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(project)) ?? 'null') as NightShift | null;
    return raw && Array.isArray(raw.tasks) ? { ...emptyNight(), ...raw } : emptyNight();
  } catch {
    return emptyNight();
  }
}

export const nightTask = (id: string) => `night:${id}`;

export function useNightShift() {
  const { project } = useWorkspace();
  const proposals = useProposals();
  const { notify } = useToast();
  const [night, setNight] = useState<NightShift>(emptyNight);
  const nightRef = useRef(night);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
    setNight(read(project.name));
  }, [project.name]);

  const save = useCallback(
    (next: NightShift) => {
      nightRef.current = next;
      setNight(next);
      try {
        localStorage.setItem(KEY(project.name), JSON.stringify(next));
      } catch {
        // this session only
      }
    },
    [project.name]
  );
  useEffect(() => {
    nightRef.current = night;
  }, [night]);

  const armed = night.armedAt !== null && !night.finishedAt;
  useEffect(() => {
    if (!armed) return;
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, [armed]);

  // A night task's proposal finished (or was stopped): record how, with the tokens it used
  const finishedKey = proposals.proposals.filter((p) => p.task?.startsWith('night:') && p.status !== 'working').map((p) => p.id).join();
  useEffect(() => {
    let current = nightRef.current;
    for (const t of current.tasks) {
      if (!t.proposalId || (t.status !== 'running' && !(t.status === 'stopped' && t.tokens === undefined))) continue;
      const p = proposals.proposals.find((x) => x.id === t.proposalId);
      if (!p || p.status === 'working') continue;
      const tokens = laneOf(p)?.evidence?.tokens ?? 0;
      current = t.status === 'running' ? taskFinished(current, t.id, { reason: p.outcome?.reason ?? 'finished', tokens }, Date.now()) : { ...current, tasks: current.tasks.map((x) => (x.id === t.id ? { ...x, tokens } : x)) };
    }
    if (current !== nightRef.current) {
      save(current);
      setTick((n) => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- when a night proposal finishes
  }, [finishedKey]);

  useEffect(() => {
    const now = Date.now();
    let current = nightRef.current;
    if (current.armedAt === null || current.finishedAt) return;
    // Act until there is nothing to do right now (a failed start moves on to the next task)
    for (let i = 0; i < current.tasks.length + 2; i++) {
      const step = nextStep(current, now);
      if (step.kind === 'wait') break;
      if (step.kind === 'start') {
        const task = current.tasks.find((t) => t.id === step.taskId)!;
        const id = proposals.ask(task.text, {
          label: `Night · ${task.text}`,
          background: true,
          quiet: true,
          origin: 'night',
          task: nightTask(task.id),
          approaches: 0,
          budget: { maxSteps: 60, maxToolCalls: 200, maxFixAttempts: 6, ...step.budget },
        });
        current = applyStep(current, step, now, id ?? undefined);
        if (id) break;
      } else if (step.kind === 'stop') {
        const task = current.tasks.find((t) => t.id === step.taskId);
        if (task?.proposalId) proposals.stop(task.proposalId);
        current = applyStep(current, step, now);
      } else {
        current = applyStep(current, step, now);
        const done = current.tasks.filter((t) => t.status === 'done').length;
        notify({ kind: 'info', title: 'The night shift is over', detail: `${done} of ${current.tasks.length} task${current.tasks.length === 1 ? '' : 's'} done${current.ended ? ` · ${current.ended}` : ''}. The morning report has the details.` });
        break;
      }
    }
    if (current !== nightRef.current) save(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- on the timer and when a task finishes
  }, [tick, armed]);

  return {
    night,
    /** Change the plan (only while it isn't running) */
    plan: (patch: Partial<NightShift>) => save({ ...nightRef.current, ...patch }),
    arm: () => save({ ...nightRef.current, armedAt: Date.now(), startedAt: undefined, finishedAt: undefined, ended: undefined }),
    /** Stop the night now: the task in progress is stopped, the rest skipped */
    cancel: () => {
      let current = nightRef.current;
      const running = current.tasks.find((t) => t.status === 'running');
      if (running?.proposalId) {
        proposals.stop(running.proposalId);
        current = applyStep(current, { kind: 'stop', taskId: running.id, reason: 'You stopped the night' }, Date.now());
      }
      save(applyStep(current, { kind: 'finish', reason: 'You stopped the night' }, Date.now()));
    },
    /** Start planning a new night (the finished one's results stay in its proposals) */
    reset: () => save({ ...emptyNight(), budget: nightRef.current.budget, startAt: nightRef.current.startAt }),
  };
}

export type NightShiftHandle = ReturnType<typeof useNightShift>;
