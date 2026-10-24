'use client';

/** Which side panels are open: remembered in this browser, so the studio opens the way you left it */

import { useCallback, useEffect, useState, type SetStateAction } from 'react';

export function usePersistedFlag(key: string, initial: boolean): [boolean, (next: SetStateAction<boolean>) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(key);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
      if (stored === '0' || stored === '1') setValue(stored === '1');
    } catch {}
  }, [key]);
  const set = useCallback(
    (next: SetStateAction<boolean>) =>
      setValue((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        try {
          localStorage.setItem(key, resolved ? '1' : '0');
        } catch {}
        return resolved;
      }),
    [key]
  );
  return [value, set];
}
