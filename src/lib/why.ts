/**
 * Why-history: every line an accepted proposal wrote remembers why it is
 * there: the goal it served, who asked (you, the debugger, the worker), and
 * the evidence it shipped with. It lives in the project (.nanocli/why.json),
 * so it travels with the code and outlives the proposal. Lines are matched by
 * their text, not their number, so the reason stays attached while the code
 * around it moves. Pure.
 */

import { changedLines } from './live/coverage.ts';

export const WHY_FILE = '.nanocli/why.json';
const MAX_ENTRIES = 300;
const MAX_LINES_PER_FILE = 400;

export interface WhyEntry {
  id: string;
  /** When it was accepted */
  at: number;
  goal: string;
  /** What the agent said it did */
  summary?: string;
  origin?: 'you' | 'debug' | 'worker' | 'watcher';
  /** "Verified", "Breaks a contract"… at the moment it was accepted */
  verdict?: string;
  /** The second reviewer's verdict */
  review?: string;
  /** Per file: the lines it wrote, normalized */
  files: Record<string, string[]>;
}

/** The form a line is compared in: no indentation, single spaces */
export const normalizeLine = (line: string) => line.trim().replace(/\s+/g, ' ');

/** A line worth remembering: not blank, not a lone brace or bracket */
const meaningful = (line: string) => line.length >= 4 && /[A-Za-z0-9]/.test(line);

/** The lines a set of changes wrote, per file */
export function linesWritten(changes: { path: string; kind: string; before: string; after: string }[], isNoted: (path: string) => boolean = () => true): Record<string, string[]> {
  const files: Record<string, string[]> = {};
  for (const c of changes) {
    if (c.kind === 'deleted' || !isNoted(c.path) || c.path === WHY_FILE) continue;
    const after = c.after.split('\n');
    const lines = [...new Set(changedLines(c.kind === 'added' ? '' : c.before, c.after).map((n) => normalizeLine(after[n - 1] ?? '')).filter(meaningful))];
    if (lines.length) files[c.path] = lines.slice(0, MAX_LINES_PER_FILE);
  }
  return files;
}

export function parseWhy(text: string | undefined): WhyEntry[] {
  if (!text) return [];
  try {
    const data = JSON.parse(text) as { entries?: unknown };
    return (Array.isArray(data.entries) ? data.entries : []).filter(
      (e): e is WhyEntry => !!e && typeof e === 'object' && typeof (e as WhyEntry).goal === 'string' && typeof (e as WhyEntry).at === 'number' && !!(e as WhyEntry).files && typeof (e as WhyEntry).files === 'object'
    );
  } catch {
    return [];
  }
}

/** The why file with one more entry, newest first; oldest ones drop off past the limit */
export function recordWhy(text: string | undefined, entry: WhyEntry): string {
  const entries = [entry, ...parseWhy(text).filter((e) => e.id !== entry.id)].slice(0, MAX_ENTRIES);
  return `${JSON.stringify({ about: 'Why each line written by an accepted proposal is there (NanoCLI Studio). Safe to commit.', entries }, null, 1)}\n`;
}

/** For one file as it is now: which entry explains each line (the newest one that wrote it) */
export function whyByLine(entries: WhyEntry[], path: string, content: string): Map<number, WhyEntry> {
  const result = new Map<number, WhyEntry>();
  const relevant = entries.filter((e) => e.files[path]?.length);
  if (!relevant.length) return result;
  const index = new Map<string, WhyEntry>();
  // Oldest first, so the newest entry that wrote a line wins
  for (const e of [...relevant].reverse()) for (const line of e.files[path]) index.set(line, e);
  content.split('\n').forEach((raw, i) => {
    const line = normalizeLine(raw);
    if (!meaningful(line)) return;
    const entry = index.get(line);
    if (entry) result.set(i + 1, entry);
  });
  return result;
}

const ORIGIN: Record<NonNullable<WhyEntry['origin']>, string> = { you: 'you asked the agent', debug: 'the debugger', worker: 'the worker', watcher: 'a watcher' };

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** The hover text for a line */
export function describeWhy(entry: WhyEntry, now = Date.now()): string {
  const facts = [entry.origin ? ORIGIN[entry.origin] : null, `accepted ${ago(entry.at, now)}`, entry.verdict, entry.review].filter(Boolean).join(' · ');
  return `**Why this line:** ${entry.goal}\n\n${facts}${entry.summary ? `\n\n${entry.summary.slice(0, 400)}` : ''}`;
}
