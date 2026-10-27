/**
 * Folders on this machine, opened in place: the studio reads a project's files from where they live, writes edits
 * straight back, and hears about changes other programs make (a `git pull`, another editor, a formatter). Only on the
 * user's own machine, behind the launch key (scripts/launch-key.js). Server only.
 *
 * A folder is known by a random id, so a link or a page can't name a path and have it opened. In a Git repository the
 * file list is Git's (tracked and untracked, without what .gitignore excludes); elsewhere it is a walk that skips the
 * usual dependency and build folders.
 */

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isSafeRelativePath } from './proc.ts';

/** Folders never listed or watched: installed dependencies, build output, tools' own state */
export const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', '.nuxt', '.svelte-kit', '.turbo', '.cache', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', 'target', 'dist', 'build', 'out', 'coverage', '.gradle', '.idea', '.vs', 'vendor', '.dart_tool', '.terraform']);

export const LIMITS = {
  /** Paths listed (the tree); A1's large-repo work raises this */
  listed: 200_000,
  /** Files whose text is loaded into the studio */
  loaded: 5_000,
  fileBytes: 1024 * 1024,
  totalBytes: 48 * 1024 * 1024,
  openFolders: 8,
  /** Directories watched per folder on Linux (each is an inotify watch) */
  watchedDirs: 8_000,
};

export interface OpenedFolder {
  id: string;
  root: string;
  name: string;
  files: Record<string, string>;
  /** Listed but not loaded, with why: too large, binary, past the limits, or a name the studio can't use */
  skipped: { path: string; reason: 'binary' | 'large' | 'limit' | 'name' }[];
  git: boolean;
}

export interface FolderChange {
  changed: Record<string, string>;
  removed: string[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Whether a project path sits in a folder the studio leaves alone */
export const inSkippedDir = (relative: string): boolean => relative.split('/').slice(0, -1).some((part) => SKIP_DIRS.has(part));

/** A NUL byte in the first 8 KB: what Git uses to call a file binary */
export const looksBinary = (data: Buffer): boolean => data.subarray(0, 8192).includes(0);

/**
 * The absolute path for a project path, or null if it would leave the folder. Git's own folder is off limits too:
 * a file written to .git/hooks would run on the next commit.
 */
export function resolveInside(root: string, relative: string): string | null {
  if (!isSafeRelativePath(relative) || relative.split('/').includes('.git')) return null;
  const full = path.resolve(root, ...relative.split('/'));
  return full.startsWith(root + path.sep) ? full : null;
}

/** Where to start the folder picker, and the folder names it offers */
export function homeFolder(): string {
  return os.homedir();
}

// ---------------------------------------------------------------------------
// Listing and loading
// ---------------------------------------------------------------------------

function gitFiles(root: string): Promise<string[] | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { maxBuffer: 256 * 1024 * 1024, timeout: 20_000, windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      resolve(stdout.split('\0').filter(Boolean));
    });
  });
}

async function walkFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (out.length >= LIMITS.listed) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) await walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile()) {
        out.push(relative);
        if (out.length >= LIMITS.listed) return;
      }
    }
  };
  await walk(root, '');
  return out;
}

/** Every file in the folder, Git's view when it is a repository */
export async function listFiles(root: string): Promise<{ paths: string[]; git: boolean }> {
  const fromGit = fs.existsSync(path.join(root, '.git')) ? await gitFiles(root) : null;
  const paths = (fromGit ?? (await walkFiles(root))).filter((p) => !inSkippedDir(p)).slice(0, LIMITS.listed);
  return { paths: paths.sort(), git: !!fromGit };
}

async function readText(full: string): Promise<{ text: string } | { reason: 'binary' | 'large' | 'gone' | 'folder' }> {
  try {
    const stat = await fsp.stat(full);
    if (stat.isDirectory()) return { reason: 'folder' };
    if (!stat.isFile()) return { reason: 'gone' };
    if (stat.size > LIMITS.fileBytes) return { reason: 'large' };
    const data = await fsp.readFile(full);
    if (looksBinary(data)) return { reason: 'binary' };
    return { text: data.toString('utf8') };
  } catch {
    return { reason: 'gone' };
  }
}

