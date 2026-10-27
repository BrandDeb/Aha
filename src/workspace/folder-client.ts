'use client';

/**
 * A folder on this machine, opened in the studio (lib/folder.ts on the server). The studio keeps the text of the
 * folder's files in memory like any project; this module saves edits back in place and brings in changes other
 * programs make.
 *
 * Big folders. Opening sends every file name and the text of the first few; the rest is "unloaded": it shows in the
 * tree at once, its text comes when it is opened, moved or deleted, and a background loader fetches the front of the
 * list (up to MAX_LOADED files) so search and the agent have most of a normal project to work with.
 *
 * Saving works from a baseline: what the studio last knew to be on disk. Every change of the project is compared with
 * it and only the difference is written, a moment after typing stops. Moves and deletes go straight to the server
 * (a diff can't tell a moved folder from a new one, and a move must take the files the studio doesn't show along).
 */

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { actionGates, actionTaps, type Action } from './store';
import { movePath, type Project } from './project';
import { diffAgainstDisk, folderProject, moveInBaseline, nextBatch, pathsUnder, type OpenedFolder } from './folder-diff';
import { priorityOrder } from '../lib/folder-order';

export type { OpenedFolder };

export interface Listing {
  path: string;
  parent: string | null;
  dirs: string[];
  project: boolean;
}

const SAVE_DELAY_MS = 400;
const RECENT_KEY = 'aha:recent-folders';
/** Files held in memory by the background loader; more open on demand (matches LIMITS.loaded on the server) */
const MAX_LOADED = 5_000;
const BATCH = 400;
const BATCH_PAUSE_MS = 60;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `The folder request failed (${response.status})`), { status: response.status });
  return data as T;
}

interface ReadAnswer {
  files: Record<string, string>;
  unreadable: { path: string; reason: string }[];
  handled: number;
}

export const openFolder = (path: string) => call<OpenedFolder>({ action: 'open', path });
export const reloadFolder = (id: string) => call<OpenedFolder>({ action: 'reload', id });
export const browseFolders = (path?: string) => call<Listing>({ action: 'browse', path });

/** Whether folders can be opened here (the studio runs on this machine, and this window has the launch key) */
export async function foldersAvailable(): Promise<boolean> {
  try {
    const response = await fetch('/api/folder', { cache: 'no-store' });
    return response.ok && (await response.json()).enabled === true;
  } catch {
    return false;
  }
}

export function recentFolders(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((p): p is string => typeof p === 'string').slice(0, 8) : [];
  } catch {
    return [];
  }
}

function rememberFolder(root: string): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([root, ...recentFolders().filter((p) => p !== root)].slice(0, 8)));
  } catch {
    // storage blocked: no recents
  }
}

// ---------------------------------------------------------------------------
// Files whose text hasn't come yet
// ---------------------------------------------------------------------------

const unloaded = new Set<string>();
let unloadedSnapshot: string[] = [];
const listeners = new Set<() => void>();

function setUnloaded(next: Iterable<string>): void {
  unloaded.clear();
  for (const p of next) unloaded.add(p);
  publish();
}

function publish(): void {
  unloadedSnapshot = [...unloaded];
  for (const l of listeners) l();
}

/** Paths in the opened folder whose text hasn't been loaded yet: the tree lists them with the rest */
export function useUnloadedPaths(): string[] {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => unloadedSnapshot,
    () => unloadedSnapshot,
  );
}

interface SyncOptions {
  project: Project;
  hydrated: boolean;
  tabs: string[];
  active: string;
  dispatch: (action: Action) => void;
  notify: (toast: { kind: 'success' | 'error' | 'info'; title: string; detail?: string }) => void;
}

/**
 * Keep an opened folder and the studio in step. Returns `adopt`, which makes a freshly opened folder the project
 * (and its files the baseline).
 */
