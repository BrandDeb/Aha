'use client';

/**
 * Proposals: every task given to the agent becomes one. A proposal is the
 * agent's work as something to review, like a small pull request that lives
 * next to your files: the goal, the plan, what it did, the changes (one lane,
 * or several when it tried different approaches), and the evidence for them.
 * Nothing in a proposal touches the project until it is accepted.
 *
 * The running agent keeps its working copies (Stage objects) in refs; what the
 * interface shows is copied into state as plain data after every step, so
 * components render from state alone.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { evidenceFrom, verdict, type Evidence } from '@/lib/agent/evidence';
import { isHarnessFile, runHarnessLoop, type HarnessEvent } from '@/lib/agent/harness';
import { runAgent } from '@/lib/agent/loop';
import { callModelFor } from '@/lib/agent/model';
import { systemPromptFor } from '@/lib/agent/prompt';
import { Stage, type SerializedStage } from '@/lib/agent/stage';
import { workspaceTools } from '@/lib/agent/tools';
import { DEFAULT_BUDGET, type AgentEvent, type Budget, type Message, type Risk, type StopReason, type ToolCall, type ToolResult } from '@/lib/agent/types';
import { resolveProvider } from '@/lib/ai-providers';
import { createAgentHost } from './agent-host';
import { useAiConfig } from './ai-config';
import { buildConnectorTools } from './connectors-client';
import { getConnectors } from './connectors-config';
import { useWorkspace } from './store';
import { useToast } from './toasts';

export interface LogEntry {
  id: number;
  kind: 'you' | 'agent' | 'tool' | 'notice';
  text?: string;
  call?: ToolCall;
  risk?: Risk;
  result?: ToolResult;
  approved?: boolean;
  lane?: string;
}

export interface FileChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  before: string;
  after: string;
  added: number;
  removed: number;
}

export interface Lane {
  id: string;
  label: string;
  status: 'running' | 'done';
  steps: number;
  /** Harness² score, when approaches were compared */
  score?: number;
  scoreNotes?: string[];
  evidence?: Evidence;
  recommended?: boolean;
  files: FileChange[];
  saved: SerializedStage;
}

export type ProposalStatus = 'working' | 'review' | 'accepted' | 'discarded';

export interface Proposal {
  id: string;
  goal: string;
  createdAt: number;
  status: ProposalStatus;
  model: string;
  step: number;
  plan: string;
  log: LogEntry[];
  lanes: Lane[];
  laneId: string;
  lessons: string[];
  outcome?: { reason: StopReason; summary: string };
  pending?: { call: ToolCall; risk: Risk };
  /** Hidden from the editor tabs (still listed in the Agent tab) */
  closed?: boolean;
  /** Who started it: you, the debugger, or the worker */
  origin?: 'you' | 'debug' | 'worker';
}

export interface AgentPrefs {
  budget: 'quick' | 'standard' | 'long';
  trustCommands: boolean;
  /** 0 = one run; 1-3 = compare that many variants against the current setup */
  approaches: number;
  /** Start a debugging proposal by itself when something fails (once per distinct failure) */
  autoDebug: boolean;
}

export const BUDGETS: Record<AgentPrefs['budget'], { label: string; budget: Partial<Budget> }> = {
  quick: { label: 'Quick · 10 steps', budget: { maxSteps: 10, maxToolCalls: 30, maxMillis: 3 * 60_000, maxFixAttempts: 2 } },
  standard: { label: 'Standard · 25 steps', budget: DEFAULT_BUDGET },
  long: { label: 'Long · 60 steps', budget: { maxSteps: 60, maxToolCalls: 200, maxMillis: 25 * 60_000, maxFixAttempts: 6 } },
};

const STORE_KEY = 'nanocli:proposals';
const PREFS_KEY = 'nanocli:agent-prefs';
const MAX_KEPT = 15;
const DEFAULT_PREFS: AgentPrefs = { budget: 'standard', trustCommands: false, approaches: 0, autoDebug: false };