// ---------------------------------------------------------------------------
// Open folders
// ---------------------------------------------------------------------------

interface Folder {
  id: string;
  root: string;
  /** What the studio last saw of each loaded file, so our own writes don't come back as outside changes */
  known: Map<string, string>;
  events: EventEmitter;
  /** One watcher per directory on Linux (see startWatching), or one recursive watcher elsewhere */
  watchers: Map<string, fs.FSWatcher>;
  pending: Set<string>;
  timer: NodeJS.Timeout | null;
  openedAt: number;
}

const folders: Map<string, Folder> = ((globalThis as Record<string, unknown>).__ahaFolders ??= new Map()) as Map<string, Folder>;

const digest = (text: string) => crypto.createHash('sha1').update(text).digest('hex');

function err(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

/** The folder for an id, or a 404-shaped error */
export function folderOf(id: unknown): Folder {
  const folder = typeof id === 'string' ? folders.get(id) : undefined;
  if (!folder) throw err('That folder is no longer open (the studio restarted). Open it again.', 404);
  return folder;
}

export const rootOf = (id: unknown): string => folderOf(id).root;

/** Check a path from the browser and give its absolute form; symlinks that lead out of the folder are refused */
async function target(folder: Folder, relative: unknown): Promise<string> {
  const full = typeof relative === 'string' ? resolveInside(folder.root, relative) : null;
  if (!full) throw err('Invalid path', 400);
  // The deepest part that exists must still be inside the folder once links are followed
  let probe = full;
  while (probe !== folder.root && !fs.existsSync(probe)) probe = path.dirname(probe);
  const real = await fsp.realpath(probe).catch(() => probe);
  if (real !== folder.root && !real.startsWith(folder.root + path.sep)) throw err('That path leads outside the folder', 400);
  return full;
}

/** Open a folder (or reuse it if it is already open) and load its files */
export async function openFolder(input: unknown): Promise<OpenedFolder> {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw err('Give the folder’s full path', 400);
  const expanded = input.trim().replace(/^~(?=$|[\\/])/, os.homedir());
  if (!path.isAbsolute(expanded)) throw err('Give the folder’s full path (for example /home/you/project)', 400);
  let root: string;
  try {
    root = await fsp.realpath(expanded);
  } catch {
    throw err(`There is no folder at ${expanded}`, 404);
  }
  if (!(await fsp.stat(root)).isDirectory()) throw err(`${root} is a file, not a folder`, 400);
  if (root === path.parse(root).root) throw err('Open a project folder, not the whole disk', 400);

  let folder = [...folders.values()].find((f) => f.root === root);
  if (!folder) {
    while (folders.size >= LIMITS.openFolders) {
      const oldest = [...folders.values()].sort((a, b) => a.openedAt - b.openedAt)[0];
      closeFolder(oldest.id);
    }
    folder = { id: crypto.randomBytes(12).toString('base64url'), root, known: new Map(), events: new EventEmitter(), watchers: new Map(), pending: new Set(), timer: null, openedAt: Date.now() };
    folder.events.setMaxListeners(32);
    folders.set(folder.id, folder);
  }
  return { ...(await loadFiles(folder)), id: folder.id, root, name: path.basename(root) };
}

async function loadFiles(folder: Folder): Promise<Omit<OpenedFolder, 'id' | 'root' | 'name'>> {
  const { paths, git } = await listFiles(folder.root);
  const files: Record<string, string> = {};
  const skipped: OpenedFolder['skipped'] = [];
  let total = 0;
  let loaded = 0;
  folder.known.clear();
  for (const relative of paths) {
    if (!isSafeRelativePath(relative)) {
      skipped.push({ path: relative, reason: 'name' });
      continue;
    }
    if (loaded >= LIMITS.loaded || total >= LIMITS.totalBytes) {
      skipped.push({ path: relative, reason: 'limit' });
      continue;
    }
    const read = await readText(path.join(folder.root, ...relative.split('/')));
    if ('text' in read) {
      if (total + read.text.length > LIMITS.totalBytes) {
        skipped.push({ path: relative, reason: 'limit' });
        continue;
      }
      files[relative] = read.text;
      folder.known.set(relative, digest(read.text));
      total += read.text.length;
      loaded++;
    } else if (read.reason === 'binary' || read.reason === 'large') {
      skipped.push({ path: relative, reason: read.reason });
    }
  }
  return { files, skipped, git };
}

/** The files of a folder that is already open (a reload, or a window `aha` opened) */
export async function reloadFolder(id: unknown): Promise<OpenedFolder> {
  const folder = folderOf(id);
  return { ...(await loadFiles(folder)), id: folder.id, root: folder.root, name: path.basename(folder.root) };
}

export function closeFolder(id: string): boolean {
  const folder = folders.get(id);
  if (!folder) return false;
  folders.delete(id);
  stopWatching(folder);
  if (folder.timer) clearTimeout(folder.timer);
  folder.events.emit('closed');
  folder.events.removeAllListeners();
  return true;
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** Write a file in place: through a temporary file and a rename, so a crash never leaves half a file */
export async function writeFile(id: unknown, relative: unknown, content: unknown): Promise<void> {
  const folder = folderOf(id);
  if (typeof content !== 'string') throw err('content must be text', 400);
  if (Buffer.byteLength(content) > LIMITS.fileBytes * 4) throw err('That file is too large to save from the studio', 413);
  const full = await target(folder, relative);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  const mode = await fsp.stat(full).then((s) => s.mode & 0o777).catch(() => undefined);
  const temp = path.join(path.dirname(full), `.${path.basename(full)}.aha-${crypto.randomBytes(4).toString('hex')}`);
  folder.known.set(relative as string, digest(content));
  try {
    await fsp.writeFile(temp, content, mode === undefined ? undefined : { mode });
    await fsp.rename(temp, full);
  } catch (error) {
    await fsp.rm(temp, { force: true });
    throw error;
  }
}

export async function removePath(id: unknown, relative: unknown): Promise<void> {
  const folder = folderOf(id);
  const full = await target(folder, relative);
  for (const known of [...folder.known.keys()]) if (known === relative || known.startsWith(`${relative}/`)) folder.known.delete(known);
  await fsp.rm(full, { recursive: true, force: true });
}

/** Move or rename a file or folder, with everything in it (including files the studio doesn't show) */
export async function movePath(id: unknown, from: unknown, to: unknown): Promise<void> {
  const folder = folderOf(id);
  const source = await target(folder, from);
  const dest = await target(folder, to);
  if (fs.existsSync(dest)) throw err(`${to as string} already exists`, 409);
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  await fsp.rename(source, dest);
  for (const [known, sum] of [...folder.known]) {
    if (known === from || known.startsWith(`${from as string}/`)) {
      folder.known.delete(known);
      folder.known.set((to as string) + known.slice((from as string).length), sum);
    }
  }
}

export async function makeDir(id: unknown, relative: unknown): Promise<void> {
  const folder = folderOf(id);
  await fsp.mkdir(await target(folder, relative), { recursive: true });
}

// ---------------------------------------------------------------------------
// Watching
// ---------------------------------------------------------------------------

const WATCH_DELAY_MS = 120;

async function flush(folder: Folder): Promise<void> {
  folder.timer = null;
  const paths = [...folder.pending];
  folder.pending.clear();
  const change: FolderChange = { changed: {}, removed: [] };
  for (const relative of paths) {
    const full = path.join(folder.root, ...relative.split('/'));
    const read = await readText(full);
    if ('text' in read) {
      const sum = digest(read.text);
      if (folder.known.get(relative) === sum) continue;
      folder.known.set(relative, sum);
      change.changed[relative] = read.text;
    } else if (read.reason === 'gone') {
      // A folder that went takes its files with it
      const gone = [...folder.known.keys()].filter((k) => k === relative || k.startsWith(`${relative}/`));
      for (const k of gone) folder.known.delete(k);
      change.removed.push(...gone);
    }
  }
  if (Object.keys(change.changed).length || change.removed.length) folder.events.emit('change', change);
}

const ignored = (relative: string) => relative.split('/').some((part) => SKIP_DIRS.has(part)) || /(^|\/)\.[^/]*\.aha-[0-9a-f]{8}$/.test(relative) || !isSafeRelativePath(relative);

function note(folder: Folder, relative: string): void {
  if (ignored(relative)) return;
  folder.pending.add(relative);
  folder.timer ??= setTimeout(() => void flush(folder), WATCH_DELAY_MS);
}

/** Watch one directory (and, on Linux, every directory under it as it appears) */
function watchDir(folder: Folder, relative: string): void {
  if (folder.watchers.has(relative) || folder.watchers.size >= LIMITS.watchedDirs) return;
  const dir = relative ? path.join(folder.root, ...relative.split('/')) : folder.root;
  let watcher: fs.FSWatcher;
  try {
    watcher = fs.watch(dir, (_event, filename) => {
      if (!filename) return;
      const child = relative ? `${relative}/${filename}` : String(filename);
      if (ignored(child)) return;
      // A new directory: watch it too, and pick up what was created in it before the watch began
      fs.stat(path.join(dir, String(filename)), (error, stat) => {
        if (error || !stat.isDirectory()) return note(folder, child);
        watchDir(folder, child);
        fs.readdir(path.join(dir, String(filename)), (readError, names) => {
          for (const name of readError ? [] : names) note(folder, `${child}/${name}`);
        });
      });
    });
  } catch {
    return;
  }
  watcher.on('error', () => {
    watcher.close();
    folder.watchers.delete(relative);
  });
  folder.watchers.set(relative, watcher);
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // gone already, or unreadable: nothing under it to watch
  }
  for (const entry of entries) {
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) watchDir(folder, relative ? `${relative}/${entry.name}` : entry.name);
  }
}

