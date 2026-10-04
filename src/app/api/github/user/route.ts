import { NextRequest, NextResponse } from 'next/server';
import { safeJsonParse } from '@/lib/utils';

export async function GET(request: NextRequest) {
  const user = request.cookies.get('github_user')?.value;
  const token = request.cookies.get('github_token')?.value;
  
  const parsed = user ? safeJsonParse<Record<string, unknown> | null>(user, null) : null;
  if (!parsed || !token) {
    return NextResponse.json(
      { error: 'Not authenticated', authenticated: false },
      { status: 401 }
    );
  }
  
  return NextResponse.json({ user: parsed, authenticated: true });
}

export async function DELETE() {
  const response = NextResponse.json({ message: 'Logged out successfully' });
  
  response.cookies.delete('github_token');
  response.cookies.delete('github_user');
  response.cookies.delete('github_oauth_state');
  
  return response;
}
