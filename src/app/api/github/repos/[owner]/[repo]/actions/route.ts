import { NextRequest, NextResponse } from 'next/server';
import { getJobLog, listRunJobs, listWorkflowRuns, rerunFailedJobs } from '@/lib/github';
import { getToken, githubErrorResponse, isSameOrigin, unauthorized } from '@/lib/github-session';

type Params = { params: Promise<{ owner: string; repo: string }> };

const id = (v: unknown) => (typeof v === 'string' || typeof v === 'number') && /^\d{1,20}$/.test(String(v)) ? Number(v) : null;

/**
 * GitHub Actions for a repository:
 *   GET ?branch=main         -> { runs: [{ id, name, status, conclusion, headSha, url, … }] }
 *   GET ?run=123             -> { jobs: [{ id, name, status, conclusion, steps, url }] }
 *   GET ?job=456             -> { log }  (the end of the job's log)
 */
export async function GET(request: NextRequest, { params }: Params) {
  const token = getToken(request);
  if (!token) return unauthorized();
  const { owner, repo } = await params;
  const query = request.nextUrl.searchParams;
  try {
    const job = id(query.get('job'));
    if (job !== null) return NextResponse.json({ log: await getJobLog(token, owner, repo, job) });
    const run = id(query.get('run'));
    if (run !== null) return NextResponse.json({ jobs: await listRunJobs(token, owner, repo, run) });
    const branch = query.get('branch');
    if (!branch) return NextResponse.json({ error: 'branch, run or job is required' }, { status: 400 });
    return NextResponse.json({ runs: await listWorkflowRuns(token, owner, repo, branch) });
  } catch (error) {
    return githubErrorResponse(error, 'Could not read GitHub Actions');
  }
}

/** Re-run the failed jobs of a run: POST { action: 'rerun', run } */
export async function POST(request: NextRequest, { params }: Params) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const token = getToken(request);
  if (!token) return unauthorized();
  const body = await request.json().catch(() => null);
  const run = id(body?.run);
  if (body?.action !== 'rerun' || run === null) return NextResponse.json({ error: 'action "rerun" and a run id are required' }, { status: 400 });
  const { owner, repo } = await params;
  try {
    await rerunFailedJobs(token, owner, repo, run);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return githubErrorResponse(error, 'Could not re-run the jobs');
  }
}
