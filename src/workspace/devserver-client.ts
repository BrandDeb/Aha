'use client';

/**
 * The browser side of /api/devserver: start and stop a project's dev server,
 * follow its status and log, and send each edit as it happens (only what
 * changed), so the framework's hot reload updates the preview.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DevState, LogLine } from '@/lib/devserver';
import { GENERATED_DIRS } from '@/lib/frameworks';
import { pythonProjectId } from './python-client';

export type { DevState, LogLine };

const MAX_LOG = 400;
const syncable = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([p]) => !GENERATED_DIRS.has(p.split('/')[0])));

async function post(body: Record<string, unknown>): Promise<(Partial<DevState> & { error?: string }) | null> {
  try {
    const response = await fetch('/api/devserver', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return (await response.json()) as Partial<DevState> & { error?: string };
  } catch {
    return null;
  }
}

export interface DevServerHandle {
  /** null until the server says whether dev servers are available here */
  enabled: boolean | null;
  state: DevState;
  log: LogLine[];
  start: () => void;
  stop: () => void;
}

const IDLE: DevState = { status: 'none', log: [], seq: 0 };

export function useDevServer(projectName: string, files: Record<string, string>, active: boolean): DevServerHandle {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [state, setState] = useState<DevState>(IDLE);
  const [log, setLog] = useState<LogLine[]>([]);
  const [id, setId] = useState<string | null>(null);
  const seq = useRef(0);
  const synced = useRef<Record<string, string> | null>(null);
  const filesRef = useRef(files);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // The id is per project name and lives in localStorage, so it is read after mount
  useEffect(() => {
    if (!active) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
    setId(pythonProjectId(projectName));
    setState(IDLE);
    setLog([]);
    seq.current = 0;
    synced.current = null;
  }, [projectName, active]);

  const absorb = useCallback((next: Partial<DevState> & { error?: string }) => {
    if (!next.status) return;
    setState((prev) => ({ ...prev, ...next, log: [] }) as DevState);
    if (next.log?.length) {
      seq.current = next.seq ?? seq.current;
      setLog((prev) => [...prev, ...next.log!].slice(-MAX_LOG));
    }
  }, []);

  // Availability, and reattaching to a server that kept running across a reload
  useEffect(() => {
    if (!active || !id) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = (await (await fetch('/api/devserver', { cache: 'no-store' })).json()) as { enabled: boolean };
        if (cancelled) return;
        setEnabled(info.enabled);
        if (!info.enabled) return;
        const current = (await (await fetch(`/api/devserver?projectId=${id}&since=0`, { cache: 'no-store' })).json()) as DevState;
        if (cancelled || current.status === 'none') return;
        absorb(current);
        // Whatever is on disk may be older than the editor: send everything once
        if (current.status === 'ready' || current.status === 'starting' || current.status === 'installing') {
          synced.current = {};
        }
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, active, absorb]);

  // Follow progress: quickly while something is happening, slowly once ready
  const busy = state.status === 'installing' || state.status === 'starting';
  const live = busy || state.status === 'ready';
  useEffect(() => {
    if (!id || !live) return;
    const timer = setInterval(async () => {
      try {
        const next = (await (await fetch(`/api/devserver?projectId=${id}&since=${seq.current}`, { cache: 'no-store' })).json()) as DevState;
        absorb(next);
      } catch {
        // the studio is restarting; try again next tick
      }
    }, busy ? 700 : 2000);
    return () => clearInterval(timer);
  }, [id, live, busy, absorb]);

  // Send edits as they happen (only what changed since the last sync)
  useEffect(() => {
    if (!id || !live || !synced.current) return;
    const timer = setTimeout(() => {
      const before = synced.current;
      if (!before) return;
      const now = syncable(filesRef.current);
      const changed = Object.fromEntries(Object.entries(now).filter(([p, c]) => before[p] !== c));
      const removed = Object.keys(before).filter((p) => !(p in now));
      if (!Object.keys(changed).length && !removed.length) return;
      synced.current = now;
      void post({ action: 'sync', projectId: id, changed, removed }).then((result) => result && absorb(result));
    }, 200);
    return () => clearTimeout(timer);
  }, [files, id, live, absorb]);

  const start = useCallback(() => {
    if (!id) return;
    const now = syncable(filesRef.current);
    synced.current = now;
    setLog([]);
    seq.current = 0;
    setState({ status: 'starting', log: [], seq: 0 });
    void post({ action: 'start', projectId: id, files: now }).then((result) => {
      if (!result) setState({ status: 'failed', error: 'The studio did not answer.', log: [], seq: 0 });
      else if (result.error && !result.status) setState({ status: 'failed', error: result.error, log: [], seq: 0 });
      else absorb(result);
    });
  }, [id, absorb]);

  const stop = useCallback(() => {
    if (!id) return;
    void post({ action: 'stop', projectId: id }).then((result) => result && absorb(result));
  }, [id, absorb]);

  return { enabled, state, log, start, stop };
}
