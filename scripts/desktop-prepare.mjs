#!/usr/bin/env node
/**
 * Puts together what the desktop app ships, for one platform:
 *
 *   desktop/app/                    the built studio: .next (no build cache), public, server.js,
 *                                   the supervisor, and production dependencies only
 *   src-tauri/binaries/node-<triple> a Node.js runtime, from nodejs.org, checked against its SHA-256
 *
 *   node scripts/desktop-prepare.mjs [--target <rust triple>] [--node <version>] [--skip-build]
 *
 * The target defaults to this machine. Build on the platform you are packaging for (CI does): npm
 * installs the compiler binaries (scriptc, zig) that match the machine it runs on.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'desktop', 'app');
const BINARIES = path.join(ROOT, 'src-tauri', 'binaries');

// Rust target triple -> Node.js distribution
const TARGETS = {
  'aarch64-apple-darwin': { dist: 'darwin-arm64', ext: 'tar.gz', bin: 'bin/node' },
  'x86_64-apple-darwin': { dist: 'darwin-x64', ext: 'tar.gz', bin: 'bin/node' },
  'x86_64-pc-windows-msvc': { dist: 'win-x64', ext: 'zip', bin: 'node.exe' },
  'aarch64-pc-windows-msvc': { dist: 'win-arm64', ext: 'zip', bin: 'node.exe' },
  'x86_64-unknown-linux-gnu': { dist: 'linux-x64', ext: 'tar.xz', bin: 'bin/node' },
  'aarch64-unknown-linux-gnu': { dist: 'linux-arm64', ext: 'tar.xz', bin: 'bin/node' },
};

function hostTriple() {
  const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
  if (process.platform === 'darwin') return `${arch}-apple-darwin`;
  if (process.platform === 'win32') return `${arch}-pc-windows-msvc`;
  return `${arch}-unknown-linux-gnu`;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

const target = arg('target', hostTriple());
// scriptc needs Node.js 24 or newer: the latest 24.x unless a version is given
const nodeVersion = (arg('node', '') || (await latestNode(24))).replace(/^v/, '');

async function latestNode(major) {
  const releases = await (await fetch('https://nodejs.org/dist/index.json')).json();
  const found = releases.find((r) => r.version.startsWith(`v${major}.`));
  if (!found) throw new Error(`No Node.js ${major} release found`);
  return found.version;
}
const spec = TARGETS[target];
if (!spec) {
  console.error(`Unknown target ${target}. One of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', ...opts });

// ---------------------------------------------------------------------------
// 1. The studio, built
// ---------------------------------------------------------------------------

if (!process.argv.includes('--skip-build')) run('npm', ['run', 'build'], { cwd: ROOT });
if (!existsSync(path.join(ROOT, '.next', 'BUILD_ID'))) {
  console.error('No production build in .next: run `npm run build` first (or drop --skip-build).');
  process.exit(1);
}

console.log(`\nAssembling ${path.relative(ROOT, APP)}…`);
rmSync(APP, { recursive: true, force: true });
mkdirSync(path.join(APP, 'scripts'), { recursive: true });
// The build cache and dev artefacts aren't needed to serve
cpSync(path.join(ROOT, '.next'), path.join(APP, '.next'), { recursive: true, filter: (src) => !/[\\/]\.next[\\/](cache|dev|trace)(?:[\\/]|$)/.test(src) });
cpSync(path.join(ROOT, 'public'), path.join(APP, 'public'), { recursive: true });
for (const file of ['server.js', 'package.json', 'package-lock.json', 'LICENSE']) {
  if (existsSync(path.join(ROOT, file))) cpSync(path.join(ROOT, file), path.join(APP, file));
}
for (const file of ['supervise.js', 'launch-key.js']) cpSync(path.join(ROOT, 'scripts', file), path.join(APP, 'scripts', file));
// next.config.ts, compiled to JavaScript here, so neither TypeScript nor Next's SWC compiler has to ship
const ts = (await import(pathToFileURL(path.join(ROOT, 'node_modules', 'typescript', 'lib', 'typescript.js')).href)).default;
const config = ts.transpileModule(readFileSync(path.join(ROOT, 'next.config.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
writeFileSync(path.join(APP, 'next.config.mjs'), config.outputText);

// Production dependencies only, for this platform (scriptc and zig are per-platform optional packages)
run('npm', ['ci', '--omit=dev', '--no-audit', '--no-fund'], { cwd: APP });

// What the app never uses at run time
const nm = path.join(APP, 'node_modules');
const drop = (rel) => rmSync(path.join(nm, rel), { recursive: true, force: true });
// zig (~400 MB) is fetched the first time a WebAssembly build needs it (src/lib/zig-install.ts)
drop('@zigc');
// Images are served unoptimized: no sharp
drop('@img');
drop('sharp');
// next.config is plain JavaScript now: Next's SWC compiler is only needed to build
for (const name of existsSync(path.join(nm, '@next')) ? readdirSync(path.join(nm, '@next')) : []) if (name.startsWith('swc-')) drop(`@next/${name}`);
// The editor is served from monaco-editor/min only
drop('monaco-editor/esm');
drop('monaco-editor/dev');
// Linux: npm installs both libc flavours of scriptc; keep the one this target uses
if (target.includes('linux-gnu')) for (const name of readdirSync(path.join(nm, '@scriptc'))) if (name.endsWith('-musl')) drop(`@scriptc/${name}`);
// Build-time and debugging leftovers: source maps, Next's development-only runtimes and docs, and type
// definitions (except scriptc's, which it type-checks programs with). About a quarter of what's left.
const KEEP_TYPES = /[\\/]node_modules[\\/](scriptc|@scriptc|typescript)[\\/]/;
function dropLeftovers(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) dropLeftovers(full);
    else if (entry.isFile() && (entry.name.endsWith('.map') || (entry.name.endsWith('.d.ts') && !KEEP_TYPES.test(full)))) rmSync(full, { force: true });
  }
}
dropLeftovers(nm);
const nextServer = path.join(nm, 'next', 'dist', 'compiled', 'next-server');
if (existsSync(nextServer)) for (const name of readdirSync(nextServer)) if (name.endsWith('.runtime.dev.js')) rmSync(path.join(nextServer, name), { force: true });
drop('next/dist/docs');
// npm's command shortcuts for what was dropped (zig, and its .cmd/.ps1 shims on Windows), and any other
// link left pointing at nothing: the bundler follows links and stops at a missing target
for (const name of readdirSync(path.join(nm, '.bin'))) if (/^zig(\.cmd|\.ps1)?$/i.test(name)) drop(`.bin/${name}`);
function dropDangling(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      if (!existsSync(full)) rmSync(full, { force: true });
    } else if (entry.isDirectory()) dropDangling(full);
  }
}
dropDangling(nm);

function size(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? size(full) : entry.isFile() ? statSync(full).size : 0;
  }
  return total;
}
console.log(`  ${(size(APP) / 1024 / 1024).toFixed(0)} MB`);

// ---------------------------------------------------------------------------
// 2. Node.js for the target, verified
// ---------------------------------------------------------------------------

const base = `https://nodejs.org/dist/v${nodeVersion}`;
const archive = `node-v${nodeVersion}-${spec.dist}.${spec.ext}`;
console.log(`\nDownloading ${archive}…`);

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const sums = (await download(`${base}/SHASUMS256.txt`)).toString('utf8');
const expected = sums.split('\n').map((l) => l.trim().split(/\s+/)).find(([, name]) => name === archive)?.[0];
if (!expected) throw new Error(`${archive} is not listed in SHASUMS256.txt`);
const data = await download(`${base}/${archive}`);
const actual = createHash('sha256').update(data).digest('hex');
if (actual !== expected) throw new Error(`Checksum mismatch for ${archive}: expected ${expected}, got ${actual}`);
console.log(`  SHA-256 verified (${expected.slice(0, 16)}…)`);

const work = mkdtempSync(path.join(tmpdir(), 'aha-node-'));
try {
  const file = path.join(work, archive);
  writeFileSync(file, data);
  // bsdtar (macOS, and Windows' own tar.exe) reads zip as well as tar; GNU tar handles the Linux .tar.xz.
  // On Windows, name System32's tar: a GNU tar earlier on PATH (Git's) can't read zip
  const systemTar = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
  execFileSync(existsSync(systemTar) || process.platform !== 'win32' ? systemTar : 'tar', ['-xf', file, '-C', work], { stdio: 'inherit' });
  const binary = path.join(work, `node-v${nodeVersion}-${spec.dist}`, spec.bin);
  mkdirSync(BINARIES, { recursive: true });
  const out = path.join(BINARIES, `node-${target}${target.includes('windows') ? '.exe' : ''}`);
  cpSync(binary, out);
  if (!target.includes('windows')) chmodSync(out, 0o755);
  console.log(`  ${path.relative(ROOT, out)} (${(statSync(out).size / 1024 / 1024).toFixed(0)} MB)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}

writeFileSync(path.join(ROOT, 'desktop', 'manifest.json'), JSON.stringify({ target, node: nodeVersion, studio: JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log('\nReady: npx tauri build');
