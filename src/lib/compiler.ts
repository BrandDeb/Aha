/**
 * Compiler utilities for scriptc - Server-side only
 * This file uses Node.js-specific modules and should only be imported on the server
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import fs from 'fs/promises';
import path from 'path';

const execFileAsync = promisify(execFile);

type Target = 'exe' | 'llvm' | 'asm' | 'wasm';
type Platform = 'linux' | 'macos' | 'windows';
type Arch = 'x64' | 'arm64';
type Optimization = 'release' | 'dev';

interface CompileOptions {
  code: string;
  filename?: string;
  target?: Target;
  platform?: Platform;
  arch?: Arch;
  optimization?: Optimization;
}

/** A scriptc diagnostic, mapped back to the user's source */
interface Diagnostic {
  line: number;
  column: number;
  severity: 'error' | 'warning';
  code: string;
  message: string;
  hint?: string;
}

interface CompileResult {
  success: boolean;
  output?: string;
  error?: string;
  stdout?: string;
  stderr?: string;
  files?: Record<string, string>;
  filename?: string;
  downloadUrl?: string;
  /** Size of the produced artifact in bytes */
  size?: number;
  /** Wall-clock build time in milliseconds */
  durationMs?: number;
  diagnostics?: Diagnostic[];
}

interface CoverageBlocker {
  count: number;
  message: string;
  code: string;
}

interface CoverageResult {
  success: boolean;
  error?: string;
  statements?: number;
  static?: number;
  percent?: number;
  blockers?: CoverageBlocker[];
}

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
  killed?: boolean;
}

export const TEMP_DIR = path.join(process.cwd(), 'temp');

/** Maximum accepted source size (bytes) */
export const MAX_CODE_SIZE = 512 * 1024;

/** Maximum time a single toolchain invocation may run */
const EXEC_TIMEOUT_MS = 60_000;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

/** Builds are CPU heavy; cap how many run at once */
const MAX_CONCURRENT_BUILDS = Number(process.env.MAX_CONCURRENT_BUILDS) || 2;

const TARGETS: readonly Target[] = ['exe', 'llvm', 'asm', 'wasm'];
const PLATFORMS: readonly Platform[] = ['linux', 'macos', 'windows'];
const ARCHES: readonly Arch[] = ['x64', 'arm64'];
const OPTIMIZATIONS: readonly Optimization[] = ['release', 'dev'];
/** Pre-0.2 optimization levels still sent by older clients */
const LEGACY_OPTIMIZATIONS: Record<string, Optimization> = {
  none: 'dev',
  O1: 'release',
  O2: 'release',
  O3: 'release',
};

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

function parseOptimization(value: unknown): Optimization | undefined {
  return oneOf(value, OPTIMIZATIONS) ?? (typeof value === 'string' ? LEGACY_OPTIMIZATIONS[value] : undefined);
}

/**
 * Validate untrusted compile input. Unknown enum values are rejected rather
 * than passed through to the toolchain.
 */
export function parseCompileOptions(body: unknown): CompileOptions | { error: string } {
  if (!body || typeof body !== 'object') {
    return { error: 'Invalid request body' };
  }
  const input = body as Record<string, unknown>;

  if (typeof input.code !== 'string' || input.code.length === 0) {
    return { error: 'Code is required' };
  }
  if (Buffer.byteLength(input.code, 'utf8') > MAX_CODE_SIZE) {
    return { error: `Code exceeds maximum size of ${MAX_CODE_SIZE} bytes` };
  }

  if (input.target === 'c') {
    return { error: 'C output was removed in scriptc 0.2; use the asm or llvm target' };
  }

  const fields = [
    ['target', TARGETS],
    ['platform', PLATFORMS],
    ['arch', ARCHES],
  ] as const;
  for (const [key, allowed] of fields) {
    if (input[key] !== undefined && !oneOf(input[key], allowed)) {
      return { error: `Invalid ${key}` };
    }
  }
  if (input.optimization !== undefined && !parseOptimization(input.optimization)) {
    return { error: 'Invalid optimization' };
  }

  return {
    code: input.code,
    filename: typeof input.filename === 'string' ? input.filename : undefined,
    target: oneOf(input.target, TARGETS),
    platform: oneOf(input.platform, PLATFORMS),
    arch: oneOf(input.arch, ARCHES),
    optimization: parseOptimization(input.optimization),
  };
}

/**
 * Build a unique, filesystem-safe source filename. The user-supplied name is
 * only used as a readable suffix; directory components and unusual
 * characters are stripped so it can never escape TEMP_DIR or collide with
 * another user's build.
 */
export function makeSourceFilename(requested?: string): string {
  const id = randomUUID().replace(/-/g, '');
  const base = path.basename(requested || '')
    .replace(/\.ts$/i, '')
    .replace(/[^A-Za-z0-9_-]/g, '')
    .slice(0, 48);
  return base ? `${id}-${base}.ts` : `${id}.ts`;
}

