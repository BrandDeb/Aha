/**
 * Evidence per change: run a proposal's version of the program with live
 * values and say, for the lines it changed, which ones actually ran (and what
 * they did) and which never did. A changed line nothing ran is a line nothing
 * checked. Pure.
 */

import { liveView } from './display.ts';
import type { LiveResult } from './shared.ts';

/** Lines of `after` (1-based) that are new or changed relative to `before` */
export function changedLines(before: string, after: string): number[] {
  const a = before.split('\n');
  const b = after.split('\n');
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  if (!midB.length) return [];
  if (!midA.length || midA.length * midB.length > 4_000_000) return midB.map((_, i) => start + i + 1);
  // Longest common subsequence over the middle: lines of b not in it are changed
  const n = midA.length;
  const m = midB.length;
  const table = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  }
  const changed: number[] = [];
  let i = 0;
  let j = 0;
  while (j < m) {
    if (i < n && midA[i] === midB[j]) {
      i++;
      j++;
    } else if (i < n && table[i + 1][j] >= table[i][j + 1]) i++;
    else {
      changed.push(start + j + 1);
      j++;
    }
  }
  return changed;
}

export interface ChangeCoverage {
  /** Changed lines that hold code and ran, with what they did */
  ran: { path: string; line: number; hits: number; text: string }[];
  /** Changed lines that hold code and never ran */
  unrun: { path: string; line: number }[];
  /** Changed files the trace does not cover (another language, or data) */
  untraced: string[];
}

/** Which of a proposal's changed lines ran in a live trace of its version of the project */
export function changeCoverage(changes: { path: string; kind: string; before: string; after: string }[], result: LiveResult): ChangeCoverage {
  const coverage: ChangeCoverage = { ran: [], unrun: [], untraced: [] };
  for (const change of changes) {
    if (change.kind === 'deleted') continue;
    const traced = result.files[change.path];
    if (!traced) {
      if (/\.(?:[cm]?[jt]sx?|py)$/.test(change.path)) coverage.untraced.push(change.path);
      continue;
    }
    const statements = new Set(traced.statementLines);
    const views = new Map(liveView(traced).lines.map((l) => [l.line, l.text]));
    for (const line of changedLines(change.kind === 'added' ? '' : change.before, change.after)) {
      // Only lines that hold a statement can run: a brace, a comment or a type is not evidence either way
      if (!statements.has(line)) continue;
      const data = traced.lines[line];
      if (data) coverage.ran.push({ path: change.path, line, hits: data.hits, text: views.get(line) ?? '' });
      else coverage.unrun.push({ path: change.path, line });
    }
  }
  return coverage;
}

/** One sentence for the proposal's header */
export function coverageHeadline(c: ChangeCoverage): string {
  const total = c.ran.length + c.unrun.length;
  if (!total) return c.untraced.length ? 'The changed code was not reached by a run' : 'No changed line holds code that runs';
  if (!c.unrun.length) return `All ${total} changed line${total === 1 ? '' : 's'} of code ran`;
  return `${c.ran.length} of ${total} changed lines ran; ${c.unrun.length} never did`;
}
