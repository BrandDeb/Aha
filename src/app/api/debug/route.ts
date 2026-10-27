import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { isRunEnabled, parseRunRequest } from '@/lib/polyglot';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonOrNull } from '@/lib/request-guard';
import { command, parseBreakpoints, parseCommand, sessionState, startSession } from '@/lib/debug/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Starting a session starts a process; commands (steps, reads) are cheap and frequent */
const starts = createRateLimiter(Number(process.env.AHA_RUN_REQUESTS_PER_10_MIN) || 150, 10 * 60 * 1000);
const commands = createRateLimiter(3000, 10 * 60 * 1000);

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const SESSION_ID = /^[0-9a-f-]{36}$/;

/** Debugging runs programs on this machine: the same rules as /api/run */
function refuse(request: NextRequest, changesState: boolean): NextResponse | null {
  if (!isRunEnabled()) return json({ enabled: false, error: 'Debugging is off on this server: it only runs programs when it listens on your own machine (or AHA_RUN=1).' }, 503);
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) return json({ error: 'Not available for this host name.' }, 403);
  if (changesState && !isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  return null;
}

const failure = (error: unknown) => json({ error: (error as Error).message }, (error as { status?: number }).status ?? 500);

/**
 * GET                    → { enabled }
 * GET ?id=…&since=N      → the session's state, with the output after N
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return json({ enabled: isRunEnabled() });
  const refused = refuse(request, false);
  if (refused) return refused;
  if (!SESSION_ID.test(id)) return json({ error: 'Invalid session id' }, 400);
  try {
    return json(sessionState(id, Number(request.nextUrl.searchParams.get('since')) || 0));
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST { action: 'start', projectId, entry, files, args?, env?, breakpoints? }  → the new session's state
 * POST { id, action: 'continue' | 'pause' | 'stop' | 'step' (kind) | 'breakpoints' (file, lines)
 *        | 'frame' (frameId) | 'children' (ref) | 'evaluate' (expression, frameId?) }
 */
export async function POST(request: NextRequest) {
  const refused = refuse(request, true);
  if (refused) return refused;
  const body = (await readJsonOrNull(request, 12 * 1024 * 1024)) as Record<string, unknown> | null;
  if (!body || typeof body !== 'object') return json({ error: 'Invalid JSON body' }, 400);

  if (body.action === 'start') {
    const wait = starts.check(clientKey(request.headers));
    if (wait) return json({ error: `Too many debug sessions. Try again in ${Math.ceil(wait / 60)} min.` }, 429);
    const run = parseRunRequest(body);
    if ('error' in run) return json({ error: run.error }, 400);
    const breakpoints = parseBreakpoints(body.breakpoints, run.files);
    if ('error' in breakpoints) return json({ error: breakpoints.error }, 400);
    try {
      return json(await startSession(run, breakpoints));
    } catch (error) {
      return failure(error);
    }
  }

  if (commands.check(clientKey(request.headers))) return json({ error: 'Too many debugger commands.' }, 429);
  if (typeof body.id !== 'string' || !SESSION_ID.test(body.id)) return json({ error: 'Invalid session id' }, 400);
  const cmd = parseCommand(body);
  if ('error' in cmd) return json({ error: cmd.error }, 400);
  try {
    return json(await command(body.id, cmd));
  } catch (error) {
    return failure(error);
  }
}
