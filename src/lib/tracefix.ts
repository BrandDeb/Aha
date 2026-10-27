/**
 * Production to fix: a stack trace, a log excerpt or a Sentry issue link pasted from production becomes a task for
 * the agent. The frames are mapped to the project's files, and the agent is told to reproduce the error with a
 * failing test first, then fix it and show the same test passing. The test stays, so the error can't come back
 * unnoticed. Pure: shared by the browser and the tests.
 */

import { excerpt, headline, parseLocations, type SourceLocation } from './debug.ts';

export type TraceKind = 'python' | 'node' | 'log';

export interface PastedTrace {
  kind: TraceKind;
  /** The error itself, one line */
  title: string;
  /** Project frames, innermost (where it was raised) first */
  frames: SourceLocation[];
  /** A Sentry issue the text links to */
  sentry?: { url: string; issue: string };
  /** The pasted text, trimmed to what the agent needs */
  text: string;
}

const MAX_TEXT = 8000;
const SENTRY_URL = /https:\/\/(?:[\w-]+\.)?sentry\.io\/(?:organizations\/[\w-]+\/)?issues\/([\w-]+)\/?[^\s)>\]]*/i;
const PYTHON = /Traceback \(most recent call last\)|^\s*File "[^"]+", line \d+/m;
const NODE = /^\s+at (?:[\w$.<>[\]]+ )?\(?(?:file:\/\/)?[^\s()]+?\.[cm]?[jt]sx?:\d+:\d+\)?/m;

/** Which language the trace came from */
export function traceKind(text: string): TraceKind {
  if (PYTHON.test(text)) return 'python';
  if (NODE.test(text)) return 'node';
  return 'log';
}

/** The error line a Node stack starts with ("TypeError: …"), which the general headline rules can miss */
function nodeError(text: string): string | undefined {
  const line = text.split('\n').map((l) => l.trim()).find((l) => /^(?:Uncaught )?[\w$.]*(?:Error|Exception)\b(?: \[[\w-]+\])?:/.test(l));
  return line && (line.length > 200 ? `${line.slice(0, 197)}…` : line);
}

export function parseTrace(text: string, projectPaths: string[]): PastedTrace {
  const trimmed = text.replace(/\r\n/g, '\n').trim();
  const kind = traceKind(trimmed);
  const found = parseLocations(trimmed, projectPaths);
  // Python prints the outermost call first and the raise last; Node prints the raise first
  const frames = kind === 'python' ? [...found].reverse() : found;
  const link = SENTRY_URL.exec(trimmed);
  const body = link && trimmed.replace(link[0], '').trim() === '' ? '' : trimmed;
  return {
    kind,
    title: body ? (kind === 'node' && nodeError(body)) || headline(body) : `Sentry issue ${link![1]}`,
    frames,
    ...(link ? { sentry: { url: link[0], issue: link[1] } } : {}),
    text: trimmed.length > MAX_TEXT ? `${trimmed.slice(0, 2000)}\n…\n${trimmed.slice(-(MAX_TEXT - 2000))}` : trimmed,
  };
}

/** Where the reproducing test goes: beside the module, so a plain import finds it, named as each ecosystem expects */
export function testPathFor(module: string, kind: TraceKind): string {
  const slash = module.lastIndexOf('/');
  const dir = slash >= 0 ? module.slice(0, slash + 1) : '';
  const name = module.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  if (kind === 'python' || ext === '.py') return `${dir}test_${stem}.py`;
  return `${dir}${stem}.test${ext || '.js'}`;
}

/** How to write and run the test, per language */
function testMethod(kind: TraceKind, testPath: string | null): string[] {
  const where = testPath ? `\`${testPath}\`` : 'a test file beside the module that fails';
  if (kind === 'python') {
    return [
      `Write ${where} with unittest: import the module, call the failing code with the input the trace shows (or the smallest input that triggers it), and assert the correct behaviour. End the file with \`if __name__ == '__main__': unittest.main()\` so it runs on its own.`,
      `Run it with the python tool (action "run", entry ${testPath ? `"${testPath}"` : 'the test file'}).`,
    ];
  }
  return [
    `Write ${where} with node:test and node:assert: import the module, call the failing code with the input the trace shows (or the smallest input that triggers it), and assert the correct behaviour. A node:test file runs its tests when it is run directly.`,
    `Run it with run_code (entry ${testPath ? `"${testPath}"` : 'the test file'}).`,
  ];
}

export interface TraceBriefOptions {
  /** The Sentry connector is connected, so its tools are there for the agent */
  sentryConnected?: boolean;
}

/** The agent's task: reproduce with a failing test, fix, show the test passing */
export function traceBrief(trace: PastedTrace, files: Record<string, string>, options: TraceBriefOptions = {}): string {
  const parts: string[] = [];
  const language = trace.kind === 'python' ? ' (Python)' : trace.kind === 'node' ? ' (Node.js)' : '';
  parts.push(`Fix this production error${language}: ${trace.title}`);
  if (trace.sentry) {
    parts.push(
      options.sentryConnected
        ? `It is Sentry issue ${trace.sentry.issue} (${trace.sentry.url}). First use the Sentry connector's tools to read the issue: the full stack trace, the request or input that caused it, how often it happens and since which release.`
        : `It links to Sentry issue ${trace.sentry.issue} (${trace.sentry.url}), but the Sentry connector is not connected, so work from the text below. Say in your summary that connecting Sentry (Connectors panel) would give the full event.`
    );
  }
  if (trace.text && !(trace.sentry && trace.text === trace.sentry.url)) parts.push(`What was pasted:\n\`\`\`\n${trace.text}\n\`\`\``);
  const located = trace.frames.filter((f) => f.file in files).slice(0, 5);
  if (located.length) {
    parts.push(`The frames in this project, where it was raised first:\n${located.map((l) => `${l.file}:${l.line}\n\`\`\`\n${excerpt(files[l.file], l.line)}\n\`\`\``).join('\n')}`);
  } else {
    parts.push('None of the frames match a file in this project by path. Search the project for the function names and messages in the text to find the code.');
  }
  const kind: TraceKind = trace.kind !== 'log' ? trace.kind : located.some((l) => l.file.endsWith('.py')) ? 'python' : 'node';
  const testPath = located[0] ? testPathFor(located[0].file, kind) : null;
  const [write, run] = testMethod(kind, testPath);
  parts.push(
    [
      'Method:',
      '1. Understand: read the frames above and the code around them until you know which input makes it fail.',
      `2. Reproduce with a test, before changing any code. ${write}`,
      `3. ${run} Show that it fails with the same error as production. If it passes, the test does not reproduce the bug yet: change it until it does.`,
      '4. Fix the root cause with the smallest change; make no unrelated edits.',
      '5. Run the same test again and show that it passes. Keep the test in the project.',
      'Finish with three short lines: the root cause, the fix, and the test that proves it (failing before, passing after).',
    ].join('\n')
  );
  return parts.join('\n\n');
}
