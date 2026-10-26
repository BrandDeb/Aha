import { NextRequest, NextResponse } from 'next/server';
import { callConnectorTool, connectorsMode, listConnectorTools, modeBlocks } from '@/lib/connectors/manager';
import { parseConnector } from '@/lib/connectors/types';
import { getBaseUrl, getToken, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Each call can start a process or reach the network; cap them per client */
const limiter = createRateLimiter(Number(process.env.AHA_CONNECTOR_CALLS_PER_10_MIN) || 400, 10 * 60 * 1000);

/** What this server allows: connectors off, local (everything) or hosted (network connectors only) */
export function GET() {
  const mode = connectorsMode();
  return NextResponse.json({ mode, node: process.version, sqlite: Number(process.versions.node.split('.')[0]) >= 22 });
}

/**
 * POST { action: 'tools' | 'call', connector, tool?, args? }
 * The connector's configuration travels with each request (it lives in the
 * browser, next to the user's keys); the server only keeps warm MCP sessions.
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  // Connectors can run programs and read files: refuse hosts the server wasn't set up for (DNS rebinding)
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Connectors are only accepted for localhost or the site in NEXT_PUBLIC_BASE_URL (add other names to ALLOWED_HOSTS).' }, { status: 403 });
  }
  const mode = connectorsMode();
  if (mode === 'off') return NextResponse.json({ error: 'Connectors are turned off on this server (AHA_CONNECTORS=0).' }, { status: 503 });

  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: `Too many connector calls. Try again in ${Math.ceil(wait / 60)} min.` }, { status: 429, headers: { 'Retry-After': String(wait) } });
  if (Number(request.headers.get('content-length')) > 512 * 1024) return NextResponse.json({ error: 'Request is too large' }, { status: 413 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || (body.action !== 'tools' && body.action !== 'call')) return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  const connector = parseConnector(body.connector);
  if ('error' in connector) return NextResponse.json({ error: connector.error }, { status: 400 });
  const blocked = modeBlocks(connector.kind, mode);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });

  const ctx = { mode: mode as 'local' | 'hosted', githubToken: getToken(request), signal: request.signal };
  try {
    if (body.action === 'tools') {
      return NextResponse.json({ ok: true, tools: await listConnectorTools(connector, ctx) });
    }
    const tool = typeof body.tool === 'string' ? body.tool : '';
    const args = body.args && typeof body.args === 'object' && !Array.isArray(body.args) ? (body.args as Record<string, unknown>) : {};
    if (!tool) return NextResponse.json({ error: 'Name the tool to call.' }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await callConnectorTool(connector, tool, args, ctx)) });
  } catch (error) {
    if ((error as Error).name === 'AbortError') return NextResponse.json({ ok: false, error: 'Stopped' }, { status: 499 });
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : 'The connector failed.' }, { status: 502 });
  }
}
