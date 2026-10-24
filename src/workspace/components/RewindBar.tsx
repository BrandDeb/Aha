'use client';

import { useEffect, useMemo, useState } from 'react';
import { describeMoment, findStep, firstError, momentAt } from '@/lib/live/rewind';
import type { LiveStep } from '@/lib/live/shared';

interface Props {
  steps: LiveStep[];
  at: number;
  onAt: (index: number) => void;
  /** Whether the timeline stops before the end of the run (the first 20,000 steps are kept) */
  truncated: boolean;
  sourceOf: (file: string) => string | undefined;
  onAsk: (question: string, label: string) => void;
  onClose: () => void;
}

/**
 * Rewind: scrub through the run. Each step is a line that ran; the editor shows that line and what it did,
 * and this bar shows every variable as it was at that moment. Step with ← →, jump to where a variable
 * changes, play the run back, or ask the agent about the moment.
 */
export function RewindBar({ steps, at, onAt, truncated, sourceOf, onAsk, onClose }: Props) {
  const moment = useMemo(() => momentAt(steps, at), [steps, at]);
  const [playing, setPlaying] = useState(false);
  const last = steps.length - 1;
  const crash = useMemo(() => firstError(steps), [steps]);

  useEffect(() => {
    if (!playing) return;
    // Playing: advance one step per tick; at the end it stops
    const t = setTimeout(() => (at >= last ? setPlaying(false) : onAt(at + 1)), steps.length > 400 ? 40 : 160);
    return () => clearTimeout(t);
  }, [playing, at, last, onAt, steps.length]);

  if (!moment) return null;
  const go = (i: number | null) => i !== null && onAt(Math.max(0, Math.min(last, i)));

  return (
    <section
      className="shrink-0 border-t border-border bg-[var(--bar)] px-3 py-2"
      aria-label="Rewind"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          go(at - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          go(at + 1);
        } else if (e.key === 'Escape') onClose();
      }}
    >
      <div className="flex items-center gap-2">
        <span className="eyebrow shrink-0 text-accent">Rewind</span>
        <div className="flex shrink-0 items-center" role="group" aria-label="Step through the run">
          <button onClick={() => go(0)} className="btn btn-ghost btn-sm h-7 px-1.5" aria-label="First step" title="First step">⏮</button>
          <button onClick={() => go(at - 1)} className="btn btn-ghost btn-sm h-7 px-1.5" aria-label="Previous step" title="Previous step (←)">◀</button>
          <button onClick={() => setPlaying((p) => !p)} className="btn btn-ghost btn-sm h-7 w-8 px-1.5" aria-label={playing ? 'Pause' : 'Play the run'} title={playing ? 'Pause' : 'Play the run back'}>{playing ? '❚❚' : '▶'}</button>
          <button onClick={() => go(at + 1)} className="btn btn-ghost btn-sm h-7 px-1.5" aria-label="Next step" title="Next step (→)">▶|</button>
          <button onClick={() => go(last)} className="btn btn-ghost btn-sm h-7 px-1.5" aria-label="Last step" title="Last step">⏭</button>
        </div>
        <input
          type="range"
          min={0}
          max={last}
          value={at}
          onChange={(e) => {
            setPlaying(false);
            onAt(Number(e.target.value));
          }}
          aria-label="Moment in the run"
          aria-valuetext={`Step ${at + 1} of ${steps.length}, ${moment.step.file} line ${moment.step.line}`}
          className="min-w-0 flex-1 accent-[var(--color-accent)]"
        />
        <span className="shrink-0 font-mono text-[11px] text-gray-400" aria-live="polite">
          {at + 1}/{steps.length}
          {truncated ? '+' : ''} · {moment.step.file.split('/').pop()}:{moment.step.line}
        </span>
        {crash !== null && (
          <button onClick={() => go(crash)} className="btn btn-ghost btn-sm h-7 shrink-0 text-danger" title="Jump to where it threw">
            ✕ crash
          </button>
        )}
        <button onClick={onClose} className="btn btn-ghost btn-sm h-7 shrink-0 px-1.5" aria-label="Close Rewind" title="Close (Esc)">✕</button>
      </div>

      <div className="mt-1.5 flex items-start gap-3">
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5" aria-label="Variables at this moment">
          {moment.effects.map((e) => (
            <li key={e.kind} className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] ${e.kind === 'threw' ? 'border-danger/50 text-danger' : 'border-[var(--accent-line)] text-accent'}`}>
              {e.kind === 'out' ? '→' : e.kind === 'return' ? '↩' : '✕'} {e.value}
            </li>
          ))}
          {moment.state.map((v) => (
            <li key={v.name}>
              <button
                onClick={(e) => go(findStep(steps, at, e.shiftKey ? -1 : 1, { name: v.name }) ?? findStep(steps, at, -1, { name: v.name }))}
                title={`${v.name} was set at ${v.file}:${v.line}. Click: next time it changes (Shift: previous)`}
                className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] transition-colors hover:border-border-strong ${v.changed ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-gray-100' : 'border-border text-gray-400'}`}
              >
                {v.name} = {v.value}
              </button>
            </li>
          ))}
          {!moment.state.length && !moment.effects.length && <li className="text-[11px] text-gray-500">No variables yet at this moment.</li>}
        </ul>
        <button
          onClick={() => onAsk(`${describeMoment(moment, steps.length, sourceOf(moment.step.file))}\n\nExplain what the program is doing at this moment and whether anything here looks wrong. If something is a bug, fix it and show that the run is right afterwards.`, `About step ${at + 1}: ${moment.step.file}:${moment.step.line}`)}
          className="btn btn-secondary btn-sm h-7 shrink-0"
        >
          Ask about this moment
        </button>
      </div>
    </section>
  );
}
