import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github';
import { getBaseUrl, setSession } from '@/lib/github-session';

function redirectWithError(message: string): NextResponse {
  const response = NextResponse.redirect(`${getBaseUrl()}?error=${encodeURIComponent(message)}`);
  response.cookies.delete('github_oauth_state');
  return response;
}

function statesMatch(a: string, b: string | undefined): boolean {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  const error = searchParams.get('error');
  
  if (error) {
    return redirectWithError(error);
  }
  
  if (!code || !state) {
    return redirectWithError('Missing authorization code');
  }
  
  if (!statesMatch(state, request.cookies.get('github_oauth_state')?.value)) {
    return redirectWithError('Invalid state');
  }
  
  try {
    const token = await exchangeCodeForToken(code);
    const user = await getGitHubUser(token.access_token);
    
    const response = NextResponse.redirect(getBaseUrl());
    // State is single-use
    response.cookies.delete('github_oauth_state');
    return setSession(response, request, token.access_token, user);
  } catch (err) {
    console.error('GitHub OAuth callback error:', err);
    return redirectWithError('Authentication failed');
  }
}
