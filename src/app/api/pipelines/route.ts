import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { isPipelineRunEnabled, parsePipelineRunRequest, runPipeline } from '@/lib/pipelines/run';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonOrNull } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(Number(process.env.AHA_PIPELINE_RUNS_PER_10_MIN) || 60, 10 * 60 * 1000);

/** Whether this server runs pipelines locally */
export async function GET() {
  return NextResponse.json({ enabled: isPipelineRunEnabled() });
}

/**
 * Run a project's CI file (or one job of it) on this machine. Newline-delimited JSON:
 *   { t: 'job' | 'step' | 'out', … }   as it runs
 *   { t: 'done', ok, jobs, ms, error? }   once, at the end
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Pipelines only run for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' }, { status: 403 });
  }
  if (!isPipelineRunEnabled()) {
    return NextResponse.json({ error: 'Running pipelines is off on this server: it only runs commands when it listens on your own machine (or AHA_RUN=1).' }, { status: 503 });
  }
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many pipeline runs. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });
  if (Number(request.headers.get('content-length')) > 12 * 1024 * 1024) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });

  const parsed = parsePipelineRunRequest(await readJsonOrNull(request, 12 * 1024 * 1024));
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
        const result = await runPipeline(parsed, { signal: controller.signal, onEvent: send });
        send({ t: 'done', ...result });
      } catch (error) {
        console.error('Pipeline run failed:', error);
        send({ t: 'done', ok: false, jobs: [], ms: 0, error: error instanceof Error ? error.message : 'The pipeline run failed' });
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
