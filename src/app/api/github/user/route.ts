import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const user = request.cookies.get('github_user')?.value;
    const token = request.cookies.get('github_token')?.value;
    
    if (!user || !token) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }
    
    return NextResponse.json({ user: JSON.parse(user), authenticated: true });
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to get user' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const response = NextResponse.json({ message: 'Logged out successfully' });
    
    response.cookies.delete('github_token');
    response.cookies.delete('github_user');
    response.cookies.delete('github_oauth_state');
    
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || 'Failed to logout' },
      { status: 500 }
    );
  }
}