/**
 * Resolve a filename inside TEMP_DIR, rejecting anything that is not a plain
 * file name (no separators, no traversal, no hidden files).
 */
export function resolveTempPath(filename: string): string | null {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(filename) || filename.includes('..')) {
    return null;
  }
  const resolved = path.resolve(TEMP_DIR, filename);
  if (path.dirname(resolved) !== path.resolve(TEMP_DIR)) {
    return null;
  }
  return resolved;
}

function downloadUrlFor(filename: string): string {
  return `/api/download/${encodeURIComponent(filename)}`;
}

function withExtension(filename: string, extension: string): string {
  return filename.replace(/\.ts$/, extension);
}

async function writeTempFile(code: string, filename: string): Promise<string> {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const filePath = path.join(TEMP_DIR, filename);
  await fs.writeFile(filePath, code, 'utf8');
  return filePath;
}

/** Name shown to the user for a generated source file (drops the unique id) */
function displayName(filename: string): string {
  return filename.replace(/^[0-9a-f]{32}-?/, '') || 'main.ts';
}

/**
 * Parse scriptc's `file:line:col - error SCxxxx: message` diagnostics (and
 * the `hint:` lines that follow them) into structured data.
 */
export function parseDiagnostics(output: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = output.split(/\r?\n/);
  for (const line of lines) {
    const match = /^(?:.*?):(\d+):(\d+) - (error|warning) (SC\d+): (.+)$/.exec(line);
    if (match) {
      diagnostics.push({
        line: Number(match[1]),
        column: Number(match[2]),
        severity: match[3] as Diagnostic['severity'],
        code: match[4],
        message: match[5].trim(),
      });
      continue;
    }
    const hint = /^\s+hint: (.+)$/.exec(line);
    const last = diagnostics[diagnostics.length - 1];
    if (hint && last && !last.hint) {
      last.hint = hint[1].trim();
    }
  }
  return diagnostics;
}

/**
 * Parse the human-readable `scriptc coverage` report.
 */
export function parseCoverage(output: string): Omit<CoverageResult, 'success'> {
  const statements = /statements analyzed\s+(\d+)/.exec(output);
  const statically = /compile statically\s+(\d+)\s+\((\d+(?:\.\d+)?)%\)/.exec(output);
  const blockers: CoverageBlocker[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*×(\d+)\s+(.+?)\s+(SC\d+)\s*$/.exec(line);
    if (match) {
      blockers.push({ count: Number(match[1]), message: match[2], code: match[3] });
    }
  }
  return {
    statements: statements ? Number(statements[1]) : undefined,
    static: statically ? Number(statically[1]) : undefined,
    percent: statically ? Number(statically[2]) : undefined,
    blockers,
  };
}

/** Strip server paths from toolchain output before returning it to clients */
function sanitize(text: string | undefined, filename: string): string | undefined {
  if (!text) return text;
  const tempPrefix = TEMP_DIR.endsWith(path.sep) ? TEMP_DIR : TEMP_DIR + path.sep;
  return text
    .split(tempPrefix + filename).join(displayName(filename))
    .split(tempPrefix).join('');
}

let activeBuilds = 0;
const buildQueue: Array<() => void> = [];

async function withBuildSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeBuilds >= MAX_CONCURRENT_BUILDS) {
    // Wait for a finishing build to hand its slot over directly
    await new Promise<void>(resolve => buildQueue.push(resolve));
  } else {
    activeBuilds++;
  }
  try {
    return await fn();
  } finally {
    const next = buildQueue.shift();
    if (next) {
      next();
    } else {
      activeBuilds--;
    }
  }
}

function scriptcBinary(): string {
  return path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'scriptc.cmd' : 'scriptc');
}

