/**
 * The pure half of the folder sync (folder-client.ts): turning an opened folder into a project, and working out what
 * to save. No React, no DOM; unit tested in tests/folder.test.ts.
 */

import type { Project } from './project.ts';
import { ENTRY_GUESSES } from '../lib/folder-order.ts';

export interface OpenedFolder {
  id: string;
  root: string;
  name: string;
  /** Every file in the folder, sorted; the tree shows all of them at once */
  paths: string[];
  /** The text of the first few; the rest is read when needed (folder-client.ts) */
  files: Record<string, string>;
  skipped: { path: string; reason: 'binary' | 'large' | 'limit' | 'name' }[];
  git: boolean;
}

/** The opened folder as a project: its files, a guess at what Run runs, and where it lives */
export function folderProject(opened: OpenedFolder): Project {
  const known = new Set(opened.paths);
  const entry = ENTRY_GUESSES.find((f) => known.has(f)) ?? '';
  return { name: opened.name, files: opened.files, folders: [], entry, disk: { id: opened.id, root: opened.root } };
}

/** The project's changes since the baseline: files to write, and files to delete */
export function diffAgainstDisk(files: Record<string, string>, onDisk: Map<string, string>): { write: Record<string, string>; remove: string[] } {
  const write: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) if (onDisk.get(path) !== content) write[path] = content;
  const remove = [...onDisk.keys()].filter((path) => !(path in files));
  return { write, remove };
}

/** Rename every baseline entry under `from` to sit under `to` */
export function moveInBaseline(onDisk: Map<string, string>, from: string, to: string): void {
  for (const [path, content] of [...onDisk]) {
    if (path === from || path.startsWith(`${from}/`)) {
      onDisk.delete(path);
      onDisk.set(to + path.slice(from.length), content);
    }
  }
}

/** The paths in a set that are `root` itself or sit under it */
export function pathsUnder(paths: Iterable<string>, root: string): string[] {
  const out: string[] = [];
  for (const p of paths) if (p === root || p.startsWith(`${root}/`)) out.push(p);
  return out;
}

/** What to load next: unloaded paths in front-door order, past the ones already tried, at most `count` */
export function nextBatch(order: string[], unloaded: Set<string>, count: number): string[] {
  const out: string[] = [];
  for (const p of order) {
    if (unloaded.has(p)) {
      out.push(p);
      if (out.length >= count) break;
    }
  }
  return out;
}
