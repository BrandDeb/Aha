import { NextRequest, NextResponse } from 'next/server';
import { compileLimiter, MAX_COMPILE_BODY } from '@/lib/compile-limits';
import { cleanupOldTempFiles, compileTypeScript, parseCompileOptions } from '@/lib/compiler';
import { clientKey } from '@/lib/rate-limit';
import { isNotCrossSite, readJsonLimited } from '@/lib/request-guard';

export async function POST(request: NextRequest) {
  // Callable from scripts (no Origin), never on behalf of another site
  if (!isNotCrossSite(request)) {
    return NextResponse.json({ error: 'Cross-site request rejected', success: false }, { status: 403 });
  }
  const wait = compileLimiter.check(clientKey(request.headers));
  if (wait) {
    return NextResponse.json({ error: `Too many builds. Try again in ${Math.ceil(wait / 60)} min.`, success: false }, { status: 429, headers: { 'Retry-After': String(wait) } });
  }
  const body = await readJsonLimited(request, MAX_COMPILE_BODY);
  if (!body.ok) return NextResponse.json({ error: body.error, success: false }, { status: body.status });

  const options = parseCompileOptions(body.value);
  if ('error' in options) {
    return NextResponse.json({ error: options.error, success: false }, { status: 400 });
  }

  try {
    // Opportunistically prune stale build artifacts
    void cleanupOldTempFiles();
    return NextResponse.json(await compileTypeScript(options));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Compilation failed', success: false }, { status: 500 });
  }
}
