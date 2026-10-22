/**
 * scriptc links WebAssembly output with zig. The `@zigc/<platform>-<arch>`
 * optional dependency ships a copy that npm installs for the current machine,
 * so `run` and WASM builds work without installing anything else. Server only.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { zigHome, zigPackage, zigVersion } from './zig-install.ts';

const ZIG_EXE = process.platform === 'win32' ? 'zig.exe' : 'zig';
const hasZig = (root: string) => existsSync(path.join(root, 'node_modules', zigPackage(), 'bin', ZIG_EXE));

/** Where the studio's zig is: installed with its node_modules, or fetched on demand (lib/zig-install.ts) */
export function zigRoot(): string {
  const cwd = process.cwd();
  if (hasZig(cwd)) return cwd;
  const version = zigVersion(cwd);
  return version && hasZig(zigHome(version)) ? zigHome(version) : cwd;
}

/** A zig of your own on PATH (it takes priority over the studio's) */
export function hasSystemZig(env: Record<string, string | undefined>): boolean {
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  return (env[key] ?? '').split(path.delimiter).filter(Boolean).some((entry) => existsSync(path.join(entry, ZIG_EXE)));
}

/** Directory holding the bundled zig binary, or null when it wasn't installed */
export function bundledZigDir(root: string = zigRoot()): string | null {
  const dir = path.join(root, 'node_modules', '@zigc', `${process.platform}-${process.arch}`, 'bin');
  return existsSync(path.join(dir, process.platform === 'win32' ? 'zig.exe' : 'zig')) ? dir : null;
}

/** zig's standard library and libc headers, shipped separately as `@zigc/lib` */
export function bundledZigLib(root: string = zigRoot()): string | null {
  const dir = path.join(root, 'node_modules', '@zigc', 'lib');
  return existsSync(path.join(dir, 'compiler_rt.zig')) ? dir : null;
}

/**
 * The environment with the bundled zig appended to PATH. Appended, not
 * prepended, so a zig the user installed themselves still takes priority.
 * ZIG_LIB_DIR is only set when the bundled binary is the one that will run
 * (no zig of their own on PATH), because a different zig can't use this library.
 */
export function withBundledZig<T extends Record<string, string | undefined>>(env: T, root?: string): T {
  const dir = bundledZigDir(root);
  if (!dir) return env;
  // Windows spells it "Path"; copying env into a plain object loses the case-insensitivity
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const current = env[key] ?? '';
  const entries = current.split(path.delimiter).filter(Boolean);
  if (entries.includes(dir)) return env;
  const systemZig = entries.some((entry) => existsSync(path.join(entry, ZIG_EXE)));
  const lib = systemZig ? null : bundledZigLib(root);
  return {
    ...env,
    [key]: current ? `${current}${path.delimiter}${dir}` : dir,
    ...(lib && !env.ZIG_LIB_DIR ? { ZIG_LIB_DIR: lib } : {}),
  } as T;
}

export const ZIG_MISSING_MESSAGE =
  'WASM builds need zig, which wasn’t found. Run `npm install` again to fetch the bundled copy, or install zig from ziglang.org and restart the server.';
