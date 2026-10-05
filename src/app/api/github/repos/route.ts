import { NextRequest, NextResponse } from 'next/server';
import { listUserRepos } from '@/lib/github';
import { getToken, githubErrorResponse, unauthorized } from '@/lib/github-session';

export async function GET(request: NextRequest) {
  const token = getToken(request);
  if (!token) {
    return unauthorized();
  }
  
  try {
    const repos = await listUserRepos(token);
    return NextResponse.json({ repos });
  } catch (error) {
    return githubErrorResponse(error, 'Failed to fetch repositories');
  }
}
