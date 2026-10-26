import Link from 'next/link';
import type { ReactNode } from 'react';
import { docHref, type Block, type DocPage, type Inline } from '@/lib/docs';

/** One page of the docs, from the blocks lib/docs parsed out of docs/guide.md */
export function DocBody({ page, pages }: { page: DocPage; pages: DocPage[] }) {
  const inline = (runs: Inline[]): ReactNode[] =>
    runs.map((r, i) => {
      switch (r.t) {
        case 'text':
          return r.v;
        case 'code':
          return (
            <code key={i} className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.85em] text-gray-100">
              {r.v}
            </code>
          );
        case 'strong':
          return (
            <strong key={i} className="font-semibold text-gray-100">
              {inline(r.c)}
            </strong>
          );
        case 'em':
          return <em key={i}>{inline(r.c)}</em>;
        case 'link': {
          const href = docHref(r.href, pages);
          const cls = 'text-accent underline-offset-4 hover:underline';
          return href.startsWith('/') || href.startsWith('#') ? (
            <Link key={i} href={href} className={cls}>
              {inline(r.c)}
            </Link>
          ) : (
            <a key={i} href={href} className={cls} target="_blank" rel="noreferrer">
              {inline(r.c)}
            </a>
          );
        }
      }
    });

  const block = (b: Block, i: number) => {
    switch (b.t) {
      case 'h':
        return b.level === 3 ? (
          <h2 key={i} id={b.id} className="mt-12 scroll-mt-20 text-xl font-semibold tracking-tight text-gray-100">
            <a href={`#${b.id}`} className="hover:text-accent">
              {inline(b.c)}
            </a>
          </h2>
        ) : (
          <h3 key={i} id={b.id} className="mt-8 scroll-mt-20 text-base font-semibold text-gray-100">
            {inline(b.c)}
          </h3>
        );
      case 'p':
        return (
          <p key={i} className="mt-4 leading-7 text-gray-300">
            {inline(b.c)}
          </p>
        );
      case 'quote':
        return (
          <blockquote key={i} className="mt-4 border-l-2 border-[var(--accent-line)] pl-4 text-gray-300">
            {inline(b.c)}
          </blockquote>
        );
      case 'list': {
        const Tag = b.ordered ? 'ol' : 'ul';
        return (
          <Tag key={i} className={`mt-4 space-y-2 pl-5 leading-7 text-gray-300 ${b.ordered ? 'list-decimal' : 'list-disc'} marker:text-gray-500`}>
            {b.items.map((item, j) => (
              <li key={j}>{inline(item)}</li>
            ))}
          </Tag>
        );
      }
      case 'code':
        return (
          <div key={i} className="group relative mt-4">
            {b.lang && <span className="absolute right-3 top-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">{b.lang}</span>}
            <pre className="overflow-x-auto rounded-lg border border-border bg-black/40 p-4 font-mono text-[13px] leading-6 text-gray-200">
              <code>{b.v}</code>
            </pre>
          </div>
        );
      case 'table':
        return (
          <div key={i} className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-sm">
              <thead className="bg-white/[0.03] text-gray-200">
                <tr>
                  {b.head.map((c, j) => (
                    <th key={j} className="px-3 py-2 font-medium">
                      {inline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-gray-400">
                {b.rows.map((row, j) => (
                  <tr key={j}>
                    {row.map((c, k) => (
                      <td key={k} className="px-3 py-2 align-top">
                        {inline(c)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
    }
  };

  return <div>{page.blocks.map(block)}</div>;
}
