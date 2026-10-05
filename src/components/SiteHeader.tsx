import Link from 'next/link';
import type { ReactNode } from 'react';
import { ByteField } from './ByteField';

const NAV = [
  { href: '/', label: 'Workspace' },
  { href: '/landing', label: 'Overview' },
  { href: '/unified', label: 'Toolkit' },
  { href: '/faq', label: 'FAQ' },
] as const;

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/landing" className="flex shrink-0 items-center" aria-label="NanoCLI home">
      <span className={`display leading-none text-gray-100 ${compact ? 'text-lg' : 'text-[22px]'}`}>NANOCLI</span>
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
  /** How strongly the byte field shows behind the page */
  byteField?: 'ambient' | 'hero';
}

export function SiteHeader({ active, children, center, fluid = false, byteField = 'ambient' }: SiteHeaderProps) {
  return (
    <>
    <ByteField intensity={byteField} />
    <header className="sticky top-3 z-40 px-3">
      <div className={`glass flex h-14 items-center gap-6 rounded-2xl px-4 ${fluid ? '' : 'mx-auto max-w-6xl'}`}>
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
            <span className="dot" aria-hidden="true" />
            scriptc 0.2
          </a>
        </div>
      </div>
    </header>
    </>
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
        <div className="flex items-center gap-5">
          <a href="https://scriptc.dev" className="hover:text-gray-100 transition-colors">scriptc docs</a>
          <a href="https://github.com/vercel-labs/scriptc" className="hover:text-gray-100 transition-colors">scriptc on GitHub</a>
          <Link href="/faq" className="hover:text-gray-100 transition-colors">FAQ</Link>
        </div>
      </div>
    </footer>
  );
}
