/**
 * The worker: an AI teammate that codes alongside you. It looks at the project
 * the way a good colleague would (what is broken, what the editor flags, what
 * you said you are building, the TODOs you left, the code nobody tests), picks
 * the most useful next task, and does it in the background on a private copy.
 * Each result is a proposal with evidence; nothing reaches your files until
 * you accept it.
 *
 * Pure: finding and ranking tasks, and writing their briefs.
 */

export type WorkerTaskKind = 'failure' | 'problem' | 'focus' | 'todo' | 'tests';

export interface WorkerTask {
  /** Stable: the same task is never done twice */
  key: string;
  kind: WorkerTaskKind;
  /** What the queue and the proposal tab show */
  title: string;
  /** Why it is worth doing, in one line */
  reason: string;
  priority: number;
  /** The agent's task */
  brief: string;
}

export interface EditorProblem {
  file: string;
  line: number;
  message: string;
}

export interface WorkerContext {
  files: Record<string, string>;
  entry?: string;
  /** What the developer says they are building; the worker takes the next step toward it */
  focus?: string;
  /** Errors the editor shows (type errors and the like) */
  problems?: EditorProblem[];
  /** The latest failure, already turned into a debugging brief */
  failure?: { signature: string; title: string; brief: string } | null;
  /** How many focus steps were already taken, so each one gets a new key */
  focusSteps?: number;
}

const PRIORITY: Record<WorkerTaskKind, number> = { failure: 100, problem: 80, focus: 70, todo: 50, tests: 30 };

const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|scala|cs|fs|rb|php|swift|dart|c|cc|cpp|h|hpp|zig|ex|exs|erl|hs|ml|lua|r|jl|nim|cr|odin|d|sol|vy|move|cairo|vue|svelte|astro)$/i;
const TEST_FILE = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[^/]+$|_test\.go$|Test\.(java|kt)$|^test_.*\.py$|\/test_[^/]*\.py$|\.t\.sol$/i;
const GENERATED = /(^|\/)(node_modules|dist|build|out|target|\.next|vendor|\.venv)\//;

const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

const RULES = [
  'Keep the change small and focused on this task; do not refactor or reformat unrelated code.',
  'Match the style of the surrounding code.',
  'Verify your work: build, run or test it, and show that it passes.',
  'If the task turns out to be unnecessary or unsafe, change nothing and explain why.',
  'Finish with what you changed and the evidence that it works.',
].join('\n- ');

