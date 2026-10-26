import { NextRequest, NextResponse } from 'next/server';
import { compileLimiter, MAX_COMPILE_BODY } from '@/lib/compile-limits';
import { analyzeCoverage, parseCompileOptions } from '@/lib/compiler';
import { clientKey } from '@/lib/rate-limit';
import { isNotCrossSite, readJsonLimited } from '@/lib/request-guard';

/**
 * How much of a program scriptc compiles statically, and what blocks the rest.
 * POST { code, filename? } -> { success, statements, static, percent, blockers }
 */
export async function POST(request: NextRequest) {
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

  const result = await analyzeCoverage(options);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
