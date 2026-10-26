import Link from 'next/link';
import type { Metadata } from 'next';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { DOC_GROUPS, searchEntries } from '@/lib/docs';
import { DocsSearch } from './DocsSearch';
import { loadDocs } from './load';
import { JsonLd } from '@/components/JsonLd';
import { breadcrumbLd, pageMeta, siteUrl } from '@/lib/site';

export const metadata: Metadata = pageMeta({
  title: 'Docs',
  description: 'How Aha! works: the editor, live values, the agent and its proposals, templates, pipelines, the desktop app, configuration and the API.',
  path: '/docs',
});

export default function DocsIndex() {
  const pages = loadDocs();
  const groups = [...DOC_GROUPS.map((g) => g.name), 'More'].filter((g) => pages.some((p) => p.group === g));
  return (
    <div className="min-h-screen bg-background text-gray-100">
      <JsonLd data={breadcrumbLd(siteUrl(), [{ name: 'Home', path: '/landing' }, { name: 'Docs', path: '/docs' }])} />
      <SiteHeader active="/docs" />
      <main className="mx-auto max-w-6xl px-4 py-14">
        <div className="eyebrow">Docs</div>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Aha! documentation</h1>
        <p className="mt-3 max-w-2xl text-gray-400">Everything the studio does and how to run your own: writing code with live values and contracts, the agent and its proposals, templates for every language, pipelines, the desktop app, configuration and the API.</p>
        <div className="mt-8 max-w-xl">
          <DocsSearch entries={searchEntries(pages)} />
        </div>
        <div className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <section key={g} aria-labelledby={`g-${g}`}>
              <h2 id={`g-${g}`} className="eyebrow mb-3">
                {g}
              </h2>
              <ul className="space-y-2">
                {pages
                  .filter((p) => p.group === g)
                  .map((p) => (
                    <li key={p.slug}>
                      <Link href={`/docs/${p.slug}`} className="block rounded-lg border border-border p-3 transition-colors hover:border-border-strong hover:bg-white/[0.02]">
                        <span className="block text-sm font-medium text-gray-100">{p.title}</span>
                        {p.summary && <span className="mt-1 line-clamp-2 block text-xs leading-relaxed text-gray-500">{p.summary}</span>}
                      </Link>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