/** TODO / FIXME / HACK / XXX comments in code, with their text */
export function findTodos(files: Record<string, string>): { file: string; line: number; tag: string; text: string }[] {
  const found: { file: string; line: number; tag: string; text: string }[] = [];
  for (const [file, content] of Object.entries(files)) {
    if (!CODE.test(file) || GENERATED.test(file)) continue;
    content.split('\n').forEach((line, i) => {
      const match = /(?:\/\/|#|--|\/\*|\*|;;?|%)\s*(TODO|FIXME|HACK|XXX)\b[:\s(]*(.*)$/.exec(line);
      if (match && match[2].replace(/\*\/\s*$/, '').trim().length >= 3) found.push({ file, line: i + 1, tag: match[1], text: match[2].replace(/\*\/\s*$/, '').trim().slice(0, 160) });
    });
  }
  return found;
}

/** Source files with real logic and no test that mentions them */
export function untestedFiles(files: Record<string, string>, entry?: string): string[] {
  const paths = Object.keys(files).filter((p) => !GENERATED.test(p));
  const tests = paths.filter((p) => TEST_FILE.test(p));
  const testText = tests.map((t) => files[t]).join('\n');
  return paths
    .filter((p) => CODE.test(p) && !TEST_FILE.test(p) && !/\.(d\.ts|config\.[cm]?[jt]s)$/.test(p) && !/(^|\/)(vite|next|nuxt|svelte|astro|tailwind|eslint|postcss)\.config/.test(p))
    .filter((p) => {
      const content = files[p];
      // Worth testing: functions or classes, a little size
      return content.split('\n').length >= 8 && /\b(function|def|fn|func|class|=>)\b|=>/.test(content);
    })
    .filter((p) => {
      const stem = p.slice(p.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      return !testText.includes(stem);
    })
    .sort((a, b) => (a === entry ? 1 : b === entry ? -1 : files[b].length - files[a].length));
}

/** Every task worth doing now, most useful first */
export function discoverTasks(ctx: WorkerContext): WorkerTask[] {
  const tasks: WorkerTask[] = [];
  if (ctx.failure) {
    tasks.push({ key: `failure:${ctx.failure.signature}`, kind: 'failure', title: `Fix: ${ctx.failure.title.slice(0, 80)}`, reason: 'The last build or run failed', priority: PRIORITY.failure, brief: ctx.failure.brief });
  }

  const problems = (ctx.problems ?? []).filter((p) => p.file in ctx.files).slice(0, 20);
  if (problems.length) {
    const byFile = new Map<string, EditorProblem[]>();
    for (const p of problems) byFile.set(p.file, [...(byFile.get(p.file) ?? []), p]);
    for (const [file, list] of byFile) {
      tasks.push({
        key: `problem:${file}:${hash(list.map((p) => p.message).join('|'))}`,
        kind: 'problem',
        title: `Fix ${list.length} problem${list.length > 1 ? 's' : ''} in ${file}`,
        reason: 'The editor shows errors here',
        priority: PRIORITY.problem + Math.min(list.length, 9),
        brief: `Fix the errors the editor reports in ${file}:\n${list.map((p) => `- line ${p.line}: ${p.message}`).join('\n')}\n\nFix the cause, not the symptom (no casts to any, no ts-ignore unless there is truly no other way).\n- ${RULES}`,
      });
    }
  }

  const focus = ctx.focus?.trim();
  if (focus) {
    const step = ctx.focusSteps ?? 0;
    tasks.push({
      key: `focus:${hash(focus)}:${step}`,
      kind: 'focus',
      title: `Next step: ${focus.slice(0, 70)}`,
      reason: 'Toward what you said you are building',
      priority: PRIORITY.focus,
      brief: `The developer is building: ${focus}\n\nLook at the project, decide the single most valuable next step toward that goal that you can finish and verify now, and do it. Write your plan first (update_plan). Do one step, not the whole goal.\n- ${RULES}`,
    });
  }

  for (const todo of findTodos(ctx.files).slice(0, 8)) {
    tasks.push({
      key: `todo:${todo.file}:${hash(todo.text)}`,
      kind: 'todo',
      title: `${todo.tag}: ${todo.text.slice(0, 70)}`,
      reason: `${todo.file}:${todo.line}`,
      priority: PRIORITY.todo + (todo.tag === 'FIXME' ? 5 : 0),
      brief: `Resolve this ${todo.tag} in ${todo.file} (line ${todo.line}): "${todo.text}"\n\nImplement what it asks and remove the comment once it is done. If it can't be done safely without a decision from the developer, change nothing and say what decision is needed.\n- ${RULES}`,
    });
  }

  const untested = untestedFiles(ctx.files, ctx.entry).slice(0, 3);
  for (const file of untested) {
    tasks.push({
      key: `tests:${file}`,
      kind: 'tests',
      title: `Add tests for ${file}`,
      reason: 'No test covers it yet',
      priority: PRIORITY.tests,
      brief: `Add focused tests for ${file}: its main behaviour, edge cases and error handling, using the test setup the project already has (or the language's standard one if there is none). Do not change ${file} itself unless a test reveals a real bug; if it does, fix the bug and say so.\n- ${RULES}`,
    });
  }

  return tasks.sort((a, b) => b.priority - a.priority);
}

/** The next task: the most useful one not done or skipped yet */
export function nextTask(tasks: WorkerTask[], done: Set<string>): WorkerTask | null {
  return tasks.find((t) => !done.has(t.key)) ?? null;
}

/** How many tasks were started within the last hour */
export function recentCount(startedAt: number[], now = Date.now()): number {
  return startedAt.filter((t) => now - t < 60 * 60_000).length;
}
