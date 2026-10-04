import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/', label: 'Editor' },
  { href: '/studio', label: 'Studio' },
  { href: '/unified', label: 'Toolkit' },
  { href: '/landing', label: 'Overview' },
  { href: '/faq', label: 'FAQ' },
] as const;

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/landing" className="flex items-center gap-2.5 shrink-0" aria-label="NanoCLI home">
      <span className="grid h-7 w-7 place-items-center rounded-md bg-gray-100 text-[11px] font-bold text-black font-mono">
        &gt;_
      </span>
      {!compact && (
        <span className="text-[15px] font-semibold tracking-tight text-gray-100">
          NanoCLI
        </span>
      )}
    </Link>
  );
}

interface SiteHeaderProps {
  /** Path of the current page, used to highlight the nav item */
  active?: (typeof NAV)[number]['href'];
  /** Right-hand controls (sign in, settings, ...) */
  children?: ReactNode;
  /** Content between the nav and the actions (e.g. a project name) */
  center?: ReactNode;
  /** Full-width bar for app layouts, centered container for content pages */
  fluid?: boolean;
}

export function SiteHeader({ active, children, center, fluid = false }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-black/70 backdrop-blur-xl supports-[backdrop-filter]:bg-black/55">
      <div className={`flex h-14 items-center gap-6 px-4 ${fluid ? '' : 'mx-auto max-w-6xl'}`}>
        <Logo />
        <nav className="hidden md:flex items-center gap-1 text-sm" aria-label="Main">
          {NAV.map(item => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active === item.href ? 'page' : undefined}
              className={`rounded-md px-2.5 py-1.5 transition-colors ${
                active === item.href
                  ? 'text-gray-100 bg-white/[0.06]'
                  : 'text-gray-400 hover:text-gray-100'
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        {center && <div className="hidden lg:flex min-w-0 flex-1 items-center justify-center">{center}</div>}
        <div className="ml-auto flex items-center gap-2">
          {children}
          <a
            href="https://scriptc.dev"
            target="_blank"
            rel="noreferrer"
            className="hidden sm:inline-flex badge hover:text-gray-100 transition-colors"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-success" />
            scriptc 0.2
          </a>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo compact />
          <span>Native binaries from TypeScript, compiled with scriptc.</span>
        </div>
        <div className="flex items-center gap-5">
          <a href="https://scriptc.dev" className="hover:text-gray-100 transition-colors">scriptc docs</a>
          <a href="https://github.com/vercel-labs/scriptc" className="hover:text-gray-100 transition-colors">scriptc on GitHub</a>
          <a href="https://github.com/BrandDeb/Aha" className="hover:text-gray-100 transition-colors">Source</a>
        </div>
      </div>
    </footer>
  );
}
