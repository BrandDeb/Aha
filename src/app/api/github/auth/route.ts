import { NextRequest, NextResponse } from 'next/server';
import { generateState } from '@/lib/github';

export async function GET(request: NextRequest) {
  try {
    const state = generateState();
    const redirectUri = process.env.GITHUB_REDIRECT_URI || 
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/github/callback`;
    
    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID!);
    githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
    githubAuthUrl.searchParams.set('scope', 'repo user');
    githubAuthUrl.searchParams.set('state', state);
    githubAuthUrl.searchParams.set('allow_signup', 'true');
    
    const response = NextResponse.redirect(githubAuthUrl.toString());
    response.cookies.set('github_oauth_state', state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 10, // 10 minutes
      path: '/',
    });
    
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to initiate GitHub OAuth' },
      { status: 500 }
    );
  }
}
