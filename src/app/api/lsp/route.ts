import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { isRunEnabled } from '@/lib/polyglot';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonOrNull } from '@/lib/request-guard';
import { isSafeRelativePath } from '@/lib/proc';
import { serverFor, serverStatus, type LspLanguage } from '@/lib/lsp/servers';
import { lspNotify, lspPoll, lspRequest, startLsp, stopLsp } from '@/lib/lsp/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const starts = createRateLimiter(60, 10 * 60 * 1000);
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const SESSION_ID = /^[0-9a-f-]{36}$/;
const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;
const MAX_FILES = 2000;

/** Language servers run programs on this machine: the same rules as /api/run */
function refuse(request: NextRequest, changesState: boolean): NextResponse | null {
  if (!isRunEnabled()) return json({ enabled: false, error: 'Language servers run only when the studio runs on your own machine (or AHA_RUN=1).' }, 503);
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) return json({ error: 'Not available for this host name.' }, 403);
  if (changesState && !isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  return null;
}

const failure = (error: unknown) => json({ error: (error as Error).message }, (error as { status?: number }).status ?? 500);

/**
 * GET                    → { enabled, servers: [{ id, name, ready, hint }] }
 * GET ?id=…&since=N      → { messages, exited } what the server published after N (waits up to 20 s)
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return json(isRunEnabled() ? { enabled: true, servers: serverStatus() } : { enabled: false, servers: [] });
  const refused = refuse(request, false);
  if (refused) return refused;
  if (!SESSION_ID.test(id)) return json({ error: 'Invalid session id' }, 400);
  try {
    return json(await lspPoll(id, Number(request.nextUrl.searchParams.get('since')) || 0));
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST { action: 'start', projectId, language, files }  → { id, capabilities } (installs the server on first use)
 * POST { id, action: 'request', method, params }         → { result }
 * POST { id, action: 'notify', method, params }          → { ok }
 * POST { id, action: 'stop' }
 */
export async function POST(request: NextRequest) {
  const refused = refuse(request, true);
  if (refused) return refused;
  const body = (await readJsonOrNull(request, 24 * 1024 * 1024)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400);

  try {
    if (body.action === 'start') {
      if (starts.check(clientKey(request.headers))) return json({ error: 'Too many language server starts.' }, 429);
      if (typeof body.projectId !== 'string' || !PROJECT_ID.test(body.projectId)) return json({ error: 'projectId is missing or invalid' }, 400);
      if (typeof body.language !== 'string' || !serverFor(body.language)) return json({ error: 'Unknown language' }, 400);
      if (!body.files || typeof body.files !== 'object' || Array.isArray(body.files)) return json({ error: 'files must be an object of path -> content' }, 400);
      const files: Record<string, string> = {};
      for (const [p, content] of Object.entries(body.files as Record<string, unknown>)) {
        if (!isSafeRelativePath(p) || typeof content !== 'string') return json({ error: `Invalid file: ${p.slice(0, 80)}` }, 400);
        files[p] = content;
      }
      if (Object.keys(files).length > MAX_FILES) return json({ error: 'Too many files' }, 400);
      return json(await startLsp({ projectId: body.projectId, language: body.language as LspLanguage, files }));
    }
    if (typeof body.id !== 'string' || !SESSION_ID.test(body.id)) return json({ error: 'Invalid session id' }, 400);
    if (body.action === 'stop') {
      stopLsp(body.id);
      return json({ ok: true });
    }
    if (typeof body.method !== 'string') return json({ error: 'method is required' }, 400);
    if (body.action === 'request') return json({ result: await lspRequest(body.id, body.method, body.params ?? {}) });
    if (body.action === 'notify') {
      lspNotify(body.id, body.method, body.params ?? {});
      return json({ ok: true });
    }
    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    return failure(error);
  }
}
