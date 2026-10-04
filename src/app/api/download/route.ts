import { NextRequest } from 'next/server';
import { serveTempFile } from '@/lib/download';

export async function GET(request: NextRequest) {
  return serveTempFile(request.nextUrl.searchParams.get('filename'));
}
