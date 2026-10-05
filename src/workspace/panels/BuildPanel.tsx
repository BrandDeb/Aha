'use client';

import { formatSize, type CompileResult, type CoverageResult } from '@/lib/compiler-browser';
import { useActions, type RunOutcome } from '../actions';
import { useWorkspace } from '../store';

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
        ) : !result ? (
          <p className="text-sm text-gray-500">Compile to see the build pipeline, artifact size and problems.</p>
        ) : (
          <div className="space-y-4 animate-fade-in">
            <p className="flex items-center gap-2 text-sm text-gray-100" role="status">
              <span className="font-mono" aria-hidden="true">{result.success ? '✓' : '✕'}</span>
              {result.success ? 'Build succeeded' : 'Build failed'}
            </p>
            {result.success && (
              <dl className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border">
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
              <button onClick={() => actions.downloadArtifact(result)} className="btn btn-secondary w-full">
                Download {result.filename?.replace(/^[0-9a-f]{32}-?/, '')}
              </button>
            )}
          </div>
        )}
      </section>

      {phases.length > 0 && (
        <section aria-labelledby="pipeline">
          <h3 id="pipeline" className="eyebrow mb-3">Pipeline</h3>
          <div className="flex h-2 overflow-hidden rounded-full bg-gray-800" aria-hidden="true">
            {phases.map((p, i) => (
              <div key={p.name} style={{ width: `${Math.max(2, (p.ms / total) * 100)}%`, opacity: 1 - i * 0.2 }} className="h-full bg-gray-100" />
            ))}
          </div>
          <ol className="mt-3 space-y-1.5 text-sm">
            {phases.map((p, i) => (
              <li key={p.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-300">
                  <span className="h-2 w-2 rounded-full bg-gray-100" style={{ opacity: 1 - i * 0.2 }} aria-hidden="true" />
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
              <div className="h-full rounded-full bg-gray-100" style={{ width: `${coverage.percent ?? 0}%` }} />
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
          <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-border text-center">
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
