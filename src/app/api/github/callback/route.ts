import { NextRequest, NextResponse } from 'next/server';
import { exchangeCodeForToken, getGitHubUser } from '@/lib/github';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const error = searchParams.get('error');
    
    if (error) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}?error=${encodeURIComponent(error)}`
      );
    }
    
    if (!code || !state) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}?error=${encodeURIComponent('Missing authorization code')}`
      );
    }
    
    const storedState = request.cookies.get('github_oauth_state')?.value;
    if (state !== storedState) {
      return NextResponse.redirect(
        `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}?error=${encodeURIComponent('Invalid state')}`
      );
    }
    
    const token = await exchangeCodeForToken(code);
    const user = await getGitHubUser(token.access_token);
    
    const response = NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}`
    );
    
    response.cookies.set('github_token', token.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: '/',
    });
    
    response.cookies.set('github_user', JSON.stringify({
      id: user.id,
      login: user.login,
      avatar_url: user.avatar_url,
      name: user.name,
    }), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    });
    
    return response;
  } catch (error: any) {
    console.error('GitHub OAuth callback error:', error);
    return NextResponse.redirect(
      `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}?error=${encodeURIComponent(error.message || 'Authentication failed')}`
    );
  }
}
