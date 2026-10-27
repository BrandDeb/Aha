/**
 * How risky a proposed change is, as one number with its reasons: what it touches (dependencies, CI, auth,
 * database migrations, secrets, the contracts), what it adds (eval, shell commands, raw HTML, destructive SQL),
 * how big it is, whether it removes tests, and what the evidence and the reviewer say. Shown on every proposal,
 * and the basis for auto-accepting the low-risk ones when you allow it. Pure, so it is tested directly.
 */

import type { Evidence } from './evidence.ts';
import type { Review } from './review.ts';
import type { SupplyFinding } from '../supply-chain.ts';

export interface RiskFactor {
  label: string;
  /** Positive raises the risk, negative lowers it */
  points: number;
  detail: string;
  /** Never auto-accept a change with this, whatever the score */
  hold?: boolean;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface RiskScore {
  /** 0 (trivial) to 100 */
  score: number;
  level: RiskLevel;
  factors: RiskFactor[];
}

export interface RiskInput {
  files: { path: string; kind: 'added' | 'modified' | 'deleted'; before: string; after: string; added: number; removed: number }[];
  evidence?: Evidence;
  review?: Pick<Review, 'verdict'> | null;
  /** What the supply-chain guard found about the dependencies the change adds */
  supplyChain?: SupplyFinding[];
}

const DOCS = /\.(md|mdx|txt|rst|adoc)$|(^|\/)(LICENSE|CHANGELOG)[^/]*$/i;
const TEST = /(^|\/)(tests?|__tests__|spec)\/|[._-](test|spec)\.[\w]+$|(^|\/)test_[\w]+\.py$|_test\.(go|py)$/i;
const MANIFEST = /(^|\/)(package\.json|requirements[\w.-]*\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile|composer\.json|pom\.xml|build\.gradle(\.kts)?|mix\.exs|pubspec\.yaml)$/;
const LOCKFILE = /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?|uv\.lock|poetry\.lock|Cargo\.lock|go\.sum|Gemfile\.lock|composer\.lock)$/;
const PIPELINE = /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml|Dockerfile|docker-compose[\w.-]*\.ya?ml|vercel\.json|netlify\.toml|fly\.toml|render\.yaml|\.aha\/pipelines?)/i;
const SENSITIVE = /(^|[/_.-])(auth|login|logout|session|crypto|password|passwd|token|permission|acl|security|middleware|oauth|jwt|csrf|cors)([/_.-]|s?\.|$)/i;
const CONFIG_ENV = /(^|\/)\.env(\.[\w-]+)?$|(^|\/)(next|vite|nuxt|svelte|astro|tsconfig|webpack)\.config\.\w+$|(^|\/)tsconfig\.json$/;
const MIGRATION = /(^|\/)(migrations?|alembic|prisma\/migrations)\/|(^|\/)schema\.(sql|prisma)$|\.sql$/i;
const CONTRACTS = /(^|\/)\.aha\/contracts\.json$/;
const MEMORY = /^\.aha\/memory\.md$/;
/**
 * Files that run by themselves later, without anyone running the project: install and build hooks, git hooks,
 * editor tasks, package-manager settings (a registry swap), and the studio's own watchers, which start agents.
 */
