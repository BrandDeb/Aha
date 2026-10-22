'use client';

/** Field kits in the browser: opening one as a project, downloading one, and the playbook's progress. */

import { useCallback, useEffect, useState } from 'react';
import { KIT_FILE, type Kit } from '@/lib/kits';

/** A kit's files as a project, with its manifest where the Kit tab looks for it */
export function kitProject(kit: Kit, files: Record<string, string>) {
  const all = { ...files, [KIT_FILE]: JSON.stringify(kit, null, 2) + '\n' };
  const entry = kit.entry && kit.entry in all ? kit.entry : Object.keys(all).find((p) => p !== KIT_FILE) ?? KIT_FILE;
  return { name: kit.id, files: all, folders: [] as string[], entry };
}

export function downloadText(filename: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Which playbook steps are done, per kit, kept in this browser */
export function useStepsDone(kitId: string): [Set<number>, (index: number) => void] {
  const key = `nanocli:kit-steps:${kitId}`;
  const [done, setDone] = useState<Set<number>>(new Set());
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
      setDone(new Set(JSON.parse(localStorage.getItem(key) ?? '[]')));
    } catch {
      setDone(new Set());
    }
  }, [key]);
  const toggle = useCallback(
    (index: number) => {
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        try {
          localStorage.setItem(key, JSON.stringify([...next]));
        } catch {
          // this session only
        }
        return next;
      });
    },
    [key]
  );
  return [done, toggle];
}
