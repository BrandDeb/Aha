/**
 * Debugging, made autonomous: every failure (a build, a run in any language,
 * a Python traceback, the preview's runtime errors, a dev server that won't
 * start) becomes a structured Failure: a headline, the project files and
 * lines it points at, and what changed since the code last worked. From that,
 * debugBrief() writes the task for the agent, which reproduces the failure,
 * finds the root cause, fixes it and proves the fix by running it again.
 *
 * Pure: shared by the browser and the tests.
 */

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export type FailureSource = 'build' | 'run' | 'python' | 'preview' | 'devserver';

export interface Failure {
  source: FailureSource;
  /** One line: the error itself ("TypeError: x is undefined", "error[E0308]: mismatched types") */
  title: string;
  /** The tail of the output, for the agent */
  output: string;
  language?: string;
  /** Project files and lines the output points at, most specific first */
  locations: SourceLocation[];
  /** Stable across repeats of the same failure: auto-debug starts once per signature */
  signature: string;
  at: number;
}

const MAX_OUTPUT = 6000;

// Where errors point, across toolchains. Each yields [path, line, column?].
const PATTERNS: RegExp[] = [
  /File "([^"]+)", line (\d+)/g, // Python tracebacks
  /\bat (?:[\w$.<>[\]]+ )?\(?((?:file:\/\/)?[^\s()]+?\.(?:[cm]?[jt]sx?)):(\d+):(\d+)\)?/g, // Node and browser stacks
  /-->\s+([^\s:]+):(\d+):(\d+)/g, // Rust, Solidity (forge), Cairo, Move
  /panicked at ([^\s:]+):(\d+):(\d+)/g, // Rust panics
  /\(([\w$]+\.(?:java|kt|scala|groovy|clj)):(\d+)\)/g, // JVM stack frames
  /\bin (\S+\.cs):line (\d+)/g, // .NET stack frames
  /([\w./\\-]+\.(?:cs|fs|vb))\((\d+),(\d+)\)/g, // MSBuild: Program.cs(12,5)
  /([\w./\\-]+\.tsx?)\((\d+),(\d+)\)/g, // tsc: file.ts(12,5)
  /\bin (\S+\.php) on line (\d+)/g, // PHP
  /([\w./@+\\-]+\.[A-Za-z]{1,6}):(\d+)(?::(\d+))?/g, // the common file:line:col (gcc, clang, go, tsc, scriptc, swift, ruby, zig…)
];

const ABSOLUTE_NOISE = /node_modules|\/rustc\/|\/usr\/(?:lib|include|share)|\/lib\/python|site-packages|<anonymous>|internal\/|\.cargo\/registry|\/go\/pkg\/mod|esm\.sh/;

/** Match a path from tool output to a project file: exact, by suffix (absolute paths of the run folder), then by a unique basename */
export function projectPathFor(candidate: string, projectPaths: string[]): string | null {
  const cleaned = candidate.replace(/^file:\/\//, '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/[?#].*$/, '');
  if (projectPaths.includes(cleaned)) return cleaned;
  const bySuffix = projectPaths.filter((p) => cleaned.endsWith(`/${p}`));
  if (bySuffix.length) return bySuffix.sort((a, b) => b.length - a.length)[0];
  if (ABSOLUTE_NOISE.test(cleaned)) return null;
  const name = cleaned.slice(cleaned.lastIndexOf('/') + 1);
  const byName = projectPaths.filter((p) => p === name || p.endsWith(`/${name}`));
  return byName.length === 1 ? byName[0] : null;
}

/** The project locations an error output points at, deduplicated, in order of appearance */
export function parseLocations(output: string, projectPaths: string[]): SourceLocation[] {
  const found: (SourceLocation & { at: number })[] = [];
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of output.matchAll(pattern)) {
      const file = projectPathFor(match[1], projectPaths);
      const line = Number(match[2]);
      if (!file || !line) continue;
      found.push({ file, line, column: match[3] ? Number(match[3]) : undefined, at: match.index ?? 0 });
    }
  }
  const seen = new Set<string>();
  return found
    .sort((a, b) => a.at - b.at)
    .filter((l) => {
      const key = `${l.file}:${l.line}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12)
    .map(({ file, line, column }) => ({ file, line, ...(column ? { column } : {}) }));
}

/** The line that says what went wrong */
export function headline(output: string): string {
  const lines = output.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  const pick =
    // Python: the last line of a traceback is the exception
    (lines.some((l) => l.startsWith('Traceback (most recent call last)')) && lines.reverse().find((l) => /^[A-Za-z_][\w.]*(Error|Exception|Interrupt|Exit)\b/.test(l))) ||
    lines.find((l) => /^(error(\[E\d+\])?|fatal error|panic|thread '.*' panicked|Uncaught|Unhandled|Exception|FAIL|\[FAIL)/i.test(l)) ||
    // "file:line:col: message" (esbuild, gcc, clang, go, swift…): the message, after the location
    lines.find((l) => /^[\w./@+-]+\.[A-Za-z]{1,6}:\d+(?::\d+)?:?\s+(?:error:\s*)?\S/.test(l))?.replace(/^[\w./@+-]+\.[A-Za-z]{1,6}:\d+(?::\d+)?:?\s+/, '') ||
    lines.find((l) => /\b(error|exception|panic|failed|cannot|undefined|not found|unexpected)\b/i.test(l)) ||
    lines[lines.length - 1] ||
    'The program failed';
  return pick.length > 200 ? `${pick.slice(0, 197)}…` : pick;
}

/** Same failure, same signature: the headline without numbers and paths, plus where it happened */
export function failureSignature(source: FailureSource, title: string, locations: SourceLocation[]): string {
  const normalized = title.replace(/0x[0-9a-f]+/gi, '#').replace(/\d+/g, '#').replace(/(['"`]).*?\1/g, '"…"').toLowerCase();
  const where = locations[0] ? `${locations[0].file}` : '';
  let h = 0x811c9dc5;
  for (const ch of `${source}|${normalized}|${where}`) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(36);
}

