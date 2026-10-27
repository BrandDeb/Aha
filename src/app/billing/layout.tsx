import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Per-account and not for search results
export const metadata: Metadata = { title: 'Team and billing', robots: { index: false, follow: false } };

export default function BillingLayout({ children }: { children: ReactNode }) {
  return children;
}
