'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import { browseFolders, openFolder, recentFolders, type Listing, type OpenedFolder } from '../folder-client';

/**
 * Open a folder on this machine: type or paste its path, pick it from the folders the studio can see, or one opened
 * before. Edits are then saved in place (folder-client.ts).
 */
export function OpenFolderDialog({ onOpened, onClose }: { onOpened: (opened: OpenedFolder) => void; onClose: () => void }) {
  const [path, setPath] = useState('');
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recent] = useState(recentFolders);

  const go = (target?: string) => {
    setError(null);
    browseFolders(target)
      .then((l) => {
        setListing(l);
        setPath(l.path);
      })
      .catch((e: Error) => setError(e.message));
  };

  // Start where the user's projects usually are: their home folder
  useEffect(() => {
    let live = true;
    browseFolders()
      .then((l) => {
        if (!live) return;
        setListing(l);
        setPath(l.path);
      })
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, []);

  const open = async (target: string) => {
    if (!target.trim()) return;
    setBusy(true);
    setError(null);
    try {
      onOpened(await openFolder(target.trim()));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const join = (dir: string) => (listing ? `${listing.path.replace(/[\\/]+$/, '')}${listing.path.includes('\\') ? '\\' : '/'}${dir}` : dir);

  return (
    <Dialog title="Open a folder" description="Work on a project where it lives: edits save in place, and changes other programs make show up here." onClose={onClose} width="max-w-xl">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void open(path);
        }}
      >
        <div className="flex gap-2">
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/home/you/projects/app" aria-label="Folder path" className="input min-w-0 flex-1 font-mono text-xs" spellCheck={false} />
          <button type="submit" disabled={busy || !path.trim()} className="btn btn-primary">{busy ? 'Opening…' : 'Open'}</button>
        </div>
        {error && <p className="text-xs text-danger" role="alert">{error}</p>}

        {listing && (
          <div className="rounded-lg border border-border">
            <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs text-gray-400">
              <button type="button" onClick={() => listing.parent && go(listing.parent)} disabled={!listing.parent} className="btn btn-ghost btn-sm" aria-label="Up one folder">↑</button>
              <span className="min-w-0 flex-1 truncate font-mono" title={listing.path}>{listing.path}</span>
              {listing.project && <span className="badge">project</span>}
            </div>
            <ul className="max-h-64 overflow-auto py-1" aria-label="Folders">
              {listing.dirs.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No folders here.</li>}
              {listing.dirs.map((dir) => (
                <li key={dir} className="flex items-center gap-2 px-1">
                  <button type="button" onClick={() => go(join(dir))} className="min-w-0 flex-1 truncate rounded px-2 py-1 text-left font-mono text-xs text-gray-200 hover:bg-white/[0.06]">
                    {dir}/
                  </button>
                  <button type="button" onClick={() => void open(join(dir))} disabled={busy} className="btn btn-ghost btn-sm text-xs">Open</button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {recent.length > 0 && (
          <section className="space-y-1">
            <h3 className="eyebrow">Recent</h3>
            <ul className="space-y-0.5">
              {recent.map((r) => (
                <li key={r}>
                  <button type="button" onClick={() => void open(r)} disabled={busy} className="w-full truncate rounded px-2 py-1 text-left font-mono text-xs text-gray-300 hover:bg-white/[0.06]" title={r}>{r}</button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs text-gray-500">From a terminal: <code className="font-mono">aha path/to/project</code>. The current project is saved to History first.</p>
      </form>
    </Dialog>
  );
}
