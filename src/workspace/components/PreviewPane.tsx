'use client';

/**
 * The running app next to the code. The framework's own dev server does the
 * work (hot reload keeps component state), and the page is shown in an
 * isolated frame on its own origin, so it can never reach the studio.
 */

import { useEffect, useRef, useState } from 'react';
import type { Detected } from '@/lib/frameworks';
import type { DevServerHandle } from '../devserver-client';

const DEVICES = [
  { id: 'full', label: 'Full', width: null },
  { id: 'tablet', label: 'Tablet', width: 820 },
  { id: 'phone', label: 'Phone', width: 390 },
] as const;

const STATUS: Record<string, { label: string; dot: string }> = {
  none: { label: 'Not running', dot: 'bg-gray-600' },
  stopped: { label: 'Stopped', dot: 'bg-gray-600' },
  installing: { label: 'Installing packages', dot: 'animate-pulse bg-warn' },
  starting: { label: 'Starting', dot: 'animate-pulse bg-warn' },
  ready: { label: 'Live', dot: 'bg-accent' },
  failed: { label: 'Failed', dot: 'bg-danger' },
};

interface Props {
  detected: Detected;
  server: DevServerHandle;
  onClose: () => void;
}

export function PreviewPane({ detected, server, onClose }: Props) {
  const { state, log, enabled, start, stop } = server;
  const [route, setRoute] = useState('/');
  const [draft, setDraft] = useState('/');
  const [device, setDevice] = useState<(typeof DEVICES)[number]['id']>('full');
  const [reloads, setReloads] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const status = STATUS[state.status] ?? STATUS.none;
  const ready = state.status === 'ready' && state.url;
  const busy = state.status === 'installing' || state.status === 'starting';
  const width = DEVICES.find((d) => d.id === device)?.width;
  const src = ready ? new URL(route.replace(/^\/*/, '/'), state.url).href : undefined;

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [log.length, showLog]);

  const logView = (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-gray-400">
      {log.map((l) => (
        <span key={l.seq} className={l.s === 'err' ? 'text-gray-300' : l.s === 'info' ? 'text-accent' : undefined}>{l.s === 'info' ? `› ${l.d}\n` : l.d}</span>
      ))}
      <div ref={logEnd} />
    </pre>
  );

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-[var(--color-background)]" aria-label="Preview">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border bg-[var(--bar)] px-2.5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${status.dot}`} aria-hidden="true" />
        <span className="shrink-0 text-xs text-gray-300" title={status.label}>{detected.label}</span>
        <form
          className="min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setRoute(draft || '/');
            setReloads((n) => n + 1);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={!ready}
            aria-label="Path in the app"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-transparent px-2 font-mono text-xs text-gray-200 outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
          />
        </form>
        <button onClick={() => setReloads((n) => n + 1)} disabled={!ready} className="btn btn-ghost btn-icon btn-sm" aria-label="Reload preview" title="Reload">↻</button>
        <div role="radiogroup" aria-label="Screen size" className="hidden rounded-md border border-border p-0.5 xl:flex">
          {DEVICES.map((d) => (
            <button key={d.id} role="radio" aria-checked={device === d.id} onClick={() => setDevice(d.id)} className={`rounded px-1.5 text-[11px] ${device === d.id ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`}>
              {d.label}
            </button>
          ))}
        </div>
        {src && <a href={src} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon btn-sm" aria-label="Open in a new tab" title="Open in a new tab">↗</a>}
        <button onClick={() => setShowLog((v) => !v)} aria-pressed={showLog} className="btn btn-ghost btn-sm px-2 text-[11px]" title="Dev server output">Log</button>
        {ready || busy ? (
          <button onClick={stop} className="btn btn-ghost btn-icon btn-sm" aria-label="Stop dev server" title="Stop">■</button>
        ) : null}
        <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm" aria-label="Close preview" title="Close (the server keeps running)">✕</button>
      </div>

      {enabled === false ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="text-sm text-gray-300">Dev servers are off on this server.</p>
          <p className="max-w-sm text-xs leading-relaxed text-gray-500">They run your project&apos;s code, so they only start when the studio runs on your own machine (or with NANOCLI_DEV=1).</p>
        </div>
      ) : ready ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className={`flex min-h-0 flex-1 justify-center overflow-auto ${width ? 'bg-black/30 p-3' : ''}`}>
            <iframe
              key={reloads}
              src={src}
              title={`${detected.label} preview`}
              style={width ? { width, maxWidth: '100%' } : undefined}
              className={`h-full border-0 bg-white ${width ? 'rounded-lg shadow-2xl' : 'w-full'}`}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
            />
          </div>
          {showLog && <div className="flex h-44 shrink-0 flex-col border-t border-border">{logView}</div>}
        </div>
      ) : busy ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-1 p-4">
            <p className="flex items-center gap-2 text-sm text-gray-200">
              <span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-100" aria-hidden="true" />
              {state.status === 'installing' ? 'Installing packages…' : `Starting ${detected.label}…`}
            </p>
            <p className="text-xs text-gray-500">{state.status === 'installing' ? 'The first start downloads the dependencies; later starts reuse them.' : 'Waiting for the dev server to answer.'}</p>
          </div>
          {logView}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex flex-col items-center gap-3 p-8 text-center">
            {state.status === 'failed' ? (
              <>
                <p className="text-sm text-danger">{state.error ?? 'The dev server failed.'}</p>
                <button onClick={start} className="btn btn-primary btn-sm">Try again</button>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-300">See the app as you build it.</p>
                <p className="max-w-sm text-xs leading-relaxed text-gray-500">
                  Starts {detected.label}&apos;s own dev server on this machine (127.0.0.1). Edits sync as you type, and accepted agent proposals show up the same way.
                </p>
                <button onClick={start} disabled={enabled === null} className="btn btn-primary btn-sm">Start {detected.framework.name}</button>
              </>
            )}
          </div>
          {log.length > 0 && logView}
        </div>
      )}
    </section>
  );
}
