'use client';

/**
 * The one place to ask for work: type what you want and press Enter. The
 * agent's answer arrives as a proposal tab next to your files.
 */

import { useState, type RefObject } from 'react';
import { useProposals } from '../proposals';

const IDEAS = ['Fix the build errors', 'Add tests for the entry file', 'Explain this project and suggest improvements', 'Add --help and argument validation'];

const MODES = [
  { k: 0, label: 'One try', hint: 'One run with the agent as it is' },
  { k: 2, label: 'Compare 3', hint: 'The current setup and two variations race on private copies; the best one is recommended' },
] as const;

interface Props {
  inputRef: RefObject<HTMLInputElement | null>;
  shortcut: string;
  /** No model set up yet: show where to choose one */
  onNeedModel: () => void;
}

export function CommandBar({ inputRef, shortcut, onNeedModel }: Props) {
  const { ask, proposals, open, prefs, setPrefs } = useProposals();
  const [text, setText] = useState('');
  const [focused, setFocused] = useState(false);
  const recent = proposals.slice(0, 3);
  const working = proposals.filter((p) => p.status === 'working').length;

  const submit = (goal: string) => {
    if (!goal.trim()) return;
    if (ask(goal) === null) onNeedModel();
    else {
      setText('');
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className="relative mx-auto w-full max-w-xl"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
        className={`flex h-8 items-center gap-2 rounded-lg border px-2.5 transition-colors ${focused ? 'border-[var(--accent-line)] bg-[var(--color-background)]' : 'border-border bg-white/[0.03] hover:border-border-strong'}`}
      >
        <span aria-hidden="true" className="text-accent">✦</span>
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') inputRef.current?.blur();
          }}
          placeholder="Ask the agent to build, fix or explain…"
          aria-label="Ask the agent"
          className="min-w-0 flex-1 bg-transparent text-sm text-gray-100 outline-none placeholder:text-gray-500"
        />
        {working > 0 && !focused && <span className="font-mono text-[11px] text-gray-400">{working} working</span>}
        {!focused && shortcut && <span className="kbd hidden text-[10px] sm:inline">{shortcut}</span>}
        {focused && text.trim() && <span className="kbd text-[10px]">↵</span>}
      </form>

      {focused && (
        <div className="absolute inset-x-0 top-10 z-40 space-y-3 rounded-xl border border-border-strong bg-[var(--bar)] p-3 shadow-2xl">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">Approach</span>
            <div role="radiogroup" aria-label="Approach" className="flex rounded-md border border-border p-0.5">
              {MODES.map((m) => (
                <button
                  key={m.k}
                  type="button"
                  role="radio"
                  aria-checked={prefs.approaches === m.k}
                  title={m.hint}
                  onClick={() => setPrefs({ approaches: m.k })}
                  className={`rounded px-2 py-0.5 text-xs ${prefs.approaches === m.k ? 'bg-white/[0.1] text-gray-100' : 'text-gray-400 hover:text-gray-100'}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <span className="ml-auto text-[11px] text-gray-500">Nothing changes until you accept</span>
          </div>
          {!text.trim() && (
            <div>
              <div className="eyebrow mb-1.5">Try</div>
              <div className="flex flex-wrap gap-1.5">
                {IDEAS.map((idea) => (
                  <button key={idea} type="button" onClick={() => submit(idea)} className="btn btn-secondary btn-sm">{idea}</button>
                ))}
              </div>
            </div>
          )}
          {recent.length > 0 && (
            <div>
              <div className="eyebrow mb-1">Recent proposals</div>
              <ul>
                {recent.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        open(p.id);
                        inputRef.current?.blur();
                      }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm text-gray-300 hover:bg-white/[0.05]"
                    >
                      <span className="min-w-0 flex-1 truncate">{p.goal}</span>
                      <span className="shrink-0 text-[11px] text-gray-500">{p.status === 'working' ? 'working' : p.status}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
