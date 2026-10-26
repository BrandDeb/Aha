import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl } from '@/lib/github-session';
import { isTrustedHost, listensOnLoopbackOnly } from '@/lib/host';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const started = Date.now();

/**
 * GET → { ok } for monitors, load balancers and the container health check; on your own machine
 * also uptime, memory and what the autopilot did recently (Settings → Maintenance shows the same).
 */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  const local = listensOnLoopbackOnly() && isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS);
  if (!local) return NextResponse.json({ ok: true }, { headers });
  const { readState } = await import('@/lib/autopilot');
  const state = await readState();
  const memory = process.memoryUsage();
  return NextResponse.json(
    {
      ok: true,
      uptimeSeconds: Math.round((Date.now() - started) / 1000),
      memoryMb: { rss: Math.round(memory.rss / 1048576), heapUsed: Math.round(memory.heapUsed / 1048576) },
      node: process.version,
      supervised: process.env.AHA_SUPERVISED === '1',
      autopilot: { autoRepair: state.autoRepair, autoUpdate: state.autoUpdate, pendingVerify: !!state.pendingVerify, recent: state.journal.slice(0, 5) },
    },
    { headers }
  );
}
