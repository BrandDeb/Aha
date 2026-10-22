/**
 * zig on demand. scriptc links WebAssembly with zig, which npm normally
 * installs next to it (~400 MB with its standard library). The desktop app
 * leaves it out to stay small, and fetches the very same packages the first
 * time a WASM build needs them: from the npm registry, checked against the
 * registry's sha512 integrity, unpacked under ~/.nanocli/zig/<version> in the
 * node_modules layout, where lib/zig.ts finds them. Server only.
 */

import { createHash } from 'node:crypto';
import { existsSync, promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { NANOCLI_DIR } from './connectors/env.ts';
import { untar } from './uv-install.ts';

const REGISTRY = 'https://registry.npmjs.org';

/** The zig version this studio was built against (the @zigc packages in package.json) */
export function zigVersion(root: string = process.cwd()): string | null {
  try {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
    const range: string | undefined = pkg.optionalDependencies?.['@zigc/lib'] ?? pkg.dependencies?.['@zigc/lib'];
    return range ? range.replace(/^[\^~=v]+/, '') : null;
  } catch {
    return null;
  }
}

/** Where an on-demand zig lives: a folder laid out like node_modules */
export const zigHome = (version: string) => path.join(NANOCLI_DIR, 'zig', version);

export const zigPackage = (platform = process.platform, arch = process.arch) => `@zigc/${platform}-${arch}`;

/** Check a download against an npm "sha512-<base64>" integrity string */
export function verifyIntegrity(data: Uint8Array, integrity: string): boolean {
  const match = /^sha512-([A-Za-z0-9+/=]+)$/.exec(integrity.trim());
  if (!match) return false;
  return createHash('sha512').update(data).digest('base64') === match[1];
}

/** Files of an npm package tarball, without its "package/" prefix; refuses paths that would escape */
export function packageFiles(tgz: Uint8Array): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, data] of Object.entries(untar(new Uint8Array(gunzipSync(tgz)), (n) => n.startsWith('package/')))) {
    const rel = name.slice('package/'.length);
    if (!rel || rel.startsWith('/') || rel.split('/').some((p) => p === '..' || p === '')) throw new Error(`Unsafe path in package: ${name}`);
    out[rel] = data;
  }
  return out;
}

type Fetch = (url: string) => Promise<Response>;
const defaultFetch: Fetch = (url) => fetch(url, { signal: AbortSignal.timeout(10 * 60_000) });

async function installPackage(name: string, version: string, dest: string, fetchImpl: Fetch, log: (line: string) => void): Promise<void> {
  const meta = await fetchImpl(`${REGISTRY}/${name.replace('/', '%2f')}/${version}`);
  if (!meta.ok) throw new Error(`${name}@${version}: the registry answered ${meta.status}`);
  const { dist } = (await meta.json()) as { dist: { tarball: string; integrity: string } };
  if (!dist?.tarball?.startsWith(`${REGISTRY}/`) || !dist.integrity) throw new Error(`${name}@${version}: unexpected registry answer`);
  log(`Downloading ${name}@${version}…`);
  const response = await fetchImpl(dist.tarball);
  if (!response.ok) throw new Error(`${name}@${version}: download failed (${response.status})`);
  const tgz = new Uint8Array(await response.arrayBuffer());
  if (!verifyIntegrity(tgz, dist.integrity)) throw new Error(`${name}@${version}: the download doesn't match the registry's checksum`);
  const files = packageFiles(tgz);
  // Unpack beside the destination, then move it in, so a half-written zig is never used
  const staging = `${dest}.partial-${process.pid}`;
  await fs.rm(staging, { recursive: true, force: true });
  for (const [rel, data] of Object.entries(files)) {
    const file = path.join(staging, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data, { mode: /^bin\//.test(rel) ? 0o755 : 0o644 });
  }
  await fs.rm(dest, { recursive: true, force: true });
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.rename(staging, dest);
}

let inflight: Promise<string> | null = null;

/**
 * Make sure zig is available for WASM builds; returns the root to look for it in.
 * Uses (in order) zig installed with the studio's node_modules, one fetched before, or fetches it now.
 */
export function ensureZig(options: { root?: string; fetchImpl?: Fetch; log?: (line: string) => void } = {}): Promise<string> {
  const root = options.root ?? process.cwd();
  const exe = process.platform === 'win32' ? 'zig.exe' : 'zig';
  if (existsSync(path.join(root, 'node_modules', zigPackage(), 'bin', exe))) return Promise.resolve(root);
  const version = zigVersion(root);
  if (!version) return Promise.reject(new Error('This build of the studio does not name a zig version.'));
  const home = zigHome(version);
  if (existsSync(path.join(home, 'node_modules', zigPackage(), 'bin', exe)) && existsSync(path.join(home, 'node_modules', '@zigc', 'lib', 'compiler_rt.zig'))) return Promise.resolve(home);
  inflight ??= (async () => {
    const log = options.log ?? ((line: string) => console.log(`> ${line}`));
    const fetchImpl = options.fetchImpl ?? defaultFetch;
    log(`zig ${version} is needed for WebAssembly builds; fetching it once (about 90 MB)`);
    await installPackage('@zigc/lib', version, path.join(home, 'node_modules', '@zigc', 'lib'), fetchImpl, log);
    await installPackage(zigPackage(), version, path.join(home, 'node_modules', zigPackage()), fetchImpl, log);
    log(`zig ${version} is ready`);
    return home;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
