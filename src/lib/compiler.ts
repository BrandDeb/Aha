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

type Target = 'exe' | 'c' | 'llvm' | 'wasm';
type Platform = 'linux' | 'macos' | 'windows';
type Arch = 'x64' | 'arm64';
type Optimization = 'none' | 'O1' | 'O2' | 'O3';

interface CompileOptions {
  code: string;
  filename?: string;
  target?: Target;
  platform?: Platform;
  arch?: Arch;
  optimization?: Optimization;
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
}

interface ExecError extends Error {
  stdout?: string;
  stderr?: string;
}

export const TEMP_DIR = path.join(process.cwd(), 'temp');

/** Maximum accepted source size (bytes) */
export const MAX_CODE_SIZE = 512 * 1024;

/** Maximum time a single toolchain invocation may run */
const EXEC_TIMEOUT_MS = 60_000;
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

const TARGETS: readonly Target[] = ['exe', 'c', 'llvm', 'wasm'];
const PLATFORMS: readonly Platform[] = ['linux', 'macos', 'windows'];
const ARCHES: readonly Arch[] = ['x64', 'arm64'];
const OPTIMIZATIONS: readonly Optimization[] = ['none', 'O1', 'O2', 'O3'];

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
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

  const fields = [
    ['target', TARGETS],
    ['platform', PLATFORMS],
    ['arch', ARCHES],
    ['optimization', OPTIMIZATIONS],
  ] as const;
  for (const [key, allowed] of fields) {
    if (input[key] !== undefined && !oneOf(input[key], allowed)) {
      return { error: `Invalid ${key}` };
    }
  }

  return {
    code: input.code,
    filename: typeof input.filename === 'string' ? input.filename : undefined,
    target: oneOf(input.target, TARGETS),
    platform: oneOf(input.platform, PLATFORMS),
    arch: oneOf(input.arch, ARCHES),
    optimization: oneOf(input.optimization, OPTIMIZATIONS),
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

/** Run a toolchain binary with an argument vector (never through a shell). */
function run(command: string, args: string[], env?: Record<string, string>) {
  return execFileAsync(command, args, {
    timeout: EXEC_TIMEOUT_MS,
    maxBuffer: EXEC_MAX_BUFFER,
    cwd: TEMP_DIR,
    env: env ? { ...process.env, ...env } : process.env,
  });
}

function scriptc(args: string[], env?: Record<string, string>) {
  return run('npx', ['scriptc', ...args], env);
}

function failure(error: unknown): CompileResult {
  const err = error as ExecError;
  return {
    success: false,
    error: err?.message || 'Compilation failed',
    stderr: err?.stderr,
    stdout: err?.stdout,
  };
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
 * scriptc only produces executables for the machine it runs on, so a request
 * for another platform/arch is reported instead of silently ignored.
 */
function unsupportedCrossCompile(options: CompileOptions): CompileResult | null {
  const platform = hostPlatform();
  const arch = hostArch();
  if ((options.platform && options.platform !== platform) || (options.arch && options.arch !== arch)) {
    return {
      success: false,
      error: `Cross-compilation is not supported: this server builds ${platform}-${arch} executables. ` +
        'Choose the C or LLVM IR target to build for other platforms locally.',
    };
  }
  return null;
}

/**
 * Write the source and run `scriptc build` (optionally with extra flags).
 * Returns paths of the executable and the generated translation unit.
 */
async function scriptcBuild(options: CompileOptions, extraArgs: string[] = [], env?: Record<string, string>) {
  const filename = makeSourceFilename(options.filename);
  const filePath = await writeTempFile(options.code, filename);
  const outputFilename = withExtension(filename, hostPlatform() === 'windows' ? '.exe' : '');
  const outputPath = path.join(TEMP_DIR, outputFilename);

  const { stdout, stderr } = await scriptc(['build', filePath, '-o', outputPath, ...extraArgs], env);
  return { filename, outputFilename, outputPath, stdout, stderr };
}

/**
 * Compile TypeScript to native binary using scriptc
 */
export async function compileToNative(options: CompileOptions): Promise<CompileResult> {
  const unsupported = unsupportedCrossCompile(options);
  if (unsupported) return unsupported;

  try {
    const { outputFilename, outputPath, stdout, stderr } = await scriptcBuild(options);
    const binary = await fs.readFile(outputPath);
    return {
      success: true,
      output: binary.toString('base64'),
      filename: outputFilename,
      downloadUrl: downloadUrlFor(outputFilename),
      stdout,
      stderr,
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Compile TypeScript to C code using scriptc's C backend
 */
export async function compileToC(options: CompileOptions): Promise<CompileResult> {
  try {
    const { filename } = await scriptcBuild(options, ['--backend', 'c', '--keep-c']);
    const outputFilename = withExtension(filename, '.c');
    const compiledCode = await fs.readFile(path.join(TEMP_DIR, outputFilename), 'utf8');

    return {
      success: true,
      output: compiledCode,
      filename: outputFilename,
      downloadUrl: downloadUrlFor(outputFilename),
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Compile TypeScript to LLVM IR using scriptc (the default backend keeps the .ll)
 */
export async function compileToLLVM(options: CompileOptions): Promise<CompileResult> {
  try {
    const { filename } = await scriptcBuild(options, ['--backend', 'llvm', '--keep-c']);
    const outputFilename = withExtension(filename, '.ll');
    const compiledCode = await fs.readFile(path.join(TEMP_DIR, outputFilename), 'utf8');

    return {
      success: true,
      output: compiledCode,
      filename: outputFilename,
      downloadUrl: downloadUrlFor(outputFilename),
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Compile TypeScript to WASM (WASI Preview 1) using scriptc's wasm32-wasi
 * target. That target needs a wasm-capable C toolchain (e.g. SCRIPTC_CC=zigcc);
 * when it is unavailable the LLVM IR is returned as a fallback.
 */
export async function compileToWASM(options: CompileOptions): Promise<CompileResult> {
  try {
    const filename = makeSourceFilename(options.filename);
    const filePath = await writeTempFile(options.code, filename);
    const wasmOutput = withExtension(filename, '.wasm');
    const wasmPath = path.join(TEMP_DIR, wasmOutput);

    try {
      await scriptc(['build', filePath, '-o', wasmPath], { SCRIPTC_TARGET: 'wasm32-wasi' });
      const result = await fs.readFile(wasmPath);
      return {
        success: true,
        output: result.toString('base64'),
        filename: wasmOutput,
        downloadUrl: downloadUrlFor(wasmOutput),
      };
    } catch {
      // Fall back to LLVM IR below
    }

    const llvm = await compileToLLVM(options);
    if (!llvm.success) return llvm;
    return {
      ...llvm,
      error: 'WASM compilation requires a wasm32-wasi toolchain (set SCRIPTC_CC=zigcc). LLVM IR provided as fallback.',
    };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Compile TypeScript with scriptc
 */
export async function compileTypeScript(options: CompileOptions): Promise<CompileResult> {
  const target = options.target || 'exe';

  switch (target) {
    case 'c':
      return compileToC(options);
    case 'llvm':
      return compileToLLVM(options);
    case 'wasm':
      return compileToWASM(options);
    case 'exe':
    default:
      return compileToNative(options);
  }
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

export type { CompileOptions, CompileResult };
