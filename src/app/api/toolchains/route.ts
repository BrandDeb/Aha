import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { clearLanguageStatuses, isRunEnabled } from '@/lib/polyglot';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { getToolchainState, installFor, listInstalled, MANAGED, miseVersion, updateAll, upgradeMajor, writeState } from '@/lib/toolchains';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Installs download hundreds of megabytes: a handful per client is plenty */
const limiter = createRateLimiter(30, 10 * 60 * 1000);

const trusted = (request: NextRequest) => isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS);

/** The studio's toolchains: what is installed, pending updates, newer major versions, settings */
export async function GET(request: NextRequest) {
  if (!isRunEnabled()) return NextResponse.json({ enabled: false });
  if (!trusted(request)) return NextResponse.json({ error: 'Not available for this host name.' }, { status: 403 });
  const [mise, tools, state] = await Promise.all([miseVersion(), listInstalled(), getToolchainState()]);
  return NextResponse.json({ enabled: true, mise, tools, ...state, installable: Object.keys(MANAGED) }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * { action: 'install', language }   → streams progress (newline-delimited JSON), like /api/run
 * { action: 'update' }              → applies every update within each tool's version line
 * { action: 'upgrade', tool }       → moves one tool to its newest major version
 * { action: 'settings', autoUpdate?, autoInstall? }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  if (!trusted(request)) return NextResponse.json({ error: 'Toolchains are only managed for localhost or the site in NEXT_PUBLIC_BASE_URL.' }, { status: 403 });
  if (!isRunEnabled()) return NextResponse.json({ error: 'Installing toolchains is off: the studio only does it when it runs on your own machine.' }, { status: 503 });
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== 'string') return NextResponse.json({ error: 'action is required' }, { status: 400 });

  if (body.action === 'settings') {
    const patch: { autoUpdate?: boolean; autoInstall?: boolean } = {};
    if (typeof body.autoUpdate === 'boolean') patch.autoUpdate = body.autoUpdate;
    if (typeof body.autoInstall === 'boolean') patch.autoInstall = body.autoInstall;
    return NextResponse.json(await writeState(patch));
  }

  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many requests. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });

  if (body.action === 'install' || body.action === 'update' || body.action === 'upgrade') {
    if (body.action === 'install' && (typeof body.language !== 'string' || !MANAGED[body.language])) return NextResponse.json({ error: 'Unknown language' }, { status: 400 });
    if (body.action === 'upgrade' && (typeof body.tool !== 'string' || !/^[\w:/.-]{1,60}$/.test(body.tool))) return NextResponse.json({ error: 'Unknown tool' }, { status: 400 });
    const encoder = new TextEncoder();
    const controller = new AbortController();
    request.signal.addEventListener('abort', () => controller.abort());
    const stream = new ReadableStream<Uint8Array>({
      async start(sink) {
        const send = (event: Record<string, unknown>) => {
          try {
            sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            // the client went away
          }
        };
        const out = (d: string) => send({ t: 'out', s: 'info', d });
        try {
          if (body.action === 'install') {
            const result = await installFor(body.language as string, out, controller.signal);
            send({ t: 'done', code: result.ok ? 0 : 1, error: result.error });
          } else if (body.action === 'update') {
            const updated = await updateAll(out);
            send({ t: 'done', code: 0, updated });
          } else {
            const ok = await upgradeMajor(body.tool as string, out);
            send({ t: 'done', code: ok ? 0 : 1, error: ok ? undefined : 'The upgrade failed; the output above says why.' });
          }
        } catch (error) {
          send({ t: 'done', code: 1, error: error instanceof Error ? error.message : 'Failed' });
        } finally {
          clearLanguageStatuses();
          try {
            sink.close();
          } catch {
            // already closed
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  return NextResponse.json({ error: 'action must be install, update, upgrade or settings' }, { status: 400 });
}
