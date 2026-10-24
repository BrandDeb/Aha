import { createReadStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import { NANOCLI_DIR } from '@/lib/connectors/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The Solidity compiler for the browser, served from this origin (the studio's script policy only runs its own
 * scripts): the official soljson builds from binaries.soliditylang.org, downloaded once and kept in
 * ~/.nanocli/solc, so the second compile at a version works offline.
 *
 *   GET /api/solc            → { latest, releases: ["0.8.38", …] } (newest first)
 *   GET /api/solc?v=0.8.38   → the compiler, as JavaScript
 */
const BASE = 'https://binaries.soliditylang.org/bin';
const DIR = path.join(NANOCLI_DIR, 'solc');
let list: { at: number; latest: string; releases: Record<string, string> } | null = null;

async function releases() {
  if (list && Date.now() - list.at < 60 * 60 * 1000) return list;
  const r = await fetch(`${BASE}/list.json`, { signal: AbortSignal.timeout(20_000) });
  if (!r.ok) throw new Error(`The compiler list answered ${r.status}`);
  const data = (await r.json()) as { latestRelease: string; releases: Record<string, string> };
  list = { at: Date.now(), latest: data.latestRelease, releases: data.releases };
  return list;
}

export async function GET(request: NextRequest) {
  const version = request.nextUrl.searchParams.get('v');
  try {
    const known = await releases();
    if (!version) {
      const all = Object.keys(known.releases).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
      return NextResponse.json({ latest: known.latest, releases: all }, { headers: { 'Cache-Control': 'public, max-age=3600' } });
    }
    const file = known.releases[version];
    if (!/^\d+\.\d+\.\d+$/.test(version) || !file || !/^soljson-v[\w.+-]+\.js$/.test(file)) return NextResponse.json({ error: `No compiler ${version}` }, { status: 404 });
    const local = path.join(DIR, file);
    const have = await stat(local).catch(() => null);
    if (!have) {
      const r = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(120_000) });
      if (!r.ok) throw new Error(`Downloading solc ${version} answered ${r.status}`);
      await mkdir(DIR, { recursive: true });
      const tmp = `${local}.${process.pid}.part`;
      await writeFile(tmp, Buffer.from(await r.arrayBuffer()));
      await rename(tmp, local);
    }
    const size = (await stat(local)).size;
    return new Response(Readable.toWeb(createReadStream(local)) as ReadableStream, {
      headers: { 'Content-Type': 'text/javascript; charset=utf-8', 'Content-Length': String(size), 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
