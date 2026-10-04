import { NextRequest, NextResponse } from 'next/server';
import { pullTree } from '@/lib/github';
import { getToken, githubErrorResponse, unauthorized } from '@/lib/github-session';

/**
 * Pull every text file of a branch: GET ?branch=main -> { ref, sha, files, skipped }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const token = getToken(request);
  if (!token) return unauthorized();
  const branch = request.nextUrl.searchParams.get('branch');
  if (!branch) {
    return NextResponse.json({ error: 'branch is required' }, { status: 400 });
  }
  const { owner, repo } = await params;
  try {
    return NextResponse.json(await pullTree(token, owner, repo, branch));
  } catch (error) {
    return githubErrorResponse(error, 'Failed to pull branch');
  }
}
