/**
 * Toolchains the studio installs and keeps current, through mise (mise.jdx.dev).
 *
 * - mise itself is downloaded from its official mirror and checked against the
 *   release's SHA-256 list, into ~/.nanocli/mise. It is isolated from any mise
 *   you use yourself: its own data, config, cache and state folders.
 * - A language's toolchain is installed on first use (or with one click) and
 *   pinned to its major version line ("go = 1", "zig = 0.16"), so updates
 *   within the line are applied automatically as soon as they ship, while a new
 *   major version is offered, never forced.
 * - Tools found on your system PATH always win; the studio's are a fallback.
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { unzipSync } from 'fflate';
import { gunzipSync } from 'node:zlib';
import { capture, runStep } from './proc.ts';
import { untar } from './uv-install.ts';

const NANOCLI_DIR = process.env.NANOCLI_HOME || path.join(os.homedir(), '.nanocli');
export const MISE_HOME = path.join(NANOCLI_DIR, 'mise');
const MIRROR = 'https://mise.jdx.dev';
const INSTALL_MS = 30 * 60_000;
const UPDATE_EVERY_MS = 12 * 60 * 60_000;

/** What mise installs for a language; `needs` are other tools it runs on (Kotlin needs a JVM) */
export interface ManagedTool {
  tool: string;
  /** What to ask for the first time; pinned to its major line afterwards */
  request?: string;
  needs?: string[];
  /** Rough download size, shown before installing */
  size: string;
}

export const MANAGED: Record<string, ManagedTool> = {
  node: { tool: 'node', size: '30 MB' },
  bun: { tool: 'bun', size: '40 MB' },
  deno: { tool: 'deno', size: '45 MB' },
  go: { tool: 'go', size: '75 MB' },
  rust: { tool: 'rust', size: '250 MB' },
  zig: { tool: 'zig', size: '50 MB' },
  java: { tool: 'java', size: '200 MB' },
  kotlin: { tool: 'kotlin', needs: ['java'], size: '90 MB + Java' },
  scala: { tool: 'scala-cli', needs: ['java'], size: '80 MB + Java' },
  clojure: { tool: 'clojure', needs: ['java'], size: '20 MB + Java' },
  groovy: { tool: 'groovy', needs: ['java'], size: '30 MB + Java' },
  csharp: { tool: 'dotnet', size: '220 MB' },
  fsharp: { tool: 'dotnet', size: '220 MB' },
  ruby: { tool: 'ruby', size: '40 MB' },
  lua: { tool: 'lua', size: '1 MB' },
  perl: { tool: 'perl', size: '25 MB' },
  r: { tool: 'conda:r-base', size: '250 MB' },
  julia: { tool: 'julia', size: '200 MB' },
  swift: { tool: 'swift', size: '600 MB' },
  dart: { tool: 'dart', size: '60 MB' },
  elixir: { tool: 'elixir', needs: ['erlang'], size: '10 MB + Erlang' },
  erlang: { tool: 'erlang', size: '100 MB' },
  gleam: { tool: 'gleam', size: '10 MB' },
  nim: { tool: 'nim', size: '30 MB' },
  crystal: { tool: 'crystal', size: '50 MB' },
  odin: { tool: 'odin', size: '60 MB' },
  racket: { tool: 'racket', size: '50 MB' },
  d: { tool: 'ldc', size: '90 MB' },
  solidity: { tool: 'foundry', size: '40 MB' },
  move: { tool: 'sui', request: 'mainnet', size: '150 MB' },
  cairo: { tool: 'scarb', size: '50 MB' },
  vyper: { tool: 'pipx:vyper', needs: ['uv'], size: '30 MB' },
  uv: { tool: 'uv', size: '20 MB' },
};

/** The version line an installed version is pinned to: majors from 1 on ("1.27.3" → "1"), minors before 1.0 ("0.16.0" → "0.16"), channels as they are ("mainnet-v1.81.1" → "mainnet") */
export function pinFor(version: string): string {
  const numeric = /^v?(\d+)\.(\d+)/.exec(version);
  if (numeric) return numeric[1] === '0' ? `0.${numeric[2]}` : numeric[1];
  // Release channels are their own line ("stable" for Rust)
  if (/^[a-z]+$/.test(version)) return version;
  const channel = /^([a-z]+)-/.exec(version);
  return channel ? channel[1] : 'latest';
}