/** Run scriptc with an argument vector (never through a shell). */
function scriptc(args: string[], env?: Record<string, string>) {
  return execFileAsync(scriptcBinary(), args, {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
    cwd: TEMP_DIR,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function failure(error: unknown, filename: string): CompileResult {
  const err = error as ExecError;
  const stderr = sanitize(err?.stderr, filename);
  const stdout = sanitize(err?.stdout, filename);
  const diagnostics = parseDiagnostics(`${stderr ?? ''}\n${stdout ?? ''}`);
  const first = diagnostics.find(d => d.severity === 'error');
  let message = 'Compilation failed';
  if (err?.killed) {
    message = `Compilation timed out after ${EXEC_TIMEOUT_MS / 1000}s`;
  } else if (first) {
    message = `${first.code}: ${first.message} (line ${first.line})`;
  } else {
    const firstLine = stderr?.split('\n').find(line => line.trim());
    if (firstLine) message = firstLine.trim().slice(0, 300);
  }
  return { success: false, error: message, stderr, stdout, diagnostics };
}

function hostPlatform(): Platform {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'macos';
  return 'linux';
}

function hostArch(): Arch {
  return process.arch === 'arm64' ? 'arm64' : 'x64';
}

/**
 * Executables are linked for the machine this server runs on; other
 * platforms need per-target runtime packs and SDKs we don't ship.
 */
function unsupportedCrossCompile(options: CompileOptions): CompileResult | null {
  const platform = hostPlatform();
  const arch = hostArch();
  if ((options.platform && options.platform !== platform) || (options.arch && options.arch !== arch)) {
    return {
      success: false,
      error: `Cross-compilation is not available: this server builds ${platform}-${arch} executables. ` +
        'Use the WASM target for a portable binary, or the LLVM IR / assembly targets to inspect the output.',
    };
  }
  return null;
}

interface BuildSpec {
  /** Output file extension, including the dot ('' for none) */
  extension: string;
  args: string[];
  env?: Record<string, string>;
  binary: boolean;
}

function buildSpec(options: CompileOptions): BuildSpec {
  const optimization = ['--optimization', options.optimization || 'release'];
  switch (options.target) {
    case 'llvm':
      return { extension: '.ll', args: ['--emit=llvm'], binary: false };
    case 'asm':
      return { extension: '.s', args: ['--emit=asm'], binary: false };
    case 'wasm':
      return {
        extension: '.wasm',
        args: optimization,
        env: { SCRIPTC_TARGET: 'wasm32-wasi' },
        binary: true,
      };
    case 'exe':
    default:
      return {
        extension: hostPlatform() === 'windows' ? '.exe' : '',
        args: ['--strip', '--no-keep-llvm', ...optimization],
        binary: true,
      };
  }
}

/**
 * Compile TypeScript with scriptc
 */
export async function compileTypeScript(options: CompileOptions): Promise<CompileResult> {
  if ((options.target || 'exe') === 'exe') {
    const unsupported = unsupportedCrossCompile(options);
    if (unsupported) return unsupported;
  }

  const spec = buildSpec(options);
  const filename = makeSourceFilename(options.filename);

  return withBuildSlot(async () => {
    try {
      const filePath = await writeTempFile(options.code, filename);
      const outputFilename = withExtension(filename, spec.extension);
      const outputPath = path.join(TEMP_DIR, outputFilename);

      const started = Date.now();
      const { stdout, stderr } = await scriptc(['build', filePath, '-o', outputPath, ...spec.args], spec.env);
      const durationMs = Date.now() - started;

      const artifact = await fs.readFile(outputPath);
      return {
        success: true,
        output: spec.binary ? artifact.toString('base64') : artifact.toString('utf8'),
        filename: outputFilename,
        downloadUrl: downloadUrlFor(outputFilename),
        size: artifact.length,
        durationMs,
        stdout: sanitize(stdout, filename),
        stderr: sanitize(stderr, filename),
        diagnostics: parseDiagnostics(sanitize(stderr, filename) ?? ''),
      };
    } catch (error) {
      if (options.target === 'wasm' && /spawnSync zig ENOENT/.test(String((error as ExecError)?.stderr))) {
        return {
          ...failure(error, filename),
          error: 'WASM linking needs zig on the server PATH (scriptc uses it as the wasm32-wasi linker).',
        };
      }
      return failure(error, filename);
    }
  });
}

/**
 * Report how much of a program scriptc can compile statically, and what
 * blocks the rest (`scriptc coverage`).
 */
export async function analyzeCoverage(options: Pick<CompileOptions, 'code' | 'filename'>): Promise<CoverageResult> {
  const filename = makeSourceFilename(options.filename);
  return withBuildSlot(async () => {
    try {
      const filePath = await writeTempFile(options.code, filename);
      const { stdout, stderr } = await scriptc(['coverage', filePath]);
      return { success: true, ...parseCoverage(`${stdout}\n${stderr}`) };
    } catch (error) {
      const err = error as ExecError;
      return {
        success: false,
        error: err?.killed ? 'Analysis timed out' : sanitize(err?.stderr, filename)?.trim() || 'Analysis failed',
      };
    }
  });
}

/**
 * Delete build artifacts older than maxAgeMs so TEMP_DIR doesn't grow forever.
 */
export async function cleanupOldTempFiles(maxAgeMs: number = 60 * 60 * 1000): Promise<void> {
  try {
    const now = Date.now();
    const entries = await fs.readdir(TEMP_DIR, { withFileTypes: true });
    await Promise.all(
      entries
        .filter(entry => entry.isFile())
        .map(async entry => {
          const filePath = path.join(TEMP_DIR, entry.name);
          try {
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > maxAgeMs) {
              await fs.unlink(filePath);
            }
          } catch {
            // File removed concurrently, ignore
          }
        })
    );
  } catch {
    // TEMP_DIR doesn't exist yet, nothing to clean
  }
}

export type { CompileOptions, CompileResult, CoverageResult, Diagnostic };
