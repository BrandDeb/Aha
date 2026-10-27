/**
 * Three-way merge of text, the way git does it: what changed between the common base and each side, line by line.
 * Changes in different places combine on their own; a place both sides changed differently is a conflict, kept with
 * the base and both versions so the conflict editor can show it. Pure, so it is tested directly.
 */

/** Pairs of equal lines (index in a, index in b), in order: Myers' O(ND) diff */
export function matchLines(a: string[], b: string[]): [number, number][] {
  // Trim the common start and end first: most edits are small, and this keeps the search short
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const head: [number, number][] = Array.from({ length: start }, (_, i) => [i, i]);
  const tail: [number, number][] = Array.from({ length: a.length - endA }, (_, i) => [endA + i, endB + i]);
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const n = A.length;
  const m = B.length;
  if (!n || !m) return [...head, ...tail];

  const max = n + m;
  const offset = max;
  const v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1]) ? v[offset + k + 1] : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }
  // Walk back through the saved frontiers to recover the matched lines
  const pairs: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d--) {
    const vd = trace[d];
    const k = x - y;
    const prevK = k === -d || (k !== d && vd[offset + k - 1] < vd[offset + k + 1]) ? k + 1 : k - 1;
    const prevX = d === 0 ? 0 : vd[offset + prevK];
    const prevY = d === 0 ? 0 : prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      pairs.push([x + start, y + start]);
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  pairs.reverse();
  return [...head, ...pairs, ...tail];
}

export type MergeChunk = { kind: 'same'; lines: string[] } | { kind: 'conflict'; base: string[]; ours: string[]; theirs: string[] };

const equal = (a: string[], b: string[]) => a.length === b.length && a.every((l, i) => l === b[i]);

/** Split into lines, keeping whether the text ended with a newline */
const lines = (text: string) => (text === '' ? [] : text.replace(/\r\n/g, '\n').split('\n'));

/**
 * Merge `ours` and `theirs`, both changed from `base`. The chunks join back into the result; conflicts are the
 * places both sides changed differently.
 */
export function merge3(base: string, ours: string, theirs: string): MergeChunk[] {
  const B = lines(base);
  const O = lines(ours);
  const T = lines(theirs);
  // For each base line, where it is in ours and theirs (-1 when that side changed it)
  const inOurs = new Int32Array(B.length).fill(-1);
  const inTheirs = new Int32Array(B.length).fill(-1);
  for (const [b, o] of matchLines(B, O)) inOurs[b] = o;
  for (const [b, t] of matchLines(B, T)) inTheirs[b] = t;

  const chunks: MergeChunk[] = [];
  const push = (chunk: MergeChunk) => {
    const last = chunks.at(-1);
    if (chunk.kind === 'same' && last?.kind === 'same') last.lines.push(...chunk.lines);
    else if (chunk.kind === 'same' && !chunk.lines.length) return;
    else chunks.push(chunk);
  };
  // An unstable region between stable lines: decide it like git does
  const region = (b0: number, b1: number, o0: number, o1: number, t0: number, t1: number) => {
    const base = B.slice(b0, b1);
    const ours = O.slice(o0, o1);
    const theirs = T.slice(t0, t1);
    if (!base.length && !ours.length && !theirs.length) return;
    if (equal(ours, base)) push({ kind: 'same', lines: theirs });
    else if (equal(theirs, base)) push({ kind: 'same', lines: ours });
    else if (equal(ours, theirs)) push({ kind: 'same', lines: ours });
    else push({ kind: 'conflict', base, ours, theirs });
  };

  let b = 0;
  let o = 0;
  let t = 0;
  for (let i = 0; i < B.length; i++) {
    // A stable line: unchanged on both sides, and not before where either side has got to
    if (inOurs[i] < o || inTheirs[i] < t) continue;
    region(b, i, o, inOurs[i], t, inTheirs[i]);
    push({ kind: 'same', lines: [B[i]] });
    b = i + 1;
    o = inOurs[i] + 1;
    t = inTheirs[i] + 1;
  }
  region(b, B.length, o, O.length, t, T.length);
  return chunks;
}

export type Resolution = 'ours' | 'theirs' | 'both' | 'base';

/** The merged text: each conflict resolved as chosen, or written with git-style markers when not yet */
export function joinMerge(chunks: MergeChunk[], choices: (Resolution | undefined)[] = [], labels = { ours: 'yours', theirs: 'theirs' }): string {
  const out: string[] = [];
  let c = 0;
  for (const chunk of chunks) {
    if (chunk.kind === 'same') {
      out.push(...chunk.lines);
      continue;
    }
    const choice = choices[c++];
    if (choice === 'ours') out.push(...chunk.ours);
    else if (choice === 'theirs') out.push(...chunk.theirs);
    else if (choice === 'both') out.push(...chunk.ours, ...chunk.theirs);
    else if (choice === 'base') out.push(...chunk.base);
    else out.push(`<<<<<<< ${labels.ours}`, ...chunk.ours, '=======', ...chunk.theirs, `>>>>>>> ${labels.theirs}`);
  }
  return out.join('\n');
}

export const conflictCount = (chunks: MergeChunk[]) => chunks.filter((c) => c.kind === 'conflict').length;
export const hasMarkers = (text: string) => /^(<<<<<<<|=======|>>>>>>>)( |$)/m.test(text);

export interface FileMerge {
  path: string;
  chunks: MergeChunk[];
}

export interface ProjectMerge {
  /** Every file after the merge; conflicted files hold git-style markers until resolved */
  files: Record<string, string>;
  /** Files deleted by the merge */
  removed: string[];
  conflicts: FileMerge[];
  /** Files that took the other side's changes, merged both, or kept yours */
  summary: { theirs: string[]; merged: string[]; ours: string[] };
}

/**
 * Merge whole projects. `base` is what both started from (the last pull), `ours` the workspace, `theirs` the
 * branch now. A file deleted on one side and changed on the other is a conflict (keep it or delete it).
 */
export function mergeProjects(base: Record<string, string>, ours: Record<string, string>, theirs: Record<string, string>): ProjectMerge {
  const files: Record<string, string> = {};
  const removed: string[] = [];
  const conflicts: FileMerge[] = [];
  const summary = { theirs: [] as string[], merged: [] as string[], ours: [] as string[] };
  const paths = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]);
  for (const path of [...paths].sort()) {
    const b = base[path];
    const o = ours[path];
    const t = theirs[path];
    if (o === t) {
      if (o === undefined) removed.push(path);
      else files[path] = o;
      continue;
    }
    if (o === b) {
      // Only they changed it
      if (t === undefined) removed.push(path);
      else files[path] = t;
      summary.theirs.push(path);
      continue;
    }
    if (t === b) {
      if (o === undefined) removed.push(path);
      else files[path] = o;
      summary.ours.push(path);
      continue;
    }
    // Both changed it
    if (o === undefined || t === undefined) {
      const kept = (o ?? t) as string;
      const chunks: MergeChunk[] = [{ kind: 'conflict', base: lines(b ?? ''), ours: lines(o ?? ''), theirs: lines(t ?? '') }];
      conflicts.push({ path, chunks });
      files[path] = kept;
      continue;
    }
    const chunks = merge3(b ?? '', o, t);
    if (conflictCount(chunks)) {
      conflicts.push({ path, chunks });
      files[path] = joinMerge(chunks);
    } else {
      files[path] = joinMerge(chunks);
      summary.merged.push(path);
    }
  }
  return { files, removed, conflicts, summary };
}
