/**
 * Dev servers for web projects (Vite, Next.js, Nuxt, SvelteKit, Astro, React
 * Router, Angular): the browser's files go to a folder, dependencies are
 * installed when they change, and the framework's own dev server runs on
 * 127.0.0.1 so the preview gets real hot reload. Edits are synced as they
 * happen. Like the language runner, this runs code on the machine hosting the
 * studio, so it is only available when that is the user's own machine.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { atLeast, dependencyKey, detectFramework, GENERATED_DIRS, INSTALL_ARGS, localUrlIn, packageManagerFor, type Framework } from './frameworks.ts';
import { isRunEnabled, NANOCLI_DIR, runEnv, which } from './polyglot.ts';
import { capture, isSafeRelativePath, killTree, runStep, writeProject } from './proc.ts';

export const DEV_PROJECTS = path.join(NANOCLI_DIR, 'dev');
export const MAX_DEV_SERVERS = Number(process.env.NANOCLI_DEV_SERVERS) || 3;
const MAX_FILES = 600;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_LOG_LINES = 600;
const IDLE_MS = 20 * 60_000;
const INSTALL_MS = 10 * 60_000;
const READY_MS = 3 * 60_000;

/** On wherever the language runner is (this machine only, by default); NANOCLI_DEV=0 turns it off, =1 forces it on */
export function isDevEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.NANOCLI_DEV === '0') return false;
  if (env.NANOCLI_DEV === '1') return true;
  return isRunEnabled(env);
}

export type DevStatus = 'installing' | 'starting' | 'ready' | 'stopped' | 'failed';

export interface LogLine {
  seq: number;
  s: 'out' | 'err' | 'info';
  d: string;
}

interface DevServer {
  id: string;
  dir: string;
  status: DevStatus;
  framework?: Framework;
  label?: string;
  url?: string;
  error?: string;
  child?: ChildProcess;
  files: Record<string, string>;
  depsKey?: string;
  log: LogLine[];
  seq: number;
  lastSeen: number;
  /** Bumped by every start and stop, so a start that was overtaken gives up */
  generation: number;
  install?: AbortController;
}

export interface DevState {
  status: DevStatus | 'none';
  framework?: string;
  label?: string;
  url?: string;
  error?: string;
  log: LogLine[];
  seq: number;
}

// Route modules can be loaded more than once; the servers must not be
const registry: Map<string, DevServer> = ((globalThis as Record<string, unknown>).__nanocliDevServers ??= new Map()) as Map<string, DevServer>;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

const PROJECT_ID = /^[A-Za-z0-9_-]{8,40}$/;
export const isProjectId = (id: unknown): id is string => typeof id === 'string' && PROJECT_ID.test(id);

/** Paths the browser may write: inside the project and outside the folders the tools own */
export const isSyncablePath = (p: string): boolean => isSafeRelativePath(p) && !GENERATED_DIRS.has(p.split('/')[0]);

export function parseFiles(raw: unknown, { allowEmpty = false } = {}): Record<string, string> | { error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'files must be an object of path -> content' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if ((!allowEmpty && !entries.length) || entries.length > MAX_FILES) return { error: `A project can have 1 to ${MAX_FILES} files` };
  const files: Record<string, string> = {};
  let total = 0;
  for (const [name, content] of entries) {
    if (!isSyncablePath(name)) return { error: `Invalid file path: ${name.slice(0, 80)}` };
    if (typeof content !== 'string') return { error: `File content must be a string: ${name}` };
    total += Buffer.byteLength(content, 'utf8');
    files[name] = content;
  }
  if (total > MAX_BYTES) return { error: `Project exceeds ${MAX_BYTES / 1024 / 1024} MB` };
  return files;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function say(server: DevServer, s: LogLine['s'], d: string) {
  if (!d) return;
  server.log.push({ seq: ++server.seq, s, d });
  if (server.log.length > MAX_LOG_LINES) server.log.splice(0, server.log.length - MAX_LOG_LINES);
}

export function stateOf(id: string, since = 0): DevState {
  const server = registry.get(id);
  if (!server) return { status: 'none', log: [], seq: 0 };
  server.lastSeen = Date.now();
  return {
    status: server.status,
    framework: server.framework?.id,
    label: server.label,
    url: server.url,
    error: server.error,
    log: server.log.filter((l) => l.seq > since),
    seq: server.seq,
  };
}

export function listServers(): { id: string; status: DevStatus; label?: string; url?: string }[] {
  return [...registry.values()].map((s) => ({ id: s.id, status: s.status, label: s.label, url: s.url }));
}

/** A free port on loopback, chosen by the OS */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

/** Does anything answer HTTP on this port yet? */
function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const request = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1500, headers: { accept: 'text/html' } }, (response) => {
      response.resume();
      resolve(true);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

/** The script a package's "bin" points at, so it runs with node directly: no shell, the same on every OS */
export async function binScript(dir: string, pkg: string, bin: string): Promise<string | null> {
  const pkgDir = path.join(dir, 'node_modules', ...pkg.split('/'));
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(pkgDir, 'package.json'), 'utf8'));
    const relative = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.[bin];
    if (typeof relative !== 'string') return null;
    const script = path.resolve(pkgDir, relative);
    return script.startsWith(pkgDir + path.sep) && fsSync.existsSync(script) ? script : null;
  } catch {
    return null;
  }
}

