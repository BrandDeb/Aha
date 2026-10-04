import { NextRequest, NextResponse } from 'next/server';
import { getRepoContents } from '@/lib/github';
import { getToken, githubErrorResponse, unauthorized } from '@/lib/github-session';

/**
 * List a directory in a repository: GET ?path=src
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  const token = getToken(request);
  if (!token) {
    return unauthorized();
  }

  const { owner, repo } = await params;
  const dirPath = request.nextUrl.searchParams.get('path') || '';

  try {
    const items = await getRepoContents(token, owner, repo, dirPath);
    // Directories first, then alphabetical
    items.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1
    );
    return NextResponse.json(items);
  } catch (error) {
    return githubErrorResponse(error, 'Failed to fetch repository contents');
  }
}
