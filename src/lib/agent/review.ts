/**
 * A second pair of eyes: when the agent finishes, a separate reviewer reads
 * its proposal cold (the goal, the diff, the evidence, the project's
 * contracts) without the agent's reasoning or its tools, the way a colleague
 * reviews a pull request. It answers with a verdict and specific findings,
 * which show on the proposal and can go back to the agent in one click.
 * Pure: the prompt, the diff it reads, and parsing its answer.
 */

export interface ReviewFinding {
  severity: 'blocker' | 'major' | 'minor';
  file?: string;
  line?: number;
  issue: string;
  fix?: string;
}

export interface Review {
  verdict: 'approve' | 'concerns' | 'block';
  summary: string;
  findings: ReviewFinding[];
}

export const REVIEWER_PROMPT = `You are the reviewer in Aha!: a senior engineer reviewing a change another agent proposes, before the developer accepts it. You see the goal, the diff and the evidence the agent gathered (builds, runs, contract checks). You did not write it; read it cold and skeptically.

Look for, in this order:
1. Bugs: wrong logic, off-by-one, unhandled errors or empty inputs, broken edge cases, wrong types, race conditions.
2. The goal: does the change actually do what was asked, completely, and nothing unrelated?
3. Safety: secrets in code, injection, unsafe deletion, network or filesystem calls the goal didn't call for.
4. Evidence: changed behaviour that nothing built, ran or tested; claims the evidence does not support.
5. The project's contracts, when given.
Ignore style unless it hides a bug. Do not invent problems: if the change is right, approve it.

Answer with JSON only, no prose around it:
{"verdict": "approve" | "concerns" | "block", "summary": "one sentence", "findings": [{"severity": "blocker" | "major" | "minor", "file": "path", "line": 12, "issue": "what is wrong and why it matters", "fix": "the concrete change"}]}
"block" = a blocker that must be fixed before accepting; "concerns" = worth fixing; "approve" = ship it (findings may still list minor notes). Line numbers refer to the new version of the file. At most 8 findings, most important first.`;

type Op = { kind: ' ' | '-' | '+'; text: string; a: number; b: number };

/** Line operations from before to after (longest common subsequence, with the common ends trimmed) */
function diffOps(before: string, after: string): Op[] {
  const a = before ? before.split('\n') : [];
  const b = after ? after.split('\n') : [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const ops: Op[] = [];
  for (let i = 0; i < start; i++) ops.push({ kind: ' ', text: a[i], a: i + 1, b: i + 1 });
  const n = endA - start;
  const m = endB - start;
  if (n * m > 4_000_000) {
    for (let i = start; i < endA; i++) ops.push({ kind: '-', text: a[i], a: i + 1, b: 0 });
    for (let j = start; j < endB; j++) ops.push({ kind: '+', text: b[j], a: 0, b: j + 1 });
  } else {
    const t = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = a[start + i] === b[start + j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    let i = 0;
    let j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        ops.push({ kind: ' ', text: a[start + i], a: start + i + 1, b: start + j + 1 });
        i++;
        j++;
      } else if (j >= m || (i < n && t[i + 1][j] >= t[i][j + 1])) {
        ops.push({ kind: '-', text: a[start + i], a: start + i + 1, b: 0 });
        i++;
      } else {
        ops.push({ kind: '+', text: b[start + j], a: 0, b: start + j + 1 });
        j++;
      }
    }
  }
  for (let i = endA, j = endB; i < a.length; i++, j++) ops.push({ kind: ' ', text: a[i], a: i + 1, b: j + 1 });
  return ops;
}

