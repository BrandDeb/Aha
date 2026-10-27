'use client';

import { useEffect, useState } from 'react';
import type { DebugVariable } from '@/lib/debug/types';
import { useWorkspace } from '../store';
import { pythonProjectId, getPythonEnv } from '../python-client';
import {
  clearBreakpoints,
  continueDebugging,
  evaluateExpression,
  expandVariable,
  pauseDebugging,
  selectFrame,
  startDebugging,
  stepDebugging,
  stopDebugging,
  toggleBreakpoint,
  useBreakpoints,
  useDebugSession,
} from '../debug-client';

const DEBUGGABLE = /\.(py|[cm]?[jt]s)$/i;
const isDebuggable = (path: string) => DEBUGGABLE.test(path) && !/\.d\.ts$/.test(path);

const STATUS: Record<string, string> = { starting: 'Starting…', running: 'Running', paused: 'Paused', exited: 'Finished', failed: 'Could not start' };

/** Breakpoints, stepping, the call stack, variables and watches, for TypeScript, JavaScript and Python */
export function DebugPanel({ onOpen }: { onOpen: (file: string, line: number) => void }) {
  const { project, active } = useWorkspace();
  const { session, output, starting, error } = useDebugSession();
  const breakpoints = useBreakpoints();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [entry, setEntry] = useState('');
  const [watches, setWatches] = useState<string[]>([]);
  const [watchValues, setWatchValues] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState('');
  const [repl, setRepl] = useState<{ input: string; output: string }[]>([]);
  const [replDraft, setReplDraft] = useState('');

  useEffect(() => {
    let live = true;
    fetch('/api/debug', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => live && setEnabled(d.enabled === true))
      .catch(() => live && setEnabled(false));
    return () => {
      live = false;
    };
  }, []);

  const candidates = Object.keys(project.files).filter(isDebuggable).sort();
  const chosen = entry && candidates.includes(entry) ? entry : candidates.includes(active) ? active : candidates.includes(project.entry) ? project.entry : candidates[0] ?? '';
  const live = session && (session.status === 'running' || session.status === 'paused');
  const paused = session?.status === 'paused';
  const frame = session?.frames.find((f) => f.id === session.frameId) ?? session?.frames[0];

  // Follow the program: open the file and line it stopped on
  const where = paused && frame?.file ? `${frame.file}:${frame.line}:${session?.frameId}` : '';
  useEffect(() => {
    if (!where || !frame?.file) return;
    onOpen(frame.file, frame.line);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per stop
  }, [where]);

  // Watches are read again at every stop
  const pauseKey = paused ? `${session?.id}:${session?.frameId}:${frame?.line}` : '';
  useEffect(() => {
    if (!pauseKey || !watches.length) return;
    let current = true;
    void Promise.all(watches.map(async (w) => [w, (await evaluateExpression(w))?.value ?? '—'] as const)).then((pairs) => current && setWatchValues(Object.fromEntries(pairs)));
    return () => {
      current = false;
    };
  }, [pauseKey, watches]);

  const start = () => {
    if (!chosen) return;
    void startDebugging({ projectId: pythonProjectId(project.name), entry: chosen, files: project.files, env: getPythonEnv() });
  };

  const addWatch = async () => {
    const w = draft.trim();
    if (!w || watches.includes(w)) return;
    setWatches([...watches, w]);
    setDraft('');
    if (paused) setWatchValues({ ...watchValues, [w]: (await evaluateExpression(w))?.value ?? '—' });
  };

  const runRepl = async () => {
    const input = replDraft.trim();
    if (!input) return;
    setReplDraft('');
    const result = await evaluateExpression(input);
    setRepl((prev) => [...prev.slice(-50), { input, output: result ? result.value : 'Pause the program to evaluate in its frame.' }]);
  };

  const bpList = Object.entries(breakpoints).flatMap(([file, lines]) => lines.map((line) => ({ file, line, landed: session?.breakpoints[file] })));

  if (enabled === false) {
    return (
      <div className="space-y-2 p-4">
        <h3 className="eyebrow">Debug</h3>
        <p className="text-sm text-gray-300">The debugger is off on this server.</p>
        <p className="text-xs leading-relaxed text-gray-500">It runs your program on the machine the studio runs on, so it works in the local studio and the desktop app (or with AHA_RUN=1). In the browser, Rewind shows what a run did, line by line.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <h3 className="eyebrow">Debug</h3>
        <div className="flex items-center gap-1.5">
          <select value={chosen} onChange={(e) => setEntry(e.target.value)} aria-label="File to debug" className="input h-8 min-w-0 flex-1 font-mono text-xs" disabled={!!live}>
            {candidates.length === 0 && <option value="">No TypeScript, JavaScript or Python file</option>}
            {candidates.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
          {live ? (
            <button onClick={() => void stopDebugging()} className="btn btn-secondary btn-sm h-8" title="Stop (Shift+F5)">Stop</button>
          ) : (
            <button onClick={start} disabled={!chosen || starting} className="btn btn-primary btn-sm h-8" title="Start debugging (F5)">{starting ? 'Starting…' : 'Debug'}</button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Debugger controls">
          <button onClick={() => void continueDebugging()} disabled={!paused} className="btn btn-ghost btn-sm h-7" title="Continue (F5)">▶ Continue</button>
          <button onClick={() => void pauseDebugging()} disabled={session?.status !== 'running'} className="btn btn-ghost btn-sm h-7" title="Pause">❚❚ Pause</button>
          <button onClick={() => void stepDebugging('over')} disabled={!paused} className="btn btn-ghost btn-sm h-7" title="Step over (F10)">Step over</button>
          <button onClick={() => void stepDebugging('into')} disabled={!paused} className="btn btn-ghost btn-sm h-7" title="Step into (F11)">Into</button>
          <button onClick={() => void stepDebugging('out')} disabled={!paused} className="btn btn-ghost btn-sm h-7" title="Step out (Shift+F11)">Out</button>
        </div>
        <p className="text-[11px] text-gray-500" aria-live="polite">
          {session ? (
            <>
              <span className={paused ? 'text-warn' : session.status === 'failed' ? 'text-danger' : 'text-gray-300'}>{STATUS[session.status]}</span>
              {paused && frame ? ` at ${frame.file ?? frame.name}:${frame.line}${session.reason ? ` (${session.reason})` : ''}` : ''}
              {session.status === 'exited' && session.exitCode !== undefined ? ` · exit code ${session.exitCode ?? '—'}` : ''}
            </>
          ) : (
            'Click left of a line number to set a breakpoint, then Debug.'
          )}
        </p>
        {(error || session?.error) && <pre role="alert" className="max-h-32 overflow-auto whitespace-pre-wrap text-[11px] text-danger">{error || session?.error}</pre>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-xs">
        {paused && (
          <>
            <section className="border-b border-border p-3" aria-label="Call stack">
              <h4 className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Call stack</h4>
              <ul>
                {session.frames.map((f) => (
                  <li key={f.id}>
                    <button
                      onClick={() => {
                        void selectFrame(f.id);
                        if (f.file) onOpen(f.file, f.line);
                      }}
                      disabled={!f.file}
                      aria-current={f.id === session.frameId}
                      className={`flex w-full justify-between gap-2 rounded px-1.5 py-0.5 text-left font-mono ${f.id === session.frameId ? 'bg-white/[0.08] text-gray-100' : 'text-gray-400 hover:bg-white/[0.04]'} disabled:cursor-default disabled:opacity-50`}
                    >
                      <span className="truncate">{f.name}</span>
                      <span className="shrink-0 text-gray-500">{f.file ? `${f.file.split('/').pop()}:${f.line}` : 'outside the project'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section className="border-b border-border p-3" aria-label="Variables">
              <h4 className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Variables</h4>
              {session.scopes.length === 0 && <p className="text-gray-500">Reading…</p>}
              {session.scopes.map((scope) => (
                <details key={scope.name} open={scope.name !== 'Globals' && scope.name !== 'Module'}>
                  <summary className="cursor-pointer select-none text-gray-400">{scope.name}</summary>
                  <ul className="ml-2">
                    {scope.variables.length === 0 && <li className="text-gray-600">nothing</li>}
                    {scope.variables.map((v) => (
                      <VariableRow key={v.name} v={v} />
                    ))}
                  </ul>
                </details>
              ))}
            </section>
          </>
        )}

        <section className="border-b border-border p-3" aria-label="Watch">
          <h4 className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Watch</h4>
          <ul className="mb-1.5 space-y-0.5">
            {watches.map((w) => (
              <li key={w} className="flex items-center gap-2 font-mono">
                <span className="text-gray-300">{w}</span>
                <span className="min-w-0 flex-1 truncate text-gray-400">= {paused ? watchValues[w] ?? '…' : '—'}</span>
                <button onClick={() => setWatches(watches.filter((x) => x !== w))} className="text-gray-600 hover:text-danger" aria-label={`Remove watch ${w}`}>×</button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void addWatch();
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add an expression" aria-label="Watch expression" className="input h-7 w-full font-mono text-xs" />
          </form>
        </section>

        <section className="border-b border-border p-3" aria-label="Breakpoints">
          <div className="mb-1 flex items-center justify-between">
            <h4 className="text-[11px] uppercase tracking-wide text-gray-500">Breakpoints</h4>
            {bpList.length > 0 && <button onClick={() => clearBreakpoints()} className="text-[11px] text-gray-500 hover:text-gray-200">Remove all</button>}
          </div>
          {bpList.length === 0 && <p className="text-gray-500">None. Click left of a line number in the editor.</p>}
          <ul>
            {bpList.map((b) => (
              <li key={`${b.file}:${b.line}`} className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
                <button onClick={() => onOpen(b.file, b.line)} className="min-w-0 flex-1 truncate text-left font-mono text-gray-300 hover:text-gray-100">{b.file}:{b.line}</button>
                <button onClick={() => toggleBreakpoint(b.file, b.line)} className="text-gray-600 hover:text-danger" aria-label={`Remove breakpoint ${b.file}:${b.line}`}>×</button>
              </li>
            ))}
          </ul>
        </section>

        <section className="p-3" aria-label="Debug console">
          <h4 className="mb-1 text-[11px] uppercase tracking-wide text-gray-500">Console</h4>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
            {output.map((o) => (
              <span key={o.seq} className={o.stream === 'stderr' ? 'text-danger' : o.stream === 'info' ? 'text-gray-500' : 'text-gray-300'}>{o.text}</span>
            ))}
            {repl.map((r, i) => (
              <span key={`r${i}`} className="block">
                <span className="text-accent">› {r.input}</span>
                {'\n'}
                <span className="text-gray-300">{r.output}</span>
              </span>
            ))}
          </pre>
          <form
            className="mt-1"
            onSubmit={(e) => {
              e.preventDefault();
              void runRepl();
            }}
          >
            <input value={replDraft} onChange={(e) => setReplDraft(e.target.value)} placeholder={paused ? 'Evaluate in the selected frame' : 'Pause to evaluate'} aria-label="Evaluate expression" className="input h-7 w-full font-mono text-xs" />
          </form>
        </section>
      </div>
    </div>
  );
}

function VariableRow({ v }: { v: DebugVariable }) {
  const [children, setChildren] = useState<DebugVariable[] | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = async () => {
    if (!v.ref) return;
    if (!open && !children) setChildren(await expandVariable(v.ref));
    setOpen(!open);
  };
  return (
    <li className="font-mono">
      <button onClick={() => void toggle()} className={`flex w-full gap-1 text-left ${v.ref ? 'cursor-pointer hover:bg-white/[0.03]' : 'cursor-default'}`} aria-expanded={v.ref ? open : undefined}>
        <span className="w-3 shrink-0 text-gray-600">{v.ref ? (open ? '▾' : '▸') : ''}</span>
        <span className="text-gray-300">{v.name}</span>
        <span className="text-gray-600">=</span>
        <span className="min-w-0 truncate text-gray-400" title={v.value}>{v.value}</span>
      </button>
      {open && children && (
        <ul className="ml-3">
          {children.length === 0 && <li className="text-gray-600">empty</li>}
          {children.map((c) => (
            <VariableRow key={c.name} v={c} />
          ))}
        </ul>
      )}
    </li>
  );
}
