'use client';

import { useRef, useState } from 'react';
import type { GitHubUserInfo } from '@/types';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';
import { exportZip, importZip } from '../zip';
import { Dialog } from './Dialog';

export function ProjectDialog({ user, onClose }: { user: GitHubUserInfo | null; onClose: () => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [gistUrl, setGistUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const downloadZip = () => {
    const blob = exportZip(project.name, project.files);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${project.name}.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    notify({ kind: 'success', title: `Exported ${project.name}.zip`, detail: `${Object.keys(project.files).length} files` });
  };

  const onImport = async (file: File) => {
    try {
      const { files, skipped } = importZip(await file.arrayBuffer());
      if (!Object.keys(files).length) throw new Error('No text files found in the archive');
      saveSnapshot('Before ZIP import');
      const entry = ['src/main.ts', 'src/index.ts', 'main.ts', 'index.ts'].find((f) => f in files)
        ?? Object.keys(files).find((f) => /\.(?:ts|js)$/.test(f) && !f.endsWith('.d.ts')) ?? '';
      dispatch({ type: 'replace', project: { name: file.name.replace(/\.zip$/i, ''), files, folders: [], entry }, git: null });
      notify({ kind: 'success', title: `Imported ${Object.keys(files).length} files`, detail: skipped.length ? `${skipped.length} binary or unsafe paths skipped` : undefined });
      onClose();
    } catch (error) {
      notify({ kind: 'error', title: 'Import failed', detail: (error as Error).message });
    }
  };

  const exportGist = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/github/gists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: `${project.name} — NanoCLI project`, files: project.files }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Gist export failed');
      setGistUrl(data.html_url);
      notify({ kind: 'success', title: 'Exported to a secret gist' });
    } catch (error) {
      notify({ kind: 'error', title: 'Gist export failed', detail: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const makeShareLink = () => {
    const payload = btoa(encodeURIComponent(JSON.stringify({ name: project.name, files: project.files, entry: project.entry })));
    const url = `${window.location.origin}/?project=${payload}`;
    if (url.length > 60_000) {
      notify({ kind: 'error', title: 'Project is too large for a link', detail: 'Export a ZIP or a gist instead.' });
      return;
    }
    setShareUrl(url);
    navigator.clipboard.writeText(url).then(() => notify({ kind: 'success', title: 'Share link copied' }), () => {});
  };

  return (
    <Dialog title="Import & export" description={`${project.name} · ${Object.keys(project.files).length} files`} onClose={onClose}>
      <div className="space-y-5">
        <section className="space-y-2">
          <h3 className="eyebrow">ZIP</h3>
          <div className="flex gap-2">
            <button onClick={downloadZip} className="btn btn-primary">Download ZIP</button>
            <button onClick={() => fileRef.current?.click()} className="btn btn-secondary">Import ZIP…</button>
            <input ref={fileRef} type="file" accept=".zip,application/zip" className="hidden" onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </div>
          <p className="text-xs text-gray-500">Importing replaces the workspace; the current project is saved to History first.</p>
        </section>

        <section className="space-y-2">
          <h3 className="eyebrow">Share link</h3>
          <button onClick={makeShareLink} className="btn btn-secondary">Copy share link</button>
          {shareUrl && <input readOnly value={shareUrl} onFocus={(e) => e.target.select()} className="input font-mono text-xs" aria-label="Share link" />}
          <p className="text-xs text-gray-500">The whole project is encoded in the link. Anyone who opens it gets their own copy.</p>
        </section>

        <section className="space-y-2">
          <h3 className="eyebrow">GitHub Gist</h3>
          {user ? (
            <button onClick={exportGist} disabled={busy} className="btn btn-secondary">{busy ? 'Exporting…' : 'Export to secret gist'}</button>
          ) : (
            <p className="text-sm text-gray-400">Sign in with GitHub to export to a gist.</p>
          )}
          {gistUrl && (
            <a href={gistUrl} target="_blank" rel="noreferrer" className="block truncate font-mono text-xs text-gray-100 underline underline-offset-4">{gistUrl}</a>
          )}
          <p className="text-xs text-gray-500">Folders are flattened with “__” because gists can’t contain directories.</p>
        </section>
      </div>
    </Dialog>
  );
}
