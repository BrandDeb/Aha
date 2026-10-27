import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, SESSION_DAYS, signAccount } from '@/lib/account';
import { googleConfigured, pollGoogleDevice, startGoogleDevice } from '@/lib/google-device';
import { cookieOptions, isSameOrigin } from '@/lib/github-session';
import { readJsonOrNull } from '@/lib/request-guard';

export const dynamic = 'force-dynamic';

const DEVICE_COOKIE = 'google_device';

/** Whether this server can sign people in with Google */
export async function GET() {
  return NextResponse.json({ configured: googleConfigured() });
}

/**
 * Device sign-in with Google:
 *   POST { action: 'start' } -> { userCode, verificationUri, expiresIn, interval }   (the device code stays in an httpOnly cookie)
 *   POST { action: 'poll' }  -> { status: 'pending' | 'done' | 'expired' | 'denied' | 'error', interval?, message?, account? }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) return NextResponse.json({ error: 'Google sign-in isn’t set up on this server (no GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET).' }, { status: 503 });
  const body = await readJsonOrNull(request, 16_000);

  if (body?.action === 'start') {
    const started = await startGoogleDevice(clientId);
    if ('error' in started) return NextResponse.json({ error: started.error }, { status: 502 });
    const { deviceCode, ...shown } = started;
    const response = NextResponse.json(shown);
    response.cookies.set(DEVICE_COOKIE, deviceCode, { ...cookieOptions(request), maxAge: started.expiresIn });
    return response;
  }

  if (body?.action === 'poll') {
    const deviceCode = request.cookies.get(DEVICE_COOKIE)?.value;
    if (!deviceCode) return NextResponse.json({ status: 'expired', message: 'The code expired. Start again for a new one.' });
    const result = await pollGoogleDevice(clientId, clientSecret, deviceCode);
    if (result.status === 'pending') return NextResponse.json(result);
    const response = NextResponse.json(result.status === 'done' ? { status: 'done', account: result.account } : result);
    response.cookies.delete(DEVICE_COOKIE);
    if (result.status === 'done') response.cookies.set(ACCOUNT_COOKIE, signAccount(result.account), { ...cookieOptions(request), maxAge: 60 * 60 * 24 * SESSION_DAYS });
    return response;
  }

  return NextResponse.json({ error: 'action must be "start" or "poll"' }, { status: 400 });
}
