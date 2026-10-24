/**
 * Health checks for the machine the studio runs on, each with a plain-English
 * result and, where there is a safe remedy, a one-click fix. Fixes only touch
 * the studio's own folders (caches, temp files, uv): never the user's projects.
 */

import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { cleanupOldTempFiles, compileTypeScript, TEMP_DIR } from './compiler.ts';
import { connectorsMode } from './connectors/manager.ts';
import { NANOCLI_DIR } from './connectors/env.ts';
import { childEnv, cleanupPythonProjects, getPythonStatus, installManagedUv, isPythonEnabled, PY_PROJECTS, resolveUv } from './python.ts';
import { bundledZigDir, withBundledZig } from './zig.ts';

const execFileAsync = promisify(execFile);

export type CheckStatus = 'ok' | 'warn' | 'fail';

export interface Check {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  fix?: { id: FixId; label: string };
}

export type FixId = 'install-uv' | 'prune-uv-cache' | 'remove-python-envs' | 'clean-temp';

export interface DoctorReport {
  checks: Check[];
  server: { node: string; platform: string; uptimeSeconds: number; memoryMb: number; supervised: boolean; home: string };
}

async function probe(file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { timeout: 8000, windowsHide: true, env: env ?? process.env, shell: process.platform === 'win32' && /^(npx|npm|uvx)$/.test(file) });
    return `${stdout}${stderr}`.trim().split('\n')[0] || '';
  } catch {
    return null;
  }
}

/** Total size of a folder, stopping early on very large ones */
export async function folderSize(dir: string, limitEntries = 60_000): Promise<number> {
  let total = 0;
  let seen = 0;
  const walk = async (current: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (++seen > limitEntries) return;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) total += (await fs.stat(full).catch(() => null))?.size ?? 0;
    }
  };
  await walk(dir);
  return total;
}

export const formatBytes = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const MAJOR = (v: string) => Number(v.replace(/^v/, '').split('.')[0]);

