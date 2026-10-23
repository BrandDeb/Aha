import Link from 'next/link';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { DocBody } from '../DocBody';
import { DocsNav } from '../DocsNav';
import { DocsSearch } from '../DocsSearch';
import { searchEntries } from '@/lib/docs';
import { loadDocs } from '../load';

// Every page comes from README.md at build time
export const dynamicParams = false;

export function generateStaticParams() {
  return loadDocs().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const page = loadDocs().find((p) => p.slug === slug);
  return page ? { title: `${page.title} · NanoCLI Studio docs`, description: page.summary.slice(0, 200) } : {};
}

export default async function DocPageView({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const pages = loadDocs();
  const index = pages.findIndex((p) => p.slug === slug);
  if (index < 0) notFound();
  const page = pages[index];
  const prev = pages[index - 1];
  const next = pages[index + 1];

  return (
    <div className="min-h-screen bg-background text-gray-100">
      <SiteHeader active="/docs" />
      <div className="mx-auto flex max-w-7xl gap-10 px-4 py-10">
        <aside className="hidden w-56 shrink-0 lg:block">
          <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-6 overflow-y-auto pb-10 pr-1">
            <DocsSearch entries={searchEntries(pages)} />
            <DocsNav pages={pages} active={slug} />
          </div>
        </aside>

        <main className="min-w-0 max-w-3xl flex-1">
          <div className="lg:hidden">
            <DocsSearch entries={searchEntries(pages)} />
            <details className="mt-3 rounded-lg border border-border px-3 py-2 text-sm">
              <summary className="cursor-pointer text-gray-300">All pages</summary>
              <div className="mt-3">
                <DocsNav pages={pages} active={slug} />
              </div>
            </details>
          </div>
          <nav aria-label="Breadcrumb" className="mt-6 text-xs text-gray-500 lg:mt-0">
            <Link href="/docs" className="hover:text-gray-200">
              Docs
            </Link>{' '}
            › {page.group}
          </nav>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{page.title}</h1>
          <article className="pb-6">
            <DocBody page={page} pages={pages} />
          </article>

          <div className="mt-12 grid gap-3 border-t border-border pt-6 sm:grid-cols-2">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="rounded-lg border border-border p-3 hover:border-border-strong">
                <span className="block text-xs text-gray-500">Previous</span>
                <span className="text-sm text-gray-100">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={`/docs/${next.slug}`} className="rounded-lg border border-border p-3 text-right hover:border-border-strong">
                <span className="block text-xs text-gray-500">Next</span>
                <span className="text-sm text-gray-100">{next.title}</span>
              </Link>
            )}
          </div>
        </main>

        {page.toc.length > 1 && (
          <aside className="hidden w-52 shrink-0 xl:block" aria-label="On this page">
            <div className="sticky top-20">
              <div className="eyebrow mb-2">On this page</div>
              <ul className="space-y-1.5 text-sm">
                {page.toc.map((t) => (
                  <li key={t.id} className={t.level === 4 ? 'pl-3' : ''}>
                    <a href={`#${t.id}`} className="text-gray-400 hover:text-gray-100">
                      {t.title}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        )}
      </div>
      <SiteFooter />
    </div>
  );
}