/** Plain data the interface renders from */
export function snapshotFiles(stage: Stage, hide: (p: string) => boolean = () => false): FileChange[] {
  return Object.entries(stage.changes())
    .sort(([a], [b]) => (hide(a) === hide(b) ? a.localeCompare(b) : hide(a) ? 1 : -1))
    .map(([path, kind]) => {
      const d = stage.diff(path);
      return { path, kind, before: d.before, after: d.after, added: d.added, removed: d.removed };
    });
}

interface ProposalsValue {
  proposals: Proposal[];
  activeId: string | null;
  active: Proposal | null;
  prefs: AgentPrefs;
  setPrefs: (patch: Partial<AgentPrefs>) => void;
  /** Start a new proposal; returns its id, or null when no model is set up */
  /** `label` is what the tab shows when the task itself is long (a debugging brief); `quiet` skips the "choose a model" toast */
  ask: (goal: string, options?: { approaches?: number; label?: string; quiet?: boolean; background?: boolean; origin?: Proposal['origin'] }) => string | null;
  followUp: (id: string, text: string) => void;
  stop: (id: string) => void;
  answer: (id: string, allowed: boolean, always?: boolean) => void;
  accept: (id: string, paths?: string[]) => void;
  discard: (id: string, paths?: string[]) => void;
  remove: (id: string) => void;
  selectLane: (id: string, laneId: string) => void;
  open: (id: string | null) => void;
  close: (id: string) => void;
}

