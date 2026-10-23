import Link from 'next/link';
import type { DocPage } from '@/lib/docs';

/** The docs sidebar: every page, by group */
export function DocsNav({ pages, active }: { pages: DocPage[]; active?: string }) {
  const groups = [...new Set(pages.map((p) => p.group))];
  return (
    <nav aria-label="Docs" className="space-y-6 text-sm">
      {groups.map((g) => (
        <div key={g}>
          <div className="eyebrow mb-2">{g}</div>
          <ul className="space-y-0.5">
            {pages
              .filter((p) => p.group === g)
              .map((p) => (
                <li key={p.slug}>
                  <Link
                    href={`/docs/${p.slug}`}
                    aria-current={active === p.slug ? 'page' : undefined}
                    className={`block rounded-md px-2.5 py-1.5 transition-colors ${active === p.slug ? 'bg-[var(--accent-soft)] text-accent' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}`}
                  >
                    {p.title}
                  </Link>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
