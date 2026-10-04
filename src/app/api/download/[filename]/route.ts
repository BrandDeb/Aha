import { NextRequest } from 'next/server';
import { serveTempFile } from '@/lib/download';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;
  return serveTempFile(filename);
}