const PID_FILE = '.home/dev-server.pid';

/** A server left running by a studio that was killed outright: stop it, if the pid still belongs to it */
async function reapStale(dir: string): Promise<void> {
  const pid = Number(await fs.readFile(path.join(dir, PID_FILE), 'utf8').catch(() => ''));
  if (!pid || process.platform === 'win32') return;
  const { output } = await capture('ps', ['-o', 'command=', '-p', String(pid)]);
  if (!output.includes(path.join(dir, 'node_modules'))) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // gone already
  }
}

function devEnv(dir: string, port: number): Record<string, string> {
  return {
    ...runEnv(process.env, dir, {}),
    NODE_ENV: 'development',
    PORT: String(port),
    HOST: '127.0.0.1',
    BROWSER: 'none',
    FORCE_COLOR: '0',
    NEXT_TELEMETRY_DISABLED: '1',
    NUXT_TELEMETRY_DISABLED: '1',
    ASTRO_TELEMETRY_DISABLED: '1',
    NG_CLI_ANALYTICS: 'false',
    // Prompts would hang a server nobody can type into
    CI: 'true',
  };
}

function stopChild(server: DevServer) {
  server.install?.abort();
  server.install = undefined;
  if (server.child) {
    server.child.removeAllListeners('exit');
    killTree(server.child);
    server.child = undefined;
  }
  void fs.rm(path.join(server.dir, PID_FILE), { force: true });
}

export function stopServer(id: string): boolean {
  const server = registry.get(id);
  if (!server) return false;
  server.generation++;
  stopChild(server);
  server.status = 'stopped';
  server.url = undefined;
  say(server, 'info', 'Stopped.');
  return true;
}

