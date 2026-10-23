'use client';

import { useState } from 'react';
import { ago, laneOf, stateOf, useProposals } from '../proposals';
import type { WorkerHandle, WorkerMode, WorkerStatus } from '../worker';

const MODES: { id: WorkerMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'The worker does nothing.' },
  { id: 'suggest', label: 'Suggest', hint: 'It keeps a ranked list of what to do next; you start each task.' },
  { id: 'auto', label: 'Autonomous', hint: 'It takes the next task whenever you pause typing, one at a time, in the background.' },
];

const KIND: Record<string, string> = { failure: 'Fix', problem: 'Errors', focus: 'Goal', improve: 'Learn', todo: 'TODO', tests: 'Tests' };

function describe(status: WorkerStatus): { text: string; tone: string } {
  switch (status.kind) {
    case 'off':
      return { text: 'Off', tone: 'text-gray-500' };
    case 'suggesting':
      return { text: 'Suggesting: start a task below', tone: 'text-gray-300' };
    case 'idle':
      return { text: 'Watching: it starts when you pause', tone: 'text-accent' };
    case 'working':
      return { text: `Working on: ${status.proposal.goal.replace(/^Worker · /, '')}`, tone: 'text-gray-100' };
    case 'waiting-for-you':
      return { text: status.reason, tone: 'text-warn' };
    case 'paused':
      return { text: `Paused: ${status.reason}`, tone: 'text-warn' };
  }
}

/** The Worker tab: an AI teammate that codes alongside you */
export function WorkerPanel({ worker }: { worker: WorkerHandle }) {
  const { open } = useProposals();
  const { settings, setSettings, status, queue, results } = worker;
  const [focus, setFocus] = useState(settings.focus);
  const state = describe(status);
  const working = status.kind === 'working' || status.kind === 'waiting-for-you';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <h3 className="eyebrow">Worker</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          An AI teammate that codes alongside you: it fixes what breaks, clears editor errors, resolves your TODOs, adds missing tests, and takes the next step toward your goal. Each task runs on a private copy and arrives as a proposal with evidence. Nothing reaches your files until you accept it.
        </p>
        <div role="radiogroup" aria-label="Worker mode" className="grid grid-cols-3 gap-1 rounded-lg border border-border p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              role="radio"
              aria-checked={settings.mode === m.id}
              onClick={() => setSettings({ mode: m.id })}
              title={m.hint}
              className={`h-7 rounded-md text-xs ${settings.mode === m.id ? 'bg-white/[0.1] text-gray-100' : 'text-gray-400 hover:text-gray-100'}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p role="status" className={`flex items-center gap-1.5 text-xs ${state.tone}`}>
          {working && <span className="dot animate-pulse" aria-hidden="true" />}
          <span className="min-w-0 truncate">{state.text}</span>
          {status.kind === 'working' && <button onClick={() => open(status.proposal.id)} className="ml-auto shrink-0 underline decoration-dotted underline-offset-2 hover:text-gray-100">Watch</button>}
          {status.kind === 'waiting-for-you' && results[0] && <button onClick={() => open((results.find((p) => p.pending) ?? results.find((p) => p.status === 'review') ?? results[0]).id)} className="btn btn-primary btn-sm ml-auto h-6 shrink-0">Review</button>}
          {status.kind === 'paused' && <button onClick={worker.resume} className="btn btn-secondary btn-sm ml-auto h-6 shrink-0">Resume</button>}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {settings.mode !== 'off' && (
          <section className="space-y-2.5 border-b border-border p-4">
            <label className="block space-y-1.5">
              <span className="eyebrow">What are you building?</span>
              <textarea
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                onBlur={() => focus !== settings.focus && setSettings({ focus })}
                rows={2}
                placeholder="e.g. a CLI that totals a shopping cart from a JSON file. The worker takes the next step toward it."
                className="input min-h-[3rem] resize-none text-sm"
              />
            </label>
            <div className="flex gap-2">
              <label className="flex flex-1 items-center justify-between gap-2 text-xs text-gray-400" title="Best: each task races the agent as it is against variations of its instructions and recommends whichever came out verified. Slower, more model calls.">
                Quality
                <select value={settings.quality} onChange={(e) => setSettings({ quality: e.target.value as 'fast' | 'best' })} className="input h-7 w-auto text-xs">
                  <option value="fast">Fast</option>
                  <option value="best">Best of 3</option>
                </select>
              </label>
              <label className="flex flex-1 items-center justify-between gap-2 text-xs text-gray-400" title="How many tasks it may start on its own in an hour">
                Per hour
                <select value={settings.perHour} onChange={(e) => setSettings({ perHour: Number(e.target.value) })} className="input h-7 w-auto text-xs">
                  {[2, 4, 6, 12, 30].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {settings.mode === 'auto' && <p className="text-[11px] text-gray-500">{worker.budgetLeft} of {settings.perHour} tasks left this hour. It waits while you type, waits for you once three results need review, and stops after three unverified ones.</p>}
          </section>
        )}

        {settings.mode !== 'off' && (
          <section className="border-b border-border p-4">
            <h3 className="eyebrow mb-2">Next up</h3>
            {queue.length === 0 ? (
              <p className="text-sm text-gray-500">Nothing to do right now. Tell it what you are building, leave a TODO, or keep coding.</p>
            ) : (
              <ol className="space-y-1" aria-label="Worker queue">
                {queue.slice(0, 8).map((task, i) => (
                  <li key={task.key} className="group flex items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                    <span className="mt-0.5 w-11 shrink-0 rounded bg-white/[0.06] px-1 text-center font-mono text-[10px] uppercase text-gray-400">{KIND[task.kind]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-gray-100" title={task.title}>{task.title}</div>
                      <div className="truncate text-[11px] text-gray-500">{task.reason}</div>
                    </div>
                    <button onClick={() => worker.start(task)} disabled={working} className={`btn btn-sm h-6 shrink-0 ${i === 0 ? 'btn-primary' : 'btn-secondary'}`} title={working ? 'One task at a time' : 'Start this task now'}>
                      Do it
                    </button>
                    <button onClick={() => worker.skip(task)} className="mt-0.5 shrink-0 text-xs text-gray-600 hover:text-gray-100" aria-label={`Skip ${task.title}`} title="Skip">✕</button>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <section className="p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2">
            <h3 className="eyebrow">Its work</h3>
            {worker.record.total > 0 && (
              <span className="font-mono text-[11px] text-gray-500" title="The agent's results in this project (all proposals): how many verified, and what you did with them. When they slip, the worker proposes improving how the agent works here.">
                {worker.record.verified}/{worker.record.total} verified · {worker.record.accepted} accepted · {worker.record.discarded} discarded
              </span>
            )}
          </div>
          {results.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing yet.</p>
          ) : (
            <ul className="space-y-1">
              {results.map((p) => {
                const s = stateOf(p);
                const lane = laneOf(p);
                return (
                  <li key={p.id}>
                    <button onClick={() => open(p.id)} className="w-full rounded-lg px-2 py-1.5 text-left hover:bg-white/[0.04]">
                      <div className="truncate text-sm text-gray-100">{p.goal.replace(/^Worker · /, '')}</div>
                      <div className="flex gap-1.5 text-[11px] text-gray-500">
                        <span className={s.tone}>{s.label}</span>
                        {lane && lane.files.length > 0 && <span>· {lane.files.length} file{lane.files.length > 1 ? 's' : ''}</span>}
                        <span>· {ago(p.createdAt)}</span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