const AUTORUN = /(^|\/)(\.npmrc|\.yarnrc(\.yml)?|\.pnpmfile\.c?js|\.husky\/|\.git\/hooks\/|\.githooks\/|\.pre-commit-config\.ya?ml|lefthook\.ya?ml|\.vscode\/(tasks|launch|settings)\.json|\.devcontainer\/|\.envrc|build\.rs|setup\.py|conftest\.py|Makefile|justfile|Taskfile\.ya?ml)$|(^|\/)(\.husky|\.git\/hooks|\.githooks|\.devcontainer)\/|(^|\/)\.aha\/(watchers|kit|skills)(\.json|\/)/i;
const SECRET = /\b(api[_-]?key|secret|password|passwd|private[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*['"`][^'"`\s]{8,}['"`]|\b(sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|xox[bp]-[A-Za-z0-9-]{10,})\b/i;

const SUPPLY_LABEL: Record<SupplyFinding['kind'], string> = {
  typosquat: 'looks like a typosquat',
  missing: 'not on the registry',
  'install-script': 'install script',
  new: 'brand-new package',
  unpopular: 'barely used',
  advisory: 'known advisory',
  licence: 'licence',
};

/** Things that are fine in their place but deserve a look when a change adds them */
const DANGEROUS: { label: string; re: RegExp }[] = [
  { label: 'eval / new Function', re: /\beval\s*\(|new\s+Function\s*\(/ },
  { label: 'downloads and runs code', re: /\b(curl|wget)\b[^|\n]*\|\s*(sudo\s+)?(ba|z)?sh\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)\b|\b(iwr|Invoke-WebRequest)\b[^|\n]*\|\s*(iex|Invoke-Expression)\b/i },
  { label: 'shell commands', re: /child_process|\bexecSync?\s*\(|\bspawnSync?\s*\(|subprocess\.|os\.system\s*\(|Runtime\.getRuntime\(\)\.exec|\bshell_exec\s*\(/ },
  { label: 'raw HTML', re: /dangerouslySetInnerHTML|\.innerHTML\s*=|v-html=|\{@html\s/ },
  { label: 'destructive SQL', re: /\b(DROP\s+(TABLE|DATABASE|COLUMN)|TRUNCATE\s+TABLE)\b|\bDELETE\s+FROM\s+\w+\s*(;|$|['"`])/i },
  { label: 'deleting files', re: /\brm\s+-rf?\b|fs\.(rm|rmdir|unlink)(Sync)?\s*\(|shutil\.rmtree|os\.remove\s*\(/ },
  { label: 'disabled checks', re: /@ts-ignore|eslint-disable(?!-next-line react-hooks)|# type:\s*ignore|# noqa|\bverify\s*=\s*False\b|rejectUnauthorized\s*:\s*false/ },
];

/** Lines that are in `after` and not in `before`: what the change adds */
function addedLines(before: string, after: string): string[] {
  const old = new Map<string, number>();
  for (const line of before.split('\n')) old.set(line, (old.get(line) ?? 0) + 1);
  const out: string[] = [];
  for (const line of after.split('\n')) {
    const n = old.get(line) ?? 0;
    if (n) old.set(line, n - 1);
    else out.push(line);
  }
  return out;
}

/** The dependencies a manifest declares, name → version spec */
export function readDependencies(path: string, text: string): Record<string, string> {
  if (path.endsWith('package.json') || path.endsWith('composer.json')) {
    try {
      const j = JSON.parse(text || '{}');
      return { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}), ...(j.require ?? {}), ...(j['require-dev'] ?? {}) };
    } catch {
      return {};
    }
  }
  // Line-based manifests: one dependency per line, name first
  const deps: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^["']?([A-Za-z0-9@][\w@./-]*)["']?\s*(?:(?:[=<>~^!]=?|:|\[)\s*["']?([^"',\]]*))?/);
    if (m && !line.trim().startsWith('#') && !/^\[/.test(line.trim()) && !/^(name|version|description|edition|authors|license|requires-python|readme|module|go|python|dependencies|requires|build-backend)$/.test(m[1])) deps[m[1]] = (m[2] ?? '').trim();
  }
  return deps;
}

/** Dependencies a manifest change adds, removes or re-versions */
export function dependencyChanges(path: string, before: string, after: string): { added: string[]; removed: string[]; changed: string[] } {
  const a = readDependencies(path, before);
  const b = readDependencies(path, after);
  return {
    added: Object.keys(b).filter((k) => !(k in a)),
    removed: Object.keys(a).filter((k) => !(k in b)),
    changed: Object.keys(b).filter((k) => k in a && a[k] !== b[k]),
  };
}

/** package.json scripts the change adds or rewrites (install hooks run on the next install) */
function scriptChanges(before: string, after: string): string[] {
  const read = (text: string): Record<string, unknown> => {
    try {
      const scripts = (JSON.parse(text || '{}') as { scripts?: unknown }).scripts;
      return scripts && typeof scripts === 'object' ? (scripts as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };
  const a = read(before);
  const b = read(after);
  return Object.keys(b).filter((k) => a[k] !== b[k]);
}

const testCount = (text: string) => (text.match(/\b(it|test)\s*\(|^\s*def test_|^\s*func Test|#\[test\]|@Test\b/gm) ?? []).length;

export function riskOf({ files, evidence, review, supplyChain }: RiskInput): RiskScore {
  const factors: RiskFactor[] = [];
  const add = (f: RiskFactor) => factors.push(f);
  // The why-history is the studio's own notes about the change, not part of it
  const project = files.filter((f) => f.path !== '.aha/why.json');
  if (!project.length) return { score: 0, level: 'low', factors: [{ label: 'No changes', points: 0, detail: 'Nothing in the project changes' }] };
  const docsOnly = project.every((f) => DOCS.test(f.path));

  // Size
  const lines = project.reduce((n, f) => n + f.added + f.removed, 0);
  const sizePoints = Math.min(25, Math.round(Math.log2(1 + lines) * 2.5));
  add({ label: `${lines} line${lines === 1 ? '' : 's'} in ${project.length} file${project.length === 1 ? '' : 's'}`, points: sizePoints + (project.length > 15 ? 10 : project.length > 5 ? 5 : 0), detail: 'Bigger changes are harder to review' });

  const deleted = project.filter((f) => f.kind === 'deleted' && !DOCS.test(f.path));
  if (deleted.length) add({ label: `deletes ${deleted.length} file${deleted.length > 1 ? 's' : ''}`, points: Math.min(15, deleted.length * 6), detail: deleted.map((f) => f.path).join(', ') });

  // Where it reaches
  const deps = { added: [] as string[], removed: [] as string[], changed: [] as string[] };
  for (const f of project) {
    if (MANIFEST.test(f.path)) {
      const d = dependencyChanges(f.path, f.before, f.after);
      deps.added.push(...d.added);
      deps.removed.push(...d.removed);
      deps.changed.push(...d.changed);
    }
  }
  if (deps.added.length) add({ label: `adds ${deps.added.length} dependenc${deps.added.length > 1 ? 'ies' : 'y'}`, points: Math.min(20, deps.added.length * 7), detail: `New code you didn't write runs in your app: ${deps.added.join(', ')}` });
  if (supplyChain?.length) {
    const kinds = [...new Set(supplyChain.map((f) => SUPPLY_LABEL[f.kind]))];
    add({ label: `supply chain: ${kinds.join(', ')}`, points: Math.min(40, 20 + 5 * supplyChain.length), detail: supplyChain.map((f) => f.detail).join('; '), hold: true });
  }
  if (deps.changed.length) add({ label: `changes ${deps.changed.length} version${deps.changed.length > 1 ? 's' : ''}`, points: Math.min(10, deps.changed.length * 3), detail: deps.changed.join(', ') });
  if (deps.removed.length) add({ label: `removes ${deps.removed.length} dependenc${deps.removed.length > 1 ? 'ies' : 'y'}`, points: 3, detail: deps.removed.join(', ') });
  if (project.some((f) => LOCKFILE.test(f.path))) add({ label: 'lockfile', points: 3, detail: 'The exact installed versions change' });
  const touched = (re: RegExp) => project.filter((f) => re.test(f.path)).map((f) => f.path);
  const pipeline = touched(PIPELINE);
  if (pipeline.length) add({ label: 'CI / deploy', points: 12, detail: `Changes how the project is built or shipped: ${pipeline.join(', ')}`, hold: true });
  const sensitive = touched(SENSITIVE).filter((p) => !DOCS.test(p) && !TEST.test(p));
  if (sensitive.length) add({ label: 'security-sensitive code', points: 12, detail: `Auth, sessions, tokens or permissions: ${sensitive.join(', ')}`, hold: true });
  const config = touched(CONFIG_ENV);
  if (config.length) add({ label: 'configuration', points: 6, detail: config.join(', ') });
  const migrations = touched(MIGRATION);
  if (migrations.length) add({ label: 'database schema', points: 15, detail: `Migrations and schemas change real data: ${migrations.join(', ')}`, hold: true });
  const autorun = touched(AUTORUN);
  if (autorun.length) add({ label: 'runs on its own', points: 15, detail: `Runs later without anyone running the project (hooks, tasks, installs, watchers): ${autorun.join(', ')}`, hold: true });
  const scripts = project.filter((f) => /(^|\/)package\.json$/.test(f.path) && f.kind !== 'deleted').flatMap((f) => scriptChanges(f.before, f.after));
  if (scripts.length) add({ label: 'package scripts', points: 12, detail: `Commands that run on install, build or start change: ${scripts.join(', ')}`, hold: true });
  if (touched(MEMORY).length) add({ label: 'edits the agent\'s memory', points: 4, detail: 'What future tasks are told about this project changes (.aha/memory.md): read the new entries', hold: true });
  if (touched(CONTRACTS).length) add({ label: 'edits the contracts', points: 15, detail: 'The rules that guard the project change: check none is loosened', hold: true });

  // What it adds
  const secretFiles: string[] = [];
  const found = new Map<string, string[]>();
  for (const f of project) {
    if (f.kind === 'deleted' || DOCS.test(f.path)) continue;
    const added = addedLines(f.before, f.after);
    if (added.some((l) => SECRET.test(l))) secretFiles.push(f.path);
    for (const d of DANGEROUS) if (added.some((l) => d.re.test(l))) found.set(d.label, [...(found.get(d.label) ?? []), f.path]);
  }
  if (secretFiles.length) add({ label: 'a secret in the code', points: 30, detail: `Looks like a key or password written into ${secretFiles.join(', ')}: keep it in an environment variable`, hold: true });
  if (found.size) add({ label: [...found.keys()].join(', '), points: Math.min(25, found.size * 10), detail: [...found].map(([k, v]) => `${k} in ${v.join(', ')}`).join('; '), hold: found.has('destructive SQL') || found.has('shell commands') || found.has('eval / new Function') || found.has('downloads and runs code') });

  // Tests
  const testFiles = project.filter((f) => TEST.test(f.path));
  const before = testFiles.reduce((n, f) => n + testCount(f.before), 0);
  const after = testFiles.reduce((n, f) => n + (f.kind === 'deleted' ? 0 : testCount(f.after)), 0);
  if (after < before) add({ label: `removes ${before - after} test${before - after > 1 ? 's' : ''}`, points: 12, detail: 'Fewer tests guard the code afterwards', hold: true });
  else if (after > before) add({ label: `adds ${after - before} test${after - before > 1 ? 's' : ''}`, points: -5, detail: 'The change comes with tests' });

  // Evidence
  if (evidence) {
    if (evidence.contracts?.broken.length || evidence.contracts?.checked === false) add({ label: 'breaks a contract', points: 30, detail: evidence.contracts.broken.join('; ') || 'The last contract check failed', hold: true });
    if (evidence.build === false || evidence.run === false) add({ label: 'last check failed', points: 20, detail: 'The last build or run failed', hold: true });
    else if (evidence.build || evidence.run || evidence.contracts?.checked) add({ label: 'checked', points: -10, detail: 'It was built or run, and passed' });
    else if (!docsOnly) add({ label: 'not checked', points: 10, detail: 'Nothing was built or run to check it' });
    if (evidence.reason !== 'finished') add({ label: 'unfinished', points: 10, detail: 'The agent did not finish on its own', hold: true });
  }
  if (review?.verdict === 'block') add({ label: 'reviewer blocks', points: 35, detail: 'The second reviewer found a blocker', hold: true });
  else if (review?.verdict === 'concerns') add({ label: 'reviewer has concerns', points: 12, detail: 'Read its findings first', hold: true });
  else if (review?.verdict === 'approve') add({ label: 'reviewer approves', points: -8, detail: 'The second reviewer read it cold and approves' });

  if (docsOnly) add({ label: 'docs only', points: -15, detail: 'Only documentation changes' });

  const score = Math.max(0, Math.min(100, factors.reduce((n, f) => n + f.points, 0)));
  const level: RiskLevel = score < 25 ? 'low' : score < 55 ? 'medium' : 'high';
  // Biggest reasons first
  factors.sort((a, b) => b.points - a.points);
  return { score, level, factors };
}

/** Auto-accept settings: off, or the highest score accepted without asking */
export const AUTO_ACCEPT = [
  { value: 0, label: 'Off', detail: 'Every proposal waits for you' },
  { value: 15, label: 'Very low risk', detail: 'Small, checked changes with nothing sensitive (score ≤ 15)' },
  { value: 25, label: 'Low risk', detail: 'Anything scored low that was checked and nothing holds back (score ≤ 25)' },
] as const;

/**
 * Whether a finished proposal may be accepted without you: auto-accept is on, the risk is at or under the
 * threshold, nothing holds it back (secrets, CI, auth, schema, contracts, failing or missing checks, a reviewer's
 * concerns), and the evidence says verified.
 */
export function autoAcceptable(risk: RiskScore, threshold: number, verified: boolean): { ok: boolean; why: string } {
  if (!threshold) return { ok: false, why: 'Auto-accept is off' };
  if (!verified) return { ok: false, why: 'Not verified' };
  const hold = risk.factors.find((f) => f.hold);
  if (hold) return { ok: false, why: `Held for you: ${hold.label}` };
  if (risk.score > threshold) return { ok: false, why: `Risk ${risk.score} is above ${threshold}` };
  return { ok: true, why: `Risk ${risk.score}, verified` };
}
