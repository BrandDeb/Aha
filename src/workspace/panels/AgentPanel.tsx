'use client';

import { useState } from 'react';
import { maxModelCalls } from '@/lib/agent/harness';
import { getProvider } from '@/lib/ai-providers';
import { useAiConfig } from '../ai-config';
import { AiModelSettings } from '../components/AiModelSettings';
import { ago, BUDGETS, laneOf, stateOf, useProposals, type AgentPrefs } from '../proposals';

/** The Agent tab: which model, how it works, and every proposal so far */
export function AgentPanel() {
  const config = useAiConfig();
  const provider = getProvider(config.provider);
  const { proposals, activeId, ask, open, remove, prefs, setPrefs } = useProposals();
  const [configuring, setConfiguring] = useState(false);
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

      {(configuring || !ready) && (
        <div className="max-h-[70%] shrink-0 overflow-y-auto border-b border-border p-4">
          <p className="mb-3 text-sm text-gray-300">The agent calls tools, so it needs a model with tool support: your own key (Anthropic, OpenAI, Gemini, Groq, OpenRouter) or a local model in Ollama.</p>
          <AiModelSettings compact onSelect={() => setConfiguring(true)} />
          {ready && <button onClick={() => setConfiguring(false)} className="btn btn-secondary btn-sm mt-3 w-full">Done</button>}
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
        <section className="space-y-2.5 border-b border-border p-4">
          <h3 className="eyebrow">How it works</h3>
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
          <label className="flex items-center gap-1.5 text-xs text-gray-400" title="When a build, run or the preview fails, the agent starts debugging it on its own: once per distinct failure, one at a time. The fix arrives as a proposal; nothing changes until you accept.">
            <input type="checkbox" checked={prefs.autoDebug} onChange={(e) => setPrefs({ autoDebug: e.target.checked })} />
            Debug failures automatically
          </label>
        </section>

        <section className="p-4">
          <h3 className="eyebrow mb-2">Proposals</h3>
          {proposals.length === 0 ? (
            <p className="text-sm text-gray-500">None yet. Ask from the bar at the top or here.</p>
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
      </div>
    </div>
  );
}
