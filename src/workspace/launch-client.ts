'use client';

/**
 * Whether this window holds the studio's launch key (scripts/launch-key.js). Without it the server refuses the
 * routes that run programs or open files, so the studio says why once, instead of each feature failing on its own.
 */

import { useEffect, useState } from 'react';

export type LaunchState = 'unknown' | 'unlocked' | 'locked';

let cached: Promise<LaunchState> | null = null;

export function launchState(): Promise<LaunchState> {
  cached ??= fetch('/api/launch', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((s: { required?: boolean; unlocked?: boolean } | null) => (!s ? 'unknown' : s.required && !s.unlocked ? 'locked' : 'unlocked'))
    // An older server, or none (a static preview): nothing to say
    .catch(() => 'unknown' as const);
  return cached;
}

export function useLaunchState(): LaunchState {
  const [state, setState] = useState<LaunchState>('unknown');
  useEffect(() => {
    let live = true;
    void launchState().then((s) => live && setState(s));
    return () => {
      live = false;
    };
  }, []);
  return state;
}
