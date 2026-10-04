/**
 * Shared helpers for GitHub API route handlers - Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import { GitHubApiError } from './github';

export const GITHUB_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

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
    const originHost = new URL(origin).host;
    return originHost === request.headers.get('host') || origin === new URL(getBaseUrl()).origin;
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
  if (error instanceof Error && (error.message === 'Invalid repository' || error.message === 'Invalid path')) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}
