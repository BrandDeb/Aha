import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { cleanupRunProjects, getLanguageStatuses, isRunEnabled, parseRunRequest, runLanguage } from '@/lib/polyglot';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Each request starts processes; cap them per client */
const limiter = createRateLimiter(Number(process.env.AHA_RUN_REQUESTS_PER_10_MIN) || 150, 10 * 60 * 1000);

/** Which languages this machine can run, and how to get the ones it can't */
export async function GET(request: NextRequest) {
  if (!isRunEnabled()) return NextResponse.json({ enabled: false, languages: [] });
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Not available for this host name.' }, { status: 403 });
  }
  return NextResponse.json({ enabled: true, languages: await getLanguageStatuses() });
}

/**
 * Run a project in one of the supported languages. The response is
 * newline-delimited JSON, like /api/python:
 *   { t: 'out', s: 'stdout' | 'stderr' | 'info', d: text }   as output arrives
 *   { t: 'done', code, ms, changed, removed, skipped, … }    once, at the end
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  // Running code is the most sensitive thing this server does: also refuse hosts it wasn't set up for
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Programs are only run for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' }, { status: 403 });
  }
  if (!isRunEnabled()) {
    return NextResponse.json({ error: 'Running other languages is off on this server: it only runs programs when it listens on your own machine (or AHA_RUN=1).' }, { status: 503 });
  }
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many runs. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });
  if (Number(request.headers.get('content-length')) > 12 * 1024 * 1024) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });

  const parsed = parseRunRequest(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  void cleanupRunProjects();

  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort());
  const body = new ReadableStream<Uint8Array>({
    async start(stream) {
      const send = (event: Record<string, unknown>) => {
        try {
          stream.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the client went away
        }
      };
      try {
        const result = await runLanguage(parsed, { signal: controller.signal, onOutput: (s, d) => send({ t: 'out', s, d }) });
        send({ t: 'done', ...result });
      } catch (error) {
        console.error('Run failed:', error);
        send({ t: 'done', code: null, ms: 0, changed: {}, removed: [], skipped: [], error: error instanceof Error ? error.message : 'The run failed' });
      } finally {
        try {
          stream.close();
        } catch {
          // already closed
        }
      }
    },
    cancel() {
      controller.abort();
    },
  });
  return new Response(body, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
