/**
 * Shared helpers for GitHub API route handlers - Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, cleanAccount, signAccount } from './account';
import { GitHubApiError, type GitHubUser } from './github';
import { secureCookies, webFlowFor } from './github-device';
import { isTrustedHost } from './host';

/**
 * Session cookies: httpOnly, and Secure when the page is served over HTTPS. Over plain HTTP (localhost,
 * the desktop app's loopback server) a Secure cookie would be dropped by some browsers, signing you out.
 */
export function cookieOptions(request: NextRequest) {
  return { httpOnly: true, secure: secureCookies(request.headers.get('x-forwarded-proto'), request.nextUrl.protocol), sameSite: 'lax' as const, path: '/' };
}

const SESSION_DAYS = 30;

/** Signed in: the token (never readable by the page) and the public profile the UI shows */
export function setSession(response: NextResponse, request: NextRequest, token: string, user: GitHubUser): NextResponse {
  const options = { ...cookieOptions(request), maxAge: 60 * 60 * 24 * SESSION_DAYS };
  response.cookies.set('github_token', token, options);
  response.cookies.set('github_user', JSON.stringify({ id: user.id, login: user.login, avatar_url: user.avatar_url, name: user.name }), options);
  // The same sign-in as a studio account, so the page treats GitHub and Google the same (see lib/account.ts)
  const account = cleanAccount({ provider: 'github', id: String(user.id), handle: user.login, name: user.name ?? user.login, avatar: user.avatar_url });
  if (account) response.cookies.set(ACCOUNT_COOKIE, signAccount(account), options);
  return response;
}

/** The redirect sign-in needs a client secret and a callback on the host the studio is served from */
export const webFlowAvailable = (request: NextRequest) => webFlowFor(request.headers.get('host'));

export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
}

export function getToken(request: NextRequest): string | undefined {
  return request.cookies.get('github_token')?.value;
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
}

/**
 * Reject cross-site state-changing requests. Browsers always send Origin on
 * non-GET fetches, so a missing or foreign Origin is refused.
 */
export function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    const host = request.headers.get('host');
    // Origin and Host agree on a DNS-rebinding page too (evil.example pointed at 127.0.0.1), so the name must be ours
    return (new URL(origin).host === host && isTrustedHost(host, getBaseUrl(), process.env.ALLOWED_HOSTS)) || origin === new URL(getBaseUrl()).origin;
  } catch {
    return false;
  }
}

export function githubErrorResponse(error: unknown, fallback: string): NextResponse {
  if (error instanceof GitHubApiError) {
    const status = error.status === 401 || error.status === 403 || error.status === 404 || error.status === 409 || error.status === 422
      ? error.status
      : 502;
    return NextResponse.json({ error: fallback, status: error.status }, { status });
  }
  if (error instanceof Error && ['Invalid repository', 'Invalid path', 'Invalid branch'].includes(error.message)) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
