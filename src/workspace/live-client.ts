'use client';

/**
 * Live mode: while it is on, the entry file runs on the server after each
 * pause in typing (and once when it is turned on), and the editor shows what
 * every line did. A result is only shown for the code it was made from.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { liveSupported, type LiveResult } from '@/lib/live/shared';
import { pythonProjectId } from './python-client';

const KEY = 'nanocli:live';
const DEBOUNCE_MS = 900;

export type LiveState = 'off' | 'running' | 'ready';

export function useLiveValues(options: { projectName: string; files: Record<string, string>; entry: string | null; args: string }) {
  const [enabledOnServer, setEnabledOnServer] = useState<boolean | null>(null);
  const [on, setOnState] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ files: Record<string, string>; value: LiveResult } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  useEffect(() => {
    let live = true;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restored once from this browser's storage
      setOnState(localStorage.getItem(KEY) === '1');
    } catch {}
    fetch('/api/live', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((s: { enabled: boolean }) => live && setEnabledOnServer(!!s.enabled))
      .catch(() => live && setEnabledOnServer(false));
    return () => {
      live = false;
    };
  }, []);

  const supported = !!options.entry && liveSupported(options.entry);
  const available = enabledOnServer === true && supported;

  const run = useCallback(
    async (quick: boolean) => {
      const { entry, files, projectName, args } = optionsRef.current;
      if (!entry || !liveSupported(entry)) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setRunning(true);
      try {
        const response = await fetch('/api/live', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId: pythonProjectId(projectName), files, entry, args: args.trim() ? args.trim().split(/\s+/) : [], quick }),
          signal: controller.signal,
        });
        const value = (await response.json()) as LiveResult;
        if (controller.signal.aborted) return;
        setResult({ files, value: response.ok ? value : { ok: false, files: {}, output: '', code: null, ms: 0, error: value.error ?? `Live values failed (${response.status})` } });
      } catch (error) {
        if ((error as Error).name !== 'AbortError') setResult({ files, value: { ok: false, files: {}, output: '', code: null, ms: 0, error: 'Could not reach the server for live values' } });
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setRunning(false);
        }
      }
    },
    []
  );

  // Each pause in typing re-runs; turning it on runs at once
  const firstRef = useRef(true);
  useEffect(() => {
    if (!on || !available) {
      firstRef.current = true;
      return;
    }
    const delay = firstRef.current ? 0 : DEBOUNCE_MS;
    firstRef.current = false;
    const timer = setTimeout(() => void run(true), delay);
    return () => clearTimeout(timer);
  }, [on, available, options.files, options.entry, options.args, run]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const setOn = useCallback((next: boolean) => {
    setOnState(next);
    try {
      localStorage.setItem(KEY, next ? '1' : '0');
    } catch {}
    if (!next) {
      abortRef.current?.abort();
      setResult(null);
    }
  }, []);

  /** The result for one file, if that file still reads as it did when it ran */
  const forFile = useCallback(
    (path: string, content: string) => (on && result && result.files[path] === content ? result.value.files[path] : undefined),
    [on, result]
  );

  return { available, supported, enabledOnServer, on, setOn, running, result: on ? result?.value ?? null : null, forFile, refresh: () => void run(false) };
}
