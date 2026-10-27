import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonOrNull } from '@/lib/request-guard';
import { packageFacts } from '@/lib/supply-chain-registry';
import type { Ecosystem } from '@/lib/supply-chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(120, 10 * 60 * 1000);
const ECOSYSTEMS = new Set<Ecosystem>(['npm', 'PyPI', 'crates.io', 'Go', 'RubyGems', 'Packagist']);
const MAX = 30;
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

/**
 * POST { deps: [{ ecosystem, name, spec }] } → { facts: PackageFacts[] }
 * What npm, PyPI and OSV say about each new dependency of a proposal. Only names go out, to fixed hosts.
 */
export async function POST(request: NextRequest) {
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) return json({ error: 'Not available for this host name.' }, 403);
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  if (limiter.check(clientKey(request.headers))) return json({ error: 'Too many checks; try again in a few minutes.' }, 429);
  const body = (await readJsonOrNull(request, 64 * 1024)) as { deps?: unknown } | null;
  if (!body || !Array.isArray(body.deps) || body.deps.length > MAX) return json({ error: `deps must be a list of at most ${MAX} packages` }, 400);
  const deps: { ecosystem: Ecosystem; name: string; spec: string }[] = [];
  for (const d of body.deps as Record<string, unknown>[]) {
    if (!d || typeof d.name !== 'string' || !ECOSYSTEMS.has(d.ecosystem as Ecosystem)) return json({ error: 'Each dependency needs an ecosystem and a name' }, 400);
    deps.push({ ecosystem: d.ecosystem as Ecosystem, name: d.name.slice(0, 220), spec: typeof d.spec === 'string' ? d.spec.slice(0, 80) : '' });
  }
  return json({ facts: await Promise.all(deps.map((d) => packageFacts(d.ecosystem, d.name, d.spec))) });
}
