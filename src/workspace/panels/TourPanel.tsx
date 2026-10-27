'use client';

import { useMemo, useState } from 'react';
import { buildTour } from '@/lib/tour';
import { MEMORY_FILE, parseMemory, type MemoryKind } from '@/lib/memory';
import { parseWhy, WHY_FILE } from '@/lib/why';
import { useWorkspace } from '../store';

const KIND_LABEL: Record<MemoryKind, string> = { decision: 'Decisions', convention: 'Conventions', gotcha: 'Gotchas' };

/** Code spans in a stop's text (`name`) */
function Text({ text }: { text: string }) {
  return (
    <>
      {text.split(/(`[^`]+`)/).map((part, i) =>
        part.startsWith('`') && part.endsWith('`') ? (
          <code key={i} className="rounded bg-white/[0.06] px-1 font-mono text-[11px] text-gray-200">{part.slice(1, -1)}</code>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

/** Five stops through the codebase for someone new to it, and what the project remembers */
export function TourPanel({ onOpen }: { onOpen: (file: string, line: number) => void }) {
  const { project } = useWorkspace();
  const tour = useMemo(() => buildTour(project.files, project.entry, parseWhy(project.files[WHY_FILE])), [project.files, project.entry]);
  const memory = useMemo(() => parseMemory(project.files[MEMORY_FILE]), [project.files]);
  const [at, setAt] = useState<number | null>(null);
  const current = at === null ? null : tour[Math.min(at, tour.length - 1)];

  const go = (i: number) => {
    const stop = tour[i];
    if (!stop) return;
    setAt(i);
    onOpen(stop.file, stop.line);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <h3 className="eyebrow">Tour</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          New to this project? {tour.length ? `${tour.length} stops` : 'A few stops'} through it, from where it starts to how to check a change, built from how the files import each other and why they were changed.
        </p>
        {tour.length > 0 && (
          <div className="flex items-center gap-1.5">
            {at === null ? (
              <button onClick={() => go(0)} className="btn btn-primary btn-sm">Start the tour</button>
            ) : (
              <>
                <button onClick={() => go(at - 1)} disabled={at === 0} className="btn btn-ghost btn-sm">Back</button>
                <button onClick={() => go(at + 1)} disabled={at >= tour.length - 1} className="btn btn-secondary btn-sm">Next stop</button>
                <span className="text-[11px] text-gray-500" aria-live="polite">Stop {at + 1} of {tour.length}</span>
              </>
            )}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4">
        {tour.length === 0 ? (
          <p className="text-xs text-gray-500">Nothing to tour yet: add some code.</p>
        ) : (
          <ol className="space-y-2" aria-label="Tour stops">
            {tour.map((stop, i) => (
              <li key={stop.file}>
                <button onClick={() => go(i)} aria-current={current === stop ? 'step' : undefined} className={`w-full rounded-lg border p-2.5 text-left transition-colors ${current === stop ? 'border-accent/50 bg-accent/[0.06]' : 'border-border hover:bg-white/[0.03]'}`}>
                  <span className="flex items-baseline gap-2">
                    <span className="text-[11px] text-gray-500">{i + 1}</span>
                    <span className="text-sm text-gray-100">{stop.title}</span>
                    <span className="ml-auto truncate font-mono text-[11px] text-gray-500">{stop.file}</span>
                  </span>
                  {current === stop && (
                    <span className="mt-1.5 block space-y-1 pl-4 text-xs leading-relaxed text-gray-400">
                      {stop.points.map((p, j) => (
                        <span key={j} className="block">
                          <Text text={p} />
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ol>
        )}

        <section aria-label="Project memory" className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs text-gray-300">What the project remembers</h4>
            {memory.length > 0 && <button onClick={() => onOpen(MEMORY_FILE, 1)} className="text-[11px] text-accent hover:underline">Open {MEMORY_FILE}</button>}
          </div>
          {memory.length === 0 ? (
            <p className="text-xs leading-relaxed text-gray-500">Nothing yet. The agent writes down decisions, conventions and gotchas as it works (each one is part of a proposal you review), reads them before every task, and cites them when they shape a change.</p>
          ) : (
            (Object.keys(KIND_LABEL) as MemoryKind[]).map((kind) => {
              const list = memory.filter((m) => m.kind === kind);
              if (!list.length) return null;
              return (
                <div key={kind}>
                  <p className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">{KIND_LABEL[kind]}</p>
                  <ul className="space-y-1">
                    {list.map((m) => (
                      <li key={m.id} className="text-xs leading-relaxed text-gray-300">
                        <span className="mr-1.5 font-mono text-[11px] text-gray-500">[{m.id}]</span>
                        {m.text}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })
          )}
        </section>
      </div>
    </div>
  );
}
