import type { Metadata } from 'next';
import Link from 'next/link';
import { Downloads } from '@/components/Downloads';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { pageMeta } from '@/lib/site';

export const metadata: Metadata = pageMeta({
  title: 'Download',
  description: 'Aha! for macOS (Apple silicon) and Windows, or run it from source on Linux. The same studio as the browser version, as a native app.',
  path: '/download',
});

export default function DownloadPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader active="/download">
        <Link href="/" className="btn btn-primary btn-sm">Open the studio</Link>
      </SiteHeader>
      <main id="main" className="mx-auto max-w-6xl px-4 py-16" aria-labelledby="download-title">
        <Downloads heading="Aha! for your desktop." />
      </main>
      <SiteFooter />
    </div>
  );
}
