'use client';

/**
 * Aha! - FAQ
 * Searchable, filterable answers. Keep these accurate to what the code does.
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { CATEGORIES, FAQS, type Category } from '@/lib/faq';

export default function FAQPage() {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<Category | 'All'>('All');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return FAQS.filter((faq) =>
      (category === 'All' || faq.category === category) &&
      (!q || faq.question.toLowerCase().includes(q) || faq.answer.toLowerCase().includes(q))
    );
  }, [query, category]);

  return (
    <div className="app-bg min-h-screen">
      <SiteHeader active="/faq">
        <Link href="/" prefetch={false} className="btn btn-primary btn-sm">Open editor</Link>
      </SiteHeader>

      <main id="main" className="mx-auto max-w-3xl px-4 pt-16 pb-24">
        <div className="eyebrow">Help</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Frequently asked questions</h1>
        <p className="mt-3 text-gray-400">
          How Aha! and scriptc work, what they support today, and how to run your own.
        </p>

        <div className="mt-8 flex flex-col gap-3">
          <div className="relative">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search questions…"
              aria-label="Search questions"
              className="input h-11 pl-10"
            />
            <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {(['All', ...CATEGORIES] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  category === c
                    ? 'border-accent bg-accent text-[var(--color-accent-fg)]'
                    : 'border-border text-gray-400 hover:border-border-strong hover:text-gray-100'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-8 divide-y divide-border border-y border-border">
          {filtered.map((faq) => (
            <details key={faq.id} id={faq.id} className="group py-5">
              <summary className="flex cursor-pointer list-none items-start justify-between gap-6">
                <span className="font-medium text-gray-100">{faq.question}</span>
                <span className="mt-0.5 shrink-0 text-gray-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
              </summary>
              <p className="mt-3 text-[15px] leading-relaxed text-gray-400">{faq.answer}</p>
              <span className="mt-3 inline-block font-mono text-xs text-gray-500">{faq.category}</span>
            </details>
          ))}
          {filtered.length === 0 && (
            <div className="py-12 text-center text-gray-500">
              No questions match “{query}”.{' '}
              <button onClick={() => { setQuery(''); setCategory('All'); }} className="text-gray-100 underline underline-offset-4">
                Clear filters
              </button>
            </div>
          )}
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
