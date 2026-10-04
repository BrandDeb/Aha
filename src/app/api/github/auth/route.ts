import { NextResponse } from 'next/server';
import { generateState } from '@/lib/github';
import { GITHUB_COOKIE_OPTIONS, getBaseUrl } from '@/lib/github-session';

export async function GET() {
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
  githubAuthUrl.searchParams.set('scope', 'repo read:user gist');
  githubAuthUrl.searchParams.set('state', state);
  githubAuthUrl.searchParams.set('allow_signup', 'true');
  
  const response = NextResponse.redirect(githubAuthUrl.toString());
  response.cookies.set('github_oauth_state', state, {
    ...GITHUB_COOKIE_OPTIONS,
    maxAge: 60 * 10, // 10 minutes
  });
  
  return response;
}