export async function runDoctor(): Promise<DoctorReport> {
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);

  // Node
  add(
    MAJOR(process.version) >= 24
      ? { id: 'node', label: 'Node.js', status: 'ok', detail: process.version }
      : { id: 'node', label: 'Node.js', status: 'warn', detail: `${process.version}. The studio is built and tested on Node 24 or newer; some features (such as SQLite connectors) need 22.5+.` }
  );

  // scriptc: compile something tiny
  const started = Date.now();
  try {
    const result = await compileTypeScript({ code: 'console.log(1 + 1);', filename: 'doctor.ts', target: 'ir' });
    add(
      result.success
        ? { id: 'scriptc', label: 'scriptc compiler', status: 'ok', detail: `Type-checks and compiles (${Date.now() - started} ms)` }
        : { id: 'scriptc', label: 'scriptc compiler', status: 'fail', detail: `A tiny test program failed to compile: ${result.error ?? 'unknown error'}. Try “npm install” to repair the installation.` }
    );
  } catch (error) {
    add({ id: 'scriptc', label: 'scriptc compiler', status: 'fail', detail: `${(error as Error).message}. Try “npm install” to repair the installation.` });
  }

  // zig (WASM builds)
  const zigEnv = withBundledZig({ ...process.env } as Record<string, string | undefined>) as NodeJS.ProcessEnv;
  const zig = await probe('zig', ['version'], zigEnv);
  add(
    zig
      ? { id: 'zig', label: 'zig (WebAssembly builds)', status: 'ok', detail: `${zig}${bundledZigDir() ? ' · bundled with the studio' : ' · from your PATH'}` }
      : { id: 'zig', label: 'zig (WebAssembly builds)', status: 'warn', detail: 'Not found. WASM builds and Run in the browser need it; “npm install” fetches a bundled copy.' }
  );

  // native linker
  const cc = (await probe('clang', ['--version'])) ?? (await probe('cc', ['--version'])) ?? (await probe('gcc', ['--version']));
  add(
    cc
      ? { id: 'native', label: 'C toolchain (native executables)', status: 'ok', detail: cc }
      : { id: 'native', label: 'C toolchain (native executables)', status: 'warn', detail: 'No clang, cc or gcc found. Native executables need one (install Xcode command line tools, build-essential or LLVM); WASM works without it.' }
  );

  // uv and Python
  if (!isPythonEnabled()) {
    add({ id: 'uv', label: 'uv (Python)', status: 'ok', detail: 'Python support is turned off (NANOCLI_PYTHON=0).' });
  } else {
    const uv = await resolveUv();
    if (uv) {
      const py = await getPythonStatus();
      add({ id: 'uv', label: 'uv (Python)', status: 'ok', detail: `uv ${uv.version} (${uv.source})${py.pythons.length ? ` · Python ${py.pythons.slice(0, 3).join(', ')}` : ' · uv downloads Python when a project needs it'}` });
    } else {
      add({ id: 'uv', label: 'uv (Python)', status: 'warn', detail: 'Not installed. Python projects need it.', fix: { id: 'install-uv', label: 'Download uv' } });
    }
  }

  // Tools the connector presets launch
  const npx = await probe('npx', ['--version']);
  const uvx = (await probe('uvx', ['--version'])) ?? ((await resolveUv()) ? 'via uv' : null);
  add({
    id: 'launchers',
    label: 'npx and uvx (MCP server presets)',
    status: npx && uvx ? 'ok' : 'warn',
    detail: `${npx ? `npx ${npx}` : 'npx missing (install Node.js with npm)'} · ${uvx ? 'uvx available' : 'uvx missing (install uv)'}. Only needed for the MCP presets that use them.`,
  });

  // Disk the studio uses
  const [envs, caches, temp] = await Promise.all([folderSize(PY_PROJECTS), folderSize(path.join(NANOCLI_DIR, 'cache')), folderSize(TEMP_DIR)]);
  add(
    envs > 2 * 1024 ** 3
      ? { id: 'python-envs', label: 'Python environments', status: 'warn', detail: `${formatBytes(envs)} used. They are rebuilt on demand, and your files live in the browser.`, fix: { id: 'remove-python-envs', label: 'Remove environments' } }
      : { id: 'python-envs', label: 'Python environments', status: 'ok', detail: formatBytes(envs) }
  );
  add(
    caches > 5 * 1024 ** 3
      ? { id: 'caches', label: 'Package caches', status: 'warn', detail: `${formatBytes(caches)} used.`, fix: { id: 'prune-uv-cache', label: 'Prune cache' } }
      : { id: 'caches', label: 'Package caches', status: 'ok', detail: formatBytes(caches) }
  );
  add(
    temp > 500 * 1024 ** 2
      ? { id: 'temp', label: 'Build leftovers', status: 'warn', detail: `${formatBytes(temp)} of temporary build files.`, fix: { id: 'clean-temp', label: 'Clean up' } }
      : { id: 'temp', label: 'Build leftovers', status: 'ok', detail: formatBytes(temp) }
  );

  // Where the studio is reachable from
  const mode = connectorsMode();
  add({
    id: 'exposure',
    label: 'Network exposure',
    status: mode === 'hosted' ? 'warn' : 'ok',
    detail:
      mode === 'hosted'
        ? `Listening beyond this machine (HOST=${process.env.HOST}). Connectors that run programs are off; keep Python off unless the server is yours alone.`
        : `Listening on ${process.env.HOST ?? '127.0.0.1'} only${mode === 'off' ? ' · connectors are turned off' : ''}.`,
  });

  return {
    checks,
    server: {
      node: process.version,
      platform: `${process.platform} ${process.arch}`,
      uptimeSeconds: Math.round(process.uptime()),
      memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      supervised: process.env.NANOCLI_SUPERVISED === '1',
      home: NANOCLI_DIR,
    },
  };
}

/** Apply one of the fixes the report offered */
export async function applyFix(id: string, onProgress: (message: string) => void = () => {}): Promise<{ ok: boolean; message: string }> {
  switch (id) {
    case 'install-uv': {
      const uv = await installManagedUv(onProgress);
      return { ok: true, message: `Installed uv ${uv.version}.` };
    }
    case 'prune-uv-cache': {
      const uv = await resolveUv();
      if (!uv) return { ok: false, message: 'uv isn’t installed, so there is no cache to prune.' };
      await execFileAsync(uv.bin, ['cache', 'prune'], { timeout: 120_000, windowsHide: true, env: childEnv(process.env, NANOCLI_DIR, {}) as NodeJS.ProcessEnv });
      return { ok: true, message: 'Removed cache entries that are no longer needed.' };
    }
    case 'remove-python-envs':
      await cleanupPythonProjects(10 * 60_000); // not ones a command is using right now
      return { ok: true, message: 'Removed Python environments that weren’t used in the last 10 minutes. They are recreated when a project runs again.' };
    case 'clean-temp': {
      const before = await folderSize(TEMP_DIR);
      await cleanupOldTempFiles(60_000); // not what a build is writing right now
      const freed = before - (await folderSize(TEMP_DIR));
      return { ok: true, message: freed > 0 ? `Removed ${formatBytes(freed)} of temporary build files.` : 'Nothing to remove yet: the build files there are from builds still running.' };
    }
    default:
      return { ok: false, message: 'Unknown fix.' };
  }
}
