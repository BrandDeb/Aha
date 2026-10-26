import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonLimited } from '@/lib/request-guard';
import { fetchPublic } from '@/lib/connectors/net';
import { fetchRepo, guessEntry, outlineOf, parseRemixSource, remixName } from '@/lib/remix';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Each remix downloads a repository or a page: enough to try several, not enough to be a proxy */
const limiter = createRateLimiter(30, 10 * 60 * 1000);

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * { source: "owner/repo" | "https://github.com/owner/repo[/tree/ref]" }  → { kind: 'repo', name, files, entry, license, skipped, ref }
 * { source: "https://example.com" }                                    → { kind: 'site', name, outline }
 * Repositories come from codeload.github.com only; pages through the public-address fetcher, which never reaches
 * private networks or follows redirects into them.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) return json({ error: 'Not available for this host name.' }, 403);
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return json({ error: `Too many remixes. Try again in ${Math.ceil(wait / 60)} min.` }, 429);
  const body = await readJsonLimited(request, 4096);
  if (!body.ok) return json({ error: body.error }, body.status);
  const raw = (body.value as { source?: unknown } | null)?.source;
  const source = typeof raw === 'string' ? parseRemixSource(raw) : null;
  if (!source) return json({ error: 'Paste a GitHub repository (owner/repo or its URL) or a website address.' }, 400);
  try {
    if (source.kind === 'repo') {
      const snap = await fetchRepo(source);
      if (!Object.keys(snap.files).length) return json({ error: 'That repository has no text files to remix.' }, 422);
      return json({ kind: 'repo', name: remixName(source), files: snap.files, entry: guessEntry(snap.files), license: snap.license, skipped: snap.skipped.length, ref: snap.ref, source });
    }
    const page = await fetchPublic(source.url, { maxBytes: 1024 * 1024, timeoutMs: 15_000, headers: { 'User-Agent': 'Aha-Remix/1.0', Accept: 'text/html' } });
    if (page.status >= 400) return json({ error: `The site answered ${page.status}.` }, 502);
    if (!/html/i.test(String(page.headers['content-type'] ?? ''))) return json({ error: 'That address is not a web page.' }, 422);
    const outline = outlineOf(page.body.toString('utf8'), page.url);
    return json({ kind: 'site', name: remixName(source, outline), outline, source });
  } catch (error) {
    return json({ error: (error as Error).message }, 502);
  }
}
