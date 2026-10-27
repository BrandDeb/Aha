import { NextRequest, NextResponse } from 'next/server';
import { refuseMaintenance } from '@/lib/maintenance-guard';
import { readJsonOrNull } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET → the autopilot's settings and journal */
export async function GET(request: NextRequest) {
  const refused = refuseMaintenance(request, false);
  if (refused) return refused;
  const { readState } = await import('@/lib/autopilot');
  return NextResponse.json(await readState(), { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * { autoRepair?: boolean, autoUpdate?: boolean } → saves the settings
 * { action: 'run' }                              → one round of checks now (repairs only when needed)
 */
export async function POST(request: NextRequest) {
  const refused = refuseMaintenance(request, true);
  if (refused) return refused;
  const body = (await readJsonOrNull(request, 4_000)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  const { readState, tick, updateSettings } = await import('@/lib/autopilot');
  if (body.action === 'run') {
    await tick();
    return NextResponse.json(await readState());
  }
  const patch: { autoRepair?: boolean; autoUpdate?: boolean } = {};
  if (typeof body.autoRepair === 'boolean') patch.autoRepair = body.autoRepair;
  if (typeof body.autoUpdate === 'boolean') patch.autoUpdate = body.autoUpdate;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nothing to change' }, { status: 400 });
  return NextResponse.json(await updateSettings(patch));
}