/**
 * Linux gets a watcher per directory: Node's recursive watch there loses a file once something replaces it by a
 * rename, which is how editors (and this studio) save. macOS and Windows watch a tree natively.
 */
function startWatching(folder: Folder): void {
  if (folder.watchers.size) return;
  if (process.platform === 'linux') {
    watchDir(folder, '');
    return;
  }
  try {
    const watcher = fs.watch(folder.root, { recursive: true }, (_event, filename) => {
      if (filename) note(folder, String(filename).split(path.sep).join('/'));
    });
    watcher.on('error', () => stopWatching(folder));
    folder.watchers.set('', watcher);
  } catch {
    // No watching here: edits still save, and outside changes show up when the folder is opened again
  }
}

function stopWatching(folder: Folder): void {
  for (const watcher of folder.watchers.values()) watcher.close();
  folder.watchers.clear();
}

/** Follow outside changes to a folder; returns the function that stops following */
export function watchFolder(id: unknown, onChange: (change: FolderChange) => void, onClosed: () => void): () => void {
  const folder = folderOf(id);
  startWatching(folder);
  folder.events.on('change', onChange);
  folder.events.once('closed', onClosed);
  return () => {
    folder.events.off('change', onChange);
    folder.events.off('closed', onClosed);
    if (!folder.events.listenerCount('change')) stopWatching(folder);
  };
}

// ---------------------------------------------------------------------------
// The folder picker
// ---------------------------------------------------------------------------

export interface Listing {
  path: string;
  parent: string | null;
  dirs: string[];
  /** Signs this is a project: a Git repository, a package manifest */
  project: boolean;
}

const PROJECT_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod', 'pom.xml', 'build.gradle', 'Gemfile', 'composer.json', 'deno.json', 'mix.exs'];

/** The folders inside a folder, for picking one to open (hidden ones and dependency folders left out) */
export async function browse(input: unknown): Promise<Listing> {
  const start = typeof input === 'string' && input.trim() ? input.trim().replace(/^~(?=$|[\\/])/, os.homedir()) : homeFolder();
  if (!path.isAbsolute(start)) throw err('Give a full path', 400);
  const dir = await fsp.realpath(start).catch(() => {
    throw err(`There is no folder at ${start}`, 404);
  });
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => {
    throw err(`Can’t read ${dir}`, 403);
  });
  const dirs = entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.') && !SKIP_DIRS.has(e.name))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b))
    .slice(0, 500);
  const parent = path.dirname(dir);
  return { path: dir, parent: parent === dir ? null : parent, dirs, project: entries.some((e) => PROJECT_MARKERS.includes(e.name)) };
}
