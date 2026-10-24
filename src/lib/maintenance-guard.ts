import { NextRequest, NextResponse } from 'next/server';
import { getBaseUrl, isSameOrigin } from './github-session.ts';
import { isTrustedHost, listensOnLoopbackOnly } from './host.ts';

/**
 * Maintenance (health fixes, updates, restarts) changes the machine the studio
 * runs on, so it is only available when the studio listens on this machine
 * alone, for a trusted Host, and (for anything that changes state) a same-origin page.
 * Returns the response to send when the request is refused.
 */
export function refuseMaintenance(request: NextRequest, changesState: boolean): NextResponse | null {
  if (!listensOnLoopbackOnly()) {
    return NextResponse.json({ error: 'Maintenance is only available when the studio runs on your own machine (it is listening beyond localhost).' }, { status: 403 });
  }
  if (!isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS)) {
    return NextResponse.json({ error: 'Maintenance is only accepted for localhost or the site in NEXT_PUBLIC_BASE_URL.' }, { status: 403 });
  }
  if (changesState && !isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  return null;
}
