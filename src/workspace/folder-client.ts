'use client';

/**
 * A folder on this machine, opened in the studio (lib/folder.ts on the server). The studio keeps the folder's text
 * files in memory like any project; this module saves edits back in place and brings in changes other programs make.
 *
 * Saving works from a baseline: what the studio last knew to be on disk. Every change of the project is compared with
 * it and only the difference is written, a moment after typing stops. Moves and deletes go straight to the server
 * (a diff can't tell a moved folder from a new one, and a move must take the files the studio doesn't show along).
 */

import { useCallback, useEffect, useRef } from 'react';
import { actionTaps, type Action } from './store';
import type { Project } from './project';
import { diffAgainstDisk, folderProject, moveInBaseline, type OpenedFolder } from './folder-diff';

export type { OpenedFolder };


export interface Listing {
  path: string;
  parent: string | null;
  dirs: string[];
  project: boolean;
}

const SAVE_DELAY_MS = 400;
const RECENT_KEY = 'aha:recent-folders';

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `The folder request failed (${response.status})`), { status: response.status });
  return data as T;
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

  const adopt = useCallback((opened: OpenedFolder, keepTabs?: { tabs: string[]; active: string }) => {
    baseline.current = new Map(Object.entries(opened.files));
    adopted.current = opened.id;
    rememberFolder(opened.root);
    dispatch({ type: 'replace', project: folderProject(opened), git: null });
    for (const tab of keepTabs?.tabs ?? []) if (tab in opened.files) dispatch({ type: 'open', path: tab });
    if (keepTabs?.active && keepTabs.active in opened.files) dispatch({ type: 'open', path: keepTabs.active });
    const skipped = opened.skipped.filter((s) => s.reason !== 'binary').length;
    if (skipped) notify({ kind: 'info', title: `${skipped} file${skipped === 1 ? '' : 's'} not loaded`, detail: 'Large files, names the studio can’t use yet, or past the 5,000-file limit. They stay on disk, untouched.' });
  }, [dispatch, notify]);

  // Moves and deletes go to the server as they happen, and the baseline follows, so the diff below sees no change
  useEffect(() => {
    const tap = (action: Action, before: Project) => {
      const id = before.disk?.id;
      if (!id || id !== adopted.current) return;
      if (action.type === 'move') {
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
        changed[path] = content;
      }
      for (const path of change.removed) baseline.current.delete(path);
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
