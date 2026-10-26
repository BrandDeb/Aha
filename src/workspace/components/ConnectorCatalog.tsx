'use client';

/**
 * The connector catalog in Settings → Connectors: well-known MCP servers by category, searchable, each with what it
 * gives the agent and what it needs. Pick one, fill in its key if it has one, and it is added and tested at once.
 */

import { useState } from 'react';
import { CATALOG_CATEGORIES, connectorFrom, searchCatalog, setupLabel, type CatalogCategory, type CatalogEntry } from '@/lib/connectors/catalog';
import type { Connector } from '@/lib/connectors/types';
import { newConnectorId, upsertConnector } from '../connectors-config';

interface Props {
  /** A shared studio: connectors that run programs here are off */
  hosted: boolean;
  existing: Connector[];
  onAdded: (connector: Connector) => void;
}

const added = (e: CatalogEntry, existing: Connector[]) =>
  existing.some((c) => (c.kind === 'mcp-http' && e.transport.kind === 'mcp-http' && c.url === e.transport.url) || (c.kind === 'mcp-stdio' && e.transport.kind === 'mcp-stdio' && c.args.join(' ').includes(e.transport.args.filter((a) => !a.includes('{')).slice(1, 2).join(''))));

export function ConnectorCatalog({ hosted, existing, onAdded }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<CatalogCategory | 'All'>('All');
  const [open, setOpen] = useState<CatalogEntry | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const entries = searchCatalog(query, category);

  const add = () => {
    if (!open) return;
    const made = connectorFrom(open, values);
    if ('error' in made) return setError(made.error);
    const connector = { ...made, id: newConnectorId() } as Connector;
    upsertConnector(connector);
    onAdded(connector);
    setOpen(null);
    setValues({});
    setError('');
  };

  return (
    <section className="space-y-3 rounded-xl border border-border p-3" aria-label="Connector catalog">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm text-gray-100">Catalog</div>
        <span className="text-[11px] text-gray-500">{entries.length} MCP servers · add in one step</span>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: database, browser, Jira, payments…" aria-label="Search the catalog" className="input ml-auto h-8 w-full text-xs sm:w-64" />
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="Categories">
        {(['All', ...CATALOG_CATEGORIES] as const).map((c) => (
          <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c} className={`rounded-full border px-2 py-0.5 text-[11px] ${category === c ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-border text-gray-400 hover:text-gray-100'}`}>
            {c}
          </button>
        ))}
      </div>

      <ul className="grid max-h-[26rem] gap-2 overflow-y-auto pr-1 sm:grid-cols-2" aria-label="Connectors you can add">
        {entries.map((e) => {
          const blocked = hosted && e.runs === 'local';
          const isAdded = added(e, existing);
          return (
            <li key={e.id}>
              <button
                onClick={() => {
                  setOpen(e);
                  setValues({});
                  setError('');
                }}
                disabled={blocked}
                title={blocked ? 'Runs a program on the server: only when the studio runs on your own machine' : e.homepage}
                className={`h-full w-full rounded-lg border p-2.5 text-left transition-colors disabled:opacity-40 ${open?.id === e.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong hover:bg-white/[0.03]'}`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-sm text-gray-100">{e.name}</span>
                  {e.official && <span className="rounded bg-white/[0.06] px-1 text-[10px] text-gray-400" title={`Made by ${e.publisher}`}>official</span>}
                  {isAdded && <span className="ml-auto text-[10px] text-accent">added</span>}
                </div>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-400">{e.description}</p>
                <div className="mt-1.5 flex flex-wrap gap-1 text-[10px] text-gray-500">
                  <span className="rounded border border-border px-1">{setupLabel(e)}</span>
                  {e.readOnly && <span className="rounded border border-border px-1">read-only</span>}
                  <span className="truncate">{e.publisher}</span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {open && (
        <form
          className="space-y-2 rounded-lg border border-[var(--accent-line)] p-3"
          aria-label={`Add ${open.name}`}
          onSubmit={(ev) => {
            ev.preventDefault();
            add();
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-100">{open.name}</span>
            <a href={open.homepage} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">docs ↗</a>
            <button type="button" onClick={() => setOpen(null)} className="ml-auto text-xs text-gray-500 hover:text-gray-100" aria-label="Close">✕</button>
          </div>
          <p className="text-xs text-gray-400">{open.description}</p>
          {open.auth === 'oauth' && <p className="text-[11px] text-gray-500">Signs in with your {open.publisher} account: the first time the agent uses it, a browser window opens to log in (through mcp-remote). The token stays on this machine.</p>}
          {open.needs === 'uv' && <p className="text-[11px] text-gray-500">Runs with uv (uvx), which the studio installs for Python projects.</p>}
          {open.needs === 'node' && open.auth !== 'oauth' && <p className="text-[11px] text-gray-500">Runs with npx on this machine; the first start downloads it.</p>}
          {open.note && <p className="text-[11px] text-warn">{open.note}</p>}
          {open.inputs.map((input) => (
            <label key={input.key} className="block space-y-1">
              <span className="flex items-center gap-2 text-xs text-gray-300">
                {input.label}
                {input.help && <a href={input.help} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">get one ↗</a>}
              </span>
              <input
                type={input.secret ? 'password' : 'text'}
                autoComplete="off"
                spellCheck={false}
                value={values[input.key] ?? ''}
                onChange={(ev) => setValues({ ...values, [input.key]: ev.target.value })}
                placeholder={input.placeholder ?? (input.optional ? 'optional' : '')}
                className="input h-8 w-full font-mono text-xs"
              />
            </label>
          ))}
          {open.inputs.some((i) => i.secret) && <p className="text-[11px] text-gray-500">Keys stay in this browser and go to the studio only with the call that needs them.</p>}
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <button type="submit" className="btn btn-primary btn-sm">Add and test</button>
        </form>
      )}
    </section>
  );
}