// ---------------------------------------------------------------------------
// mise itself
// ---------------------------------------------------------------------------

const exe = process.platform === 'win32' ? '.exe' : '';
export const miseBin = () => path.join(MISE_HOME, 'bin', `mise${exe}`);
const CONFIG = () => path.join(MISE_HOME, 'config', 'config.toml');
const STATE = () => path.join(MISE_HOME, 'studio.json');

/** mise's environment: its own folders, never your ~/.config/mise, and no prompts */
export function miseEnv(base: Record<string, string | undefined> = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(base)) if (v !== undefined && !k.startsWith('MISE_')) env[k] = v;
  return {
    ...env,
    MISE_DATA_DIR: path.join(MISE_HOME, 'data'),
    MISE_CONFIG_DIR: path.join(MISE_HOME, 'config'),
    MISE_CACHE_DIR: path.join(MISE_HOME, 'cache'),
    MISE_STATE_DIR: path.join(MISE_HOME, 'state'),
    MISE_GLOBAL_CONFIG_FILE: CONFIG(),
    // mise's Rust uses ~/.rustup and ~/.cargo unless told otherwise: keep the studio's apart
    MISE_RUSTUP_HOME: path.join(MISE_HOME, 'rustup'),
    MISE_CARGO_HOME: path.join(MISE_HOME, 'cargo'),
    MISE_YES: '1',
    MISE_EXPERIMENTAL: '1',
    // Python packages (Vyper) go through uv, which the studio already uses
    MISE_PIPX_UVX: '1',
  };
}

/** The release asset for this machine, as named on the mirror */
export function miseAsset(version: string, platform = process.platform, arch = process.arch, musl = isMusl()): string | null {
  const a = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null;
  if (!a) return null;
  if (platform === 'linux') return `mise-v${version}-linux-${a}${musl ? '-musl' : ''}.tar.gz`;
  if (platform === 'darwin') return `mise-v${version}-macos-${a}.tar.gz`;
  if (platform === 'win32') return `mise-v${version}-windows-${a}.zip`;
  return null;
}

function isMusl(): boolean {
  if (process.platform !== 'linux') return false;
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return !report?.header?.glibcVersionRuntime;
}

/** The SHA-256 line for `asset` in a SHASUMS256.txt, or null */
export function checksumFor(shasums: string, asset: string): string | null {
  for (const line of shasums.split('\n')) {
    const [hash, name] = line.trim().split(/\s+/);
    if (/^[0-9a-f]{64}$/.test(hash ?? '') && (name === asset || name === `./${asset}` || name === `*${asset}`)) return hash;
  }
  return null;
}

type Out = (text: string) => void;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

export async function miseVersion(): Promise<string | null> {
  if (!fsSync.existsSync(miseBin())) return null;
  const { code, output } = await capture(miseBin(), ['--version'], { env: miseEnv() as NodeJS.ProcessEnv });
  return code === 0 ? (/(\d{4}\.\d+\.\d+)/.exec(output)?.[1] ?? null) : null;
}

