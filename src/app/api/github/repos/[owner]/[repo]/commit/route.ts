import { NextRequest, NextResponse } from 'next/server';
import { commitFiles } from '@/lib/github';
import { getToken, githubErrorResponse, isSameOrigin, unauthorized } from '@/lib/github-session';

const MAX_CHANGES = 200;
const MAX_TOTAL_SIZE = 4 * 1024 * 1024;

/**
 * Commit and push several files at once:
 * POST { branch, message, changes: { path: content | null }, expectedHead? } -> { sha, html_url }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ owner: string; repo: string }> }
) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  const token = getToken(request);
  if (!token) return unauthorized();

  const body = await request.json().catch(() => null);
  if (!body || typeof body.branch !== 'string' || typeof body.message !== 'string' || !body.message.trim()) {
    return NextResponse.json({ error: 'branch and message are required' }, { status: 400 });
  }
  const changes = body.changes;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    return NextResponse.json({ error: 'changes must be an object of path -> content | null' }, { status: 400 });
  }
  const entries = Object.entries(changes as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_CHANGES) {
    return NextResponse.json({ error: `Commit 1-${MAX_CHANGES} files at a time` }, { status: 400 });
  }
  let total = 0;
  for (const [, content] of entries) {
    if (content !== null && typeof content !== 'string') {
      return NextResponse.json({ error: 'File contents must be strings (or null to delete)' }, { status: 400 });
    }
    total += typeof content === 'string' ? Buffer.byteLength(content) : 0;
  }
  if (total > MAX_TOTAL_SIZE) {
    return NextResponse.json({ error: 'Commit is too large' }, { status: 413 });
  }

  const { owner, repo } = await params;
  try {
    const result = await commitFiles(
      token,
      owner,
      repo,
      body.branch,
      body.message.trim().slice(0, 1000),
      changes as Record<string, string | null>,
      typeof body.expectedHead === 'string' ? body.expectedHead : undefined
    );
    return NextResponse.json(result);
  } catch (error) {
    return githubErrorResponse(error, 'Failed to commit');
  }
}
