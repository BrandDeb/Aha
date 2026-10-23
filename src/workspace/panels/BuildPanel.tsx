'use client';

import { useEffect, useState } from 'react';
import { formatSize, type CompileResult, type CoverageResult } from '@/lib/compiler-browser';
import { useActions, type RunOutcome } from '../actions';
import { useWorkspace } from '../store';
import { targetInfo } from '../targets';

const PHASE_LABELS: Record<string, string> = {
  queue: 'Queue',
  write: 'Write sources',
  compile: 'scriptc compile + link',
  package: 'Package artifact',
};

interface BuildPanelProps {
  result: CompileResult | null;
  building: boolean;
  coverage: CoverageResult | null;
  analyzing: boolean;
  onCoverage: () => void;
  lastRun: (RunOutcome & { entry: string }) | null;
}

export function BuildPanel({ result, building, coverage, analyzing, onCoverage, lastRun }: BuildPanelProps) {
  // The three-step guide is for the first visit; after a first build or run a single line is enough
  const [builtBefore] = useState(() => {
    try {
      return localStorage.getItem('nanocli:built-once') === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (!result && !lastRun) return;
    try {
      localStorage.setItem('nanocli:built-once', '1');
    } catch {
      // storage blocked: the guide shows again
    }
  }, [result, lastRun]);
  const { project, dispatch } = useWorkspace();
  const actions = useActions();
  const phases = result?.phases ?? [];
  const total = phases.reduce((sum, p) => sum + p.ms, 0) || 1;
  const diagnostics = result?.diagnostics ?? [];

  return (
    <div className="space-y-7 p-4">
      <section aria-labelledby="build-status">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="build-status" className="eyebrow">Build</h3>
          <span className="font-mono text-[11px] text-gray-500">{project.entry || 'no entry'}</span>
        </div>
        {building ? (
          <p className="flex items-center gap-2 text-sm text-gray-300" role="status">
            <span className="h-3 w-3 animate-spin rounded-full border border-gray-500 border-t-gray-100" aria-hidden="true" />
            Compiling with scriptc…
          </p>
        ) : !result && builtBefore ? (
          <div className="space-y-3">
            <p className="text-sm text-gray-400">No build yet in this session. Build makes a native binary and shows the pipeline, its size and any scriptc problems.</p>
            <button onClick={() => void actions.compile()} className="btn btn-primary w-full">Build now</button>
          </div>
        ) : !result ? (
          <div className="space-y-4">
            <ol className="space-y-3 text-sm text-gray-300">
              {[
                ['Run', 'runs the program right here; a program that needs arguments asks for them.'],
                ['Build', 'makes a native binary and shows the pipeline, size and any scriptc problems.'],
                ['Ask the agent', 'type what you want in the bar at the top: it works on a copy and shows you the proof.'],
              ].map(([title, body], i) => (
                <li key={title} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] font-mono text-[11px] text-accent">{i + 1}</span>
                  <span><strong className="font-medium text-gray-100">{title}</strong> — {body}</span>
                </li>
              ))}
            </ol>
            <button onClick={() => void actions.compile()} className="btn btn-primary w-full">Build now</button>
          </div>
        ) : (
          <div className="space-y-4 animate-fade-in">
            <p className="flex items-center gap-2 text-sm text-gray-100" role="status">
              <span className={`font-mono ${result.success ? 'text-accent' : 'text-danger'}`} aria-hidden="true">{result.success ? '✓' : '✕'}</span>
              {result.success ? `Build succeeded${result.target ? ` · ${targetInfo(result.target).label}` : ''}` : 'Build failed'}
            </p>
            {result.success && (
              <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border">
                <div className="border-r border-border p-3">
                  <dt className="text-xs text-gray-500">Artifact</dt>
                  <dd className="mt-1 font-mono text-lg text-gray-100">{formatSize(result.size)}</dd>
                </div>
                <div className="p-3">
                  <dt className="text-xs text-gray-500">Build time</dt>
                  <dd className="mt-1 font-mono text-lg text-gray-100">{result.durationMs}ms</dd>
                </div>
              </dl>
            )}
            {result.error && result.success && <p className="text-xs text-gray-400">{result.error}</p>}
            {!result.success && !diagnostics.length && <p className="text-sm text-gray-400">{result.error}</p>}
            {result.success && (
              <div className="flex gap-2">
                {result.output !== undefined && (
                  <button onClick={() => actions.inspect(result)} className="btn btn-secondary flex-1">Inspect</button>
                )}
                <button onClick={() => actions.downloadArtifact(result)} className="btn btn-secondary min-w-0 flex-[2] truncate">
                  Download {result.filename?.replace(/^[0-9a-f]{32}-?/, '')}
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {phases.length > 0 && (
        <section aria-labelledby="pipeline">
          <h3 id="pipeline" className="eyebrow mb-3">Pipeline</h3>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
            {phases.map((p, i) => (
              <div key={p.name} style={{ width: `${Math.max(2, (p.ms / total) * 100)}%`, opacity: 1 - i * 0.2 }} className="h-full bg-accent" />
            ))}
          </div>
          <ol className="mt-3 space-y-1.5 text-sm">
            {phases.map((p, i) => (
              <li key={p.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-300">
                  <span className="h-2 w-2 rounded-full bg-accent" style={{ opacity: 1 - i * 0.2 }} aria-hidden="true" />
                  {PHASE_LABELS[p.name] ?? p.name}
                </span>
                <span className="font-mono text-xs text-gray-500">{p.ms}ms</span>
              </li>
            ))}
          </ol>
          {result?.success && phases.find((p) => p.name === 'queue' && p.ms > 500) && (
            <p className="mt-2 text-xs text-gray-500">The build waited in the queue; the server was busy with other builds.</p>
          )}
        </section>
      )}

      {diagnostics.length > 0 && (
        <section aria-labelledby="problems">
          <h3 id="problems" className="eyebrow mb-3">Problems · {diagnostics.length}</h3>
          <ul className="space-y-2.5">
            {diagnostics.map((d, i) => (
              <li key={i}>
                <button
                  onClick={() => d.file && dispatch({ type: 'open', path: d.file })}
                  className="w-full rounded-xl p-2 text-left text-sm hover:bg-white/[0.04]"
                >
                  <span className="font-mono text-xs text-danger">{d.code}</span>
                  <span className="ml-2 font-mono text-xs text-gray-500">{d.file ?? project.entry}:{d.line}</span>
                  <span className="mt-0.5 block text-gray-100">{d.message}</span>
                  {d.hint && <span className="mt-0.5 block text-xs text-gray-400">{d.hint}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="coverage">
        <div className="mb-3 flex items-center justify-between">
          <h3 id="coverage" className="eyebrow">scriptc coverage</h3>
          <button onClick={onCoverage} disabled={analyzing} className="btn btn-ghost btn-sm">
            {analyzing ? 'Analyzing…' : 'Analyze'}
          </button>
        </div>
        {!coverage ? (
          <p className="text-sm text-gray-500">How much of the program compiles statically, and what blocks the rest.</p>
        ) : coverage.success ? (
          <div className="space-y-3 animate-fade-in">
            <div className="flex items-baseline justify-between">
              <span className="display text-4xl text-gray-100">{coverage.percent}%</span>
              <span className="text-xs text-gray-500">{coverage.static}/{coverage.statements} statements</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-800" role="progressbar" aria-valuenow={coverage.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Static coverage">
              <div className="h-full rounded-full bg-accent" style={{ width: `${coverage.percent ?? 0}%` }} />
            </div>
            {coverage.blockers?.length ? (
              <ul className="space-y-1.5 text-xs">
                {coverage.blockers.map((b) => (
                  <li key={b.code + b.message}>
                    <span className="font-mono text-gray-100">{b.code}</span>
                    <span className="text-gray-400"> ×{b.count} {b.message}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-gray-400">Everything compiles statically.</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-danger">{coverage.error}</p>
        )}
      </section>

      <section aria-labelledby="profile">
        <h3 id="profile" className="eyebrow mb-3">Last run</h3>
        {!lastRun ? (
          <p className="text-sm text-gray-500">
            Type <span className="kbd">run</span> in the terminal to execute the program as WASM in this tab and profile it.
          </p>
        ) : lastRun.ok ? (
          <dl className="grid grid-cols-3 overflow-hidden rounded-xl border border-border text-center">
            <div className="border-r border-border p-3">
              <dt className="text-[11px] text-gray-500">Exit</dt>
              <dd className="mt-1 font-mono text-gray-100">{lastRun.code}</dd>
            </div>
            <div className="border-r border-border p-3">
              <dt className="text-[11px] text-gray-500">Wall time</dt>
              <dd className="mt-1 font-mono text-gray-100">{lastRun.ms?.toFixed(1)}ms</dd>
            </div>
            <div className="p-3">
              <dt className="text-[11px] text-gray-500">Memory</dt>
              <dd className="mt-1 font-mono text-gray-100">{formatSize(lastRun.memoryBytes)}</dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-danger">{lastRun.message}</p>
        )}
        {lastRun?.ok && <p className="mt-2 font-mono text-[11px] text-gray-500">{lastRun.entry} · WASI in a Web Worker</p>}
      </section>
    </div>
  );
}
