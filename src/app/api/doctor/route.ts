import { NextRequest, NextResponse } from 'next/server';
import { applyFix, runDoctor } from '@/lib/doctor';
import { refuseMaintenance } from '@/lib/maintenance-guard';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const limiter = createRateLimiter(60, 10 * 60 * 1000);

/** Health checks for the machine the studio runs on */
export async function GET(request: NextRequest) {
  const refused = refuseMaintenance(request, false);
  if (refused) return refused;
  return NextResponse.json(await runDoctor());
}

/** POST { fix } applies one of the fixes a check offered */
export async function POST(request: NextRequest) {
  const refused = refuseMaintenance(request, true);
  if (refused) return refused;
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers: { 'Retry-After': String(wait) } });
  const body = (await request.json().catch(() => null)) as { fix?: unknown } | null;
  if (typeof body?.fix !== 'string') return NextResponse.json({ error: 'Name the fix to apply.' }, { status: 400 });
  try {
    return NextResponse.json(await applyFix(body.fix));
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : 'The fix failed.' });
  }
}
