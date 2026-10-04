import { NextRequest, NextResponse } from 'next/server';
import { cleanupOldTempFiles, compileTypeScript, parseCompileOptions } from '@/lib/compiler';

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: 'Invalid JSON body', success: false },
      { status: 400 }
    );
  }

  const options = parseCompileOptions(body);
  if ('error' in options) {
    return NextResponse.json(
      { error: options.error, success: false },
      { status: 400 }
    );
  }

  try {
    // Opportunistically prune stale build artifacts
    void cleanupOldTempFiles();

    const result = await compileTypeScript({
      ...options,
      optimization: options.optimization || 'O2',
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Compilation failed',
        success: false
      },
      { status: 500 }
    );
  }
}
