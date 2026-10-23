/**
 * AI autocomplete: the grey text that appears as you type and Tab accepts.
 * Works with any chat model (no special fill-in-the-middle endpoint needed):
 * the model sees the code before and after the cursor, a little of the other
 * open files, and is asked for exactly the text that belongs at the cursor.
 * Its answer is then cleaned up — code fences dropped, any echo of the code
 * already before the cursor removed, and anything that would duplicate the
 * code after it cut — so what shows is only what is missing. Pure; the editor
 * side is in workspace/autocomplete.ts.
 */

export interface CompletionRequest {
  path: string;
  /** Monaco language id */
  language: string;
  /** Text before the cursor */
  prefix: string;
  /** Text after the cursor */
  suffix: string;
  /** A few other project files, for names and types the code uses */
  related?: { path: string; text: string }[];
}

/** How much context to send: enough to know the file, small enough to answer in a few hundred ms */
const PREFIX_CHARS = 6000;
const SUFFIX_CHARS = 2000;
const RELATED_CHARS = 2500;
const CURSOR = '<CURSOR/>';

export const COMPLETION_SYSTEM = `You are a code completion engine inside an editor. You are shown a file with ${CURSOR} where the cursor is.
Reply with ONLY the text to insert at the cursor: no explanation, no markdown, no code fences, and never repeat code that is already before or after the cursor.
Complete the current statement or line; continue with a few more lines only when the next lines are obvious (the rest of a function body, a closing bracket the code needs, the next case of a pattern).
Match the file's style, indentation and naming exactly. If nothing useful belongs at the cursor, reply with nothing.`;

/** The user message: related files for context, then the file with the cursor marked */
export function completionPrompt(req: CompletionRequest): string {
  const prefix = req.prefix.slice(-PREFIX_CHARS);
  const suffix = req.suffix.slice(0, SUFFIX_CHARS);
  const related = (req.related ?? [])
    .filter((r) => r.path !== req.path)
    .slice(0, 3)
    .map((r) => `--- ${r.path} (for reference) ---\n${r.text.slice(0, RELATED_CHARS)}`)
    .join('\n\n');
  return `${related ? `${related}\n\n` : ''}--- ${req.path} (${req.language}) ---\n${prefix}${CURSOR}${suffix}`;
}

/** The longest end of `a` that is also a start of `b` */
function overlap(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let n = max; n > 0; n--) if (a.endsWith(b.slice(0, n))) return n;
  return 0;
}

/**
 * Turn a model's answer into the text to insert: no fences or cursor marker, no echo of the line being typed,
 * nothing that is already after the cursor, and at most `maxLines` lines.
 */
export function cleanCompletion(raw: string, prefix: string, suffix: string, maxLines = 12): string {
  let text = raw.replace(/\r\n?/g, '\n');
  // Fenced answers: keep the inside of the first fence
  const fence = text.match(/```[\w+-]*\n([\s\S]*?)(?:```|$)/);
  if (fence) text = fence[1];
  text = text.replaceAll(CURSOR, '');
  // Models sometimes restate the current line (or more) before continuing it
  const lineStart = prefix.slice(prefix.lastIndexOf('\n') + 1);
  if (lineStart.trim() && text.startsWith(lineStart)) text = text.slice(lineStart.length);
  else {
    const echo = overlap(prefix.slice(-400), text);
    if (echo >= 4) text = text.slice(echo);
    else {
      // The model restated the end of the line, re-indented: "  return items.reduce(…" after "} return items.re"
      const trimmed = text.replace(/^[ \t]+/, '');
      const line = lineStart.trimStart();
      for (let n = line.length; n >= 4; n--) {
        const tail = line.slice(-n);
        if (trimmed.startsWith(tail) && (n === line.length || !/\w/.test(line[line.length - n - 1]))) {
          text = trimmed.slice(n);
          break;
        }
      }
    }
  }
  // Drop what the code after the cursor already has
  const restOfLine = suffix.split('\n')[0];
  if (restOfLine.trim() && text.endsWith(restOfLine)) text = text.slice(0, -restOfLine.length);
  const nextLines = suffix.replace(/^[^\n]*\n?/, '');
  const lines = text.split('\n');
  const firstNext = nextLines.split('\n').find((l) => l.trim());
  if (firstNext) {
    const at = lines.findIndex((l, i) => i > 0 && l.trim() === firstNext.trim());
    if (at > 0) lines.length = at;
  }
  if (lines.length > maxLines) lines.length = maxLines;
  text = lines.join('\n');
  // A completion that is only whitespace, or ends in a dangling newline, adds nothing useful
  text = text.replace(/\s+$/, (ws) => (ws.includes('\n') && text.trim() ? '' : ws));
  return text.trim() ? text : '';
}

/** When to ask: not in the middle of a word, not on an empty file, not right after the cursor moved with nothing typed */
export function shouldComplete(prefix: string, suffix: string): boolean {
  if (!prefix.trim()) return false;
  const nextChar = suffix[0] ?? '';
  // Mid-word: the editor's normal suggestions are better there
  if (/\w/.test(nextChar)) return false;
  const line = prefix.slice(prefix.lastIndexOf('\n') + 1);
  // Inside a line comment that just started, wait for a word
  if (/\/\/\s*$|#\s*$/.test(line)) return false;
  return true;
}

/** A small cache, keyed by what the model would see near the cursor, so retyping the same thing is instant */
export class CompletionCache {
  private map = new Map<string, string>();
  private size: number;
  constructor(size = 50) {
    this.size = size;
  }
  static key(req: CompletionRequest): string {
    return `${req.path}\n${req.prefix.slice(-400)}\u0000${req.suffix.slice(0, 120)}`;
  }
  get(key: string): string | undefined {
    const v = this.map.get(key);
    if (v !== undefined) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, value: string) {
    this.map.set(key, value);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
}

/** Files worth showing the model: the ones this file imports, by relative path, then recently edited ones */
export function relatedFiles(path: string, files: Record<string, string>, limit = 3): { path: string; text: string }[] {
  const text = files[path] ?? '';
  const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const imported: string[] = [];
  for (const m of text.matchAll(/(?:from|import|require\()\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const parts = [...(dir ? dir.split('/') : []), ...m[1].split('/')];
    const stack: string[] = [];
    for (const p of parts) {
      if (p === '..') stack.pop();
      else if (p !== '.') stack.push(p);
    }
    const base = stack.join('/').replace(/\.(js|mjs|cjs)$/, '');
    const hit = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}.py`].find((p) => p in files);
    if (hit && !imported.includes(hit)) imported.push(hit);
  }
  return imported.slice(0, limit).map((p) => ({ path: p, text: files[p] }));
}
