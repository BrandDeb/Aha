/**
 * Remix: start from something that exists. A public GitHub repository is copied in (one tarball download, no
 * sign-in, no API rate limit) and the agent changes it the way you describe; a website becomes an outline (its
 * title, sections, navigation and copy) that the agent rebuilds as an original app with the same structure. The
 * repository's licence is read and shown, because a remix is only yours to ship when the licence says so.
 * The parsing and the brief are pure; fetching takes the fetch function, so it is tested without the network.
 */

import { gunzipSync } from 'node:zlib';
import { htmlToText } from './connectors/html.ts';
import type { RemixSource, SiteOutline } from './remix-brief.ts';

export { guessEntry, parseRemixSource, remixBrief, remixName, type RemixSource, type SiteOutline } from './remix-brief.ts';

/** Files a remix never copies: dependencies, build output, version control, and anything that isn't text */
const SKIP = /(^|\/)(node_modules|\.git|dist|build|out|\.next|\.nuxt|target|vendor|\.venv|venv|__pycache__|coverage|\.cache)\//;
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|bmp|tiff?|pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|class|exe|dll|so|dylib|a|o|obj|wasm|woff2?|ttf|otf|eot|mp3|mp4|mov|avi|webm|ogg|wav|flac|psd|sketch|fig|db|sqlite3?|lockb)$/i;
export const REMIX_LIMITS = { files: 400, fileBytes: 256 * 1024, totalBytes: 6 * 1024 * 1024 };

/** Regular files of a tar archive, with long names (ustar prefix and pax headers) put back together */
export function readTar(tar: Uint8Array): { path: string; data: Uint8Array }[] {
  const out: { path: string; data: Uint8Array }[] = [];
  const decoder = new TextDecoder();
  const field = (start: number, length: number) => decoder.decode(tar.subarray(start, start + length)).replace(/\0[\s\S]*$/, '');
  let longName: string | null = null;
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = field(offset, 100);
    if (!name) break;
    const size = parseInt(field(offset + 124, 12).trim() || '0', 8);
    const type = field(offset + 156, 1);
    const prefix = field(offset + 345, 155);
    const start = offset + 512;
    const data = tar.subarray(start, start + size);
    if (type === 'x') {
      // pax extended header: "<len> path=<name>\n" records
      const m = /\d+ path=([^\n]*)\n/.exec(decoder.decode(data));
      longName = m ? m[1] : null;
    } else if (type === 'L') longName = decoder.decode(data).replace(/\0[\s\S]*$/, '');
    else {
      if (type === '0' || type === '') out.push({ path: longName ?? (prefix ? `${prefix}/${name}` : name), data: data.slice() });
      if (type !== 'g') longName = null;
    }
    offset = start + Math.ceil(size / 512) * 512;
  }
  return out;
}

export interface RepoSnapshot {
  files: Record<string, string>;
  skipped: string[];
  /** The licence the repository declares, by its first line ("MIT License"), or null when there is none */
  license: string | null;
}

/** The text files of a repository tarball (codeload's "<repo>-<ref>/" top folder removed), within the limits */
export function snapshotFromTarball(tgz: Uint8Array): RepoSnapshot {
  const entries = readTar(new Uint8Array(gunzipSync(tgz)));
  const files: Record<string, string> = {};
  const skipped: string[] = [];
  let total = 0;
  for (const { path: full, data } of entries) {
    const path = full.replace(/^[^/]+\//, '');
    if (!path || path.split('/').some((p) => p === '..' || p === '')) continue;
    if (SKIP.test(`${path}`) || BINARY.test(path) || data.length > REMIX_LIMITS.fileBytes || data.includes(0)) {
      skipped.push(path);
      continue;
    }
    if (Object.keys(files).length >= REMIX_LIMITS.files || total + data.length > REMIX_LIMITS.totalBytes) {
      skipped.push(path);
      continue;
    }
    total += data.length;
    files[path] = new TextDecoder().decode(data);
  }
  const licenseFile = Object.keys(files).find((p) => /^(LICEN[CS]E|COPYING)(\.\w+)?$/i.test(p));
  const license = licenseFile ? (files[licenseFile].split('\n').map((l) => l.trim()).find(Boolean) ?? 'a licence file').slice(0, 80) : null;
  return { files, skipped: skipped.sort(), license };
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** Download a public repository at a ref (or its default branch) as text files */
export async function fetchRepo(source: Extract<RemixSource, { kind: 'repo' }>, fetchImpl: Fetch = fetch): Promise<RepoSnapshot & { ref: string }> {
  const tryRef = async (ref: string) => {
    const r = await fetchImpl(`https://codeload.github.com/${source.owner}/${source.repo}/tar.gz/${ref.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const size = Number(r.headers.get('content-length') ?? 0);
    if (size > 40 * 1024 * 1024) throw new Error('That repository is too big to remix here (over 40 MB compressed).');
    return { ref, snap: snapshotFromTarball(new Uint8Array(await r.arrayBuffer())) };
  };
  const got = source.ref ? await tryRef(source.ref) : ((await tryRef('HEAD')) ?? (await tryRef('main')) ?? (await tryRef('master')));
  if (!got) throw new Error(`Couldn't download ${source.owner}/${source.repo}${source.ref ? ` at ${source.ref}` : ''}: is it public, and spelled right?`);
  return { ...got.snap, ref: got.ref };
}

/** What a page is made of, from its HTML */
export function outlineOf(html: string, url: string): SiteOutline {
  const { title, text } = htmlToText(html, url);
  const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const headings = [...html.matchAll(/<h([1-4])[^>]*>([\s\S]*?)<\/h\1>/gi)].map((m) => ({ level: Number(m[1]), text: strip(m[2]).slice(0, 120) })).filter((h) => h.text).slice(0, 40);
  const navHtml = html.match(/<nav[\s\S]*?<\/nav>/i)?.[0] ?? html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? '';
  const nav = [...navHtml.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => strip(m[1])).filter((t) => t && t.length < 40).slice(0, 12);
  return { url, title: title.slice(0, 120), headings, nav, text: text.slice(0, 6000) };
}

