import { NextRequest, NextResponse } from 'next/server';
import { refuseMaintenance } from '@/lib/maintenance-guard';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { applyUpdate, getUpdateStatus, type UpdateStatus } from '@/lib/updater';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(30, 10 * 60 * 1000);
const FRESH_MS = 6 * 60 * 60 * 1000;
/** The restart exit code scripts/supervise.js understands */
const RESTART_CODE = 75;

let cached: UpdateStatus | null = null;

/**
 * GET → what an update would bring. The remote is contacted at most every six
 * hours (`?refresh=1` forces it), so opening the studio is not a network call.
 */
export async function GET(request: NextRequest) {
  const refused = refuseMaintenance(request, false);
  if (refused) return refused;
  const force = request.nextUrl.searchParams.get('refresh') === '1';
  if (force || !cached || Date.now() - cached.checkedAt > FRESH_MS) cached = await getUpdateStatus({ fetch: true });
  else cached = { ...(await getUpdateStatus({ fetch: false })), checkedAt: cached.checkedAt, fetchError: cached.fetchError };
  return NextResponse.json(cached);
}

/**
 * POST { action: "apply" } updates from git with progress as newline-delimited JSON
 * ({ t: "out", d } … { t: "done", ok, from, to, steps, restartRequired, rolledBack?, error? }).
 * POST { action: "restart" } asks the supervisor to start the studio again.
 */
export async function POST(request: NextRequest) {
  const refused = refuseMaintenance(request, true);
  if (refused) return refused;
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(wait) } });
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null;

  if (body?.action === 'restart') {
    if (process.env.AHA_SUPERVISED !== '1') {
      return NextResponse.json({ ok: false, error: 'This server wasn’t started with npm run dev / npm start, so it can’t restart itself. Stop it and start it again.' }, { status: 409 });
    }
    setTimeout(() => process.exit(RESTART_CODE), 300);
    return NextResponse.json({ ok: true });
  }
  if (body?.action !== 'apply') return NextResponse.json({ error: 'Unknown action' }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          // the page went away; the update still finishes (or rolls back) on its own
        }
      };
      try {
        const result = await applyUpdate({ onProgress: (d) => send({ t: 'out', d }) });
        cached = null;
        send({ t: 'done', ...result });
      } catch (error) {
        send({ t: 'done', ok: false, steps: [], restartRequired: false, error: error instanceof Error ? error.message : 'The update failed.' });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}