const Ctx = createContext<ProposalsValue | null>(null);

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function ProposalsProvider({ children }: { children: ReactNode }) {
  const { project, dispatch, saveSnapshot, hydrated } = useWorkspace();
  const { notify } = useToast();
  const config = useAiConfig();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [prefs, setPrefsState] = useState<AgentPrefs>(DEFAULT_PREFS);
  const [loaded, setLoaded] = useState(false);

  const stages = useRef(new Map<string, Map<string, Stage>>());
  const controllers = useRef(new Map<string, AbortController>());
  const answers = useRef(new Map<string, (allowed: boolean, always?: boolean) => void>());
  const histories = useRef(new Map<string, Message[]>());
  const idCounter = useRef(0);
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Restore saved proposals (their working copies are rebuilt on demand)
  useEffect(() => {
    if (!hydrated) return;
    const saved = load<Proposal[]>(STORE_KEY, []);
    /* eslint-disable react-hooks/set-state-in-effect -- storage is only readable after hydration */
    const restored = saved
      .filter((p) => p && typeof p.id === 'string' && Array.isArray(p.lanes))
      .map((p) => (p.status === 'working' ? { ...p, status: 'review' as const, pending: undefined, outcome: { reason: 'aborted' as const, summary: 'Stopped when the page was reloaded.' }, lanes: p.lanes.map((l) => ({ ...l, status: 'done' as const })) } : { ...p, pending: undefined }));
    // Anything started before this ran (the worker, auto-debug) stays, newest first
    setProposals((prev) => [...prev, ...restored.filter((r) => !prev.some((p) => p.id === r.id))]);
    setPrefsState({ ...DEFAULT_PREFS, ...load<Partial<AgentPrefs>>(PREFS_KEY, {}) });
    setLoaded(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [hydrated]);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      try {
        const keep = proposals.slice(0, MAX_KEPT).map((p) => ({ ...p, pending: undefined, log: p.log.slice(-80) }));
        localStorage.setItem(STORE_KEY, JSON.stringify(keep));
      } catch {
        // storage full: proposals stay for this session only
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [proposals, loaded]);

  // Stop everything when the workspace goes away
  useEffect(() => {
    const running = controllers.current;
    return () => running.forEach((c) => c.abort());
  }, []);

  const setPrefs = useCallback((patch: Partial<AgentPrefs>) => {
    setPrefsState((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        // per-session only
      }
      return next;
    });
  }, []);

  const update = useCallback((id: string, fn: (p: Proposal) => Proposal) => setProposals((prev) => prev.map((p) => (p.id === id ? fn(p) : p))), []);
  const log = useCallback((id: string, entry: Omit<LogEntry, 'id'>) => update(id, (p) => ({ ...p, log: [...p.log, { id: ++idCounter.current, ...entry }] })), [update]);

  const syncLane = useCallback(
    (id: string, laneId: string, patch: Partial<Lane> = {}) => {
      const stage = stages.current.get(id)?.get(laneId);
      if (!stage) return;
      update(id, (p) => ({ ...p, lanes: p.lanes.map((l) => (l.id === laneId ? { ...l, ...patch, files: snapshotFiles(stage, isHarnessFile), saved: stage.serialize() } : l)) }));
    },
    [update]
  );

  const approver = useCallback(
    (id: string, trusted: Set<string>) => (call: ToolCall, spec: { risk: Risk }) =>
      trusted.has(call.name)
        ? Promise.resolve(true)
        : new Promise<boolean>((resolve) => {
            update(id, (p) => ({ ...p, pending: { call, risk: spec.risk } }));
            answers.current.set(id, (allowed, always) => {
              if (always) trusted.add(call.name);
              answers.current.delete(id);
              update(id, (p) => ({ ...p, pending: undefined }));
              resolve(allowed);
            });
          }),
    [update]
  );

  const finish = useCallback(
    (id: string, outcome: Proposal['outcome'], ok: boolean) => {
      update(id, (p) => ({ ...p, status: 'review', pending: undefined, outcome, lanes: p.lanes.map((l) => ({ ...l, status: 'done' })) }));
      controllers.current.delete(id);
      answers.current.delete(id);
      if (ok) notify({ kind: 'success', title: 'Proposal ready to review', detail: outcome?.summary.slice(0, 120) });
    },
    [update, notify]
  );

  /** One agent run on one lane; also used for follow-ups, which continue the conversation */
  const runSingle = useCallback(
    async (id: string, laneId: string, goal: string, target: Exclude<ReturnType<typeof resolveProvider>, { error: string }>) => {
      const p = projectRef.current;
      const lanes = stages.current.get(id) ?? new Map<string, Stage>();
      stages.current.set(id, lanes);
      const stage = lanes.get(laneId) ?? new Stage(p.files);
      stage.rebase(p.files);
      lanes.set(laneId, stage);
      const controller = new AbortController();
      controllers.current.set(id, controller);
      const host = createAgentHost({ stage, projectName: p.name, entry: p.entry, files: stage.files(), onPlan: (plan) => update(id, (x) => ({ ...x, plan })) });
      const events: AgentEvent[] = [];
      try {
        const connected = await buildConnectorTools(getConnectors(), controller.signal);
        if (connected.connected.length) log(id, { kind: 'notice', text: `Connected: ${connected.connected.map((c) => c.name).join(', ')}` });
        for (const f of connected.failed) log(id, { kind: 'notice', text: `${f.name} is not available: ${f.error}` });
        const run = await runAgent({
          goal,
          system: systemPromptFor(stage.files()),
          tools: [...workspaceTools(host), ...connected.tools],
          callModel: callModelFor(target),
          budget: BUDGETS[prefs.budget].budget,
          autoApprove: prefs.trustCommands ? ['read', 'stage', 'build', 'exec'] : ['read', 'stage', 'build'],
          history: histories.current.get(id) ?? [],
          signal: controller.signal,
          approve: approver(id, new Set()),
          onEvent: (event) => {
            events.push(event);
            if (event.type === 'step') update(id, (x) => ({ ...x, step: event.step, lanes: x.lanes.map((l) => (l.id === laneId ? { ...l, steps: event.step } : l)) }));
            else if (event.type === 'text') log(id, { kind: 'agent', text: event.text });
            else if (event.type === 'notice') log(id, { kind: 'notice', text: event.text });
            else if (event.type === 'tool') log(id, { kind: 'tool', call: event.call, risk: event.risk });
            else if (event.type === 'approval') update(id, (x) => ({ ...x, log: x.log.map((e) => (e.call?.id === event.call.id ? { ...e, approved: event.approved } : e)) }));
            else if (event.type === 'result') {
              update(id, (x) => ({ ...x, log: x.log.map((e) => (e.call?.id === event.call.id ? { ...e, result: event.result } : e)) }));
              syncLane(id, laneId);
            }
          },
        });
        histories.current.set(id, run.messages);
        syncLane(id, laneId, { evidence: evidenceFrom(run, events, stage, isHarnessFile) });
        finish(id, { reason: run.reason, summary: run.summary }, run.reason === 'finished');
      } catch (error) {
        finish(id, { reason: (error as Error).name === 'AbortError' ? 'aborted' : 'error', summary: (error as Error).message }, false);
      }
    },
    [approver, finish, log, prefs.budget, prefs.trustCommands, syncLane, update]
  );

  /** Try the task with the current setup and with variants of the agent's harness, then recommend the best (Harness²-style) */
  const runApproaches = useCallback(
    async (id: string, goal: string, k: number, target: Exclude<ReturnType<typeof resolveProvider>, { error: string }>) => {
      const p = projectRef.current;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      const lanes = new Map<string, Stage>();
      stages.current.set(id, lanes);
      const onEvent = (event: HarnessEvent) => {
        if (event.type === 'notice') log(id, { kind: 'notice', text: event.text });
        else if (event.type === 'probe-start')
          update(id, (x) => ({ ...x, laneId: x.laneId || event.id, lanes: [...x.lanes, { id: event.id, label: event.id === 'baseline' ? 'Current setup' : event.id, status: 'running', steps: 0, files: [], saved: { edits: [], before: {} } }] }));
        else if (event.type === 'probe-step') {
          const e = event.event;
          if (e.type === 'step') update(id, (x) => ({ ...x, lanes: x.lanes.map((l) => (l.id === event.id ? { ...l, steps: e.step } : l)) }));
          else if (e.type === 'tool') log(id, { kind: 'tool', call: e.call, risk: e.risk, lane: event.id });
          else if (e.type === 'result') update(id, (x) => ({ ...x, log: x.log.map((l) => (l.call?.id === e.call.id ? { ...l, result: e.result } : l)) }));
        } else if (event.type === 'probe-done') update(id, (x) => ({ ...x, lanes: x.lanes.map((l) => (l.id === event.id ? { ...l, status: 'done', score: event.score, scoreNotes: event.evidence } : l)) }));
        else if (event.type === 'composing') log(id, { kind: 'notice', text: 'Comparing the approaches…' });
      };
      try {
        const result = await runHarnessLoop({
          goal,
          files: p.files,
          makeHost: (s) => createAgentHost({ stage: s, projectName: p.name, entry: p.entry, files: s.files(), onPlan: () => {} }),
          callModel: callModelFor(target),
          system: systemPromptFor,
          k,
          mode: 'parallel',
          budget: { maxSteps: 12, maxToolCalls: 40, maxMillis: 4 * 60_000, maxFixAttempts: 3 },
          signal: controller.signal,
          onEvent,
        });
        for (const probe of result.probes) lanes.set(probe.variant.id, probe.stage);
        lanes.set('recommended', result.stage);
        const best = result.best;
        const recommended: Lane = {
          id: 'recommended',
          label: 'Recommended',
          status: 'done',
          steps: best.run.steps,
          score: best.score,
          scoreNotes: best.evidence,
          recommended: true,
          evidence: evidenceFrom(best.run, best.events, result.stage, isHarnessFile),
          files: snapshotFiles(result.stage, isHarnessFile),
          saved: result.stage.serialize(),
        };
        update(id, (x) => ({
          ...x,
          lessons: result.lessons,
          laneId: 'recommended',
          lanes: [
            recommended,
            ...x.lanes.map((l) => {
              const probe = result.probes.find((r) => r.variant.id === l.id);
              return probe ? { ...l, status: 'done' as const, evidence: evidenceFrom(probe.run, probe.events, probe.stage, isHarnessFile), files: snapshotFiles(probe.stage, isHarnessFile), saved: probe.stage.serialize() } : l;
            }),
          ],
        }));
        const summary =
          best === result.baseline
            ? `No variant beat the current setup (score ${best.score}), so its result is recommended and no harness changes are proposed.`
            : `“${best.variant.id}” scored ${best.score} against ${result.baseline.score} for the current setup. The recommendation is its result plus the harness changes that earned it.`;
        finish(id, { reason: 'finished', summary }, true);
      } catch (error) {
        finish(id, { reason: (error as Error).name === 'AbortError' ? 'aborted' : 'error', summary: (error as Error).message }, false);
      }
    },
    [finish, log, update]
  );

  const targetOrExplain = useCallback((quiet = false) => {
    const target = resolveProvider(config);
    if ('error' in target) {
      if (!quiet) notify({ kind: 'error', title: 'Choose a model first', detail: `${target.error} Open the Agent tab to pick one; free and local options are listed.` });
      return null;
    }
    if (target.provider.kind === 'server') {
      if (!quiet) notify({ kind: 'error', title: 'The agent needs your own model', detail: 'Pick a provider with a key, or a local model such as Ollama, in the Agent tab.' });
      return null;
    }
    return target;
  }, [config, notify]);

  const ask = useCallback<ProposalsValue['ask']>(
    (goal, options = {}) => {
      const text = goal.trim();
      if (!text) return null;
      const target = targetOrExplain(options.quiet);
      if (!target) return null;
      const k = options.approaches ?? prefs.approaches;
      const id = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      const proposal: Proposal = {
        id,
        goal: options.label?.trim() || text,
        createdAt: Date.now(),
        status: 'working',
        model: `${target.provider.name} · ${target.model}`,
        step: 0,
        plan: '',
        log: [{ id: ++idCounter.current, kind: 'you', text }],
        lanes: k ? [] : [{ id: 'main', label: 'Changes', status: 'running', steps: 0, files: [], saved: { edits: [], before: {} } }],
        laneId: k ? '' : 'main',
        lessons: [],
        origin: options.origin ?? 'you',
      };
      setProposals((prev) => [proposal, ...prev]);
      // Background work (the worker) opens as a tab but doesn't take the editor from you
      if (!options.background) setActiveId(id);
      if (k) void runApproaches(id, text, k, target);
      else void runSingle(id, 'main', text, target);
      return id;
    },
    [prefs.approaches, runApproaches, runSingle, targetOrExplain]
  );

  const followUp = useCallback<ProposalsValue['followUp']>(
    (id, text) => {
      const target = targetOrExplain();
      const proposal = proposals.find((p) => p.id === id);
      if (!target || !proposal || !text.trim() || proposal.status === 'working') return;
      const laneId = proposal.laneId || 'main';
      // A follow-up continues from the selected lane's work
      const lanes = stages.current.get(id) ?? new Map<string, Stage>();
      stages.current.set(id, lanes);
      if (!lanes.get(laneId)) {
        const lane = proposal.lanes.find((l) => l.id === laneId);
        if (lane) lanes.set(laneId, Stage.restore(projectRef.current.files, lane.saved));
      }
      update(id, (p) => ({ ...p, status: 'working', outcome: undefined, log: [...p.log, { id: ++idCounter.current, kind: 'you', text: text.trim() }] }));
      void runSingle(id, laneId, text.trim(), target);
    },
    [proposals, runSingle, targetOrExplain, update]
  );

  const stop = useCallback((id: string) => {
    controllers.current.get(id)?.abort();
    answers.current.get(id)?.(false);
  }, []);

  const answer = useCallback((id: string, allowed: boolean, always?: boolean) => answers.current.get(id)?.(allowed, always), []);

  /** The working copy for the selected lane, rebuilt from storage after a reload */
  const laneStage = useCallback((proposal: Proposal): Stage | null => {
    const lanes = stages.current.get(proposal.id) ?? new Map<string, Stage>();
    stages.current.set(proposal.id, lanes);
    const existing = lanes.get(proposal.laneId);
    if (existing) return existing;
    const lane = proposal.lanes.find((l) => l.id === proposal.laneId);
    if (!lane) return null;
    const restored = Stage.restore(projectRef.current.files, lane.saved);
    lanes.set(lane.id, restored);
    return restored;
  }, []);

  const accept = useCallback<ProposalsValue['accept']>(
    (id, paths) => {
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal || proposal.status === 'working') return;
      const stage = laneStage(proposal);
      if (!stage) return;
      const current = projectRef.current.files;
      const conflicts = stage.conflicts(current);
      const chosen = (paths ?? Object.keys(stage.changes())).filter((p) => !conflicts.includes(p));
      if (conflicts.length) notify({ kind: 'info', title: `${conflicts.length} file${conflicts.length > 1 ? 's' : ''} skipped`, detail: `${conflicts.join(', ')} changed since the agent started. Review them by hand.` });
      if (!chosen.length) return;
      const { files, removed } = stage.toPut(chosen);
      saveSnapshot(`Before accepting: ${proposal.goal.slice(0, 40)}`);
      dispatch({ type: 'put', files, removed });
      stage.rebase({ ...Object.fromEntries(Object.entries(current).filter(([p]) => !removed.includes(p))), ...files });
      const left = stage.size;
      update(id, (p) => ({ ...p, status: left ? p.status : 'accepted', lanes: p.lanes.map((l) => (l.id === p.laneId ? { ...l, files: snapshotFiles(stage, isHarnessFile), saved: stage.serialize() } : l)) }));
      notify({ kind: 'success', title: `Applied ${chosen.length} change${chosen.length > 1 ? 's' : ''}`, detail: 'The previous version is in History.' });
    },
    [dispatch, laneStage, notify, proposals, saveSnapshot, update]
  );

  const discard = useCallback<ProposalsValue['discard']>(
    (id, paths) => {
      const proposal = proposals.find((p) => p.id === id);
      if (!proposal) return;
      if (!paths) {
        stop(id);
        update(id, (p) => ({ ...p, status: 'discarded' }));
        return;
      }
      const stage = laneStage(proposal);
      if (!stage) return;
      paths.forEach((p) => stage.revert(p));
      update(id, (p) => ({ ...p, status: stage.size ? p.status : 'discarded', lanes: p.lanes.map((l) => (l.id === p.laneId ? { ...l, files: snapshotFiles(stage, isHarnessFile), saved: stage.serialize() } : l)) }));
    },
    [laneStage, proposals, stop, update]
  );

  const remove = useCallback(
    (id: string) => {
      stop(id);
      stages.current.delete(id);
      histories.current.delete(id);
      setProposals((prev) => prev.filter((p) => p.id !== id));
      setActiveId((current) => (current === id ? null : current));
    },
    [stop]
  );

  const selectLane = useCallback((id: string, laneId: string) => update(id, (p) => ({ ...p, laneId })), [update]);

  const open = useCallback(
    (id: string | null) => {
      if (id) update(id, (p) => (p.closed ? { ...p, closed: false } : p));
      setActiveId(id);
    },
    [update]
  );

  const close = useCallback(
    (id: string) => {
      update(id, (p) => ({ ...p, closed: true }));
      setActiveId((current) => (current === id ? null : current));
    },
    [update]
  );

  const value = useMemo<ProposalsValue>(() => {
    const active = proposals.find((p) => p.id === activeId) ?? null;
    return { proposals, activeId: active ? activeId : null, active, prefs, setPrefs, ask, followUp, stop, answer, accept, discard, remove, selectLane, open, close };
  }, [proposals, activeId, prefs, setPrefs, ask, followUp, stop, answer, accept, discard, remove, selectLane, open, close]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProposals(): ProposalsValue {
  const value = useContext(Ctx);
  if (!value) throw new Error('useProposals must be used inside ProposalsProvider');
  return value;
}

/** “3 min ago” */
export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(at).toLocaleDateString();
}

/** The selected lane of a proposal */
export const laneOf = (p: Proposal): Lane | undefined => p.lanes.find((l) => l.id === p.laneId) ?? p.lanes[0];

export { verdict };

/** Where a proposal stands, in a word, for lists */
export function stateOf(p: Proposal): { label: string; tone: string } {
  if (p.pending) return { label: 'waiting for you', tone: 'text-warn' };
  if (p.status === 'working') return { label: 'working', tone: 'text-gray-300' };
  if (p.status === 'accepted') return { label: 'accepted', tone: 'text-gray-500' };
  if (p.status === 'discarded') return { label: 'discarded', tone: 'text-gray-500' };
  const evidence = laneOf(p)?.evidence;
  const judged = evidence && verdict(evidence);
  return judged?.verified ? { label: 'verified', tone: 'text-accent' } : { label: 'review', tone: 'text-warn' };
}