/** Download and verify mise (or a newer mise), atomically replacing the old binary */
export async function installMise(out: Out, wanted?: string): Promise<string> {
  const version = (wanted ?? (await fetchText(`${MIRROR}/VERSION`))).trim();
  if (!/^\d{4}\.\d+\.\d+$/.test(version)) throw new Error(`Unexpected mise version “${version.slice(0, 40)}”`);
  const asset = miseAsset(version);
  if (!asset) throw new Error(`mise has no build for ${process.platform}/${process.arch}`);
  out(`Downloading mise ${version}…\n`);
  const expected = checksumFor(await fetchText(`${MIRROR}/v${version}/SHASUMS256.txt`), asset);
  if (!expected) throw new Error(`No checksum published for ${asset}`);
  const response = await fetch(`${MIRROR}/v${version}/${asset}`, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!response.ok) throw new Error(`Downloading ${asset}: HTTP ${response.status}`);
  const archive = Buffer.from(await response.arrayBuffer());
  const actual = crypto.createHash('sha256').update(archive).digest('hex');
  if (actual !== expected) throw new Error(`Checksum mismatch for ${asset}: refusing to install it`);

  // Unpacked in-process, the same on every OS (zlib for .tar.gz, which may hold several gzip members; fflate for .zip): only the binary is taken
  const isBinary = (name: string) => name.replace(/^\.\//, '') === `mise/bin/mise${exe}`;
  const files = asset.endsWith('.zip') ? unzipSync(new Uint8Array(archive), { filter: (f) => isBinary(f.name) }) : untar(new Uint8Array(gunzipSync(archive)), isBinary);
  const binary = Object.values(files)[0];
  if (!binary) throw new Error('The mise archive did not contain mise/bin/mise');
  await fs.mkdir(path.dirname(miseBin()), { recursive: true });
  const next = `${miseBin()}.new`;
  await fs.writeFile(next, binary);
  await fs.chmod(next, 0o755);
  await fs.rename(next, miseBin());
  out(`mise ${version} installed (checksum verified).\n`);
  return version;
}

async function ensureMise(out: Out): Promise<void> {
  if (!(await miseVersion())) await installMise(out);
  await fs.mkdir(path.dirname(CONFIG()), { recursive: true });
  if (!fsSync.existsSync(CONFIG())) await fs.writeFile(CONFIG(), '# Toolchains installed by NanoCLI Studio\n[tools]\n');
}

/** Run mise, streaming its output; resolves with the exit code */
async function mise(args: string[], out: Out, signal?: AbortSignal): Promise<number | null> {
  const outcome = await runStep({
    file: miseBin(),
    args,
    cwd: MISE_HOME,
    env: miseEnv(),
    timeoutMs: INSTALL_MS,
    budget: { left: 8 * 1024 * 1024 },
    maxOutputBytes: 8 * 1024 * 1024,
    onOutput: (_s, text) => out(text),
    signal,
  });
  return outcome.spawnError ? null : outcome.code;
}

async function miseJson<T>(args: string[]): Promise<T | null> {
  const { code, output } = await capture(miseBin(), args, { env: miseEnv() as NodeJS.ProcessEnv, timeoutMs: 60_000 });
  if (code !== 0) return null;
  try {
    return JSON.parse(output.slice(output.search(/[[{]/))) as T;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PATH entries for the runners
// ---------------------------------------------------------------------------

export interface ManagedEnv {
  /** Folders with the studio's toolchain binaries */
  paths: string[];
  /** Variables they need (JAVA_HOME, RUSTUP_HOME, DOTNET_ROOT…) */
  vars: Record<string, string>;
}

let envCache: ManagedEnv = { paths: [], vars: {} };
let envLoaded = false;

/** The studio's toolchains as PATH entries and variables (cached; refreshed after installs and updates) */
export function managedEnv(): ManagedEnv {
  if (!envLoaded) void refreshBinPaths();
  return envCache;
}

export const managedBinPaths = (): string[] => managedEnv().paths;

export async function refreshBinPaths(): Promise<string[]> {
  envLoaded = true;
  if (!fsSync.existsSync(miseBin()) || !fsSync.existsSync(CONFIG())) {
    envCache = { paths: [], vars: {} };
    return [];
  }
  const env = await miseJson<Record<string, string>>(['env', '--json']);
  if (!env) return envCache.paths;
  const paths = (env.PATH ?? '').split(path.delimiter).filter((p) => p.startsWith(MISE_HOME + path.sep));
  const vars = Object.fromEntries(Object.entries(env).filter(([k, v]) => k !== 'PATH' && typeof v === 'string'));
  envCache = { paths, vars };
  return paths;
}

/** Which tool a variable belongs to: it only applies when that tool is the studio's, not one on your PATH */
const VAR_OWNER: Record<string, string | null> = {
  JAVA_HOME: 'java',
  DOTNET_ROOT: 'dotnet',
  DOTNET_MULTILEVEL_LOOKUP: 'dotnet',
  RUSTUP_HOME: 'cargo',
  RUSTUP_TOOLCHAIN: 'cargo',
  // go finds its own root; pointing a system go at another GOROOT would break it
  GOROOT: null,
  GOBIN: null,
  // The runners keep their own shared cache here
  CARGO_HOME: null,
};

/**
 * Add the studio's toolchains to a runner's environment: PATH entries after the system's own
 * (system installs win), and their variables only where the tool in use is the studio's.
 */
export function applyManaged(env: Record<string, string>, hasSystemTool: (bin: string, systemPath: string) => boolean, managed: ManagedEnv = managedEnv()): Record<string, string> {
  const key = 'Path' in env && !('PATH' in env) ? 'Path' : 'PATH';
  const systemPath = env[key] ?? '';
  const { paths, vars } = managed;
  for (const [name, value] of Object.entries(vars)) {
    const owner = name in VAR_OWNER ? VAR_OWNER[name] : undefined;
    if (owner === null || name in env) continue;
    if (owner && hasSystemTool(owner, systemPath)) continue;
    env[name] = value;
  }
  const extra = paths.filter((p) => !systemPath.split(path.delimiter).includes(p));
  if (extra.length) env[key] = [systemPath, ...extra].filter(Boolean).join(path.delimiter);
  return env;
}

// ---------------------------------------------------------------------------
// Installing and updating
// ---------------------------------------------------------------------------

export interface InstalledTool {
  tool: string;
  requested: string;
  version: string;
  /** A newer version on the same line, about to be (or already being) applied */
  update?: string;
  /** A newer major line, offered rather than applied */
  major?: string;
}

export interface ToolchainState {
  lastCheck?: number;
  lastUpdate?: { at: number; updated: string[] };
  autoUpdate: boolean;
  autoInstall: boolean;
}

async function readState(): Promise<ToolchainState> {
  const defaults: ToolchainState = { autoUpdate: process.env.NANOCLI_TOOLCHAIN_AUTO_UPDATE !== '0', autoInstall: process.env.NANOCLI_TOOLCHAIN_AUTO_INSTALL !== '0' };
  try {
    return { ...defaults, ...JSON.parse(await fs.readFile(STATE(), 'utf8')) };
  } catch {
    return defaults;
  }
}

export async function writeState(patch: Partial<ToolchainState>): Promise<ToolchainState> {
  const next = { ...(await readState()), ...patch };
  await fs.mkdir(MISE_HOME, { recursive: true });
  await fs.writeFile(STATE(), JSON.stringify(next, null, 2));
  return next;
}

export const getToolchainState = readState;

/** Install a language's toolchain (and what it runs on), pinned to its current major line */
export async function installFor(languageId: string, out: Out, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
  const managed = MANAGED[languageId];
  if (!managed) return { ok: false, error: 'The studio cannot install this language automatically.' };
  try {
    await ensureMise(out);
  } catch (error) {
    return { ok: false, error: `Could not install mise: ${(error as Error).message}` };
  }
  for (const id of [...(managed.needs ?? []), languageId]) {
    const spec = MANAGED[id] ?? { tool: id, size: '' };
    out(`Installing ${spec.tool}${spec.size ? ` (about ${spec.size})` : ''} with mise…\n`);
    const code = await mise(['use', '--global', `${spec.tool}@${spec.request ?? 'latest'}`], out, signal);
    if (code !== 0) return { ok: false, error: `Installing ${spec.tool} failed; the output above says why.` };
    // Pin to the major line of what was installed, so updates stay compatible
    const installed = await miseJson<{ version: string }[]>(['ls', '--installed', '--json', spec.tool]);
    const version = installed?.map((i) => i.version).sort(compareVersions).pop();
    if (version) await mise(['use', '--global', `${spec.tool}@${pinFor(version)}`], () => {}, signal);
  }
  await refreshBinPaths();
  return { ok: true };
}

/** Newer-first is not needed here, just a stable order for picking the newest installed */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  const pb = b.split(/[.+-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x === y) continue;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

interface Outdated {
  name: string;
  requested: string;
  current: string;
  latest: string;
  bump?: string;
}

/** What the studio has installed, with updates on the same line and newer majors */
export async function listInstalled(): Promise<InstalledTool[]> {
  if (!(await miseVersion()) || !fsSync.existsSync(CONFIG())) return [];
  const config = await fs.readFile(CONFIG(), 'utf8');
  const requested = new Map<string, string>();
  for (const match of config.matchAll(/^\s*"?([\w:/.-]+)"?\s*=\s*"([^"]+)"/gm)) requested.set(match[1], match[2]);
  const [outdated, bumps] = await Promise.all([miseJson<Record<string, Outdated>>(['outdated', '--json']), miseJson<Record<string, Outdated>>(['outdated', '--bump', '--json'])]);
  const tools: InstalledTool[] = [];
  for (const [tool, wanted] of requested) {
    const installed = await miseJson<{ version: string }[]>(['ls', '--installed', '--json', tool]);
    const version = installed?.map((i) => i.version).sort(compareVersions).pop();
    if (!version) continue;
    const same = outdated?.[tool];
    const bump = bumps?.[tool];
    tools.push({ tool, requested: wanted, version, update: same && same.latest !== same.current ? same.latest : undefined, major: bump?.bump && bump.bump !== wanted ? bump.latest : undefined });
  }
  return tools;
}

let updating: Promise<string[]> | null = null;

/** Apply every update within each tool's line, refresh mise itself, and remove what the update replaced */
export function updateAll(out: Out = () => {}): Promise<string[]> {
  updating ??= (async () => {
    const updated: string[] = [];
    try {
      if (!(await miseVersion())) return updated;
      const latestMise = (await fetchText(`${MIRROR}/VERSION`).catch(() => '')).trim();
      const current = await miseVersion();
      if (latestMise && current && latestMise !== current && /^\d{4}\.\d+\.\d+$/.test(latestMise)) {
        await installMise(out, latestMise);
        updated.push(`mise ${latestMise}`);
      }
      const before = await listInstalled();
      const pending = before.filter((t) => t.update);
      if (pending.length) {
        out(`Updating ${pending.map((t) => `${t.tool} ${t.version} → ${t.update}`).join(', ')}…\n`);
        if ((await mise(['upgrade'], out)) === 0) {
          updated.push(...pending.map((t) => `${t.tool} ${t.update}`));
          await mise(['prune', '--yes'], out);
        }
      }
      await refreshBinPaths();
      await writeState({ lastCheck: Date.now(), ...(updated.length ? { lastUpdate: { at: Date.now(), updated } } : {}) });
    } finally {
      updating = null;
    }
    return updated;
  })();
  return updating;
}

/** Move to a newer major line, when you choose to */
export async function upgradeMajor(tool: string, out: Out): Promise<boolean> {
  if (!Object.values(MANAGED).some((m) => m.tool === tool) && tool !== 'erlang') return false;
  const code = await mise(['use', '--global', `${tool}@latest`], out);
  if (code !== 0) return false;
  const installed = await miseJson<{ version: string }[]>(['ls', '--installed', '--json', tool]);
  const version = installed?.map((i) => i.version).sort(compareVersions).pop();
  if (version) await mise(['use', '--global', `${tool}@${pinFor(version)}`], () => {});
  await mise(['prune', '--yes'], out);
  await refreshBinPaths();
  return true;
}

// Check for updates soon after start and every 12 hours; apply them when auto-update is on
const timers = globalThis as { __nanocliToolchainTimer?: NodeJS.Timeout };
export function scheduleToolchainUpdates(): void {
  if (timers.__nanocliToolchainTimer || process.env.NODE_ENV === 'test') return;
  const tick = async () => {
    const state = await readState();
    if (!state.autoUpdate || !fsSync.existsSync(miseBin())) return;
    if (state.lastCheck && Date.now() - state.lastCheck < UPDATE_EVERY_MS) return;
    await updateAll().catch((error) => console.error('Toolchain update failed:', error));
  };
  timers.__nanocliToolchainTimer = setInterval(() => void tick(), 60 * 60_000);
  timers.__nanocliToolchainTimer.unref();
  setTimeout(() => void tick(), 30_000).unref();
}
