/** The command palette's ordering and its memory of recently used commands */

/** What an empty palette offers first: the things people do most */
export const SUGGESTED = ['file.new-project', 'agent.ask', 'build.run', 'panel.optimize', 'panel.agent', 'file.import-export', 'view.terminal', 'prefs.settings'];
const RECENT_KEY = 'aha:recent-commands';
export const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
};
export const remember = (id: string) => {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 5)));
  } catch {
    // storage blocked: no recents
  }
};

export type Section = 'Recent' | 'Suggested' | 'Files' | 'Commands';

/**
 * The palette's list. Empty: recently used commands, then the suggested ones, then open-able files.
 * Typing: everything that matches, best first.
 */
export function paletteOrder<T extends { kind: 'command' | 'file'; id: string; s: number }>(items: T[], query: string, recent: string[]): (T & { section: Section })[] {
  if (query.trim()) return items.filter((i) => i.s !== Infinity).sort((a, b) => a.s - b.s).slice(0, 50).map((i) => ({ ...i, section: i.kind === 'file' ? 'Files' : 'Commands' }));
  const cmds = items.filter((i) => i.kind === 'command');
  const byId = (id: string) => cmds.find((c) => c.id === id);
  const rec = recent.map(byId).filter((c): c is T => !!c);
  const sug = SUGGESTED.map(byId).filter((c): c is T => !!c && !rec.includes(c));
  const rest = cmds.filter((c) => !rec.includes(c) && !sug.includes(c));
  const files = items.filter((i) => i.kind === 'file').slice(0, 8);
  return [...rec.map((i) => ({ ...i, section: 'Recent' as const })), ...sug.map((i) => ({ ...i, section: 'Suggested' as const })), ...files.map((i) => ({ ...i, section: 'Files' as const })), ...rest.map((i) => ({ ...i, section: 'Commands' as const }))];
}