/** A unified diff with new-file line numbers on each line, so findings can point at them */
export function unifiedDiff(path: string, before: string, after: string, context = 3): string {
  const ops = diffOps(before, after);
  const changed = ops.map((o, i) => (o.kind !== ' ' ? i : -1)).filter((i) => i >= 0);
  if (!changed.length) return '';
  const keep = new Set<number>();
  for (const i of changed) for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) keep.add(k);
  const out = [`--- ${before ? path : '/dev/null'}`, `+++ ${after ? path : '/dev/null'}`];
  let last = -2;
  for (let i = 0; i < ops.length; i++) {
    if (!keep.has(i)) continue;
    if (i !== last + 1) out.push('@@');
    const o = ops[i];
    out.push(`${o.kind}${o.b ? String(o.b).padStart(4) : '    '} ${o.text}`);
    last = i;
  }
  return out.join('\n');
}

const MAX_DIFF = 40_000;

/** What the reviewer reads */
export function reviewInput(options: { goal: string; changes: { path: string; before: string; after: string }[]; evidence: string[]; contracts?: string[]; summary?: string }): string {
  let diff = '';
  for (const c of options.changes) {
    const d = unifiedDiff(c.path, c.before, c.after);
    if (!d) continue;
    if (diff.length + d.length > MAX_DIFF) {
      diff += `\n… (${c.path} and later files left out: the diff is too long)`;
      break;
    }
    diff += `${diff ? '\n\n' : ''}${d}`;
  }
  return [
    `Goal: ${options.goal}`,
    options.summary ? `The agent says: ${options.summary}` : '',
    `Evidence: ${options.evidence.join(' · ') || 'none'}`,
    options.contracts?.length ? `Project contracts (must stay true):\n${options.contracts.map((c) => `- ${c}`).join('\n')}` : '',
    `Diff (the number on each line is its line in the new file):\n${diff || '(no changes)'}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Read the reviewer's answer; a reply that isn't the JSON asked for becomes a "concerns" note rather than nothing */
export function parseReview(text: string): Review {
  const json = text.match(/\{[\s\S]*\}/)?.[0];
  try {
    const raw = JSON.parse(json ?? '') as Record<string, unknown>;
    const verdict = raw.verdict === 'approve' || raw.verdict === 'block' || raw.verdict === 'concerns' ? raw.verdict : 'concerns';
    const findings = (Array.isArray(raw.findings) ? raw.findings : [])
      .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object' && typeof (f as { issue?: unknown }).issue === 'string')
      .slice(0, 8)
      .map((f) => ({
        severity: f.severity === 'blocker' || f.severity === 'major' ? f.severity : 'minor',
        ...(typeof f.file === 'string' && f.file ? { file: f.file } : {}),
        ...(typeof f.line === 'number' && f.line > 0 ? { line: Math.round(f.line) } : {}),
        issue: String(f.issue).slice(0, 600),
        ...(typeof f.fix === 'string' && f.fix ? { fix: f.fix.slice(0, 600) } : {}),
      })) as ReviewFinding[];
    // A blocker finding is a block, whatever the verdict says
    const final = findings.some((f) => f.severity === 'blocker') ? 'block' : verdict;
    return { verdict: final, summary: typeof raw.summary === 'string' ? raw.summary.slice(0, 300) : '', findings };
  } catch {
    return { verdict: 'concerns', summary: text.trim().slice(0, 300) || 'The reviewer gave no answer.', findings: [] };
  }
}

/** The findings, as a follow-up for the agent */
export function reviewFollowUp(review: Review, only?: ReviewFinding[]): string {
  const findings = only ?? review.findings;
  return `A reviewer read your proposal and found:\n${findings
    .map((f, i) => `${i + 1}. [${f.severity}]${f.file ? ` ${f.file}${f.line ? `:${f.line}` : ''}` : ''}: ${f.issue}${f.fix ? `\n   Suggested fix: ${f.fix}` : ''}`)
    .join('\n')}\n\nAddress each one (or explain why it is not a problem), then verify again.`;
}

export const REVIEW_LABEL: Record<Review['verdict'], string> = { approve: 'Reviewer approves', concerns: 'Reviewer has concerns', block: 'Reviewer blocks' };
