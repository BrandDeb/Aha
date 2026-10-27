/**
 * Project memory: what the next run (or a newcomer) should know about this codebase, kept in .aha/memory.md and
 * travelling with the project. Three kinds: decisions (what was chosen and why), conventions (how things are done
 * here) and gotchas (what bites). The agent adds to it with the remember tool, as part of a proposal you review; it
 * reads it before every task and cites the entries that shaped its work as [m3], so you can see where a choice came
 * from. You can edit the file like any other. Pure.
 */

export const MEMORY_FILE = '.aha/memory.md';

export type MemoryKind = 'decision' | 'convention' | 'gotcha';

export interface MemoryEntry {
  id: string;
  kind: MemoryKind;
  text: string;
  /** "2026-10-27", when it was written down */
  date?: string;
}

const SECTIONS: Record<MemoryKind, string> = { decision: 'Decisions', convention: 'Conventions', gotcha: 'Gotchas' };
const KIND_OF: Record<string, MemoryKind> = { decisions: 'decision', conventions: 'convention', gotchas: 'gotcha' };
const ENTRY = /^\s*[-*]\s+\[(m\d+)\]\s+(.+?)\s*$/;
const DATED = /^(.*?)\s*\((\d{4}-\d{2}-\d{2})\)$/;
const MAX_TEXT = 300;
const MAX_ENTRIES = 80;
const MAX_PROMPT = 5000;

const HEADER = `# Project memory

What the next run, or someone new to this project, should know. The agent reads it before every task and cites
entries like [m1] when they shape its work. Edit it like any other file.
`;

export function parseMemory(text: string | undefined): MemoryEntry[] {
  if (!text) return [];
  const out: MemoryEntry[] = [];
  let kind: MemoryKind | null = null;
  for (const line of text.split('\n')) {
    const heading = /^##\s+(\w+)/.exec(line);
    if (heading) {
      kind = KIND_OF[heading[1].toLowerCase()] ?? null;
      continue;
    }
    const m = ENTRY.exec(line);
    if (!m || !kind) continue;
    const dated = DATED.exec(m[2]);
    out.push({ id: m[1], kind, text: dated ? dated[1] : m[2], ...(dated ? { date: dated[2] } : {}) });
  }
  return out;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Where a new entry of this kind goes: after the last line of its section, or a new section at the end */
function insertEntry(text: string, kind: MemoryKind, line: string): string {
  const lines = text.replace(/\s+$/, '').split('\n');
  const start = lines.findIndex((l) => KIND_OF[(/^##\s+(\w+)/.exec(l)?.[1] ?? '').toLowerCase()] === kind);
  if (start < 0) return `${lines.join('\n')}\n\n## ${SECTIONS[kind]}\n\n${line}\n`;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // After the section's last entry (free text in the section stays below it), or under the heading
  let last = -1;
  for (let i = start + 1; i < end; i++) if (ENTRY.test(lines[i])) last = i;
  if (last >= 0) lines.splice(last + 1, 0, line);
  else lines.splice(start + 1, 0, '', line);
  return `${lines.join('\n')}\n`;
}

/** The file with one more entry, everything else in it kept; the same thing said twice keeps the first */
export function addMemory(text: string | undefined, kind: MemoryKind, said: string, date?: string): { text: string; id: string; added: boolean } | { error: string } {
  const clean = said.replace(/\s+/g, ' ').trim();
  if (clean.length < 8) return { error: 'Say it in a full sentence.' };
  if (clean.length > MAX_TEXT) return { error: `Keep it under ${MAX_TEXT} characters: one fact per entry.` };
  if (!(kind in SECTIONS)) return { error: 'kind must be decision, convention or gotcha.' };
  const entries = parseMemory(text);
  const same = entries.find((e) => normalize(e.text) === normalize(clean));
  if (same) return { text: text!, id: same.id, added: false };
  if (entries.length >= MAX_ENTRIES) return { error: `Memory holds ${MAX_ENTRIES} entries: remove or merge some in ${MEMORY_FILE} first.` };
  const highest = Math.max(0, ...[...(text ?? '').matchAll(/\[m(\d+)\]/g)].map((m) => Number(m[1])));
  const id = `m${highest + 1}`;
  return { text: insertEntry(text?.trim() ? text : HEADER, kind, `- [${id}] ${clean}${date ? ` (${date})` : ''}`), id, added: true };
}

/** The section of the agent's system prompt */
export function memoryPrompt(entries: MemoryEntry[]): string {
  if (!entries.length) return '';
  let body = '';
  for (const kind of Object.keys(SECTIONS) as MemoryKind[]) {
    const list = entries.filter((e) => e.kind === kind);
    if (list.length) body += `${SECTIONS[kind]}:\n${list.map((e) => `[${e.id}] ${e.text}`).join('\n')}\n`;
  }
  if (body.length > MAX_PROMPT) body = `${body.slice(0, MAX_PROMPT)}\n… (more in ${MEMORY_FILE})`;
  return `Project memory (${MEMORY_FILE}): decisions, conventions and gotchas recorded on earlier tasks. Follow them unless the user asks otherwise. When an entry shapes what you do, cite its id in your final summary, for example "kept prices in cents [m2]".\n${body.trim()}`;
}

/** The entries a summary cites, in the order it cites them */
export function citedMemory(summary: string | undefined, entries: MemoryEntry[]): MemoryEntry[] {
  if (!summary || !entries.length) return [];
  const ids = [...new Set([...summary.matchAll(/\[(m\d+)\]/g)].map((m) => m[1]))];
  return ids.map((id) => entries.find((e) => e.id === id)).filter((e): e is MemoryEntry => !!e);
}
