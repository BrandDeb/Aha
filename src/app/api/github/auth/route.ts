import { NextRequest, NextResponse } from 'next/server';
import { generateState } from '@/lib/github';
import { cookieOptions, getBaseUrl } from '@/lib/github-session';

export async function GET(request: NextRequest) {
  if (!process.env.GITHUB_CLIENT_ID) {
    return NextResponse.json(
      { error: 'GitHub OAuth is not configured' },
      { status: 500 }
    );
  }

  const state = generateState();
  const redirectUri = process.env.GITHUB_REDIRECT_URI || `${getBaseUrl()}/api/github/callback`;
  
  const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
  githubAuthUrl.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
  githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
  // workflow: commits may include CI files (.github/workflows/), which GitHub only accepts with this scope
  githubAuthUrl.searchParams.set('scope', 'repo workflow read:user gist');
  githubAuthUrl.searchParams.set('state', state);
  githubAuthUrl.searchParams.set('allow_signup', 'true');
  
  const response = NextResponse.redirect(githubAuthUrl.toString());
  response.cookies.set('github_oauth_state', state, {
    ...cookieOptions(request),
    maxAge: 60 * 10, // 10 minutes
  });
  
  return response;
}
