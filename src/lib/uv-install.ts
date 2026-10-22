/**
 * Download uv from Astral's official GitHub releases when it isn't installed.
 * The archive's SHA-256 is checked against the checksum file published next to
 * it, and extraction is plain JavaScript so it behaves the same on Windows,
 * macOS and Linux. Server only.
 */

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { gunzipSync, unzipSync } from 'fflate';

const execFileAsync = promisify(execFile);

/** The release the studio installs. Bump after checking the changelog. */
export const UV_VERSION = '0.8.17';

const RELEASE_URL = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}`;

/** Names of uv's release archives, by platform and CPU */
export function uvAsset(platform: string = process.platform, arch: string = process.arch, musl = false): string | null {
  const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'aarch64' : null;
  if (!cpu) return null;
  switch (platform) {
    case 'win32':
      return `uv-${cpu}-pc-windows-msvc.zip`;
    case 'darwin':
      return `uv-${cpu}-apple-darwin.tar.gz`;
    case 'linux':
      return `uv-${cpu}-unknown-linux-${musl ? 'musl' : 'gnu'}.tar.gz`;
    default:
      return null;
  }
}

/** Whether this Linux uses musl instead of glibc (Alpine) */
function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

/** The hash from a `sha256sum`-style file: "<hex>  <name>" or "<hex> *<name>" */
export function parseSha256File(text: string): string | null {
  const match = /^([0-9a-fA-F]{64})\b/.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}

/** Pull the named files out of an uncompressed tar archive (regular files only) */
export function untar(tar: Uint8Array, wanted: (name: string) => boolean): Record<string, Uint8Array> {
  const files: Record<string, Uint8Array> = {};
  const text = (start: number, length: number) => new TextDecoder().decode(tar.subarray(start, start + length)).replace(/\0[\s\S]*$/, '');
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const name = text(offset, 100);
    if (!name) break; // two empty blocks end the archive
    const size = parseInt(text(offset + 124, 12).trim() || '0', 8);
    const type = text(offset + 156, 1);
    const start = offset + 512;
    if ((type === '0' || type === '') && wanted(name)) files[name] = tar.slice(start, start + size);
    offset = start + Math.ceil(size / 512) * 512;
  }
  return files;
}

type Fetch = (url: string) => Promise<Response>;

/**
 * Install uv into `destDir/<version>/` and return the path of the binary.
 * Throws with a readable message when the download or the checksum fails.
 */
export async function installUv(
  destDir: string,
  onProgress: (message: string) => void = () => {},
  fetchImpl: Fetch = (url) => fetch(url, { redirect: 'follow' })
): Promise<string> {
  const asset = uvAsset(process.platform, process.arch, isMusl());
  if (!asset) throw new Error(`There is no official uv build for ${process.platform}-${process.arch}. Install uv yourself: https://docs.astral.sh/uv/getting-started/installation/`);

  onProgress(`Downloading uv ${UV_VERSION} (${asset})…`);
  const [checksum, archive] = await Promise.all([fetchImpl(`${RELEASE_URL}/${asset}.sha256`), fetchImpl(`${RELEASE_URL}/${asset}`)]);
  if (!checksum.ok || !archive.ok) throw new Error(`Could not download uv from GitHub (HTTP ${archive.ok ? checksum.status : archive.status}).`);

  const expected = parseSha256File(await checksum.text());
  const bytes = new Uint8Array(await archive.arrayBuffer());
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (!expected || expected !== actual) throw new Error('The uv download failed its SHA-256 check, so it was discarded.');
  onProgress('Checksum verified. Unpacking…');

  const isBinary = (name: string) => /(?:^|\/)uvx?(?:\.exe)?$/.test(name);
  const extracted = asset.endsWith('.zip')
    ? unzipSync(bytes, { filter: (file) => isBinary(file.name) })
    : untar(gunzipSync(bytes), isBinary);

  const dir = path.join(destDir, UV_VERSION);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(extracted)) {
    const target = path.join(dir, path.basename(name));
    await writeFile(target, content);
    await chmod(target, 0o755);
  }
  const bin = path.join(dir, process.platform === 'win32' ? 'uv.exe' : 'uv');
  const { stdout } = await execFileAsync(bin, ['--version'], { timeout: 15_000 }).catch(() => ({ stdout: '' }));
  if (!stdout.startsWith('uv ')) throw new Error('uv was downloaded but would not start on this machine.');
  onProgress(`Installed ${stdout.trim()}.`);
  return bin;
}
