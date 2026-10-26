import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { cleanupPythonProjects, getPythonStatus, installManagedUv, isPythonEnabled, parsePythonRequest, runPython } from '@/lib/python';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Each request can start a process; cap them per client */
const limiter = createRateLimiter(Number(process.env.AHA_PY_REQUESTS_PER_10_MIN) || 120, 10 * 60 * 1000);

/** Whether uv is available, and which Python versions it already has */
export async function GET() {
  return NextResponse.json(await getPythonStatus());
}

/**
 * Run a Python action (run, add, remove, sync, lock, init, tree, pin) in the
 * project's directory with uv. The response is newline-delimited JSON:
 *   { t: 'out', s: 'stdout' | 'stderr' | 'info', d: text }   as output arrives
 *   { t: 'done', code, ms, changed, removed, skipped, … }    once, at the end
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  // Running code is the most sensitive thing this server does: also refuse hosts it wasn't set up for
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json(
      { error: 'Python commands are only accepted for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' },
      { status: 403 }
    );
  }
  if (!isPythonEnabled()) {
    return NextResponse.json({ error: 'Python support is turned off on this server (AHA_PYTHON=0).' }, { status: 503 });
  }

  const wait = limiter.check(clientKey(request.headers));
  if (wait) {
    return NextResponse.json({ error: `Too many Python commands. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });
  }
  if (Number(request.headers.get('content-length')) > 8 * 1024 * 1024) {
    return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
  }

  const parsed = parsePythonRequest(await request.json().catch(() => null));
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  void cleanupPythonProjects();

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
        if (parsed.action === 'install-uv') {
          const started = Date.now();
          try {
            const uv = await installManagedUv((message) => send({ t: 'out', s: 'info', d: `${message}\n` }));
            send({ t: 'done', code: 0, ms: Date.now() - started, changed: {}, removed: [], skipped: [], uv: uv.version });
          } catch (error) {
            send({ t: 'done', code: 1, ms: Date.now() - started, changed: {}, removed: [], skipped: [], error: error instanceof Error ? error.message : 'Could not install uv' });
          }
          return;
        }
        const result = await runPython(parsed, {
          signal: controller.signal,
          onOutput: (s, d) => send({ t: 'out', s, d }),
        });
        send({ t: 'done', ...result });
      } catch (error) {
        console.error('Python run failed:', error);
        send({ t: 'done', code: null, ms: 0, changed: {}, removed: [], skipped: [], error: error instanceof Error ? error.message : 'The command failed' });
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

  return new Response(body, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}