export function useFolderSync({ project, hydrated, tabs, active, dispatch, notify }: SyncOptions): (opened: OpenedFolder, keepTabs?: { tabs: string[]; active: string }) => void {
  const baseline = useRef(new Map<string, string>());
  const adopted = useRef<string | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failed = useRef(false);
  const reopening = useRef(false);
  const view = useRef({ tabs, active });
  const order = useRef<string[]>([]);
  const disk = project.disk;

  useEffect(() => {
    view.current = { tabs, active };
  }, [tabs, active]);

  /** Run disk operations one at a time, in order */
  const enqueue = useCallback((op: () => Promise<unknown>) => {
    queue.current = queue.current.then(op).catch((error: Error) => {
      if (failed.current) return;
      failed.current = true;
      notify({ kind: 'error', title: 'Couldn’t save to the folder', detail: error.message });
      setTimeout(() => (failed.current = false), 10_000);
    });
  }, [notify]);

  /** Fetch the text of some unloaded files and bring them in; returns once they are in the project */
  const loadPaths = useCallback(async (paths: string[]): Promise<void> => {
    const id = adopted.current;
    if (!id) return;
    const wanted = paths.filter((p) => unloaded.has(p));
    for (let i = 0; i < wanted.length; i += 1000) {
      const chunk = wanted.slice(i, i + 1000);
      const answer = await call<ReadAnswer>({ action: 'read', id, paths: chunk });
      if (adopted.current !== id) return;
      for (const [path, text] of Object.entries(answer.files)) baseline.current.set(path, text);
      // Handled files leave the unloaded list: loaded, or unreadable (binary, too large) or gone, which the tree drops
      for (const path of chunk.slice(0, answer.handled)) unloaded.delete(path);
      if (Object.keys(answer.files).length) dispatch({ type: 'put', files: answer.files });
      // A request that ran out of byte budget leaves the rest for the next one
      const rest = chunk.slice(answer.handled);
      if (rest.length) wanted.splice(i + 1000, 0, ...rest);
    }
    publish();
  }, [dispatch]);

  // Opening, moving or deleting something whose text isn't here yet waits for it (the whole folder, for a folder)
  useEffect(() => {
    const gate = (action: Action, before: Project): Promise<unknown> | null => {
      if (!before.disk || before.disk.id !== adopted.current || !unloaded.size) return null;
      if (action.type === 'open') return unloaded.has(action.path) ? loadPaths([action.path]) : null;
      if (action.type === 'move' || action.type === 'delete') {
        const from = action.type === 'move' ? action.from : action.path;
        const inside = pathsUnder(unloaded, from);
        return inside.length ? loadPaths(inside) : null;
      }
      return null;
    };
    actionGates.add(gate);
    return () => {
      actionGates.delete(gate);
    };
  }, [loadPaths]);

  /** Load the front of the folder in the background, a batch at a time, up to MAX_LOADED files */
  const loadInBackground = useCallback((id: string) => {
    const step = async () => {
      if (adopted.current !== id || baseline.current.size >= MAX_LOADED) return;
      const batch = nextBatch(order.current, unloaded, Math.min(BATCH, MAX_LOADED - baseline.current.size));
      if (!batch.length) return;
      try {
        await loadPaths(batch);
      } catch {
        return; // the studio is going away, or the folder closed: nothing to finish
      }
      setTimeout(() => void step(), BATCH_PAUSE_MS);
    };
    setTimeout(() => void step(), BATCH_PAUSE_MS);
  }, [loadPaths]);

  const adopt = useCallback((opened: OpenedFolder, keepTabs?: { tabs: string[]; active: string }) => {
    baseline.current = new Map(Object.entries(opened.files));
    adopted.current = opened.id;
    order.current = priorityOrder(opened.paths);
    setUnloaded(opened.paths.filter((p) => !(p in opened.files)));
    rememberFolder(opened.root);
    dispatch({ type: 'replace', project: folderProject(opened), git: null });
    const wanted = [...(keepTabs?.tabs ?? []), ...(keepTabs?.active ? [keepTabs.active] : [])];
    const restore = () => {
      for (const tab of keepTabs?.tabs ?? []) if (baseline.current.has(tab)) dispatch({ type: 'open', path: tab });
      if (keepTabs?.active && baseline.current.has(keepTabs.active)) dispatch({ type: 'open', path: keepTabs.active });
    };
    if (wanted.some((p) => unloaded.has(p))) void loadPaths(wanted).then(restore, restore);
    else restore();
    loadInBackground(opened.id);
    const skipped = opened.skipped.length;
    if (skipped) notify({ kind: 'info', title: `${skipped} file${skipped === 1 ? '' : 's'} not shown`, detail: 'Names the studio can’t use yet. They stay on disk, untouched.' });
  }, [dispatch, notify, loadPaths, loadInBackground]);

  // Moves and deletes go to the server as they happen, and the baseline follows, so the diff below sees no change
  useEffect(() => {
    const tap = (action: Action, before: Project) => {
      const id = before.disk?.id;
      if (!id || id !== adopted.current) return;
      if (action.type === 'move') {
        // The studio refuses some moves (onto an existing file, into itself): then nothing happens on disk either
        if ('error' in movePath(before, action.from, action.to)) return;
        moveInBaseline(baseline.current, action.from, action.to);
        enqueue(() => call({ action: 'move', id, from: action.from, to: action.to }));
      } else if (action.type === 'delete') {
        for (const path of [...baseline.current.keys()]) if (path === action.path || path.startsWith(`${action.path}/`)) baseline.current.delete(path);
        enqueue(() => call({ action: 'delete', id, path: action.path }));
      } else if (action.type === 'mkdir') {
        enqueue(() => call({ action: 'mkdir', id, path: action.path }));
      }
    };
    actionTaps.add(tap);
    return () => {
      actionTaps.delete(tap);
    };
  }, [enqueue]);

  // A folder remembered from the last visit (or opened by `aha` with ?folder=): read its files again
  useEffect(() => {
    if (!hydrated || reopening.current) return;
    const linked = new URLSearchParams(window.location.search).get('folder');
    const wanted = linked ? { id: linked, root: '' } : disk && disk.id !== adopted.current ? disk : null;
    if (!wanted) return;
    reopening.current = true;
    const keep = linked ? undefined : { ...view.current };
    if (linked) {
      const url = new URL(window.location.href);
      url.searchParams.delete('folder');
      window.history.replaceState(null, '', url);
    }
    reloadFolder(wanted.id)
      .catch((error: { status?: number }) => (error.status === 404 && wanted.root ? openFolder(wanted.root) : Promise.reject(error)))
      .then((opened) => adopt(opened, keep))
      .catch((error: Error) => notify({ kind: 'error', title: 'Couldn’t open the folder', detail: error.message }))
      .finally(() => (reopening.current = false));
  }, [hydrated, disk, adopt, notify]);

  // Save what changed, a moment after the last edit
  useEffect(() => {
    if (!disk || disk.id !== adopted.current) return;
    const id = disk.id;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      const { write, remove } = diffAgainstDisk(project.files, baseline.current);
      for (const [path, content] of Object.entries(write)) {
        baseline.current.set(path, content);
        enqueue(() => call({ action: 'write', id, path, content }));
      }
      for (const path of remove) {
        baseline.current.delete(path);
        enqueue(() => call({ action: 'delete', id, path }));
      }
    }, SAVE_DELAY_MS);
  }, [project.files, disk, enqueue]);

  // Changes other programs make come in as they happen
  useEffect(() => {
    if (!disk || disk.id !== adopted.current) return;
    const id = disk.id;
    const source = new EventSource(`/api/folder?watch=${encodeURIComponent(id)}`);
    source.addEventListener('change', (event) => {
      const change = JSON.parse((event as MessageEvent).data) as { changed: Record<string, string>; removed: string[] };
      const changed: Record<string, string> = {};
      for (const [path, content] of Object.entries(change.changed)) {
        baseline.current.set(path, content);
        unloaded.delete(path);
        changed[path] = content;
      }
      for (const path of change.removed) {
        baseline.current.delete(path);
        unloaded.delete(path);
      }
      order.current = order.current.filter((p) => !change.removed.includes(p));
      publish();
      dispatch({ type: 'put', files: changed, removed: change.removed });
    });
    source.addEventListener('closed', () => {
      source.close();
      // The studio restarted and forgot the folder: open it again where it is
      if (adopted.current !== id || reopening.current) return;
      reopening.current = true;
      openFolder(disk.root)
        .then((opened) => adopt(opened, { ...view.current }))
        .catch((error: Error) => notify({ kind: 'error', title: 'The folder was closed', detail: error.message }))
        .finally(() => (reopening.current = false));
    });
    return () => source.close();
  }, [disk, dispatch, adopt, notify]);

  return adopt;
}
