/**
 * The studio was called NanoCLI Studio before it was Aha!. What people saved under the old name carries over, once:
 * - browser storage: `nanocli:*` keys become `aha:*` (before the page reads its settings);
 * - projects: files under `.nanocli/` (watchers, why-history, channel history…) move to `.aha/`;
 * - settings variables: `NANOCLI_*` still work, as `AHA_*` (server.js and supervise.js do the same, and also move
 *   `~/.nanocli` to `~/.aha`).
 * A value saved under the new name always wins over the old one.
 */

export const LEGACY_STORAGE_PREFIX = 'nanocli:';
export const STORAGE_PREFIX = 'aha:';
export const LEGACY_PROJECT_DIR = '.nanocli/';
export const PROJECT_DIR = '.aha/';

interface KeyStore {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Move `nanocli:*` keys to `aha:*`; returns how many moved. Self-contained: it is also inlined as a page script */
export function migrateStorage(store: KeyStore): number {
  // Collect first: adding and removing keys while walking them by index skips some
  const keys: string[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (key && key.indexOf('nanocli:') === 0) keys.push(key);
  }
  for (const key of keys) {
    const next = 'aha:' + key.slice(8);
    const value = store.getItem(key);
    if (store.getItem(next) === null && value !== null) store.setItem(next, value);
    store.removeItem(key);
  }
  return keys.length;
}

/** The same, as a script for the page's <head> (runs before anything reads storage) */
export const storageMigrationScript = `try{(${migrateStorage.toString()})(localStorage)}catch(e){}`;

/** A project's `.nanocli/` files under `.aha/` (a file already under the new name is kept); the same object when nothing moves */
export function migrateProjectFiles(files: Record<string, string>): Record<string, string> {
  if (!Object.keys(files).some((p) => p.startsWith(LEGACY_PROJECT_DIR))) return files;
  const out: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(LEGACY_PROJECT_DIR)) {
      out[path] = content;
      continue;
    }
    const next = PROJECT_DIR + path.slice(LEGACY_PROJECT_DIR.length);
    if (!(next in files)) out[next] = content;
  }
  return out;
}

/** `NANOCLI_X` becomes `AHA_X` unless that is set */
export function adoptLegacyEnv(env: Record<string, string | undefined>): string[] {
  const adopted: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('NANOCLI_') || value === undefined) continue;
    const next = `AHA_${key.slice('NANOCLI_'.length)}`;
    if (env[next] === undefined) {
      env[next] = value;
      adopted.push(next);
    }
  }
  return adopted;
}