/** Write the files, install when needed and start the dev server; resolves when it answers or fails */
export async function startServer(id: string, files: Record<string, string>): Promise<DevState> {
  let server = registry.get(id);
  if (!server) {
    // Make room: the server nobody has looked at for longest goes first
    const running = [...registry.values()].filter((s) => s.status !== 'stopped' && s.status !== 'failed');
    if (running.length >= MAX_DEV_SERVERS) stopServer(running.sort((a, b) => a.lastSeen - b.lastSeen)[0].id);
    server = { id, dir: path.join(DEV_PROJECTS, id), status: 'starting', files: {}, log: [], seq: 0, lastSeen: Date.now(), generation: 0 };
    registry.set(id, server);
  }
  const generation = ++server.generation;
  stopChild(server);
  server.files = { ...files };
  server.error = undefined;
  server.url = undefined;
  server.status = 'starting';
  const current = () => registry.get(id) === server && server!.generation === generation;
  const fail = (message: string) => {
    if (!current()) return stateOf(id);
    server!.status = 'failed';
    server!.error = message;
    say(server!, 'info', message);
    return stateOf(id);
  };

  const detected = detectFramework(files);
  if (!detected) return fail('No web framework found: package.json needs one of Vite, Next.js, Nuxt, SvelteKit, Astro, React Router or Angular.');
  const { framework, label } = detected;
  server.framework = framework;
  server.label = label;
  if (!atLeast(process.versions.node, framework.minNode)) say(server, 'info', `${label} expects Node.js ${framework.minNode} or newer; this machine has ${process.versions.node}. It may still work.`);

  await fs.mkdir(server.dir, { recursive: true });
  await reapStale(server.dir);
  await writeProject(server.dir, files, { keep: GENERATED_DIRS });
  if (!current()) return stateOf(id);

  // Dependencies: only when they changed (or were never installed)
  const key = dependencyKey(files);
  if (server.depsKey !== key || !fsSync.existsSync(path.join(server.dir, 'node_modules'))) {
    const manager = packageManagerFor(files);
    const env = devEnv(server.dir, 0);
    const tool = which(manager, env.PATH ?? env.Path ?? '') ?? (manager !== 'npm' ? which('npm', env.PATH ?? env.Path ?? '') : null);
    if (!tool) return fail(`${manager} was not found. Install Node.js (nodejs.org), which includes npm, then try again.`);
    server.status = 'installing';
    say(server, 'info', `${path.basename(tool)} ${INSTALL_ARGS[manager].join(' ')}`);
    const controller = new AbortController();
    server.install = controller;
    const outcome = await runStep({
      file: tool,
      args: path.basename(tool).startsWith(manager) ? INSTALL_ARGS[manager] : INSTALL_ARGS.npm,
      cwd: server.dir,
      env,
      timeoutMs: INSTALL_MS,
      budget: { left: 4 * 1024 * 1024 },
      maxOutputBytes: 4 * 1024 * 1024,
      onOutput: (s, d) => say(server!, s === 'stdout' ? 'out' : s === 'stderr' ? 'err' : 'info', d),
      signal: controller.signal,
    });
    server.install = undefined;
    if (!current()) return stateOf(id);
    if (outcome.code !== 0) return fail(outcome.timedOut ? 'Installing dependencies took too long.' : outcome.spawnError ? `Could not start ${manager}: ${outcome.spawnError.message}` : 'Installing dependencies failed; the output above says why.');
    server.depsKey = key;
  }

  const script = await binScript(server.dir, framework.pkg, framework.bin);
  if (!script) return fail(`${framework.pkg} is not installed in this project: add it to package.json.`);
  const port = await freePort();
  if (!current()) return stateOf(id);
  server.status = 'starting';
  say(server, 'info', `${framework.bin} ${framework.args(port).join(' ')}`);
  const child = spawn(process.execPath, [script, ...framework.args(port)], {
    cwd: server.dir,
    env: devEnv(server.dir, port) as NodeJS.ProcessEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  });
  server.child = child;
  if (child.pid) void fs.writeFile(path.join(server.dir, PID_FILE), String(child.pid)).catch(() => {});
  // The tool may pick another port than asked (or print where it is); believe the first local URL it prints
  let printedPort: number | null = null;
  const onData = (s: 'out' | 'err') => (chunk: Buffer) => {
    const text = chunk.toString('utf8');
    say(server!, s, text);
    const url = printedPort === null ? localUrlIn(text) : null;
    if (url) printedPort = Number(new URL(url.replace('[::1]', '127.0.0.1')).port) || null;
  };
  child.stdout?.on('data', onData('out'));
  child.stderr?.on('data', onData('err'));
  child.on('exit', (code) => {
    if (registry.get(id) !== server || server!.child !== child) return;
    server!.child = undefined;
    server!.url = undefined;
    if (server!.status === 'ready') {
      server!.status = 'stopped';
      say(server!, 'info', `The dev server exited (code ${code}).`);
    } else {
      server!.status = 'failed';
      server!.error = `The dev server exited before it was ready (code ${code}). The output above says why.`;
      say(server!, 'info', server!.error);
    }
  });

  const deadline = Date.now() + READY_MS;
  while (Date.now() < deadline) {
    if (!current() || server.child !== child) return stateOf(id);
    const target = printedPort ?? port;
    if (await answers(target)) {
      if (!current()) return stateOf(id);
      server.status = 'ready';
      server.url = `http://127.0.0.1:${target}/`;
      say(server, 'info', `Ready at ${server.url}`);
      return stateOf(id);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  stopChild(server);
  return fail('The dev server did not answer within 3 minutes.');
}

/** Apply edits to a running project; a dependency change reinstalls and restarts */
export async function syncServer(id: string, changed: Record<string, string>, removed: string[]): Promise<DevState | { error: string }> {
  const server = registry.get(id);
  if (!server) return { error: 'No dev server for this project. Start it first.' };
  server.lastSeen = Date.now();
  const next = { ...server.files, ...changed };
  for (const p of removed) delete next[p];
  const restart = dependencyKey(next) !== server.depsKey;
  server.files = next;
  for (const [relative, content] of Object.entries(changed)) {
    const target = path.resolve(server.dir, relative);
    if (!target.startsWith(server.dir + path.sep)) continue;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const existing = await fs.readFile(target, 'utf8').catch(() => null);
    if (existing !== content) await fs.writeFile(target, content, 'utf8');
  }
  for (const relative of removed) {
    const target = path.resolve(server.dir, relative);
    if (target.startsWith(server.dir + path.sep)) await fs.rm(target, { force: true });
  }
  if (restart && (server.status === 'ready' || server.status === 'starting')) {
    say(server, 'info', 'Dependencies changed: installing and restarting.');
    void startServer(id, next);
  }
  return stateOf(id);
}

// Servers nobody looks at are stopped; all of them go when the studio does
const timers = globalThis as { __nanocliDevReaper?: NodeJS.Timeout };
if (!timers.__nanocliDevReaper) {
  timers.__nanocliDevReaper = setInterval(() => {
    for (const server of registry.values()) {
      if (server.child && Date.now() - server.lastSeen > IDLE_MS) {
        stopServer(server.id);
        say(server, 'info', 'Stopped after 20 minutes without the preview open.');
      }
    }
  }, 60_000);
  timers.__nanocliDevReaper.unref();
  process.once('exit', () => {
    for (const server of registry.values()) if (server.child) killTree(server.child);
  });
}

export async function cleanupDevProjects(maxAgeMs = 14 * 24 * 60 * 60 * 1000): Promise<void> {
  try {
    for (const entry of await fs.readdir(DEV_PROJECTS, { withFileTypes: true })) {
      if (!entry.isDirectory() || registry.has(entry.name)) continue;
      const full = path.join(DEV_PROJECTS, entry.name);
      const stat = await fs.stat(full);
      if (Date.now() - stat.mtimeMs > maxAgeMs) await fs.rm(full, { recursive: true, force: true });
    }
  } catch {
    // nothing to clean
  }
}
