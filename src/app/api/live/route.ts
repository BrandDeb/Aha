import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { parseLiveRequest, runLive } from '@/lib/live/run';
import { isRunEnabled } from '@/lib/polyglot';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Live mode runs on every pause in typing: a generous limit, still per client
const limiter = createRateLimiter(Number(process.env.AHA_LIVE_RUNS_PER_10_MIN) || 600, 10 * 60 * 1000);

/** Whether this server runs programs for live values */
export async function GET() {
  return NextResponse.json({ enabled: isRunEnabled() });
}

/** Run the entry file with live values: POST { projectId, files, entry, args, quick? } -> LiveResult */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Programs are only run for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' }, { status: 403 });
  }
  if (!isRunEnabled()) return NextResponse.json({ error: 'Live values run your program on this server, which only happens when it listens on your own machine (or AHA_RUN=1).' }, { status: 503 });
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many runs. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429 });
  const body = await request.json().catch(() => null);
  const parsed = parseLiveRequest(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort());
  try {
    // While typing (quick), a short limit keeps the editor responsive
    const result = await runLive(parsed, { timeoutMs: body?.quick ? 4000 : 15_000, signal: controller.signal });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ ok: false, files: {}, output: '', code: null, ms: 0, error: (error as Error).message }, { status: 500 });
  }
}
