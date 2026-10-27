/**
 * Request checks shared by the API routes that are meant to be callable from
 * scripts as well as from the studio (compile, coverage): refuse requests a
 * browser makes on behalf of another site, and read bodies with a hard size
 * limit, so a chunked upload without Content-Length can't exhaust memory.
 */

import { isTrustedHost } from './host.ts';

interface HeaderSource {
  headers: { get(name: string): string | null };
}

/**
 * True unless a browser says this request comes from another site. Browsers
 * send Origin (and Sec-Fetch-Site) on every cross-site POST, including the
 * "simple" text/plain ones that skip CORS preflight; curl and scripts send
 * neither and are allowed.
 */
export function isNotCrossSite(request: HeaderSource, baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site === 'cross-site') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    const host = request.headers.get('host');
    // Origin and Host agree on a DNS-rebinding page too (evil.example pointed at 127.0.0.1), so the name must be ours
    return (new URL(origin).host === host && isTrustedHost(host, baseUrl, process.env.ALLOWED_HOSTS)) || new URL(origin).origin === new URL(baseUrl).origin;
  } catch {
    return false;
  }
}

export type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

/** Parse a JSON body, giving up as soon as it grows past `maxBytes` */
export async function readJsonLimited(request: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(request.headers.get('content-length'));
  if (declared > maxBytes) return { ok: false, status: 413, error: 'Request is too large' };
  if (!request.body) return { ok: false, status: 400, error: 'Invalid JSON body' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return { ok: false, status: 413, error: 'Request is too large' };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, value: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch {
    return { ok: false, status: 400, error: 'Invalid JSON body' };
  }
}

/** The JSON body, or null when it is not JSON or grows past `maxBytes` (a chunked upload has no Content-Length to check) */
// Typed like Request.json(), which it replaces in the routes
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonOrNull(request: Request, maxBytes: number): Promise<any> {
  const body = await readJsonLimited(request, maxBytes);
  return body.ok ? body.value : null;
}
