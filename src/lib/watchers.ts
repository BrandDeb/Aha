/**
 * Watchers: agents that wake on their own. A watcher is a task plus a trigger (a schedule, an interval, files
 * changing, or a failure). When it fires it either suggests the task or starts it as a background proposal.
 *
 * The rules that keep this useful rather than noisy, all here and all pure:
 * - one event, one run: every event has a key, and a key that already ran is ignored (idempotency);
 * - check the premise before acting: a failure that is already fixed, or changed files that are gone, is a skip;
 * - restraint is visible: every skip is logged with its reason, so silence can be read;
 * - a budget per day, and no new run while its last result still waits for review.
 *
 * Definitions live in the project (`.aha/watchers.json`) so they travel with it; run history stays in the browser.
 */

export const WATCHERS_FILE = '.aha/watchers.json';

export type WatcherTrigger =
  | { kind: 'schedule'; cron: string }
  | { kind: 'interval'; minutes: number }
  | { kind: 'change'; glob: string }
  | { kind: 'failure' };

export type WatcherMode = 'suggest' | 'act';

export interface Watcher {
  id: string;
  name: string;
  /** What the agent does when it fires */
  task: string;
  trigger: WatcherTrigger;
  /** Suggest: tell you, you start it. Act: start a background proposal you review */
  mode: WatcherMode;
  enabled: boolean;
  /** Runs started per day, at most */
  perDay: number;
}

export interface WatcherEvent {
  /** One run per key */
  key: string;
  /** What happened, in a sentence */
  summary: string;
  /** Files that changed (change trigger) */
  paths?: string[];
}

export type RunAction = 'started' | 'suggested' | 'skipped';

export interface WatcherRun {
  watcherId: string;
  at: number;
  key: string;
  event: string;
  action: RunAction;
  /** Why it acted, or why it held back */
  reason: string;
  proposalId?: string;
  /** The same hold-back, this many times in a row */
  count?: number;
}

/* ------------------------------------------------------------------ cron */

export interface Cron {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  /** Both day fields restricted: either may match (standard cron) */
  dayOr: boolean;
}

const FIELDS: [name: string, min: number, max: number][] = [
  ['minute', 0, 59],
  ['hour', 0, 23],
  ['day of month', 1, 31],
  ['month', 1, 12],
  ['day of week', 0, 7],
];

const NAMED: Record<string, string> = { '@hourly': '0 * * * *', '@daily': '0 0 * * *', '@weekly': '0 0 * * 0', '@weekdays': '0 9 * * 1-5' };

function parseField(text: string, [name, min, max]: (typeof FIELDS)[number]): Set<number> | string {
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (!m) return `"${part}" is not a valid ${name}`;
    const step = m[4] ? Number(m[4]) : 1;
    if (step < 1) return `The step in "${part}" must be at least 1`;
    const from = m[1] === '*' ? min : Number(m[2]);
    const to = m[1] === '*' ? max : m[3] !== undefined ? Number(m[3]) : m[4] ? max : from;
    if (from < min || to > max || from > to) return `${name} must be between ${min} and ${max}`;
    for (let v = from; v <= to; v += step) out.add(name === 'day of week' && v === 7 ? 0 : v);
  }
  return out;
}

/** Five-field cron (minute hour day month weekday) in local time, plus @hourly, @daily, @weekly, @weekdays */
export function parseCron(expr: string): Cron | { error: string } {
  const text = NAMED[expr.trim().toLowerCase()] ?? expr.trim();
  const parts = text.split(/\s+/);
  if (parts.length !== 5) return { error: 'A schedule has five fields: minute hour day month weekday (e.g. "0 8 * * 1-5")' };
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    const set = parseField(parts[i], FIELDS[i]);
    if (typeof set === 'string') return { error: set };
    sets.push(set);
  }
  return { minute: sets[0], hour: sets[1], day: sets[2], month: sets[3], weekday: sets[4], dayOr: parts[2] !== '*' && parts[4] !== '*' };
}

export function cronMatches(cron: Cron, at: Date): boolean {
  if (!cron.minute.has(at.getMinutes()) || !cron.hour.has(at.getHours()) || !cron.month.has(at.getMonth() + 1)) return false;
  const day = cron.day.has(at.getDate());
  const weekday = cron.weekday.has(at.getDay());
  return cron.dayOr ? day || weekday : day && weekday;
}

