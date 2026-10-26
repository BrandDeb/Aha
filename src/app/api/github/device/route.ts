import { NextRequest, NextResponse } from 'next/server';
import { getGitHubUser } from '@/lib/github';
import { githubClientId, pollDeviceFlow, startDeviceFlow } from '@/lib/github-device';
import { cookieOptions, isSameOrigin, setSession, webFlowAvailable } from '@/lib/github-session';

export const dynamic = 'force-dynamic';

const DEVICE_COOKIE = 'github_device';

/** How this server signs in: { configured, flow: 'web' | 'device' } */
export async function GET(request: NextRequest) {
  return NextResponse.json({ configured: !!githubClientId(), flow: webFlowAvailable(request) ? 'web' : 'device' });
}

/**
 * Device sign-in:
 *   POST { action: 'start' } -> { userCode, verificationUri, expiresIn, interval }   (the device code stays in an httpOnly cookie)
 *   POST { action: 'poll' }  -> { status: 'pending' | 'done' | 'expired' | 'denied' | 'disabled' | 'error', interval?, message?, user? }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const clientId = githubClientId();
  if (!clientId) return NextResponse.json({ error: 'GitHub sign-in isn’t set up on this server (no GITHUB_CLIENT_ID).' }, { status: 503 });
  const body = await request.json().catch(() => null);

  if (body?.action === 'start') {
    const started = await startDeviceFlow(clientId);
    if ('error' in started) return NextResponse.json({ error: started.error }, { status: 502 });
    const { deviceCode, ...shown } = started;
    const response = NextResponse.json(shown);
    response.cookies.set(DEVICE_COOKIE, deviceCode, { ...cookieOptions(request), maxAge: started.expiresIn });
    return response;
  }

  if (body?.action === 'poll') {
    const deviceCode = request.cookies.get(DEVICE_COOKIE)?.value;
    if (!deviceCode) return NextResponse.json({ status: 'expired', message: 'The code expired. Start again for a new one.' });
    const result = await pollDeviceFlow(clientId, deviceCode);
    if (result.status === 'pending') return NextResponse.json(result);
    if (result.status !== 'done') {
      const response = NextResponse.json(result);
      response.cookies.delete(DEVICE_COOKIE);
      return response;
    }
    try {
      const user = await getGitHubUser(result.token);
      const response = NextResponse.json({ status: 'done', user: { id: user.id, login: user.login, avatar_url: user.avatar_url, name: user.name } });
      response.cookies.delete(DEVICE_COOKIE);
      return setSession(response, request, result.token, user);
    } catch {
      return NextResponse.json({ status: 'error', message: 'Signed in, but GitHub didn’t return your profile. Try again.' }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'action must be "start" or "poll"' }, { status: 400 });
}