export function makeFailure(source: FailureSource, output: string, projectPaths: string[], language?: string, now = Date.now()): Failure {
  const tail = output.length > MAX_OUTPUT ? `…${output.slice(-MAX_OUTPUT)}` : output;
  const locations = parseLocations(output, projectPaths);
  const title = headline(output);
  return { source, title, output: tail, language, locations, signature: failureSignature(source, title, locations), at: now };
}

// ---------------------------------------------------------------------------
// What changed since it last worked
// ---------------------------------------------------------------------------

export interface FileChangeSummary {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
  /** A compact unified-style diff (- old, + new), trimmed */
  diff: string;
}

/** Line diff by longest common subsequence; files too large for that are summarised */
export function lineDiff(before: string, after: string, maxLines = 40): string {
  const a = before.split('\n');
  const b = after.split('\n');
  if (a.length * b.length > 250_000) return `(${a.length} → ${b.length} lines; too large to diff here)`;
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (i < a.length && (j >= b.length || dp[i + 1][j] >= dp[i][j + 1])) out.push(`${String(i + 1).padStart(4)} - ${a[i++]}`);
    else out.push(`${String(j + 1).padStart(4)} + ${b[j++]}`);
    if (out.length >= maxLines) {
      out.push('     … (more changes)');
      break;
    }
  }
  return out.join('\n');
}

export function changesSince(lastGood: Record<string, string> | null, files: Record<string, string>, maxFiles = 8): FileChangeSummary[] {
  if (!lastGood) return [];
  const changes: FileChangeSummary[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!(path in lastGood)) changes.push({ path, kind: 'added', diff: lineDiff('', content, 15) });
    else if (lastGood[path] !== content) changes.push({ path, kind: 'modified', diff: lineDiff(lastGood[path], content) });
  }
  for (const path of Object.keys(lastGood)) if (!(path in files)) changes.push({ path, kind: 'deleted', diff: '' });
  return changes.slice(0, maxFiles);
}

// ---------------------------------------------------------------------------
// The agent's task
// ---------------------------------------------------------------------------

const SOURCE_LABEL: Record<FailureSource, string> = {
  build: 'The build failed',
  run: 'The program failed when run',
  python: 'The Python program failed',
  preview: 'The app failed in the preview',
  devserver: 'The dev server failed',
};

/** Lines around a location, numbered, for context */
export function excerpt(content: string, line: number, radius = 3): string {
  const lines = content.split('\n');
  const from = Math.max(1, line - radius);
  const to = Math.min(lines.length, line + radius);
  const out: string[] = [];
  for (let n = from; n <= to; n++) out.push(`${n === line ? '>' : ' '}${String(n).padStart(4)} | ${lines[n - 1]}`);
  return out.join('\n');
}

export function debugBrief(failure: Failure, files: Record<string, string>, lastGood: Record<string, string> | null): string {
  const parts: string[] = [];
  parts.push(`Debug and fix this. ${SOURCE_LABEL[failure.source]}${failure.language ? ` (${failure.language})` : ''}: ${failure.title}`);
  parts.push(`Output (tail):\n\`\`\`\n${failure.output.trim()}\n\`\`\``);
  const located = failure.locations.filter((l) => l.file in files).slice(0, 4);
  if (located.length) parts.push(`Where it points:\n${located.map((l) => `${l.file}:${l.line}${l.column ? `:${l.column}` : ''}\n\`\`\`\n${excerpt(files[l.file], l.line)}\n\`\`\``).join('\n')}`);
  const changes = changesSince(lastGood, files);
  if (lastGood && changes.length) {
    parts.push(`Changed since it last worked (the cause is often here):\n${changes.map((c) => `${c.kind} ${c.path}${c.diff ? `\n\`\`\`\n${c.diff}\n\`\`\`` : ''}`).join('\n')}`);
  } else if (lastGood) {
    parts.push('Nothing changed since it last worked: suspect the environment, input, or data rather than the code.');
  }
  parts.push(
    [
      'Method:',
      '1. Reproduce: run the same thing (build, run_program, run_code or python) and confirm you see this error. If it cannot run here (a browser-only error), reason from the output and the code.',
      '2. Locate: read the files and lines above, and the changes since it last worked.',
      '3. Find the root cause, not the symptom. If unsure, add temporary logging and run again.',
      '4. Fix it with the smallest change; make no unrelated edits, and remove temporary logging.',
      '5. Verify: run it again and show that it now works.',
      'Finish with three short lines: the root cause, the fix, and the evidence that it works.',
    ].join('\n')
  );
  return parts.join('\n\n');
}
