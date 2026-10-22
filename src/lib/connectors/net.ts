/**
 * Fetching on behalf of a model. A page the agent reads is untrusted, and the
 * URL it asks for may be chosen by something it read, so requests must not be
 * able to reach the local network (cloud metadata, routers, this very server).
 * Addresses are checked after DNS resolution and the connection is pinned to
 * the checked address, so a hostname cannot answer differently the second time.
 */

import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

/** True for loopback, private, link-local, shared, multicast, reserved and mapped-private addresses */
export function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(lower);
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16);
      const lo = parseInt(hexMapped[2], 16);
      return isPrivateAddress(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return (
      lower === '::' ||
      lower === '::1' ||
      /^f[cd]/.test(lower) || // unique local
      /^fe[89ab]/.test(lower) || // link-local
      /^ff/.test(lower) || // multicast
      lower.startsWith('2001:db8') ||
      lower.startsWith('64:ff9b') // NAT64 can reach IPv4 private space
    );
  }
  return true; // not an address we understand: treat as unsafe
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  /** Let requests reach private addresses (the user's own servers, tests) */
  allowPrivate?: boolean;
  signal?: AbortSignal;
}

export interface FetchedResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  url: string;
  truncated: boolean;
}

export class FetchError extends Error {}

async function resolveTarget(hostname: string, allowPrivate: boolean): Promise<{ address: string; family: number }> {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) {
    if (!allowPrivate && isPrivateAddress(bare)) throw new FetchError('That address is on a private network, which the agent may not reach.');
    return { address: bare, family: net.isIPv6(bare) ? 6 : 4 };
  }
  let records: dns.LookupAddress[];
  try {
    records = await dns.promises.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new FetchError(`Could not find “${bare}”.`);
  }
  if (!records.length) throw new FetchError(`Could not find “${bare}”.`);
  if (!allowPrivate && records.some((r) => isPrivateAddress(r.address))) {
    throw new FetchError(`“${bare}” points to a private network address, which the agent may not reach.`);
  }
  return records[0];
}

function decode(body: Buffer, encoding: string | undefined, maxBytes: number): Buffer {
  const options = { maxOutputLength: maxBytes };
  try {
    if (encoding === 'gzip') return zlib.gunzipSync(body, options);
    if (encoding === 'deflate') return zlib.inflateSync(body, options);
    if (encoding === 'br') return zlib.brotliDecompressSync(body, options);
  } catch {
    throw new FetchError('The response could not be decompressed (or is too large).');
  }
  return body;
}

function once(url: URL, target: { address: string; family: number }, options: FetchOptions, maxBytes: number): Promise<FetchedResponse> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.request(
      url,
      {
        method: options.method ?? 'GET',
        headers: {
          'User-Agent': 'NanoCLI-Studio-Agent/1.0',
          'Accept-Encoding': 'gzip, deflate, br',
          ...(options.body !== undefined ? { 'Content-Length': String(Buffer.byteLength(options.body)) } : {}),
          ...options.headers,
        },
        // Connect to the address that was checked, whatever the name resolves to now
        lookup: (_host, lookupOptions, callback) => {
          if ((lookupOptions as { all?: boolean }).all) (callback as unknown as (e: null, a: unknown) => void)(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        },
        timeout: options.timeoutMs ?? 15_000,
        signal: options.signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let truncated = false;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            truncated = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () => {
          try {
            const raw = Buffer.concat(chunks);
            const body = truncated ? raw : decode(raw, response.headers['content-encoding'], maxBytes * 4);
            resolve({ status: response.statusCode ?? 0, headers: response.headers, body, url: url.toString(), truncated });
          } catch (error) {
            reject(error);
          }
        };
        response.on('end', finish);
        response.on('close', () => truncated && finish());
        response.on('error', (error) => (truncated ? finish() : reject(error)));
      }
    );
    request.on('timeout', () => request.destroy(new FetchError('The request timed out.')));
    request.on('error', (error) => reject(error instanceof FetchError ? error : new FetchError(`The request failed: ${(error as Error).message}`)));
    if (options.body !== undefined) request.write(options.body);
    request.end();
  });
}

/** GET (or POST) a public URL, following redirects only to other public URLs */
export async function fetchPublic(rawUrl: string, options: FetchOptions = {}): Promise<FetchedResponse> {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new FetchError('That is not a valid URL.');
  }
  for (let hop = 0; hop <= (options.maxRedirects ?? 5); hop++) {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchError('Only http and https URLs can be fetched.');
    if (url.username || url.password) throw new FetchError('URLs with embedded credentials are not allowed.');
    const target = await resolveTarget(url.hostname, options.allowPrivate === true);
    const response = await once(url, target, hop === 0 ? options : { ...options, method: 'GET', body: undefined }, maxBytes);
    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      const next = new URL(location, url);
      // Credentials must not follow a redirect to another site
      if (next.origin !== url.origin && options.headers) options = { ...options, headers: Object.fromEntries(Object.entries(options.headers).filter(([k]) => !/^(authorization|cookie|x-.*(key|token).*)$/i.test(k))) };
      url = next;
      continue;
    }
    return response;
  }
  throw new FetchError('Too many redirects.');
}
