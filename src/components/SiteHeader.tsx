import Link from 'next/link';
import type { ReactNode } from 'react';

const NAV = [
  { href: '/landing', label: 'Product' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/download', label: 'Download' },
  { href: '/docs', label: 'Docs' },
  { href: '/faq', label: 'FAQ' },
  { href: '/', label: 'Studio' },
] as const;

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/landing" className="flex shrink-0 items-center" aria-label="NanoCLI home">
      <span className={`wordmark text-gray-100 ${compact ? 'text-lg' : 'text-[22px]'}`}>NANOCLI</span>
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
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
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
                  ? 'bg-white/[0.07] text-gray-100'
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
        </div>
      </div>
      {!fluid && (
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 text-sm md:hidden" aria-label="Main (mobile)">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={active === item.href ? 'page' : undefined} className={`shrink-0 rounded-md px-2.5 py-1 ${active === item.href ? 'bg-white/[0.07] text-gray-100' : 'text-gray-400'}`}>
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Logo compact />
          <span>© 2026 BrandDeb. All rights reserved.</span>
        </div>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2" aria-label="Footer">
          <Link href="/landing" className="hover:text-gray-100 transition-colors">Product</Link>
          <Link href="/pricing" className="hover:text-gray-100 transition-colors">Pricing</Link>
          <Link href="/docs" className="hover:text-gray-100 transition-colors">Docs</Link>
          <Link href="/faq" className="hover:text-gray-100 transition-colors">FAQ</Link>
          <a href="https://scriptc.dev" className="hover:text-gray-100 transition-colors">scriptc</a>
        </nav>
      </div>
    </footer>
  );
}
