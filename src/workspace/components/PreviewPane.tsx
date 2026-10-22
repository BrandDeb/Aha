'use client';

/**
 * The running app next to the code, two ways:
 * - Dev server: the framework's own server on this machine (hot reload keeps
 *   component state), shown in a frame on its own origin.
 * - In browser: Vite-style apps bundled by esbuild-wasm inside a sandboxed
 *   frame with an opaque origin (see app/preview-frame); no install, no
 *   server, and the only option where the studio may not run code.
 * Either way the page can never reach the studio.
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

interface ConsoleLine {
  id: number;
  level: string;
  text: string;
}

type BrowserState = { status: 'loading' | 'building' | 'ready' | 'failed'; ms?: number; error?: string };

/** The in-browser preview: sends the files to the sandboxed frame, which bundles and runs them */
function BrowserPreview({ files, reloads, width, onState, onConsole }: { files: Record<string, string>; reloads: number; width: number | null | undefined; onState: (s: BrowserState) => void; onConsole: (l: Omit<ConsoleLine, 'id'>) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const ready = useRef(false);
  const latest = useRef(files);
  useEffect(() => {
    latest.current = files;
  }, [files]);
  const send = () => {
    if (!ready.current) return;
    onState({ status: 'building' });
    frame.current?.contentWindow?.postMessage({ type: 'build', files: latest.current }, '*');
  };

  useEffect(() => {
    ready.current = false;
    onState({ status: 'loading' });
    const onMessage = (event: MessageEvent) => {
      // Only our frame; it has an opaque origin, so the window is what identifies it
      if (event.source !== frame.current?.contentWindow) return;
      const data = event.data as { source?: string; type?: string; ms?: number; message?: string; level?: string; text?: string } | null;
      if (data?.source !== 'nanocli-preview') return;
      if (data.type === 'ready') {
        ready.current = true;
        send();
      } else if (data.type === 'built') onState({ status: 'ready', ms: data.ms });
      else if (data.type === 'error') onState({ status: 'failed', error: data.message });
      else if (data.type === 'console') onConsole({ level: String(data.level), text: String(data.text).slice(0, 4000) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
    // send and the callbacks are stable enough: re-subscribing on every render would drop messages
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloads]);

  // Every edit rebuilds (esbuild takes milliseconds); typing is debounced
  useEffect(() => {
    const timer = setTimeout(send, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  return (
    <div className={`flex min-h-0 flex-1 justify-center overflow-auto ${width ? 'bg-black/30 p-3' : ''}`}>
      <iframe
        key={reloads}
        ref={frame}
        src="/preview-frame"
        title="In-browser preview"
        style={width ? { width, maxWidth: '100%' } : undefined}
        className={`h-full border-0 bg-white ${width ? 'rounded-lg shadow-2xl' : 'w-full'}`}
        // No allow-same-origin: an opaque origin, so the project's code can't reach the studio
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
      />
    </div>
  );
}

interface Props {
  detected: Detected;
  server: DevServerHandle;
  files: Record<string, string>;
  mode: 'server' | 'browser';
  browserSupport: { ok: true } | { ok: false; reason: string } | null;
  onMode: (mode: 'server' | 'browser') => void;
  onClose: () => void;
}

export function PreviewPane({ detected, server, files, mode, browserSupport, onMode, onClose }: Props) {
  const { state, log, enabled, start, stop } = server;
  const [browser, setBrowser] = useState<BrowserState>({ status: 'loading' });
  const [consoleLines, setConsoleLines] = useState<ConsoleLine[]>([]);
  const consoleId = useRef(0);
  const inBrowser = mode === 'browser';
  const [route, setRoute] = useState('/');
  const [draft, setDraft] = useState('/');
  const [device, setDevice] = useState<(typeof DEVICES)[number]['id']>('full');
  const [reloads, setReloads] = useState(0);
  const [showLog, setShowLog] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const status = inBrowser
    ? browser.status === 'ready'
      ? { label: `Built in ${browser.ms} ms`, dot: 'bg-accent' }
      : browser.status === 'failed'
        ? { label: 'Build failed', dot: 'bg-danger' }
        : { label: 'Building', dot: 'animate-pulse bg-warn' }
    : (STATUS[state.status] ?? STATUS.none);
  const ready = state.status === 'ready' && state.url;
  const busy = state.status === 'installing' || state.status === 'starting';
  const width = DEVICES.find((d) => d.id === device)?.width;
  const src = ready ? new URL(route.replace(/^\/*/, '/'), state.url).href : undefined;

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [log.length, consoleLines.length, showLog]);

  const consoleView = (
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-gray-300">
      {browser.status === 'failed' && browser.error && <span className="text-danger">{`${browser.error}\n`}</span>}
      {consoleLines.length === 0 && browser.status !== 'failed' && <span className="text-gray-500">The app&apos;s console output appears here.</span>}
      {consoleLines.map((l) => (
        <span key={l.id} className={l.level === 'error' ? 'text-danger' : l.level === 'warn' ? 'text-warn' : undefined}>{`${l.text}\n`}</span>
      ))}
      <div ref={logEnd} />
    </pre>
  );

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
        <div role="radiogroup" aria-label="Where the preview runs" className="flex shrink-0 rounded-md border border-border p-0.5">
          <button role="radio" aria-checked={!inBrowser} onClick={() => onMode('server')} disabled={enabled === false} title={enabled === false ? 'Dev servers are off on this server' : 'The framework’s own dev server on this machine'} className={`rounded px-1.5 text-[11px] disabled:opacity-40 ${!inBrowser ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`}>Dev server</button>
          <button role="radio" aria-checked={inBrowser} onClick={() => onMode('browser')} disabled={!browserSupport?.ok} title={browserSupport && !browserSupport.ok ? browserSupport.reason : 'Bundled in your browser: no install, no server'} className={`rounded px-1.5 text-[11px] disabled:opacity-40 ${inBrowser ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`}>In browser</button>
        </div>
        {inBrowser && <span className="hidden shrink-0 font-mono text-[11px] text-gray-500 sm:inline">{status.label}</span>}
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
            disabled={!ready || inBrowser}
            aria-label="Path in the app"
            spellCheck={false}
            className="h-7 w-full rounded-md border border-border bg-transparent px-2 font-mono text-xs text-gray-200 outline-none focus:border-[var(--accent-line)] disabled:opacity-50"
          />
        </form>
        <button onClick={() => setReloads((n) => n + 1)} disabled={!ready && !inBrowser} className="btn btn-ghost btn-icon btn-sm" aria-label="Reload preview" title="Reload">↻</button>
        <div role="radiogroup" aria-label="Screen size" className="hidden rounded-md border border-border p-0.5 xl:flex">
          {DEVICES.map((d) => (
            <button key={d.id} role="radio" aria-checked={device === d.id} onClick={() => setDevice(d.id)} className={`rounded px-1.5 text-[11px] ${device === d.id ? 'bg-white/[0.1] text-gray-100' : 'text-gray-500 hover:text-gray-100'}`}>
              {d.label}
            </button>
          ))}
        </div>
        {src && !inBrowser && <a href={src} target="_blank" rel="noreferrer" className="btn btn-ghost btn-icon btn-sm" aria-label="Open in a new tab" title="Open in a new tab">↗</a>}
        <button onClick={() => setShowLog((v) => !v)} aria-pressed={showLog} className="btn btn-ghost btn-sm px-2 text-[11px]" title={inBrowser ? 'The app’s console' : 'Dev server output'}>{inBrowser ? 'Console' : 'Log'}</button>
        {!inBrowser && (ready || busy) ? (
          <button onClick={stop} className="btn btn-ghost btn-icon btn-sm" aria-label="Stop dev server" title="Stop">■</button>
        ) : null}
        <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm" aria-label="Close preview" title="Close (the server keeps running)">✕</button>
      </div>

      {inBrowser ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <BrowserPreview
            files={files}
            reloads={reloads}
            width={width}
            onState={setBrowser}
            onConsole={(line) => setConsoleLines((prev) => [...prev.slice(-300), { id: ++consoleId.current, ...line }])}
          />
          {(showLog || browser.status === 'failed') && <div className="flex h-44 shrink-0 flex-col border-t border-border">{consoleView}</div>}
        </div>
      ) : enabled === false ? (
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
