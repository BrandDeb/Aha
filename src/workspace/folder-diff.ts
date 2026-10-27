/**
 * The pure half of the folder sync (folder-client.ts): turning an opened folder into a project, and working out what
 * to save. No React, no DOM; unit tested in tests/folder.test.ts.
 */

import type { Project } from './project.ts';

export interface OpenedFolder {
  id: string;
  root: string;
  name: string;
  files: Record<string, string>;
  skipped: { path: string; reason: 'binary' | 'large' | 'limit' | 'name' }[];
  git: boolean;
}

const ENTRY_GUESSES = ['src/main.ts', 'src/index.ts', 'src/main.tsx', 'src/index.tsx', 'main.ts', 'index.ts', 'main.py', 'app.py', 'src/main.py', 'main.go', 'cmd/main.go', 'src/main.rs', 'index.js', 'src/index.js', 'server.js', 'app.js'];

/** The opened folder as a project: its files, a guess at what Run runs, and where it lives */
export function folderProject(opened: OpenedFolder): Project {
  const entry = ENTRY_GUESSES.find((f) => f in opened.files) ?? '';
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
