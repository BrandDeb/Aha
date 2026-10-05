import { NextRequest, NextResponse } from 'next/server';
import { getRepoFile, updateRepoFile } from '@/lib/github';
import { getToken, githubErrorResponse, isSameOrigin, unauthorized } from '@/lib/github-session';

const MAX_FILE_SIZE = 1024 * 1024;

type Params = { params: Promise<{ owner: string; repo: string }> };

/**
 * Read a file: GET ?path=src/main.ts -> { path, content, sha }
 */
export async function GET(request: NextRequest, { params }: Params) {
  const token = getToken(request);
  if (!token) {
    return unauthorized();
  }

  const { owner, repo } = await params;
  const filePath = request.nextUrl.searchParams.get('path');
  if (!filePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }

  try {
    const file = await getRepoFile(token, owner, repo, filePath);
    return NextResponse.json({ path: filePath, ...file });
  } catch (error) {
    return githubErrorResponse(error, 'Failed to fetch file');
  }
}

/**
 * Create or update a file (one commit):
 * PUT { path, content, message?, sha? } -> { path, sha, commit }
 */
export async function PUT(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }

  const token = getToken(request);
  if (!token) {
    return unauthorized();
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { path: filePath, content, message, sha } = body;
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 });
  }
  if (typeof content !== 'string') {
    return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_SIZE) {
    return NextResponse.json({ error: 'File is too large' }, { status: 413 });
  }
  if (sha !== undefined && typeof sha !== 'string') {
    return NextResponse.json({ error: 'sha must be a string' }, { status: 400 });
  }

  const commitMessage = typeof message === 'string' && message.trim()
    ? message.trim().slice(0, 500)
    : `Update ${filePath} from NanoCLI Studio`;

  const { owner, repo } = await params;

  try {
    const result = await updateRepoFile(token, owner, repo, filePath, content, commitMessage, sha);
    return NextResponse.json({
      path: filePath,
      sha: result.content?.sha,
      commit: { sha: result.commit.sha, html_url: result.commit.html_url },
    });
  } catch (error) {
    return githubErrorResponse(error, 'Failed to save file');
  }
}
