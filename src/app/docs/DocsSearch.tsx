'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { searchDocs, type SearchEntry } from '@/lib/docs';

/** Search every page of the docs as you type */
export function DocsSearch({ entries, autoFocus = false }: { entries: SearchEntry[]; autoFocus?: boolean }) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchDocs(entries, query).slice(0, 8), [entries, query]);
  return (
    <div className="relative">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search the docs…"
        aria-label="Search the docs"
        autoFocus={autoFocus}
        className="input h-10 w-full pl-9 text-sm"
      />
      <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      {query.trim() && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 max-h-96 overflow-y-auto rounded-lg border border-border bg-[var(--surface-2,#111)] p-1 shadow-2xl" role="listbox" aria-label="Search results">
          {results.length ? (
            results.map((p) => {
              const section = p.toc.find((t) => query.toLowerCase().split(/\s+/).some((w) => w && t.title.toLowerCase().includes(w)));
              return (
                <Link key={p.slug} href={`/docs/${p.slug}${section ? `#${section.id}` : ''}`} onClick={() => setQuery('')} className="block rounded-md px-3 py-2 hover:bg-white/[0.06]" role="option" aria-selected={false}>
                  <span className="block text-sm text-gray-100">
                    {p.title}
                    {section && <span className="text-gray-500"> › {section.title}</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-1 block text-xs text-gray-500">{p.summary}</span>
                </Link>
              );
            })
          ) : (
            <p className="px-3 py-2 text-sm text-gray-500">Nothing matches “{query}”.</p>
          )}
        </div>
      )}
    </div>
  );
}

