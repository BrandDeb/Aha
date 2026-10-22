'use client';

import { useEffect, useRef, useState } from 'react';
import { maxModelCalls, runHarnessLoop, type HarnessEvent } from '@/lib/agent/harness';
import { runAgent } from '@/lib/agent/loop';
import { callModelFor } from '@/lib/agent/model';
import { systemPromptFor } from '@/lib/agent/prompt';
import { Stage } from '@/lib/agent/stage';
import { workspaceTools } from '@/lib/agent/tools';
import { DEFAULT_BUDGET, type AgentEvent, type Budget, type Message, type Risk, type StopReason, type ToolCall, type ToolResult } from '@/lib/agent/types';
import { getProvider, resolveProvider } from '@/lib/ai-providers';
import { useActions } from '../actions';
import { createAgentHost } from '../agent-host';
import { useAiConfig } from '../ai-config';
import { AiModelSettings } from '../components/AiModelSettings';
import { buildConnectorTools } from '../connectors-client';
import { getConnectors } from '../connectors-config';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

interface Entry {
  id: number;
  kind: 'text' | 'tool' | 'notice';
  text?: string;
  call?: ToolCall;
  risk?: Risk;
  result?: ToolResult;
  approved?: boolean;
}

interface Approach {
  id: string;
  status: 'running' | 'done';
  score?: number;
  evidence?: string[];
  steps: number;
}

interface ChangeRow {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  added: number;
  removed: number;
}

const BUDGETS: Record<string, { label: string; budget: Partial<Budget> }> = {
  quick: { label: 'Quick · 10 steps', budget: { maxSteps: 10, maxToolCalls: 30, maxMillis: 3 * 60_000, maxFixAttempts: 2 } },
  standard: { label: 'Standard · 25 steps', budget: DEFAULT_BUDGET },
  long: { label: 'Long · 60 steps', budget: { maxSteps: 60, maxToolCalls: 200, maxMillis: 25 * 60_000, maxFixAttempts: 6 } },
};

const IDEAS = ['Fix the build errors', 'Add tests for the entry file', 'Explain this project and suggest improvements', 'Add --help and argument validation'];

const OUTCOME: Record<StopReason, { label: string; tone: string }> = {
  finished: { label: 'Finished', tone: 'text-accent' },
  budget: { label: 'Stopped: budget used', tone: 'text-warn' },
  stuck: { label: 'Stopped: going in circles', tone: 'text-warn' },
  aborted: { label: 'Stopped', tone: 'text-gray-400' },
  declined: { label: 'Declined by the model', tone: 'text-warn' },
  error: { label: 'Failed', tone: 'text-danger' },
};

/** The one thing worth showing about a call: the path, query or first argument */
function summarize(call: ToolCall): string {
  const args = call.args;
  const main = args.path ?? args.query ?? args.entry ?? args.action ?? args.steps ?? Object.values(args).find((v) => typeof v === 'string');
  const text = typeof main === 'string' ? main.replace(/\s+/g, ' ').trim() : '';
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function rowsOf(stage: Stage): ChangeRow[] {
  return Object.entries(stage.changes())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, kind]) => {
      const { added, removed } = stage.diff(path);
      return { path, kind, added, removed };
    });
}