/** The next minute after `after` that the schedule matches (within a year), or null */
export function nextCron(cron: Cron, after: Date): Date | null {
  const t = new Date(after);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (!cron.month.has(t.getMonth() + 1)) {
      t.setMonth(t.getMonth() + 1, 1);
      t.setHours(0, 0, 0, 0);
      continue;
    }
    if (!cron.hour.has(t.getHours())) {
      t.setHours(t.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (cronMatches(cron, t)) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}

/* ------------------------------------------------------------------ files */

/** A path glob: `*` within a folder, `**` across folders, `?` one character, `{a,b}` alternatives */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        re += '(?:.*/)?';
      } else re += '.*';
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else if (c === '{') {
      const end = glob.indexOf('}', i);
      if (end < 0) re += '\\{';
      else {
        re += `(?:${glob.slice(i + 1, end).split(',').map((s) => s.replace(/[.+^$()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
        i = end;
      }
    } else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** Paths whose content differs between two snapshots (added, changed or removed) */
export function changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
  const out = new Set<string>();
  for (const [p, c] of Object.entries(after)) if (before[p] !== c) out.add(p);
  for (const p of Object.keys(before)) if (!(p in after)) out.add(p);
  return [...out].sort();
}

/** A short stable hash (FNV-1a), for event keys */
export function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/* ------------------------------------------------------------------ firing */

export interface Context {
  now: number;
  /** When the watchers were last checked (schedules fire for every minute in between, once) */
  lastCheck: number;
  /** Files that changed since the last check, with the project as it is now */
  changed: string[];
  files: Record<string, string>;
  /** The current failure, if any */
  failure: { signature: string; title: string } | null;
}

/** Does this watcher fire now, and on what? */
export function eventFor(w: Watcher, ctx: Context): WatcherEvent | null {
  if (!w.enabled) return null;
  const t = w.trigger;
  if (t.kind === 'schedule') {
    const cron = parseCron(t.cron);
    if ('error' in cron) return null;
    // The last scheduled minute between the last check and now (missed ones while closed don't pile up)
    const from = new Date(Math.max(ctx.lastCheck, ctx.now - 24 * 60 * 60_000));
    let due: Date | null = null;
    for (let next = nextCron(cron, from); next && next.getTime() <= ctx.now; next = nextCron(cron, next)) due = next;
    if (!due) return null;
    return { key: `${w.id}:at:${due.toISOString()}`, summary: `Scheduled for ${due.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` };
  }
  if (t.kind === 'interval') {
    const ms = Math.max(1, t.minutes) * 60_000;
    const slot = Math.floor(ctx.now / ms);
    if (slot === Math.floor(ctx.lastCheck / ms)) return null;
    return { key: `${w.id}:every:${slot}`, summary: `Every ${describeMinutes(t.minutes)}` };
  }
  if (t.kind === 'change') {
    const re = globToRegExp(t.glob);
    const paths = ctx.changed.filter((p) => re.test(p) && !p.startsWith('.aha/'));
    if (!paths.length) return null;
    const state = paths.map((p) => `${p}\n${ctx.files[p] ?? '(removed)'}`).join('\n');
    return { key: `${w.id}:change:${hash(state)}`, summary: `${paths.length === 1 ? paths[0] : `${paths.length} files`} changed`, paths };
  }
  if (!ctx.failure) return null;
  return { key: `${w.id}:failure:${ctx.failure.signature}`, summary: `It failed: ${ctx.failure.title}` };
}

export interface Situation {
  now: number;
  history: WatcherRun[];
  files: Record<string, string>;
  failure: { signature: string } | null;
  /** This watcher's last result still waits for your review */
  unreviewed: boolean;
}

export type Decision = { action: 'start' | 'suggest'; reason: string } | { action: 'skip'; reason: string } | { action: 'ignore' };

const DAY = 24 * 60 * 60_000;

/** Act, suggest, hold back (logged), or ignore (an event that already ran) */
export function decide(w: Watcher, event: WatcherEvent, s: Situation): Decision {
  const mine = s.history.filter((r) => r.watcherId === w.id);
  if (mine.some((r) => r.key === event.key)) return { action: 'ignore' };
  // The premise: is what triggered it still true?
  if (w.trigger.kind === 'failure' && (!s.failure || !event.key.endsWith(`:failure:${s.failure.signature}`))) return { action: 'skip', reason: 'The failure was already fixed' };
  if (w.trigger.kind === 'change' && event.paths?.every((p) => !(p in s.files))) return { action: 'skip', reason: 'The changed files were removed again' };
  if (s.unreviewed) return { action: 'skip', reason: 'Its last result still waits for your review' };
  const today = mine.filter((r) => r.action !== 'skipped' && s.now - r.at < DAY).length;
  if (today >= w.perDay) return { action: 'skip', reason: `It used its budget (${w.perDay} a day)` };
  return w.mode === 'act' ? { action: 'start', reason: event.summary } : { action: 'suggest', reason: event.summary };
}

/** The brief the agent gets: the task, plus what woke it */
export function briefFor(w: Watcher, event: WatcherEvent): string {
  const lines = [w.task.trim(), '', `(Started by the watcher "${w.name}": ${event.summary}.)`];
  if (event.paths?.length) lines.push(`Changed: ${event.paths.slice(0, 20).join(', ')}${event.paths.length > 20 ? ', …' : ''}`);
  lines.push('If there is nothing worth changing, say so and change nothing.');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ definitions */

function describeMinutes(m: number): string {
  if (m % 1440 === 0) return m === 1440 ? 'day' : `${m / 1440} days`;
  if (m % 60 === 0) return m === 60 ? 'hour' : `${m / 60} hours`;
  return m === 1 ? 'minute' : `${m} minutes`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** In words: "Weekdays at 08:00", "Every 15 minutes while open", "When src/**\/*.ts changes", "When a run fails" */
export function describeTrigger(t: WatcherTrigger): string {
  if (t.kind === 'interval') return `Every ${describeMinutes(t.minutes)} while open`;
  if (t.kind === 'change') return `When ${t.glob} changes`;
  if (t.kind === 'failure') return 'When a run or test fails';
  const cron = parseCron(t.cron);
  if ('error' in cron) return `Schedule "${t.cron}" (invalid)`;
  const parts = (NAMED[t.cron.trim().toLowerCase()] ?? t.cron.trim()).split(/\s+/);
  const simple = /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) && parts[2] === '*' && parts[3] === '*';
  if (!simple) return `Schedule ${t.cron}`;
  const time = `${parts[1].padStart(2, '0')}:${parts[0].padStart(2, '0')}`;
  const days = [...cron.weekday].sort();
  if (days.length === 7) return `Every day at ${time}`;
  if (days.join() === '1,2,3,4,5') return `Weekdays at ${time}`;
  return `${days.map((d) => WEEKDAYS[d]).join(', ')} at ${time}`;
}

/** Why a definition can't be saved, or null */
export function validate(w: Watcher): string | null {
  if (!w.name.trim()) return 'Give it a name';
  if (!w.task.trim()) return 'Say what it should do';
  if (!Number.isFinite(w.perDay) || w.perDay < 1 || w.perDay > 100) return 'Runs a day: between 1 and 100';
  const t = w.trigger;
  if (t.kind === 'schedule') {
    const cron = parseCron(t.cron);
    if ('error' in cron) return cron.error;
  }
  if (t.kind === 'interval' && (!Number.isFinite(t.minutes) || t.minutes < 5 || t.minutes > 10_080)) return 'An interval is between 5 minutes and a week';
  if (t.kind === 'change' && !t.glob.trim()) return 'Which files? e.g. src/**/*.ts';
  return null;
}

function triggerOf(raw: unknown): WatcherTrigger | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (t.kind === 'schedule' && typeof t.cron === 'string') return { kind: 'schedule', cron: t.cron };
  if (t.kind === 'interval' && typeof t.minutes === 'number') return { kind: 'interval', minutes: t.minutes };
  if (t.kind === 'change' && typeof t.glob === 'string') return { kind: 'change', glob: t.glob };
  if (t.kind === 'failure') return { kind: 'failure' };
  return null;
}

/** The watchers in a project's `.aha/watchers.json`; anything malformed is left out */
export function parseWatchers(text: string | undefined): Watcher[] {
  if (!text) return [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(data) ? data : Array.isArray((data as { watchers?: unknown })?.watchers) ? (data as { watchers: unknown[] }).watchers : [];
  const out: Watcher[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const w = raw as Record<string, unknown>;
    const trigger = triggerOf(w.trigger);
    if (typeof w.id !== 'string' || typeof w.name !== 'string' || typeof w.task !== 'string' || !trigger) continue;
    const watcher: Watcher = {
      id: w.id,
      name: w.name,
      task: w.task,
      trigger,
      mode: w.mode === 'act' ? 'act' : 'suggest',
      enabled: w.enabled !== false,
      perDay: typeof w.perDay === 'number' ? w.perDay : 4,
    };
    if (!validate(watcher)) out.push(watcher);
  }
  return out;
}

export function serializeWatchers(watchers: Watcher[]): string {
  return `${JSON.stringify({ watchers }, null, 2)}\n`;
}

/** Ready-made watchers: pick one, adjust, save */
export const WATCHER_PRESETS: (Omit<Watcher, 'id' | 'enabled'> & { blurb: string })[] = [
  {
    name: 'Morning check',
    blurb: 'Weekdays at 08:00: outdated or vulnerable dependencies, failing tests, new TODOs',
    task: 'Check the project: dependencies that are outdated or have known vulnerabilities, tests that fail, and TODOs added recently. Fix what is safe to fix and list the rest.',
    trigger: { kind: 'schedule', cron: '0 8 * * 1-5' },
    mode: 'suggest',
    perDay: 1,
  },
  {
    name: 'Fix failures',
    blurb: 'When a run or test fails: find the cause and fix it, with a test that shows it',
    task: 'A run or test just failed. Find the root cause, fix it, and add or update a test that would have caught it.',
    trigger: { kind: 'failure' },
    mode: 'act',
    perDay: 6,
  },
  {
    name: 'Keep tests in step',
    blurb: 'When source files change: add or update the tests for what changed',
    task: 'Source files changed. Add or update tests so the changed behaviour is covered, and make sure the tests pass.',
    trigger: { kind: 'change', glob: 'src/**/*.{ts,tsx,js,py}' },
    mode: 'suggest',
    perDay: 6,
  },
  {
    name: 'Tidy up',
    blurb: 'Every 2 hours while open: one small cleanup (dead code, naming, a TODO)',
    task: 'Make one small, safe cleanup: remove dead code, improve a confusing name, or resolve a simple TODO. Keep the change small.',
    trigger: { kind: 'interval', minutes: 120 },
    mode: 'suggest',
    perDay: 4,
  },
];
