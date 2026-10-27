import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { cleanupDevProjects, isDevEnabled, isProjectId, isSyncablePath, listServers, parseFiles, startServer, stateOf, stopServer, syncServer } from '@/lib/devserver';
import { FRAMEWORKS } from '@/lib/frameworks';
import { closePhone, openPhone, phoneOf } from '@/lib/phone-preview';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonOrNull } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starting a server installs packages and runs code; syncs are cheap and frequent */
const starts = createRateLimiter(Number(process.env.AHA_DEV_STARTS_PER_10_MIN) || 40, 10 * 60 * 1000);
const syncs = createRateLimiter(3000, 10 * 60 * 1000);

const trusted = (request: NextRequest) => isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS);

/**
 * GET                         → whether dev servers are available here, and which run
 * GET ?projectId=…&since=N    → one server's status and the log lines after N
 */
export async function GET(request: NextRequest) {
  if (!isDevEnabled()) return NextResponse.json({ enabled: false, frameworks: [] });
  if (!trusted(request)) return NextResponse.json({ error: 'Not available for this host name.' }, { status: 403 });
  const id = request.nextUrl.searchParams.get('projectId');
  if (id === null) {
    return NextResponse.json({ enabled: true, node: process.versions.node, frameworks: FRAMEWORKS.map((f) => ({ id: f.id, name: f.name, minNode: f.minNode })), running: listServers() });
  }
  if (!isProjectId(id)) return NextResponse.json({ error: 'projectId is invalid' }, { status: 400 });
  const since = Number(request.nextUrl.searchParams.get('since')) || 0;
  return NextResponse.json({ ...stateOf(id, since), phone: phoneOf(id) }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * { action: 'start', projectId, files }             → write, install when needed, start (returns at once; poll GET)
 * { action: 'sync', projectId, changed, removed }   → apply edits to the running project
 * { action: 'stop', projectId }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  if (!trusted(request)) {
    return NextResponse.json({ error: 'Dev servers only run for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' }, { status: 403 });
  }
  if (!isDevEnabled()) {
    return NextResponse.json({ error: 'Dev servers are off on this server: they only run when the studio listens on your own machine (or AHA_DEV=1).' }, { status: 503 });
  }
  if (Number(request.headers.get('content-length')) > 14 * 1024 * 1024) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });
  const body = (await readJsonOrNull(request, 14 * 1024 * 1024)) as Record<string, unknown> | null;
  if (!body || !isProjectId(body.projectId)) return NextResponse.json({ error: 'projectId is missing or invalid' }, { status: 400 });
  const id = body.projectId;

  if (body.action === 'stop') {
    closePhone(id);
    return NextResponse.json({ stopped: stopServer(id), ...stateOf(id) });
  }
  if (body.action === 'phone-off') return NextResponse.json({ closed: closePhone(id), phone: null });

  const limiter = body.action === 'start' ? starts : syncs;
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many requests. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });

  if (body.action === 'start') {
    const files = parseFiles(body.files);
    if ('error' in files) return NextResponse.json({ error: files.error }, { status: 400 });
    void cleanupDevProjects();
    // Runs in the background; its progress is what GET reports
    void startServer(id, files).catch((error) => console.error('Dev server failed:', error));
    return NextResponse.json(stateOf(id));
  }

  // Phone preview: a proxy on this machine's network address to the running dev server, behind a random key
  if (body.action === 'phone-on') {
    const state = stateOf(id);
    if (state.status !== 'ready' || !state.url) return NextResponse.json({ error: 'Start the dev server first.' }, { status: 409 });
    try {
      return NextResponse.json({ phone: await openPhone(id, () => (stateOf(id).status === 'ready' ? (stateOf(id).url ?? null) : null)) });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: (error as { status?: number }).status ?? 500 });
    }
  }

  if (body.action === 'sync') {
    const changed = parseFiles(body.changed ?? {}, { allowEmpty: true });
    if ('error' in changed) return NextResponse.json({ error: changed.error }, { status: 400 });
    const removed = Array.isArray(body.removed) ? body.removed : [];
    if (removed.length > 600 || removed.some((p) => typeof p !== 'string' || !isSyncablePath(p))) return NextResponse.json({ error: 'removed must be a list of project paths' }, { status: 400 });
    const result = await syncServer(id, changed, removed as string[]);
    return NextResponse.json(result, { status: 'error' in result ? 409 : 200 });
  }

  return NextResponse.json({ error: 'action must be start, sync, stop, phone-on or phone-off' }, { status: 400 });
}
