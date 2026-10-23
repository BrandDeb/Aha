'use client';

/**
 * What a proposal's changes did: its version of the program runs once with
 * live values, and each changed line of code shows whether it ran and what it
 * produced. Lines that never ran are the ones nothing checked.
 */

import { useEffect, useState } from 'react';
import { changeCoverage, coverageHeadline, type ChangeCoverage } from '@/lib/live/coverage';
import { liveSupported } from '@/lib/live/shared';
import { liveEnabled, traceOnce } from '../live-client';
import type { FileChange } from '../proposals';
import { useWorkspace } from '../store';

type State = { status: 'running' } | { status: 'done'; coverage: ChangeCoverage; ok: boolean; output: string } | { status: 'error'; error: string };

// One trace per version of a proposal, kept while the page is open
const traces = new Map<string, State>();

export function ChangeProof({ id, changes, onPick }: { id: string; changes: FileChange[]; onPick: (path: string) => void }) {
  const { project } = useWorkspace();
  const entry = project.entry;
  const key = `${id}:${changes.map((c) => `${c.path}:${c.after.length}:${c.added}`).join('|')}`;
  const [state, setState] = useState<State | null>(() => traces.get(key) ?? null);
  const [open, setOpen] = useState(false);
  const traceable = !!entry && liveSupported(entry) && changes.some((c) => c.kind !== 'deleted' && /\.(?:[cm]?[jt]sx?|py)$/.test(c.path));
  const [available, setAvailable] = useState(false);
  // Tracing runs the program on this machine: on its own only when you turned Live on, otherwise on a click
  const [go, setGo] = useState(() => {
    try {
      return localStorage.getItem('nanocli:live') === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let live = true;
    if (traceable) void liveEnabled().then((enabled) => live && setAvailable(enabled));
    return () => {
      live = false;
    };
  }, [traceable]);

  useEffect(() => {
    if (!traceable || !go || traces.has(key)) return;
    const controller = new AbortController();
    void (async () => {
      if (!(await liveEnabled())) return;
      const files = { ...project.files };
      for (const c of changes) {
        if (c.kind === 'deleted') delete files[c.path];
        else files[c.path] = c.after;
      }
      traces.set(key, { status: 'running' });
      setState({ status: 'running' });
      try {
        const result = await traceOnce(project.name, files, entry!, controller.signal);
        const next: State = result.error && !Object.keys(result.files).length ? { status: 'error', error: result.error } : { status: 'done', coverage: changeCoverage(changes, result), ok: result.ok, output: result.output };
        traces.set(key, next);
        setState(next);
      } catch (error) {
        traces.delete(key);
        if ((error as Error).name !== 'AbortError') setState({ status: 'error', error: 'Could not trace the changes' });
      }
    })();
    return () => controller.abort();
    // project.files: the base the proposal applies to, read when the trace starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, traceable, entry, go]);

  if (!traceable || !available) return null;
  if (!state) {
    return (
      <section aria-label="What the changes did">
        <h3 className="eyebrow mb-1">What the changes did</h3>
        <button onClick={() => setGo(true)} className="btn btn-secondary btn-sm h-6">Trace the changed lines</button>
        <p className="mt-1 text-[11px] text-gray-500">Runs this version once and shows which changed lines ran, and what they did.</p>
      </section>
    );
  }
  if (state.status === 'running') return <p className="text-xs text-gray-500" role="status">Tracing what the changed lines do…</p>;
  if (state.status === 'error') return <p className="text-xs text-gray-500">No trace of the changes: {state.error}</p>;

  const { coverage } = state;
  const total = coverage.ran.length + coverage.unrun.length;
  return (
    <section aria-label="What the changes did">
      <h3 className="eyebrow mb-1">What the changes did</h3>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className={`text-left text-xs ${coverage.unrun.length ? 'text-warn' : total ? 'text-accent' : 'text-gray-400'}`}>
        {coverage.unrun.length ? '◐ ' : total ? '✓ ' : ''}
        {coverageHeadline(coverage)}
        {!state.ok && <span className="text-gray-500"> · the program itself exited with an error</span>}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px]">
          {coverage.unrun.map((l) => (
            <li key={`u${l.path}:${l.line}`}>
              <button onClick={() => onPick(l.path)} className="text-left text-warn hover:underline">○ {l.path}:{l.line} never ran</button>
            </li>
          ))}
          {coverage.ran.slice(0, 30).map((l) => (
            <li key={`r${l.path}:${l.line}`} className="truncate text-gray-400" title={l.text}>
              <button onClick={() => onPick(l.path)} className="text-left hover:text-gray-100">
                ✓ {l.path}:{l.line}{l.text ? <span className="text-accent/80">  {l.text}</span> : l.hits > 1 ? `  ×${l.hits}` : ''}
              </button>
            </li>
          ))}
          {coverage.untraced.length > 0 && <li className="text-gray-500">Not reached from {entry}: {coverage.untraced.join(', ')}</li>}
        </ul>
      )}
    </section>
  );
}
