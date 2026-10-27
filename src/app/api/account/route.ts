import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, providersFor, readAccount } from '@/lib/account';
import { isSameOrigin } from '@/lib/github-session';

export const dynamic = 'force-dynamic';

/** Who is signed in (whichever provider), and which providers this server can sign people in with */
export async function GET(request: NextRequest) {
  return NextResponse.json({ account: readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value), providers: providersFor() }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Sign out of everything: the account and the provider sessions behind it */
export async function DELETE(request: NextRequest) {
  // Another site must not be able to sign you out
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  for (const name of [ACCOUNT_COOKIE, 'github_token', 'github_user', 'github_oauth_state', 'github_device', 'google_device']) response.cookies.delete(name);
  return response;
}
