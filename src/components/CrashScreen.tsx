'use client';

import { useEffect, useState } from 'react';
import { exportWorkspace, hasLastGood, recordCrash, resetSettings, restoreLastGood } from '@/workspace/recovery';

/**
 * Shown when the studio crashes. It explains, offers the fixes that usually
 * work in the order they are least destructive, and always offers a download
 * of the project, so a bug never costs anyone their work.
 */
export function CrashScreen({ error, retry, standalone = false }: { error: Error & { digest?: string }; retry: () => void; standalone?: boolean }) {
  const [crashes, setCrashes] = useState(1);
  const [canRestore, setCanRestore] = useState(false);
  const [done, setDone] = useState('');

  useEffect(() => {
    // Reading storage is only possible in the browser, after the crash has rendered
    /* eslint-disable react-hooks/set-state-in-effect */
    setCrashes(recordCrash(localStorage));
    setCanRestore(hasLastGood(localStorage));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const download = () => {
    const raw = exportWorkspace(localStorage);
    if (!raw) {
      setDone('There is no saved project to download.');
      return;
    }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nanocli-project-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const styles = standalone
    ? { wrap: { minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#09090b', color: '#f4f4f5', fontFamily: 'system-ui, sans-serif', padding: 24 } as const }
    : undefined;

  const body = (
    <div className="mx-auto w-full max-w-lg space-y-5 rounded-2xl border border-border bg-[var(--panel)] p-6" role="alert" style={standalone ? { maxWidth: 520 } : undefined}>
      <div>
        <h1 className="text-lg font-semibold text-gray-100" style={standalone ? { fontSize: 20, margin: 0 } : undefined}>Something went wrong</h1>
        <p className="mt-1 text-sm text-gray-400" style={standalone ? { color: '#a1a1aa' } : undefined}>
          The studio hit an error and stopped. Your project is saved in this browser and hasn’t been changed.
        </p>
      </div>
      <pre className="max-h-28 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-xs text-gray-300" style={standalone ? { background: '#000', padding: 12, overflow: 'auto', maxHeight: 112 } : undefined}>
        {error.message || 'Unknown error'}
        {error.digest ? `\n(${error.digest})` : ''}
      </pre>
      <div className="flex flex-wrap gap-2" style={standalone ? { display: 'flex', gap: 8, flexWrap: 'wrap' } : undefined}>
        <button className="btn btn-primary" onClick={retry}>Try again</button>
        <button className="btn btn-secondary" onClick={() => location.reload()}>Reload</button>
        <button className="btn btn-secondary" onClick={download}>Download project backup</button>
      </div>
      {crashes >= 2 && (
        <div className="space-y-2 rounded-lg border border-border p-3 text-sm text-gray-300" style={standalone ? { border: '1px solid #3f3f46', padding: 12, borderRadius: 8 } : undefined}>
          <p>This keeps happening ({crashes} times in the last ten minutes). These usually fix it:</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { resetSettings(localStorage); setDone('Settings and appearance were reset. Reloading…'); setTimeout(() => location.reload(), 600); }}>Reset settings and appearance</button>
            {canRestore && (
              <button className="btn btn-secondary btn-sm" onClick={() => { setDone(restoreLastGood(localStorage) ? 'Restored the last working copy of your project. Reloading…' : 'Nothing to restore.'); setTimeout(() => location.reload(), 600); }}>Restore the last working copy</button>
            )}
          </div>
          <p className="text-xs text-gray-500">Restoring keeps the current copy aside, so nothing is lost. Download the backup first if you want a second copy.</p>
        </div>
      )}
      {done && <p role="status" className="text-sm text-accent">{done}</p>}
    </div>
  );

  return standalone ? <div style={styles?.wrap}>{body}</div> : <div className="grid min-h-screen place-items-center p-6">{body}</div>;
}
