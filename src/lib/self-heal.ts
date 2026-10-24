/**
 * Self-healing in the browser. The common breakage after the studio updates: a tab that was open
 * before asks for code chunks that no longer exist, and the page fails. Reloading fixes it, so the
 * studio does that by itself, at most once a minute (if a reload doesn't fix it, the crash screen
 * with its recovery options stays).
 */

/** Errors meaning "this page's code is out of date" (each bundler and browser words it differently) */
export const STALE_CODE = /ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed|Failed to load chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

const KEY = 'nanocli:healed-at';
const MIN_GAP_MS = 60_000;

/** Reload once if the error means stale code; returns whether it did */
export function healStaleCode(message: string | undefined, storage: Pick<Storage, 'getItem' | 'setItem'>, reload: () => void, now = Date.now()): boolean {
  if (!message || !STALE_CODE.test(message)) return false;
  try {
    const last = Number(storage.getItem(KEY) || 0);
    if (last && now - last < MIN_GAP_MS) return false;
    storage.setItem(KEY, String(now));
  } catch {
    return false;
  }
  reload();
  return true;
}

/** The same, as an inline script for the document head: it must work before (and when) the app's own code doesn't */
export const healScript = `(function(){var re=new RegExp(${JSON.stringify(STALE_CODE.source)},'i');function heal(m){if(!m||!re.test(m))return;try{var t=+sessionStorage.getItem('${KEY}')||0;if(t&&Date.now()-t<${MIN_GAP_MS})return;sessionStorage.setItem('${KEY}',String(Date.now()))}catch(e){return}location.reload()}addEventListener('error',function(e){heal(e&&(e.message||(e.error&&e.error.message)))},true);addEventListener('unhandledrejection',function(e){var r=e&&e.reason;heal(r&&(r.message||String(r)))})})();`;