export function AgentPanel() {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const actions = useActions();
  const { notify } = useToast();
  const config = useAiConfig();
  const provider = getProvider(config.provider);

  const [goal, setGoal] = useState('');
  const [budgetId, setBudgetId] = useState('standard');
  const [trustCommands, setTrustCommands] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [running, setRunning] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [plan, setPlan] = useState('');
  const [step, setStep] = useState(0);
  const [outcome, setOutcome] = useState<{ reason: StopReason; summary: string } | null>(null);
  const [changes, setChanges] = useState<ChangeRow[]>([]);
  const [pending, setPending] = useState<{ call: ToolCall; risk: Risk } | null>(null);
  // Try several approaches (Harness²-style): the agent runs the task with variations of its own instructions and keeps what worked
  const [compare, setCompare] = useState(false);
  const [variants, setVariants] = useState(2);
  const [approaches, setApproaches] = useState<Approach[]>([]);
  const [lessons, setLessons] = useState<string[]>([]);

  const stageRef = useRef<Stage | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const answerRef = useRef<((allowed: boolean, always?: boolean) => void) | null>(null);
  const historyRef = useRef<Message[]>([]);
  const idRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries, pending, outcome]);

  // Leaving the panel mid-run must not leave a model call or a question hanging
  useEffect(() => () => abortRef.current?.abort(), []);

  const handleEvent = (event: AgentEvent) => {
    if (event.type === 'step') setStep(event.step);
    else if (event.type === 'text') setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'text', text: event.text }]);
    else if (event.type === 'notice') setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'notice', text: event.text }]);
    else if (event.type === 'tool') setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'tool', call: event.call, risk: event.risk }]);
    else if (event.type === 'approval') setEntries((prev) => prev.map((e) => (e.call?.id === event.call.id ? { ...e, approved: event.approved } : e)));
    else if (event.type === 'result') {
      setEntries((prev) => prev.map((e) => (e.call?.id === event.call.id ? { ...e, result: event.result } : e)));
      if (stageRef.current) setChanges(rowsOf(stageRef.current));
    } else if (event.type === 'done') setOutcome({ reason: event.reason, summary: event.summary });
  };

  const handleHarnessEvent = (event: HarnessEvent) => {
    if (event.type === 'notice') setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'notice', text: event.text }]);
    else if (event.type === 'probe-start') setApproaches((prev) => [...prev, { id: event.id, status: 'running', steps: 0 }]);
    else if (event.type === 'probe-step' && event.event.type === 'step') setApproaches((prev) => prev.map((a) => (a.id === event.id ? { ...a, steps: event.event.type === 'step' ? event.event.step : a.steps } : a)));
    else if (event.type === 'probe-done') setApproaches((prev) => prev.map((a) => (a.id === event.id ? { ...a, status: 'done', score: event.score, evidence: event.evidence } : a)));
  };

  /** Run the task once per harness variant on private copies, then offer the best result and the harness changes that earned it */
  const startCompare = async (task: string, target: Exclude<ReturnType<typeof resolveProvider>, { error: string }>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setOutcome(null);
    setApproaches([]);
    setLessons([]);
    setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'text', text: `**You:** ${task}` }]);
    setGoal('');
    const files = stageRef.current ? { ...project.files } : project.files;
    try {
      const result = await runHarnessLoop({
        goal: task,
        files,
        makeHost: (probeStage) => createAgentHost({ stage: probeStage, projectName: project.name, entry: project.entry, files: probeStage.files(), onPlan: () => {} }),
        callModel: callModelFor(target),
        system: systemPromptFor,
        k: variants,
        mode: 'parallel',
        budget: { maxSteps: 12, maxToolCalls: 40, maxMillis: 4 * 60_000, maxFixAttempts: 3 },
        signal: controller.signal,
        onEvent: handleHarnessEvent,
      });
      stageRef.current = result.stage;
      setChanges(rowsOf(result.stage));
      setLessons(result.lessons);
      const baseline = result.baseline;
      setOutcome({
        reason: 'finished',
        summary:
          result.best === baseline
            ? `None of the variants beat the current harness (baseline ${baseline.score}), so its result is shown and no harness changes are proposed.`
            : `“${result.best.variant.id}” scored ${result.best.score} against ${baseline.score} for the current harness. Its result and the harness changes that earned it are listed below; nothing is applied until you accept.`,
      });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setOutcome({ reason: 'error', summary: (error as Error).message });
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const start = async (text: string) => {
    const task = text.trim();
    if (!task || running) return;
    const target = resolveProvider(config);
    if ('error' in target) {
      notify({ kind: 'error', title: 'Choose a model first', detail: target.error });
      setConfiguring(true);
      return;
    }
    if (target.provider.kind === 'server') {
      notify({ kind: 'error', title: 'The agent needs your own model', detail: 'Pick a provider with a key, or a local model such as Ollama, in the model settings.' });
      setConfiguring(true);
      return;
    }

    // A fresh proposal on top of the project as it is now, keeping any edits still waiting for review
    const stage = stageRef.current ?? new Stage(project.files);
    stage.rebase(project.files);
    stageRef.current = stage;
    if (compare) {
      await startCompare(task, target);
      return;
    }
    const host = createAgentHost({ stage, projectName: project.name, entry: project.entry, files: stage.files(), onPlan: setPlan });

    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setOutcome(null);
    setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'text', text: `**You:** ${task}` }]);
    setGoal('');
    // Tools the user said to allow for the rest of this run
    const trustedTools = new Set<string>();
    const notice = (text: string) => setEntries((prev) => [...prev, { id: ++idRef.current, kind: 'notice', text }]);

    try {
      const connected = await buildConnectorTools(getConnectors(), controller.signal);
      if (connected.connected.length) notice(`Connected: ${connected.connected.map((c) => `${c.name} (${c.tools} tool${c.tools === 1 ? '' : 's'})`).join(', ')}`);
      for (const failure of connected.failed) notice(`${failure.name} is not available: ${failure.error}`);

      const result = await runAgent({
        goal: task,
        system: systemPromptFor(stage.files()),
        tools: [...workspaceTools(host), ...connected.tools],
        callModel: callModelFor(target),
        budget: BUDGETS[budgetId].budget,
        autoApprove: trustCommands ? ['read', 'stage', 'build', 'exec'] : ['read', 'stage', 'build'],
        history: historyRef.current,
        signal: controller.signal,
        onEvent: handleEvent,
        approve: (call, spec) =>
          trustedTools.has(call.name)
            ? Promise.resolve(true)
            : new Promise<boolean>((resolve) => {
            setPending({ call, risk: spec.risk });
            answerRef.current = (allowed, always) => {
              if (always) trustedTools.add(call.name);
              setPending(null);
              answerRef.current = null;
              resolve(allowed);
            };
          }),
      });
      historyRef.current = result.messages;
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setOutcome({ reason: 'error', summary: (error as Error).message });
    } finally {
      setRunning(false);
      setPending(null);
      answerRef.current?.(false);
      abortRef.current = null;
      if (stageRef.current) setChanges(rowsOf(stageRef.current));
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    answerRef.current?.(false);
  };

  const accept = (only?: string[]) => {
    const stage = stageRef.current;
    if (!stage) return;
    const conflicts = stage.conflicts(project.files);
    const chosen = (only ?? changes.map((c) => c.path)).filter((p) => !conflicts.includes(p));
    if (conflicts.length) {
      notify({ kind: 'info', title: `${conflicts.length} file${conflicts.length > 1 ? 's' : ''} skipped`, detail: `${conflicts.join(', ')} changed while the agent worked. Review them by hand.` });
    }
    if (!chosen.length) return;
    const { files, removed } = stage.toPut(chosen);
    saveSnapshot('Before agent changes');
    dispatch({ type: 'put', files, removed });
    stage.rebase({ ...Object.fromEntries(Object.entries(project.files).filter(([p]) => !removed.includes(p))), ...files });
    setChanges(rowsOf(stage));
    notify({ kind: 'success', title: `Applied ${chosen.length} change${chosen.length > 1 ? 's' : ''}`, detail: 'The previous version is in History.' });
  };

  const discard = (paths?: string[]) => {
    const stage = stageRef.current;
    if (!stage) return;
    if (paths) paths.forEach((p) => stage.revert(p));
    else stage.clear();
    setChanges(rowsOf(stage));
  };

  const review = (path: string) => {
    const stage = stageRef.current;
    if (!stage) return;
    const { before, after } = stage.diff(path);
    actions.showDiff({ title: `Agent: ${path}`, path, original: before, modified: after });
  };

  const reset = () => {
    historyRef.current = [];
    setApproaches([]);
    setLessons([]);
    setEntries([]);
    setPlan('');
    setOutcome(null);
    setStep(0);
  };

  const budget = BUDGETS[budgetId].budget as Budget;
  const lastText = [...entries].reverse().find((e) => e.kind === 'text')?.text;
  const outcomeInfo = outcome && OUTCOME[outcome.reason];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="eyebrow">Agent</h3>
          <button
            onClick={() => setConfiguring((v) => !v)}
            aria-expanded={configuring}
            className="max-w-[60%] truncate rounded-md px-1.5 py-0.5 font-mono text-[11px] text-gray-400 hover:bg-white/[0.07] hover:text-gray-100"
            title="Choose provider and model"
          >
            {provider && provider.kind !== 'server' ? `${provider.name} · ${config.models[provider.id] ?? provider.models[0] ?? '—'}` : 'Choose a model'} ▾
          </button>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          Give it a goal. It reads your project, edits a private copy, builds to check its work and retries within a budget.
          Nothing reaches your files until you accept it.
        </p>
      </div>

      {(configuring || !provider || provider.kind === 'server') && (
        <div className="max-h-[70%] shrink-0 overflow-y-auto border-b border-border p-4">
          <p className="mb-3 text-sm text-gray-300">The agent calls tools, so it needs a model with tool support: your own key (Anthropic, OpenAI, Gemini, Groq, OpenRouter) or a local model in Ollama.</p>
          <AiModelSettings compact onSelect={() => setConfiguring(true)} />
          {provider && provider.kind !== 'server' && <button onClick={() => setConfiguring(false)} className="btn btn-secondary btn-sm mt-3 w-full">Done</button>}
        </div>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {entries.length === 0 && !running && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">Try one of these, or describe your own task:</p>
            <div className="flex flex-wrap gap-1.5">
              {IDEAS.map((idea) => (
                <button key={idea} onClick={() => setGoal(idea)} className="btn btn-secondary btn-sm">{idea}</button>
              ))}
            </div>
          </div>
        )}

        {plan && (
          <div className="rounded-xl border border-border p-3">
            <div className="eyebrow mb-1.5">Plan</div>
            <ul className="space-y-1 text-sm text-gray-300">
              {plan.split('\n').filter((l) => l.trim()).map((line, i) => {
                const done = /^\s*[-*]\s*\[[xX]\]/.test(line);
                return (
                  <li key={i} className={done ? 'text-gray-500 line-through' : undefined}>
                    <span aria-hidden="true" className="mr-1.5 font-mono text-xs">{done ? '✓' : '○'}</span>
                    {line.replace(/^\s*[-*]\s*(\[[ xX]\])?\s*/, '')}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {entries.map((entry) =>
          entry.kind === 'text' ? (
            <p key={entry.id} className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{entry.text?.replace(/\*\*/g, '')}</p>
          ) : entry.kind === 'notice' ? (
            <p key={entry.id} className="text-xs text-gray-500">{entry.text}</p>
          ) : (
            <details key={entry.id} className="group rounded-lg border border-border bg-white/[0.02] text-sm">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 marker:hidden">
                <span
                  aria-label={entry.result ? (entry.result.ok ? 'succeeded' : 'failed') : 'running'}
                  className={`h-2 w-2 shrink-0 rounded-full ${entry.result ? (entry.result.ok ? 'bg-accent' : 'bg-danger') : 'animate-pulse bg-gray-500'}`}
                />
                <span className="font-mono text-xs text-gray-100">{entry.call?.name}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-500">{entry.call && summarize(entry.call)}</span>
                {entry.approved === false && <span className="badge px-1.5 py-0 text-[10px]">declined</span>}
              </summary>
              {entry.result && <pre className="max-h-56 overflow-auto border-t border-border px-3 py-2 font-mono text-[11px] leading-relaxed text-gray-400">{entry.result.content}</pre>}
            </details>
          )
        )}

        {pending && (
          <div role="alertdialog" aria-label="Allow this action?" className="space-y-2 rounded-xl border border-[var(--accent-line)] bg-[var(--accent-soft)] p-3">
            <div className="text-sm font-medium text-gray-100">
              {pending.risk === 'exec' ? 'The agent wants to run a command on this machine' : 'The agent wants to use a connector'}
            </div>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-black/30 p-2 font-mono text-xs text-gray-200">{pending.call.name} {JSON.stringify(pending.call.args, null, 1)}</pre>
            <div className="flex flex-wrap gap-1.5">
              <button className="btn btn-primary btn-sm" onClick={() => answerRef.current?.(true)}>Allow once</button>
              <button className="btn btn-secondary btn-sm" onClick={() => answerRef.current?.(true, true)}>Allow {pending.call.name.length > 18 ? 'this tool' : pending.call.name} this run</button>
              <button className="btn btn-ghost btn-sm" onClick={() => answerRef.current?.(false)}>Decline</button>
            </div>
          </div>
        )}

        {running && !pending && (
          <p className="flex items-center gap-2 text-sm text-gray-500">
            <span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-100" aria-hidden="true" />
            Working · step {step} of {budget.maxSteps}
          </p>
        )}

        {outcome && outcomeInfo && (
          <div className="space-y-1.5 rounded-xl border border-border p-3">
            <div className={`text-xs font-medium ${outcomeInfo.tone}`}>{outcomeInfo.label}{step ? ` · ${step} step${step > 1 ? 's' : ''}` : ''}</div>
            {outcome.summary !== lastText && <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{outcome.summary}</p>}
          </div>
        )}

        {approaches.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border p-3">
            <div className="eyebrow">Approaches tried</div>
            <ul className="space-y-1.5">
              {approaches.map((a) => (
                <li key={a.id} className="text-xs">
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono text-gray-100">{a.id === 'baseline' ? 'current harness' : a.id}</span>
                    {a.status === 'running' ? <span className="text-gray-500">step {a.steps}…</span> : <span className="font-mono text-accent">{a.score}/100</span>}
                  </div>
                  {a.evidence && <div className="text-[11px] text-gray-500">{a.evidence.join(' · ')}</div>}
                </li>
              ))}
            </ul>
            {lessons.length > 0 && (
              <div className="border-t border-border pt-2 text-xs text-gray-300">
                <div className="eyebrow mb-1">Lessons proposed for agent/lessons.md</div>
                <ul className="list-disc space-y-0.5 pl-4">{lessons.map((l, i) => <li key={i}>{l}</li>)}</ul>
              </div>
            )}
          </div>
        )}

        {changes.length > 0 && (
          <div className="rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border px-3 py-2">
              <span className="eyebrow whitespace-nowrap">Changes · {changes.length}</span>
              <div className="flex gap-1">
                <button className="btn btn-primary btn-sm h-7" disabled={running} onClick={() => accept()}>Accept all</button>
                <button className="btn btn-ghost btn-sm h-7" disabled={running} onClick={() => discard()}>Discard</button>
              </div>
            </div>
            <ul className="divide-y divide-border">
              {changes.map((row) => (
                <li key={row.path} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                  <span className={`w-12 shrink-0 font-mono ${row.kind === 'deleted' ? 'text-danger' : row.kind === 'added' ? 'text-accent' : 'text-gray-400'}`}>{row.kind}</span>
                  <button className="min-w-0 flex-1 truncate text-left font-mono text-gray-100 hover:underline" onClick={() => review(row.path)} title="Review the diff">{row.path}</button>
                  <span className="shrink-0 font-mono text-gray-500">+{row.added} −{row.removed}</span>
                  <button className="btn btn-ghost btn-sm h-6 px-1.5 text-[11px]" disabled={running} onClick={() => accept([row.path])}>Accept</button>
                  <button className="btn btn-ghost btn-sm h-6 px-1.5 text-[11px]" disabled={running} onClick={() => discard([row.path])}>Reject</button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <form
        className="space-y-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void start(goal);
        }}
      >
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void start(goal);
            }
          }}
          rows={3}
          placeholder="What should the agent do?  (⌘/Ctrl + Enter to run)"
          aria-label="Goal for the agent"
          disabled={running}
          className="input min-h-[4rem] resize-none text-sm"
        />
        <div className="flex items-center gap-2">
          <select value={budgetId} onChange={(e) => setBudgetId(e.target.value)} disabled={running} className="input h-8 min-w-0 flex-1 text-xs" aria-label="Budget">
            {Object.entries(BUDGETS).map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
          </select>
          {running ? (
            <button type="button" onClick={stop} className="btn btn-secondary">Stop</button>
          ) : (
            <button type="submit" disabled={!goal.trim()} className="btn btn-primary">Run agent</button>
          )}
        </div>
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="Run the task with the agent as it is and with variations of its instructions on private copies, score them by whether builds and runs pass, and keep what worked. Costs several runs.">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} disabled={running} />
            Try several approaches
            {compare && (
              <select value={variants} onChange={(e) => setVariants(Number(e.target.value))} disabled={running} className="input ml-1 h-6 w-auto px-1 text-xs" aria-label="Number of variants">
                {[1, 2, 3].map((n) => <option key={n} value={n}>{n} variant{n > 1 ? 's' : ''}</option>)}
              </select>
            )}
          </label>
          {compare && <p className="text-[11px] leading-relaxed text-gray-500">Runs the task {variants + 1} times (the current setup plus {variants}), up to {maxModelCalls(variants, { maxSteps: 12 })} model calls. Probes can build but never run commands.</p>}
        </div>
        <div className="flex items-center justify-between gap-2">
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="Python and package commands run on this machine. Off means you are asked each time.">
            <input type="checkbox" checked={trustCommands} onChange={(e) => setTrustCommands(e.target.checked)} disabled={running} />
            Run commands without asking
          </label>
          {(entries.length > 0 || outcome) && !running && <button type="button" onClick={reset} className="text-xs text-gray-500 hover:text-gray-100">New task</button>}
        </div>
      </form>
    </div>
  );
}
