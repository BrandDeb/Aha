import { NextRequest, NextResponse } from 'next/server';
import { createGist } from '@/lib/github';
import { getToken, githubErrorResponse, isSameOrigin, unauthorized } from '@/lib/github-session';

/**
 * Export project files to a secret gist: POST { description, files } -> { id, html_url }
 */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  }
  const token = getToken(request);
  if (!token) return unauthorized();

  const body = await request.json().catch(() => null);
  const files = body?.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    return NextResponse.json({ error: 'files are required' }, { status: 400 });
  }
  if (Object.keys(files).length > 100 || Object.values(files).some(c => typeof c !== 'string')) {
    return NextResponse.json({ error: 'Up to 100 text files can be exported' }, { status: 400 });
  }
  if (Buffer.byteLength(JSON.stringify(files)) > 2 * 1024 * 1024) {
    return NextResponse.json({ error: 'Project is too large for a gist' }, { status: 413 });
  }
  try {
    const description = typeof body.description === 'string' ? body.description.slice(0, 200) : 'NanoCLI project';
    return NextResponse.json(await createGist(token, description, files as Record<string, string>));
  } catch (error) {
    return githubErrorResponse(error, 'Failed to create gist (sign in again to grant gist access)');
  }
}
