'use client';

/**
 * Failures, and the last version that worked: every run path reports here
 * (builds, runs in any language, Python, the preview), so the studio can offer
 * "Debug this" with the error, where it points and what changed since it last
 * worked, or start that on its own when auto-debug is on.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { makeFailure, type Failure, type FailureSource } from '@/lib/debug';

const KEY = (project: string) => `aha:last-good:${project}`;
/** Bigger projects keep their last good version for the session only */
const MAX_STORED = 1.5 * 1024 * 1024;

export interface FailureTracker {
  failure: Failure | null;
  report: (source: FailureSource, output: string, language?: string) => void;
  /** The current files worked (a clean build or run): remember them, and clear a failure from the same source */
  markGood: (source: FailureSource) => void;
  lastGood: () => Record<string, string> | null;
  dismiss: () => void;
}

export function useFailureTracker(projectName: string, files: Record<string, string>): FailureTracker {
  const [failure, setFailure] = useState<Failure | null>(null);
  const filesRef = useRef(files);
  const good = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  // A new project starts with what it last worked as, if it was stored
  useEffect(() => {
    good.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- another project: its failure doesn't apply
    setFailure(null);
    try {
      const raw = localStorage.getItem(KEY(projectName));
      if (raw) good.current = JSON.parse(raw) as Record<string, string>;
    } catch {
      // storage blocked or corrupt: start without
    }
  }, [projectName]);

  const report = useCallback((source: FailureSource, output: string, language?: string) => {
    if (!output.trim()) return;
    setFailure(makeFailure(source, output, Object.keys(filesRef.current), language));
  }, []);

  const markGood = useCallback(
    (source: FailureSource) => {
      good.current = { ...filesRef.current };
      setFailure((current) => (current?.source === source ? null : current));
      try {
        const raw = JSON.stringify(good.current);
        if (raw.length < MAX_STORED) localStorage.setItem(KEY(projectName), raw);
      } catch {
        // full or blocked: kept for this session
      }
    },
    [projectName]
  );

  return { failure, report, markGood, lastGood: useCallback(() => good.current, []), dismiss: useCallback(() => setFailure(null), []) };
}

/** Collects what a run prints (the tail), so a failure can be explained */
export function outputRecorder(limit = 20_000): { push: (text: string) => void; text: () => string } {
  let buffer = '';
  return {
    push: (text) => {
      buffer += text; // streams send chunks; line-based callers add their own newline
      if (buffer.length > limit * 2) buffer = buffer.slice(-limit);
    },
    text: () => buffer.slice(-limit),
  };
}
