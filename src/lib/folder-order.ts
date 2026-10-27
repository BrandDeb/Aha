/**
 * The order an opened folder's files are loaded in, shared by the server (what an open call sends first) and the
 * studio (what the background loader fetches next). Pure; no Node, no DOM.
 */

/** Files a project's `Run` starts from, in the order to prefer them */
export const ENTRY_GUESSES = ['src/main.ts', 'src/index.ts', 'src/main.tsx', 'src/index.tsx', 'main.ts', 'index.ts', 'main.py', 'app.py', 'src/main.py', 'main.go', 'cmd/main.go', 'src/main.rs', 'index.js', 'src/index.js', 'server.js', 'app.js'];

const FRONT_DOOR = /^(?:readme(?:\.[a-z]+)?|package\.json|pyproject\.toml|cargo\.toml|go\.mod|tsconfig\.json|agents\.md|claude\.md)$/i;

/** The project's front door first (entry, README, manifests), then shallow before deep */
export function priorityOrder(paths: string[]): string[] {
  const rank = (p: string) => {
    let depth = 1;
    for (let i = 0; i < p.length; i++) if (p.charCodeAt(i) === 47) depth++;
    if (ENTRY_GUESSES.includes(p)) return 0;
    if (depth === 1 && FRONT_DOOR.test(p)) return 1;
    return 2 + depth;
  };
  // Rank once per path: a sort compares each one many times, and a repository can have 50,000
  return paths
    .map((path) => ({ path, rank: rank(path) }))
    .sort((a, b) => a.rank - b.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((x) => x.path);
}
