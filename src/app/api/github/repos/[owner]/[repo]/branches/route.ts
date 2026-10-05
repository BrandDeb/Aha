import { NextRequest, NextResponse } from 'next/server';
import { createBranch, getDefaultBranch, listBranches } from '@/lib/github';
import { getToken, githubErrorResponse, isSameOrigin, unauthorized } from '@/lib/github-session';

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * List branches: GET -> { default, branches: [{ name, sha, protected }] }
 */
export async function GET(request: NextRequest, { params }: Params) {
  const token = getToken(request);
  if (!token) return unauthorized();
  const { owner, repo } = await params;
  try {
    const [branches, defaultBranch] = await Promise.all([
      listBranches(token, owner, repo),
      getDefaultBranch(token, owner, repo),
    ]);
    return NextResponse.json({ default: defaultBranch, branches });
  } catch (error) {
    return githubErrorResponse(error, 'Failed to list branches');
  }
}

/**
 * Create a branch: POST { name, from } -> { name, sha }
 */
export async function POST(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  const token = getToken(request);
  if (!token) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== 'string' || typeof body.from !== 'string') {
    return NextResponse.json({ error: 'name and from are required' }, { status: 400 });
  }
  const { owner, repo } = await params;
  try {
    return NextResponse.json(await createBranch(token, owner, repo, body.name, body.from));
  } catch (error) {
    return githubErrorResponse(error, 'Failed to create branch');
  }
}
