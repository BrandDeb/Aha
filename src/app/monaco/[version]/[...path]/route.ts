import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * The code editor's files (monaco-editor's `min/vs` folder), served from the
 * installed package. The editor library would otherwise fetch them from a
 * public CDN: this keeps the studio working offline, avoids a third-party
 * request on every load, and pins the editor to the version that was tested.
 * The version in the URL makes the files safe to cache for a year.
 */
const ROOT = path.join(process.cwd(), 'node_modules', 'monaco-editor', 'min');

const TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ttf': 'font/ttf',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);

/** Compressed copies, kept for the life of the server: the editor's files are fixed, so each is compressed once */
const compressed = new Map<string, Buffer>();
const COMPRESSIBLE = new Set(['.js', '.css', '.json', '.svg']);

async function body(file: string, extension: string, accept: string): Promise<{ data: Buffer; encoding?: 'br' | 'gzip' }> {
  const raw = await readFile(file);
  const encoding = !COMPRESSIBLE.has(extension) ? undefined : /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : undefined;
  if (!encoding) return { data: raw };
  const key = `${encoding}:${file}`;
  let data = compressed.get(key);
  if (!data) {
    data = encoding === 'br' ? await brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }) : await deflate(raw, { level: 6 });
    compressed.set(key, data);
  }
  return { data, encoding };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ version: string; path: string[] }> }) {
  const { version, path: parts } = await params;
  const type = TYPES[path.extname(parts[parts.length - 1]).toLowerCase()];
  // Only the editor's own assets: a known file type under min/vs, with no way out of that folder
  if (!type || parts[0] !== 'vs' || parts.some((p) => !p || p === '.' || p === '..' || p.includes('\\') || p.includes('\0'))) {
    return new NextResponse('Not found', { status: 404 });
  }
  const file = path.join(ROOT, ...parts);
  if (!file.startsWith(ROOT + path.sep)) return new NextResponse('Not found', { status: 404 });
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return new NextResponse('Not found', { status: 404 });

  const current = version === process.env.NEXT_PUBLIC_MONACO_VERSION;
  const extension = path.extname(file).toLowerCase();
  const { data, encoding } = await body(file, extension, request.headers.get('accept-encoding') ?? '');
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': type,
      'Content-Length': String(data.length),
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
      Vary: 'Accept-Encoding',
      // A URL with the right version never changes content; anything else must not be cached
      'Cache-Control': current ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
