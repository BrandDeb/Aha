import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { isRunEnabled } from '@/lib/polyglot';
import { parseShellRequest, runShell } from '@/lib/shell';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Each request starts processes; cap them per client */
const limiter = createRateLimiter(Number(process.env.NANOCLI_SHELL_REQUESTS_PER_10_MIN) || 300, 10 * 60 * 1000);

/** Whether this server runs terminal commands */
export async function GET() {
  return NextResponse.json({ enabled: isRunEnabled() });
}

/**
 * Run a terminal command in the project's folder on this machine. The response is
 * newline-delimited JSON, like /api/run:
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
    return NextResponse.json({ error: 'The terminal only runs real commands when the studio listens on your own machine (or NANOCLI_RUN=1).' }, { status: 503 });
  }
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many commands. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });
  if (Number(request.headers.get('content-length')) > 12 * 1024 * 1024) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });

  const parsed = parseShellRequest(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

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
        const result = await runShell(parsed, { signal: controller.signal, onOutput: (s, d) => send({ t: 'out', s, d }) });
        send({ t: 'done', ...result });
      } catch (error) {
        console.error('Shell command failed:', error);
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
