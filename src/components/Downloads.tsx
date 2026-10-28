import Link from 'next/link';
import { buildsUrl, downloadUrl, fetchRelease, formatSize, PLATFORMS, releaseUrl } from '@/lib/downloads';
import { PlatformHighlight } from './PlatformHighlight';

/** One card per platform: what it needs, the download, and how to install it */
export async function Downloads({ headingId = 'download-title', heading = 'Get the app.' }: { headingId?: string; heading?: string }) {
  const fetched = await fetchRelease();
  const release = fetched === 'missing' ? null : fetched;
  const built = release?.updatedAt ? new Date(release.updatedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }) : null;
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-accent">Download</div>
          <h2 id={headingId} className="mt-3 text-3xl font-semibold tracking-tight">{heading}</h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-gray-400">
            The same studio as the browser version, as a native app: it runs its own server on your machine, uses the compilers you already have, and works offline with a local model.
          </p>
        </div>
        <a href={releaseUrl()} className="btn btn-ghost" target="_blank" rel="noopener noreferrer">
          All files and checksums →
        </a>
      </div>
      {/* Highlights the card for the visitor's system once the page is in the browser */}
      <PlatformHighlight />
      <div className="mt-8 grid gap-3 md:grid-cols-3">
        {PLATFORMS.map((p) => {
          const asset = p.file ? release?.assets[p.file] : undefined;
          // Known not to be published yet: say so rather than link to a 404
          const pending = !!p.file && (fetched === 'missing' || (!!release && !asset));
          return (
            <article key={p.id} id={`download-${p.id}`} data-platform={p.id} className="surface flex flex-col p-6 transition-colors data-[mine=true]:border-accent/60">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-lg font-medium text-gray-100">{p.name}</h3>
                <span className="hidden text-[11px] font-medium uppercase tracking-wider text-accent data-[mine=true]:inline" data-mine-label>Your system</span>
              </div>
              <p className="mt-1 text-sm text-gray-400">{p.requirement}</p>
              <div className="mt-5">
                {pending ? (
                  <a href={buildsUrl()} target="_blank" rel="noopener noreferrer" className="btn btn-secondary h-11 w-full text-[15px]">
                    Being built: check progress
                  </a>
                ) : p.file ? (
                  <a href={asset?.url ?? downloadUrl(p.file)} className="btn btn-primary h-11 w-full text-[15px]">
                    Download for {p.name}
                  </a>
                ) : (
                  <Link href="/" prefetch={false} className="btn btn-secondary h-11 w-full text-[15px]">Use it in the browser</Link>
                )}
                {!pending && p.alternates?.map((alt) => (
                  <a key={alt.file} href={release?.assets[alt.file]?.url ?? downloadUrl(alt.file)} className="mt-2 block text-center text-sm text-gray-400 underline-offset-4 hover:text-gray-100 hover:underline">
                    {alt.label}
                    {release?.assets[alt.file] && ` · ${formatSize(release.assets[alt.file].size)}`}
                  </a>
                ))}
                <p className="mt-2 text-center font-mono text-[11px] text-gray-500">
                  {pending ? 'Available here in a few minutes' : p.kind}
                  {asset && ` · ${formatSize(asset.size)}`}
                  {p.file && built && ` · built ${built}${release?.commit ? ` (${release.commit})` : ''}`}
                </p>
              </div>
              <ol className="mt-5 space-y-1.5 text-sm leading-relaxed text-gray-300">
                {p.steps.map((step, i) => (
                  <li key={step} className="flex gap-2">
                    <span className="font-mono text-xs leading-6 text-gray-500">{i + 1}</span>
                    <span className={p.file ? '' : 'break-all font-mono text-xs leading-6'}>{step}</span>
                  </li>
                ))}
              </ol>
              {p.unsigned && (
                <details className="mt-4 text-sm">
                  <summary className="cursor-pointer text-gray-400 hover:text-gray-100">First launch says it can’t verify the app?</summary>
                  <p className="mt-2 break-words leading-relaxed text-gray-400">{p.unsigned}</p>
                </details>
              )}
            </article>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-gray-500">
        Intel Mac, ARM Windows or a Chromebook? Use the studio in your browser for now. Prefer containers? <code className="font-mono">docker compose up</code> runs it on any system.
      </p>
    </div>
  );
}
