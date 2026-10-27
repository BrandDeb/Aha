'use client';

import { useMemo, useState } from 'react';
import { parseTrace, testPathFor, traceBrief, type PastedTrace } from '@/lib/tracefix';
import type { Connector } from '@/lib/connectors/types';
import { Dialog } from './Dialog';

const KIND = { python: 'Python traceback', node: 'Node.js stack trace', log: 'Log excerpt' } as const;

/** An enabled connector that reaches Sentry (from the catalog, or added by hand) */
export const hasSentry = (connectors: Connector[]) =>
  connectors.some((c) => c.enabled && (/sentry/i.test(c.name) || (c.kind === 'mcp-http' && /(^|\.)sentry\.(dev|io)\b/.test(new URL(c.url, 'https://x').hostname))));

/** Paste an error from production; the agent reproduces it with a failing test, fixes it and shows the test passing */
export function TraceFixDialog({ files, connectors, onFix, onClose }: { files: Record<string, string>; connectors: Connector[]; onFix: (brief: string, trace: PastedTrace) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const paths = useMemo(() => Object.keys(files), [files]);
  const trace = useMemo(() => (text.trim() ? parseTrace(text, paths) : null), [text, paths]);
  const sentry = hasSentry(connectors);
  const frames = trace?.frames.filter((f) => f.file in files) ?? [];
  const kind = trace && trace.kind !== 'log' ? trace.kind : frames.some((f) => f.file.endsWith('.py')) ? 'python' : 'node';

  return (
    <Dialog title="Fix a production error" description="Paste a stack trace, a log excerpt or a Sentry issue link. The agent writes a test that reproduces it, fixes the code and shows the test passing, as a proposal for you to review." onClose={onClose} width="max-w-2xl">
      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          spellCheck={false}
          autoFocus
          aria-label="Stack trace, log or Sentry link"
          placeholder={'Traceback (most recent call last):\n  File "/srv/app/cart.py", line 4, in total\nZeroDivisionError: division by zero\n\nor https://your-org.sentry.io/issues/123456/'}
          className="input w-full resize-y font-mono text-xs"
        />
        {trace && (
          <section aria-label="What it points at" className="space-y-1.5 rounded-lg border border-border p-3 text-xs">
            <p className="text-gray-300">
              <span className="text-gray-500">{KIND[trace.kind]}:</span> {trace.title}
            </p>
            {trace.sentry && (
              <p className={sentry ? 'text-accent' : 'text-warn'}>
                Sentry issue {trace.sentry.issue}: {sentry ? 'the agent reads it with the Sentry connector.' : 'connect Sentry (Connectors) for the full event; the agent works from the text.'}
              </p>
            )}
            {frames.length ? (
              <ul className="space-y-0.5 font-mono text-gray-400">
                {frames.slice(0, 5).map((f, i) => (
                  <li key={`${f.file}:${f.line}`}>
                    {i === 0 ? '→ ' : '  '}
                    {f.file}:{f.line}
                  </li>
                ))}
              </ul>
            ) : (
              !trace.sentry && <p className="text-gray-500">No frame matches a project file; the agent will search the project for it.</p>
            )}
            {frames[0] && <p className="text-gray-500">Reproducing test: {testPathFor(frames[0].file, kind)}</p>}
          </section>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button
            onClick={() => {
              if (!trace) return;
              onFix(traceBrief(trace, files, { sentryConnected: sentry }), trace);
              onClose();
            }}
            disabled={!trace}
            className="btn btn-primary btn-sm"
          >
            Reproduce and fix
          </button>
        </div>
      </div>
    </Dialog>
  );
}
