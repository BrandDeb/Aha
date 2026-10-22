'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Check } from '@/lib/doctor';
import { applyDoctorFix, fetchDoctor, restartStudio, runUpdate, type DoctorReport, type UpdateResult, type UpdateStatus } from '../maintenance-client';

const DOT: Record<Check['status'], string> = { ok: 'bg-accent', warn: 'bg-warn', fail: 'bg-danger' };
const LABEL: Record<Check['status'], string> = { ok: 'OK', warn: 'Needs attention', fail: 'Failing' };

function Health() {
  const [report, setReport] = useState<DoctorReport | null | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const load = useCallback(async () => setReport(await fetchDoctor()), []);
  useEffect(() => {
    let live = true;
    fetchDoctor().then((r) => live && setReport(r));
    return () => {
      live = false;
    };
  }, []);

  if (report === undefined) return <p className="text-sm text-gray-500">Checking…</p>;
  if (report === null) return <p className="text-sm text-gray-400">Health checks are only available when the studio runs on your own machine.</p>;

  const problems = report.checks.filter((c) => c.status !== 'ok').length;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-300">{problems ? `${problems} thing${problems > 1 ? 's' : ''} to look at` : 'Everything looks healthy'}</p>
        <div className="flex gap-1.5">
          <button className="btn btn-secondary btn-sm" onClick={() => { setMessage(''); void load(); }}>Check again</button>
          <button className="btn btn-ghost btn-sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(report, null, 2)).then(() => setMessage('Copied the report. It contains no keys or project files.'))}>Copy report</button>
        </div>
      </div>
      <ul className="divide-y divide-border rounded-xl border border-border">
        {report.checks.map((check) => (
          <li key={check.id} className="flex items-start gap-3 px-3 py-2.5">
            <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${DOT[check.status]}`} role="img" aria-label={LABEL[check.status]} />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-100">{check.label}</div>
              <div className="break-words text-xs text-gray-400">{check.detail}</div>
            </div>
            {check.fix && (
              <button
                className="btn btn-secondary btn-sm shrink-0"
                aria-disabled={busy !== null}
                onClick={async () => {
                  if (busy) return;
                  setBusy(check.id);
                  const result = await applyDoctorFix(check.fix!.id);
                  setMessage(result.message);
                  setBusy(null);
                  void load();
                }}
              >
                {busy === check.id ? 'Working…' : check.fix.label}
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="font-mono text-[11px] text-gray-500">
        Node {report.server.node} · {report.server.platform} · up {Math.floor(report.server.uptimeSeconds / 60)} min · {report.server.memoryMb} MB{report.server.supervised ? ' · restarts itself if it crashes' : ''}
      </p>
      {message && <p role="status" className="text-xs text-accent">{message}</p>}
    </div>
  );
}

function Updates({ status, refresh }: { status: UpdateStatus | null; refresh: (force?: boolean) => Promise<void> }) {
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState('');
  const [result, setResult] = useState<UpdateResult | null>(null);
  const [restarting, setRestarting] = useState(false);

  if (!status) return <p className="text-sm text-gray-400">Updates are only available when the studio runs on your own machine.</p>;

  const apply = async () => {
    setRunning(true);
    setLog('');
    setResult(null);
    const outcome = await runUpdate((text) => setLog((prev) => (prev + text).slice(-6000)));
    setResult(outcome);
    setRunning(false);
    await refresh(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-gray-300">
          {!status.supported
            ? 'Updating from here isn’t available'
            : status.behind
              ? `${status.behind} update${status.behind > 1 ? 's' : ''} available on ${status.upstream}`
              : `Up to date on ${status.branch}${status.current ? ` (${status.current.slice(0, 7)})` : ''}`}
        </p>
        <button
          className="btn btn-secondary btn-sm"
          aria-disabled={checking || running}
          onClick={async () => {
            if (checking || running) return;
            setChecking(true);
            await refresh(true);
            setChecking(false);
          }}
        >
          {checking ? 'Checking…' : 'Check now'}
        </button>
      </div>

      {status.note && <p className="text-xs text-gray-400">{status.note}</p>}
      {status.fetchError && <p className="text-xs text-warn">Couldn’t reach the remote: {status.fetchError}</p>}

      {status.commits.length > 0 && (
        <ul className="max-h-44 divide-y divide-border overflow-y-auto rounded-xl border border-border text-xs">
          {status.commits.map((c) => (
            <li key={c.sha} className="flex gap-2 px-3 py-1.5">
              <span className="shrink-0 font-mono text-gray-500">{c.sha.slice(0, 7)}</span>
              <span className="min-w-0 flex-1 truncate text-gray-200" title={c.subject}>{c.subject}</span>
              <span className="shrink-0 text-gray-500">{c.author}</span>
            </li>
          ))}
        </ul>
      )}

      {status.canApply && !result?.ok && (
        <div className="space-y-2 rounded-xl border border-border p-3">
          <p className="text-xs text-gray-400">
            This fast-forwards your checkout. It never touches uncommitted work, reinstalls dependencies only if they changed, rebuilds if this is a
            production server, and puts the old version back if anything fails.
          </p>
          <button className="btn btn-primary btn-sm" onClick={() => void apply()} aria-disabled={running}>{running ? 'Updating…' : 'Update now'}</button>
        </div>
      )}

      {log && <pre className="max-h-40 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[11px] leading-relaxed text-gray-300" aria-live="polite">{log}</pre>}

      {result && (
        <div role="status" className="space-y-2 rounded-xl border border-border p-3 text-sm">
          {result.ok ? (
            <>
              <p className="text-accent">{result.steps.at(-1) ?? 'Updated.'}</p>
              {result.restartRequired && status.supervised && (
                <button
                  className="btn btn-primary btn-sm"
                  aria-disabled={restarting}
                  onClick={async () => {
                    setRestarting(true);
                    await restartStudio();
                    // The page reloads itself once the server answers again
                    const wait = async () => {
                      for (let i = 0; i < 60; i++) {
                        await new Promise((r) => setTimeout(r, 1000));
                        try {
                          if ((await fetch('/api/connectors', { cache: 'no-store' })).ok) return location.reload();
                        } catch {
                          // still restarting
                        }
                      }
                      setRestarting(false);
                    };
                    void wait();
                  }}
                >
                  {restarting ? 'Restarting…' : 'Restart now'}
                </button>
              )}
              {result.restartRequired && !status.supervised && <p className="text-xs text-gray-400">Stop the studio and start it again (<code>npm run dev</code> or <code>npm start</code>) to use the new version.</p>}
            </>
          ) : (
            <>
              <p className="text-danger">{result.rolledBack ? 'The update failed and the previous version was put back.' : 'The update didn’t run.'}</p>
              {result.error && <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md bg-black/40 p-2 font-mono text-[11px] text-gray-300">{result.error}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function MaintenanceSettings({ update, refresh }: { update: UpdateStatus | null; refresh: (force?: boolean) => Promise<void> }) {
  return (
    <div className="space-y-6">
      <section aria-labelledby="updates-heading" className="space-y-2">
        <h3 id="updates-heading" className="eyebrow">Updates</h3>
        <Updates status={update} refresh={refresh} />
      </section>
      <section aria-labelledby="health-heading" className="space-y-2">
        <h3 id="health-heading" className="eyebrow">Health</h3>
        <Health />
      </section>
    </div>
  );
}
