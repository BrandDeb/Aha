import { NextRequest, NextResponse } from 'next/server';
import { strFromU8, unzipSync } from 'fflate';
import { getBaseUrl, isSameOrigin } from '@/lib/github-session';
import { isTrustedHost } from '@/lib/host';
import { readPack, splitId } from '@/lib/extensions';
import { clientKey, createRateLimiter } from '@/lib/rate-limit';
import { readJsonLimited } from '@/lib/request-guard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * VS Code extensions from Open VSX. Searching passes through; installing downloads the .vsix from Open VSX, reads
 * only its manifest and JSON files (themes, snippets), and returns what the studio can use. Nothing from the
 * package is executed or stored on this machine: the browser keeps the result.
 */

const OPEN_VSX = 'https://open-vsx.org/api';
const MAX_VSIX = 40 * 1024 * 1024;
const MAX_FILE = 4 * 1024 * 1024;
const MAX_TEXT = 12 * 1024 * 1024;
const limiter = createRateLimiter(40, 10 * 60 * 1000);

const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const trusted = (request: NextRequest) => isTrustedHost(request.headers.get('host'), getBaseUrl(), process.env.ALLOWED_HOSTS);
const SEGMENT = /^[\w.-]{1,100}$/;

interface OpenVsxExtension {
  namespace: string;
  name: string;
  version: string;
  displayName?: string;
  description?: string;
  downloadCount?: number;
  averageRating?: number;
  files?: { download?: string; icon?: string };
}

async function openVsx(path: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(`${OPEN_VSX}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (response.status === 404) throw Object.assign(new Error('Not on Open VSX'), { status: 404 });
  if (!response.ok) throw new Error(`Open VSX answered ${response.status}`);
  return response.json();
}

const summary = (e: OpenVsxExtension) => ({
  id: `${e.namespace}.${e.name}`,
  version: e.version,
  displayName: e.displayName || e.name,
  description: e.description ?? '',
  downloads: e.downloadCount ?? 0,
  icon: e.files?.icon && e.files.icon.startsWith(`${OPEN_VSX}/`) ? e.files.icon : undefined,
});

/** The package, read up to a size limit */
async function download(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal });
  if (!response.ok || !response.body) throw new Error(`The download failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > MAX_VSIX) throw new Error('The extension is too large');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_VSIX) {
      await reader.cancel();
      throw new Error('The extension is too large');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

/**
 * GET ?q=dracula  → { results } (search)
 * GET ?id=pub.name → { extension } (one extension's details)
 */
export async function GET(request: NextRequest) {
  if (!trusted(request)) return json({ error: 'Not available for this host name.' }, 403);
  const signal = AbortSignal.timeout(15_000);
  const q = (request.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 100);
  const id = request.nextUrl.searchParams.get('id');
  try {
    if (id !== null) {
      const parts = splitId(id);
      if (!parts) return json({ error: 'An extension id looks like publisher.name' }, 400);
      return json({ extension: summary((await openVsx(`/${parts.namespace}/${parts.name}`, signal)) as OpenVsxExtension) });
    }
    if (!q) return json({ results: [] });
    const data = (await openVsx(`/-/search?query=${encodeURIComponent(q)}&size=20&sortBy=relevance`, signal)) as { extensions?: OpenVsxExtension[] };
    return json({ results: (data.extensions ?? []).map(summary) });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    return json({ error: (error as Error).name === 'TimeoutError' ? 'Open VSX did not answer in time' : (error as Error).message }, status);
  }
}

/** POST { id: "publisher.name", version? } → { pack } */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return json({ error: 'Cross-origin request rejected' }, 403);
  if (!trusted(request)) return json({ error: 'Not available for this host name.' }, 403);
  const wait = limiter.check(clientKey(request.headers));
  if (wait) return json({ error: `Too many installs. Try again in ${Math.ceil(wait / 60)} min.` }, 429);
  const body = await readJsonLimited(request, 2_000);
  if (!body.ok) return json({ error: body.error }, body.status);
  const input = (body.value ?? {}) as { id?: unknown; version?: unknown };
  const parts = typeof input.id === 'string' ? splitId(input.id) : null;
  if (!parts || !SEGMENT.test(parts.namespace) || !SEGMENT.test(parts.name)) return json({ error: 'An extension id looks like publisher.name' }, 400);
  const version = typeof input.version === 'string' && SEGMENT.test(input.version) ? `/${input.version}` : '';

  const signal = AbortSignal.timeout(60_000);
  try {
    const meta = (await openVsx(`/${parts.namespace}/${parts.name}${version}`, signal)) as OpenVsxExtension;
    const url = meta.files?.download;
    // Only Open VSX's own download address (it may redirect to its storage)
    if (!url || !url.startsWith(`${OPEN_VSX}/`)) return json({ error: 'Open VSX did not give a download for it' }, 502);
    const zip = unzipSync(await download(url, signal), {
      filter: (file) => file.name.startsWith('extension/') && !file.name.includes('/node_modules/') && file.originalSize <= MAX_FILE && (file.name === 'extension/package.json' || /\.(json|code-snippets)$/i.test(file.name)),
    });
    const files: Record<string, string> = {};
    let total = 0;
    for (const [name, data] of Object.entries(zip)) {
      total += data.byteLength;
      if (total > MAX_TEXT) break;
      files[name] = strFromU8(data);
    }
    const pack = readPack(files, { namespace: meta.namespace, name: meta.name, version: meta.version });
    return json({ pack });
  } catch (error) {
    const status = (error as { status?: number }).status ?? 502;
    return json({ error: (error as Error).name === 'TimeoutError' ? 'The download took too long' : (error as Error).message }, status);
  }
}
