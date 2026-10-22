/**
 * Getting back to a working studio after a crash, without ever losing the
 * user's project. The studio keeps a copy of the last workspace that loaded
 * and stayed up for a few seconds; a crash screen can restore it, reset the
 * look and settings (the usual suspects), or hand over the raw project as a
 * file. Everything takes a Storage so it can be tested without a browser.
 */

export const WORKSPACE_KEY = 'nanocli:workspace';
export const LAST_GOOD_KEY = 'nanocli:workspace:last-good';
export const CRASHES_KEY = 'nanocli:crashes';

/** Keys that only affect how the studio looks and behaves; resetting them never touches a project or an API key */
export const SETTINGS_KEYS = ['nanocli:settings', 'nanocli:appearance-vars'];

const CRASH_WINDOW_MS = 10 * 60_000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function isWorkspace(raw: string | null): boolean {
  if (!raw) return false;
  try {
    const value = JSON.parse(raw);
    return !!value && typeof value === 'object' && !!value.project && typeof value.project.files === 'object' && Object.keys(value.project.files).length > 0;
  } catch {
    return false;
  }
}

/** The workspace loaded and stayed up: remember it as the version to fall back to */
export function markHealthy(storage: Store): void {
  try {
    const current = storage.getItem(WORKSPACE_KEY);
    if (isWorkspace(current)) storage.setItem(LAST_GOOD_KEY, current as string);
    storage.removeItem(CRASHES_KEY);
  } catch {
    // storage is full or blocked: recovery is a convenience
  }
}

/** Note a crash; returns how many happened in the last ten minutes */
export function recordCrash(storage: Store, now = Date.now()): number {
  let times: number[] = [];
  try {
    times = JSON.parse(storage.getItem(CRASHES_KEY) ?? '[]');
  } catch {
    times = [];
  }
  times = (Array.isArray(times) ? times : []).filter((t) => typeof t === 'number' && now - t < CRASH_WINDOW_MS).concat(now).slice(-10);
  try {
    storage.setItem(CRASHES_KEY, JSON.stringify(times));
  } catch {
    // ignore
  }
  return times.length;
}

export function hasLastGood(storage: Store): boolean {
  try {
    return isWorkspace(storage.getItem(LAST_GOOD_KEY));
  } catch {
    return false;
  }
}

/** Put the last good workspace back. The broken one is kept aside, not deleted. */
export function restoreLastGood(storage: Store): boolean {
  try {
    const good = storage.getItem(LAST_GOOD_KEY);
    if (!isWorkspace(good)) return false;
    const broken = storage.getItem(WORKSPACE_KEY);
    if (broken) storage.setItem(`${WORKSPACE_KEY}:before-restore`, broken);
    storage.setItem(WORKSPACE_KEY, good as string);
    storage.removeItem(CRASHES_KEY);
    return true;
  } catch {
    return false;
  }
}

export function resetSettings(storage: Store): void {
  for (const key of SETTINGS_KEYS) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/** The stored workspace as text for a download: what the user can keep even if nothing else works */
export function exportWorkspace(storage: Store): string | null {
  try {
    return storage.getItem(WORKSPACE_KEY) ?? storage.getItem(LAST_GOOD_KEY);
  } catch {
    return null;
  }
}
