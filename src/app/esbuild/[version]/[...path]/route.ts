import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';
import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

/**
 * The in-browser preview's bundler: esbuild's WebAssembly build and its
 * browser module, served from the installed esbuild-wasm package (no CDN).
 * The preview frame has an opaque origin, so these two files are the only
 * ones the studio serves with Access-Control-Allow-Origin: *; they are public
 * library code. The version in the URL makes them cacheable for a year.
 */
const ROOT = path.join(process.cwd(), 'node_modules', 'esbuild-wasm');
const FILES: Record<string, { file: string; type: string }> = {
  'browser.js': { file: path.join(ROOT, 'esm', 'browser.min.js'), type: 'text/javascript; charset=utf-8' },
  'esbuild.wasm': { file: path.join(ROOT, 'esbuild.wasm'), type: 'application/wasm' },
};

const brotli = promisify(brotliCompress);
const deflate = promisify(gzip);
const compressed = new Map<string, Buffer>();

export async function GET(request: NextRequest, { params }: { params: Promise<{ version: string; path: string[] }> }) {
  const { version, path: parts } = await params;
  const entry = parts.length === 1 ? FILES[parts[0]] : undefined;
  if (!entry) return new NextResponse('Not found', { status: 404 });
  const accept = request.headers.get('accept-encoding') ?? '';
  const encoding = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : undefined;
  let data: Buffer;
  if (encoding) {
    const key = `${encoding}:${parts[0]}`;
    data = compressed.get(key) ?? (await (async () => {
      const raw = await readFile(entry.file);
      const out = encoding === 'br' ? await brotli(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 6 } }) : await deflate(raw, { level: 6 });
      compressed.set(key, out);
      return out;
    })());
  } else {
    data = await readFile(entry.file);
  }
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': entry.type,
      'Content-Length': String(data.length),
      ...(encoding ? { 'Content-Encoding': encoding } : {}),
      Vary: 'Accept-Encoding',
      'Access-Control-Allow-Origin': '*',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'Cache-Control': version === process.env.NEXT_PUBLIC_ESBUILD_VERSION ? 'public, max-age=31536000, immutable' : 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
