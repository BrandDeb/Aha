'use client';

import { AUTO_ACCEPT } from '@/lib/agent/risk';
import { VIBES } from '@/lib/agent/vibe';
import { useState } from 'react';
import { maxModelCalls } from '@/lib/agent/harness';
import { getProvider } from '@/lib/ai-providers';
import { useActions } from '../actions';
import { useAiConfig } from '../ai-config';
import { AiModelSettings } from '../components/AiModelSettings';
import { ago, BUDGETS, laneOf, stateOf, useProposals, type AgentPrefs } from '../proposals';
import { useSkillIndex } from '../skills-client';

/** The Agent tab: which model, how it works, and every proposal so far */
export function AgentPanel() {
  const actions = useActions();
  const config = useAiConfig();
  const provider = getProvider(config.provider);
  const { proposals, activeId, ask, open, remove, prefs, setPrefs } = useProposals();
  const vibeIndex = Math.max(0, VIBES.findIndex((v) => v.id === prefs.vibe));
  const vibe = VIBES[vibeIndex];
  const [configuring, setConfiguring] = useState(false);
  const skills = useSkillIndex().index?.skills.filter((s) => s.enabled) ?? [];
  const [goal, setGoal] = useState('');
  const ready = !!provider && provider.kind !== 'server';

  const submit = () => {
    if (ask(goal) !== null) setGoal('');
    else setConfiguring(true);
  };

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
            {ready ? `${provider.name} · ${config.models[provider.id] ?? provider.models[0] ?? '—'}` : 'Choose a model'} ▾
          </button>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">
          Every task becomes a proposal that opens next to your files: the plan, the diff, and evidence that it builds and runs. Nothing reaches your files until you accept it.
        </p>
      </div>

      {!ready && !configuring && (
        <div className="space-y-2 border-b border-border bg-[var(--accent-soft)]/40 p-4">
          <p className="text-sm font-medium text-gray-100">First, a model</p>
          <p className="text-xs leading-relaxed text-gray-400">The agent needs a model that can call tools. Free options work: a Google Gemini key, Groq, OpenRouter, or a local model in Ollama.</p>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => actions.openSettings('ai')} className="btn btn-primary btn-sm">See what to use, and why</button>
            <button onClick={() => setConfiguring(true)} className="btn btn-ghost btn-sm">Pick one here</button>
          </div>
        </div>
      )}
      {configuring && (
        <div className="max-h-[70%] shrink-0 overflow-y-auto border-b border-border p-4">
          <button onClick={() => actions.openSettings('ai')} className="mb-3 text-xs text-accent underline-offset-2 hover:underline">Not sure? See which model to use for which job, and why</button>
          <AiModelSettings compact onSelect={() => setConfiguring(true)} />
          <button onClick={() => setConfiguring(false)} className="btn btn-secondary btn-sm mt-3 w-full">{ready ? 'Done' : 'Close'}</button>
        </div>
      )}

      <form
        className="space-y-2 border-b border-border p-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={3}
          placeholder="What should the agent do?  (⌘/Ctrl + Enter)"
          aria-label="Goal for the agent"
          className="input min-h-[4rem] resize-none text-sm"
        />
        <button type="submit" disabled={!goal.trim()} className="btn btn-primary w-full">Start proposal</button>
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto">

        <section className="p-4">
          <h3 className="eyebrow mb-2">Proposals</h3>
          {proposals.length === 0 ? (
            <p className="text-sm text-gray-500">None yet. Describe a task above, or in the bar at the top (Ctrl/⌘ + L).</p>
          ) : (
            <ul className="space-y-1">
              {proposals.map((p) => {
                const state = stateOf(p);
                const lane = laneOf(p);
                return (
                  <li key={p.id} className={`group flex items-center gap-2 rounded-lg px-2 py-1.5 ${p.id === activeId ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]'}`}>
                    <button onClick={() => open(p.id)} className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm text-gray-100">{p.goal}</div>
                      <div className="flex gap-1.5 text-[11px] text-gray-500">
                        <span className={state.tone}>{state.label}</span>
                        {lane && lane.files.length > 0 && <span>· {lane.files.length} file{lane.files.length > 1 ? 's' : ''}</span>}
                        <span>· {ago(p.createdAt)}</span>
                      </div>
                    </button>
                    <button onClick={() => remove(p.id)} className="text-xs text-gray-600 opacity-0 hover:text-gray-100 group-hover:opacity-100 focus:opacity-100" aria-label={`Delete proposal ${p.goal}`}>✕</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="space-y-1.5 border-t border-border px-4 py-3" aria-label="Vibe">
          <div className="flex items-baseline justify-between gap-2">
            <label htmlFor="vibe-dial" className="eyebrow">Vibe</label>
            <span className="text-xs text-gray-200">{vibe.label}</span>
          </div>
          <input
            id="vibe-dial"
            type="range"
            min={0}
            max={VIBES.length - 1}
            step={1}
            value={vibeIndex}
            onChange={(e) => setPrefs({ vibe: VIBES[Number(e.target.value)].id })}
            aria-valuetext={vibe.label}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-gray-500" aria-hidden="true">
            <span>Just make it work</span>
            <span>Explain every line</span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">{vibe.detail}</p>
        </section>
        <details className="group border-t border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs text-gray-400 hover:text-gray-100">
            <span className="eyebrow whitespace-nowrap">How it works</span>
            <span className="truncate pl-3 font-mono text-[11px] text-gray-500">{BUDGETS[prefs.budget].label.split(' ·')[0]} · {prefs.approaches ? `compare ${prefs.approaches + 1}` : 'one try'}{prefs.review ? ' · reviewed' : ''} <span className="inline-block transition-transform group-open:rotate-90" aria-hidden="true">›</span></span>
          </summary>
          <div className="space-y-2.5 px-4 pb-4">
          <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
            Budget
            <select value={prefs.budget} onChange={(e) => setPrefs({ budget: e.target.value as AgentPrefs['budget'] })} className="input h-7 w-auto text-xs">
              {Object.entries(BUDGETS).map(([id, b]) => <option key={id} value={id}>{b.label}</option>)}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-gray-400" title="Run the task with the agent as it is and with variations of its instructions on private copies, score them by whether builds and runs pass, and recommend the best.">
            Approaches
            <select value={prefs.approaches} onChange={(e) => setPrefs({ approaches: Number(e.target.value) })} className="input h-7 w-auto text-xs">
              <option value={0}>One try</option>
              {[1, 2, 3].map((n) => <option key={n} value={n}>Compare {n + 1}</option>)}
            </select>
          </label>
          {prefs.approaches > 0 && <p className="text-[11px] leading-relaxed text-gray-500">Up to {maxModelCalls(prefs.approaches, { maxSteps: 12 })} model calls per task. Compared approaches can build but never run commands.</p>}
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="Python and package commands run on this machine. Off means you are asked each time.">
            <input type="checkbox" checked={prefs.trustCommands} onChange={(e) => setPrefs({ trustCommands: e.target.checked })} />
            Run commands without asking
          </label>
          <p className="text-xs text-gray-400" title={skills.map((s) => s.name).join(', ')}>
            {skills.length} skills · it loads one when a task calls for it, or type <span className="font-mono text-gray-300">/name</span>. Add from GitHub or write your own in Settings → Skills.
          </p>
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="When a build, run or the preview fails, the agent starts debugging it on its own: once per distinct failure, one at a time. The fix arrives as a proposal; nothing changes until you accept.">
            <input type="checkbox" checked={prefs.autoDebug} onChange={(e) => setPrefs({ autoDebug: e.target.checked })} />
            Debug failures automatically
          </label>
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="When the agent finishes, a second reviewer reads the change cold (the goal, the diff, the evidence and your contracts) and lists what it would fix. Uses the same model; one extra call per proposal.">
            <input type="checkbox" checked={prefs.review} onChange={(e) => setPrefs({ review: e.target.checked })} />
            Second reviewer on every proposal
          </label>
          <label className="flex items-center justify-between gap-2 text-xs text-gray-400" title="Accept finished proposals by themselves when they are verified, score at or under this risk, and touch nothing sensitive (secrets, CI, auth, database schema, contracts, removed tests). Each one is saved to History first and announced, so it can be undone.">
            Auto-accept
            <select value={prefs.autoAccept} onChange={(e) => setPrefs({ autoAccept: Number(e.target.value) })} className="input h-7 w-auto text-xs">
              {AUTO_ACCEPT.map((o) => <option key={o.value} value={o.value} title={o.detail}>{o.label}</option>)}
            </select>
          </label>
          </div>
        </details>
      </div>
    </div>
  );
}
