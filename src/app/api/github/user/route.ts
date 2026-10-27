import { NextRequest, NextResponse } from 'next/server';
import { isSameOrigin } from '@/lib/github-session';
import { safeJsonParse } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const user = request.cookies.get('github_user')?.value;
  const token = request.cookies.get('github_token')?.value;
  
  const parsed = user ? safeJsonParse<Record<string, unknown> | null>(user, null) : null;
  if (!parsed || !token) {
    // Signed out is a normal state for this endpoint, not an error
    return NextResponse.json({ authenticated: false });
  }
  
  return NextResponse.json({ user: parsed, authenticated: true });
}

export async function DELETE(request: NextRequest) {
  // Another site must not be able to sign you out
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const response = NextResponse.json({ message: 'Logged out successfully' });
  
  response.cookies.delete('github_token');
  response.cookies.delete('github_user');
  response.cookies.delete('github_oauth_state');
  response.cookies.delete('github_device');
  response.cookies.delete('aha_account');
  
  return response;
}
