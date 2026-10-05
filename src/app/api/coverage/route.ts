import { NextRequest, NextResponse } from 'next/server';
import { analyzeCoverage, parseCompileOptions } from '@/lib/compiler';

/**
 * How much of a program scriptc compiles statically, and what blocks the rest.
 * POST { code, filename? } -> { success, statements, static, percent, blockers }
 */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body', success: false }, { status: 400 });
  }

  const options = parseCompileOptions(body);
  if ('error' in options) {
    return NextResponse.json({ error: options.error, success: false }, { status: 400 });
  }

  const result = await analyzeCoverage(options);
  return NextResponse.json(result, { status: result.success ? 200 : 500 });
}
