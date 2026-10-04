/**
 * Serve a compiled artifact from the temp directory - Server-side only
 */

import { promises as fs } from 'fs';
import { NextResponse } from 'next/server';
import { resolveTempPath } from './compiler';

export async function serveTempFile(filename: string | null): Promise<NextResponse> {
  if (!filename) {
    return NextResponse.json(
      { error: 'Filename is required' },
      { status: 400 }
    );
  }

  const filePath = resolveTempPath(filename);
  if (!filePath) {
    return NextResponse.json(
      { error: 'Invalid filename' },
      { status: 400 }
    );
  }

  try {
    const fileBuffer = await fs.readFile(filePath);
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'File not found' },
      { status: 404 }
    );
  }
}
