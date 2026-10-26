'use client';

import { useState } from 'react';
import { RECOMMENDED, projectRecommendations } from '@/lib/extensions';
import { useWorkspace } from '../store';
import { chooseExtensionTheme, installExtension, setExtensionEnabled, uninstallExtension, useExtensions, type Installed } from '../extensions-client';

interface Result {
  id: string;
  version: string;
  displayName: string;
  description: string;
  downloads: number;
}

const count = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

/** VS Code extensions from Open VSX: themes and snippets, read from the package and never run */
export function ExtensionsPanel() {
  const { project } = useWorkspace();
  const { installed, theme } = useExtensions();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const has = (id: string) => installed.some((e) => e.id.toLowerCase() === id.toLowerCase());
  const fromProject = projectRecommendations(project.files).filter((id) => !has(id));
  const curated = RECOMMENDED.filter((r) => !has(r.id));

  const search = async () => {
    const q = query.trim();
    if (!q) return setResults(null);
    setSearching(true);
    setError('');
    try {
      const response = await fetch(`/api/extensions?q=${encodeURIComponent(q)}`);
      const data = (await response.json()) as { results?: Result[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? 'Search failed');
      setResults(data.results ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const install = async (id: string) => {
    setBusy(id);
    setError('');
    try {
      const ext = await installExtension(id);
      if (!ext.themes.length && !ext.snippets.length) setError(`${ext.displayName} has nothing the studio can use yet: ${ext.unsupported.join(', ') || 'no themes or snippets'}.`);
    } catch (e) {
      setError(`${id}: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const installButton = (id: string) => (
    <button onClick={() => void install(id)} disabled={busy !== null} className="btn btn-secondary btn-sm h-6 shrink-0" aria-label={`Install ${id}`}>
      {busy === id ? 'Installing…' : 'Install'}
    </button>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <h3 className="eyebrow">Extensions</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          VS Code extensions from <a href="https://open-vsx.org" target="_blank" rel="noreferrer" className="text-accent hover:underline">Open VSX</a>. The studio reads their colour themes and snippets; it never runs extension code, so extensions that need it say so.
        </p>
        <form
          className="flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void search();
          }}
        >
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search Open VSX" aria-label="Search extensions" className="input h-8 min-w-0 flex-1 text-sm" />
          <button type="submit" disabled={searching} className="btn btn-primary btn-sm h-8">{searching ? '…' : 'Search'}</button>
        </form>
        {error && <p role="alert" className="text-[11px] text-danger">{error}</p>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {results && (
          <section className="border-b border-border p-4" aria-label="Search results">
            <h4 className="mb-2 text-xs text-gray-300">Results</h4>
            {results.length === 0 && <p className="text-xs text-gray-500">Nothing on Open VSX matches.</p>}
            <ul className="space-y-2">
              {results.map((r) => (
                <li key={r.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-gray-200">{r.displayName} <span className="text-[11px] text-gray-500">{r.id} · {count(r.downloads)}</span></div>
                    <div className="line-clamp-2 text-[11px] text-gray-500">{r.description}</div>
                  </div>
                  {has(r.id) ? <span className="text-[11px] text-gray-500">installed</span> : installButton(r.id)}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="border-b border-border p-4" aria-label="Installed">
          <h4 className="mb-2 text-xs text-gray-300">Installed</h4>
          {installed.length === 0 && <p className="text-xs text-gray-500">None yet. Themes and snippets you install are kept in this browser.</p>}
          <ul className="space-y-2">
            {installed.map((ext) => <InstalledRow key={ext.id} ext={ext} theme={theme} />)}
          </ul>
          {theme && (
            <button onClick={() => chooseExtensionTheme(null)} className="btn btn-ghost btn-sm mt-2 h-6">Back to the studio theme</button>
          )}
        </section>

        {fromProject.length > 0 && (
          <section className="border-b border-border p-4" aria-label="Recommended by this project">
            <h4 className="mb-1 text-xs text-gray-300">This project recommends</h4>
            <p className="mb-2 text-[11px] text-gray-500">From <code className="font-mono">.vscode/extensions.json</code>.</p>
            <ul className="space-y-1.5">
              {fromProject.map((id) => (
                <li key={id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-300">{id}</span>
                  {installButton(id)}
                </li>
              ))}
            </ul>
          </section>
        )}

        {curated.length > 0 && (
          <section className="p-4" aria-label="Popular">
            <h4 className="mb-2 text-xs text-gray-300">Popular</h4>
            <ul className="space-y-1.5">
              {curated.map((r) => (
                <li key={r.id} className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-xs text-gray-300">{r.id}</div>
                    <div className="text-[11px] text-gray-500">{r.why}</div>
                  </div>
                  {installButton(r.id)}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function InstalledRow({ ext, theme }: { ext: Installed; theme: string | null }) {
  return (
    <li className="rounded-lg border border-border p-2.5">
      <div className="flex items-center gap-2">
        <span className={`truncate text-sm ${ext.enabled ? 'text-gray-100' : 'text-gray-500'}`}>{ext.displayName}</span>
        <span className="text-[10px] text-gray-500">{ext.version}</span>
        <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
          <input type="checkbox" checked={ext.enabled} onChange={(e) => setExtensionEnabled(ext.id, e.target.checked)} aria-label={`${ext.displayName} on`} />
          on
        </label>
      </div>
      <div className="mt-0.5 text-[11px] text-gray-500">
        {[ext.themes.length && `${ext.themes.length} theme${ext.themes.length > 1 ? 's' : ''}`, ext.snippets.length && `${ext.snippets.length} snippets`].filter(Boolean).join(' · ') || 'nothing usable yet'}
      </div>
      {ext.unsupported.length > 0 && <div className="mt-0.5 text-[11px] text-gray-600" title="The studio reads extensions, it does not run them">Not supported: {ext.unsupported.join(', ')}</div>}
      {ext.enabled && ext.themes.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ext.themes.map((t) => (
            <button key={t.id} onClick={() => chooseExtensionTheme(t.id)} aria-pressed={theme === t.id} className={`btn btn-sm h-6 ${theme === t.id ? 'btn-primary' : 'btn-secondary'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <button onClick={() => uninstallExtension(ext.id)} className="btn btn-ghost btn-sm mt-1 h-6 text-gray-500 hover:text-danger" aria-label={`Uninstall ${ext.displayName}`}>Uninstall</button>
    </li>
  );
}
