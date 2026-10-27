/**
 * What the registries say about a package, for the supply-chain guard: npm and PyPI (existence, install scripts, age,
 * downloads, licence) and OSV (known advisories for the version that would be installed). Only these fixed hosts are
 * asked; a package name never becomes part of a host, and every answer is size-capped and cached for an hour.
 */

import type { Ecosystem, PackageFacts } from './supply-chain.ts';

const TIMEOUT_MS = 8000;
const CACHE_MS = 60 * 60 * 1000;
const cache = new Map<string, { at: number; facts: Promise<PackageFacts> }>();

/** Names each registry allows; anything else is refused before a request is made */
export const VALID_NAME: Partial<Record<Ecosystem, RegExp>> = {
  npm: /^(@[a-z0-9][\w.-]{0,100}\/)?[a-z0-9][\w.-]{0,213}$/i,
  PyPI: /^[A-Za-z0-9][\w.-]{0,100}$/,
  'crates.io': /^[A-Za-z][\w-]{0,63}$/,
  Go: /^[\w.-]+(\/[\w.~-]+){0,10}$/,
  RubyGems: /^[A-Za-z0-9][\w.-]{0,100}$/,
  Packagist: /^[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*$/,
};

class Missing extends Error {}

async function getJson(url: string, maxBytes: number, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), headers: { Accept: 'application/json', 'User-Agent': 'aha-studio supply-chain check', ...(init.headers ?? {}) } });
  if (response.status === 404) throw new Missing();
  if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > maxBytes) throw new RangeError('too large');
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new RangeError('too large');
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const exactVersion = (spec: string) => (/^[=v]?\s*(\d+\.\d+\.\d+[\w.+-]*)$/.exec(spec.trim().replace(/^==/, '')) ?? [])[1];

async function osv(ecosystem: Ecosystem, name: string, version: string | undefined): Promise<PackageFacts['advisories']> {
  // Without a version OSV lists every advisory the package ever had: only ask about the one that would be installed
  if (!version) return undefined;
  const data = (await getJson('https://api.osv.dev/v1/query', 2 * 1024 * 1024, { method: 'POST', body: JSON.stringify({ version, package: { name, ecosystem } }), headers: { 'Content-Type': 'application/json' } })) as { vulns?: { id: string; summary?: string; details?: string; aliases?: string[]; database_specific?: { severity?: string } }[] } | null;
  return (data?.vulns ?? []).slice(0, 10).map((v) => ({ id: v.aliases?.find((a) => a.startsWith('CVE-')) ?? v.id, summary: (v.summary ?? v.details ?? '').split('\n')[0].slice(0, 160), ...(v.database_specific?.severity ? { severity: v.database_specific.severity.toLowerCase() } : {}) }));
}

async function npmFacts(name: string, spec: string): Promise<PackageFacts> {
  const path = name.replace('/', '%2f');
  let latest: { version?: string; license?: unknown; scripts?: Record<string, string> };
  try {
    latest = (await getJson(`https://registry.npmjs.org/${path}/latest`, 1024 * 1024)) as typeof latest;
  } catch (error) {
    if (error instanceof Missing) return { ecosystem: 'npm', name, exists: false };
    throw error;
  }
  const facts: PackageFacts = { ecosystem: 'npm', name, exists: true, version: exactVersion(spec) ?? latest.version };
  const license = latest.license;
  facts.license = typeof license === 'string' ? license : license && typeof license === 'object' && 'type' in license ? String((license as { type: unknown }).type) : undefined;
  facts.installScripts = Object.keys(latest.scripts ?? {}).filter((k) => /^(preinstall|install|postinstall|prepare)$/.test(k)).map((k) => `${k}: ${latest.scripts![k].slice(0, 80)}`);
  const [downloads, advisories] = await Promise.allSettled([
    getJson(`https://api.npmjs.org/downloads/point/last-week/${name}`, 64 * 1024) as Promise<{ downloads?: number }>,
    osv('npm', name, facts.version),
  ]);
  if (downloads.status === 'fulfilled' && typeof downloads.value?.downloads === 'number') facts.weeklyDownloads = downloads.value.downloads;
  if (advisories.status === 'fulfilled') facts.advisories = advisories.value;
  // The first publish date is in the full document, which is only small for small packages
  if (facts.weeklyDownloads !== undefined && facts.weeklyDownloads < 5000) {
    try {
      const full = (await getJson(`https://registry.npmjs.org/${path}`, 4 * 1024 * 1024)) as { time?: { created?: string } };
      if (full.time?.created) facts.created = Date.parse(full.time.created);
    } catch {
      // the age is a nice-to-have
    }
  }
  return facts;
}

async function pypiFacts(name: string, spec: string): Promise<PackageFacts> {
  let data: { info?: { version?: string; license?: string; license_expression?: string; classifiers?: string[] }; releases?: Record<string, { upload_time_iso_8601?: string }[]>; urls?: { packagetype?: string }[] };
  try {
    data = (await getJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, 8 * 1024 * 1024)) as typeof data;
  } catch (error) {
    if (error instanceof Missing) return { ecosystem: 'PyPI', name, exists: false };
    if (error instanceof RangeError) return { ecosystem: 'PyPI', name, exists: true, error: 'a large, long-published package (not checked further)' };
    throw error;
  }
  const info = data.info ?? {};
  const facts: PackageFacts = { ecosystem: 'PyPI', name, exists: true, version: exactVersion(spec) ?? info.version };
  const classifier = info.classifiers?.find((c) => c.startsWith('License ::'))?.split('::').pop()?.trim();
  facts.license = info.license_expression || (info.license && info.license.length < 60 ? info.license : undefined) || classifier;
  const uploads = Object.values(data.releases ?? {}).flat().map((f) => Date.parse(f.upload_time_iso_8601 ?? '')).filter(Number.isFinite);
  if (uploads.length) facts.created = Math.min(...uploads);
  if (data.urls?.length && !data.urls.some((u) => u.packagetype === 'bdist_wheel')) facts.installScripts = ['setup.py (no wheel: it builds from source on install)'];
  try {
    facts.advisories = await osv('PyPI', name, facts.version);
  } catch {
    // advisories stay unknown
  }
  return facts;
}

async function lookup(ecosystem: Ecosystem, name: string, spec: string): Promise<PackageFacts> {
  try {
    if (ecosystem === 'npm') return await npmFacts(name, spec);
    if (ecosystem === 'PyPI') return await pypiFacts(name, spec);
    const version = exactVersion(spec);
    return { ecosystem, name, ...(version ? { version, advisories: await osv(ecosystem, name, version) } : {}) };
  } catch (error) {
    return { ecosystem, name, error: error instanceof Error && error.name === 'TimeoutError' ? 'the registry did not answer in time' : `the registry could not be reached (${(error as Error).message.slice(0, 80)})` };
  }
}

/** The registry's facts, from the cache when asked within the hour */
export function packageFacts(ecosystem: Ecosystem, name: string, spec = ''): Promise<PackageFacts> {
  if (!VALID_NAME[ecosystem]?.test(name)) return Promise.resolve({ ecosystem, name, error: 'not a valid package name' });
  const key = `${ecosystem}:${name}@${spec}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.facts;
  const facts = lookup(ecosystem, name, spec);
  cache.set(key, { at: Date.now(), facts });
  // A failed lookup is not remembered
  void facts.then((f) => f.error && f.exists === undefined && cache.delete(key));
  if (cache.size > 2000) cache.delete(cache.keys().next().value!);
  return facts;
}
