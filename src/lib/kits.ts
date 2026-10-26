/**
 * Field kits: everything a forward-deployed engineer or an ISV's developers
 * need to be productive on day one, as one file you can share. A kit is a
 * project (starter code, tests, sample data) plus what usually lives in
 * someone's head or a wiki page:
 *
 *   playbook     the steps of the engagement, each one optionally handed to the agent
 *   environment  the variables and secrets it needs (names only: values never travel)
 *   connectors   the tools the agent should have (APIs, databases, MCP servers), with
 *                ${VARIABLE} placeholders where a secret goes
 *   checks       how to tell it works here: runs with expected output
 *   house rules  agent/prompt.md and agent/skills/: how the agent should work in it
 *
 * Inside a project the kit lives at .aha/kit.json; to share it, a whole
 * project is exported as one .nanokit.json bundle. Exporting refuses to carry
 * secrets: .env files are left out, and any file that looks like it holds a key
 * is left out and named, so nothing leaks to a customer or a public repo.
 *
 * Pure: validation, secret scanning, bundling, placeholders and readiness.
 */

import { parseConnector, type Connector } from './connectors/types.ts';

export const KIT_FILE = '.aha/kit.json';
export const KIT_FORMAT = 1;

export type KitAudience = 'fde' | 'isv' | 'team';

export interface KitEnv {
  name: string;
  description: string;
  required: boolean;
  /** Shown masked, never exported */
  secret: boolean;
  /** A harmless example value, shown as a placeholder */
  example?: string;
}

export interface KitConnector {
  name: string;
  description: string;
  /** A connector configuration whose strings may contain ${VARIABLE} placeholders */
  config: Record<string, unknown>;
}

export interface KitStep {
  title: string;
  detail: string;
  /** A goal handed to the agent with one click */
  agent?: string;
}

export interface KitCheck {
  label: string;
  /** The file to run (defaults to the kit's entry) */
  entry?: string;
  args: string[];
  /** A regular expression the output must match */
  expect?: string;
}

export interface Kit {
  format: number;
  id: string;
  name: string;
  version: string;
  publisher: string;
  audience: KitAudience;
  summary: string;
  entry?: string;
  /** Where the worker should head (its "What are you building?") */
  focus?: string;
  env: KitEnv[];
  connectors: KitConnector[];
  steps: KitStep[];
  checks: KitCheck[];
}

export interface KitBundle {
  nanokit: number;
  kit: Kit;
  files: Record<string, string>;
}

const LIMITS = { bundleBytes: 5_000_000, files: 400, fileBytes: 1_000_000, text: 4000, items: 30 };
const KINDS = ['mcp-stdio', 'mcp-http', 'github', 'web-fetch', 'web-search', 'sqlite', 'postgres', 'command'];
const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const ENV_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
const VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,32})?$/;
const SAFE_PATH = /^(?:[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*\/|\.[A-Za-z0-9_][A-Za-z0-9_.@+-]*\/)*\.?[A-Za-z0-9_@+-][A-Za-z0-9_.@+-]*$/;

/** A project path a kit may write: relative, no "..", nothing tool-owned */
export function safeKitPath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 200 &&
    SAFE_PATH.test(path) &&
    !path.split('/').some((part) => part === '..' || part === '.') &&
    !/^(?:\.git|\.venv|node_modules)\//.test(path) &&
    !path.split('/').includes('node_modules')
  );
}

// ---------------------------------------------------------------------------
// Secrets: what must never leave the machine
// ---------------------------------------------------------------------------

const SECRET_PATTERNS: [string, RegExp][] = [
  ['private key', /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/],
  ['Anthropic key', /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI-style key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}/],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{40,}/],
  ['AWS access key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['Slack token', /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['Stripe key', /\b(?:sk|rk)_live_[0-9A-Za-z]{20,}/],
  ['password in a URL', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@'"]+:[^\s/@'"${}]{3,}@[^\s'"]+/i],
];

/** Kinds of secrets found in a text (empty when it looks clean) */
export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(([, re]) => re.test(text)).map(([kind]) => kind);
}

/** Files that hold secrets by convention, whatever their content */
const SECRET_FILE = /(^|\/)(\.env(\.[^/]*)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.pfx|.*\.key)$/i;
/** Except the documented examples */
const EXAMPLE_FILE = /(^|\/)\.env\.(example|sample|template)$/i;

// ---------------------------------------------------------------------------
// Validation (a kit is untrusted input: it can come from anyone)
// ---------------------------------------------------------------------------

type Result<T> = T | { error: string };
const fail = (error: string) => ({ error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max = LIMITS.text): v is string => typeof v === 'string' && v.length <= max && !v.includes('\0');

function list<T>(value: unknown, what: string, item: (v: unknown, i: number) => Result<T>): Result<T[]> {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > LIMITS.items) return fail(`${what} must be a list of at most ${LIMITS.items}`);
  const out: T[] = [];
  for (let i = 0; i < value.length; i++) {
    const parsed = item(value[i], i);
    if (isObj(parsed) && 'error' in parsed) return parsed as { error: string };
    out.push(parsed as T);
  }
  return out;
}

/** Every string in a value, however deep */
function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (isObj(value)) return Object.values(value).flatMap(strings);
  return [];
}

export function parseKit(value: unknown): Result<Kit> {
  if (!isObj(value)) return fail('A kit is a JSON object');
  const v = value;
  if (v.format !== KIT_FORMAT) return fail(`Unsupported kit format (expected ${KIT_FORMAT})`);
  if (!text(v.id, 48) || !ID.test(v.id)) return fail('id: lowercase letters, digits and dashes');
  if (!text(v.name, 80) || !v.name.trim()) return fail('name is required (80 characters at most)');
  if (!text(v.version, 48) || !VERSION.test(v.version)) return fail('version: semantic, like 1.0.0');
  if (!text(v.publisher, 80) || !v.publisher.trim()) return fail('publisher is required');
  if (v.audience !== 'fde' && v.audience !== 'isv' && v.audience !== 'team') return fail('audience: fde, isv or team');
  if (!text(v.summary, 400)) return fail('summary: 400 characters at most');
  if (v.entry !== undefined && (!text(v.entry, 200) || !safeKitPath(v.entry))) return fail('entry: a project path');
  if (v.focus !== undefined && !text(v.focus, 400)) return fail('focus: 400 characters at most');

  const env = list<KitEnv>(v.env, 'env', (e, i) => {
    if (!isObj(e) || !text(e.name, 64) || !ENV_NAME.test(e.name)) return fail(`env ${i + 1}: an UPPER_CASE name`);
    if (!text(e.description, 400)) return fail(`env ${e.name}: a description`);
    if (e.example !== undefined && (!text(e.example, 200) || findSecrets(e.example).length)) return fail(`env ${e.name}: the example must be harmless`);
    return { name: e.name, description: e.description, required: e.required !== false, secret: e.secret === true, ...(e.example ? { example: e.example } : {}) };
  });
  if ('error' in env) return env;

  const connectors = list<KitConnector>(v.connectors, 'connectors', (c, i) => {
    if (!isObj(c) || !text(c.name, 80) || !text(c.description, 400) || !isObj(c.config)) return fail(`connector ${i + 1}: name, description and config`);
    const found = strings(c.config).flatMap(findSecrets);
    if (found.length) return fail(`connector ${c.name}: holds a ${found[0]}; use a \${VARIABLE} placeholder instead`);
    // A known kind; without placeholders it must already be a valid connector (with them, it is checked once they're filled)
    if (!KINDS.includes(c.config.kind as string)) return fail(`connector ${c.name}: unknown kind`);
    if (!fillPlaceholders(c.config, {}).missing.length) {
      const trial = parseConnector({ ...c.config, id: 'kit', name: c.name, enabled: true });
      if ('error' in trial) return fail(`connector ${c.name}: ${trial.error}`);
    }
    return { name: c.name, description: c.description, config: c.config };
  });
  if ('error' in connectors) return connectors;

  const steps = list<KitStep>(v.steps, 'steps', (s, i) => {
    if (!isObj(s) || !text(s.title, 120) || !s.title.trim() || !text(s.detail)) return fail(`step ${i + 1}: a title and detail`);
    if (s.agent !== undefined && !text(s.agent)) return fail(`step ${s.title}: agent goal too long`);
    return { title: s.title, detail: s.detail, ...(s.agent ? { agent: s.agent } : {}) };
  });
  if ('error' in steps) return steps;

  const checks = list<KitCheck>(v.checks, 'checks', (c, i) => {
    if (!isObj(c) || !text(c.label, 120)) return fail(`check ${i + 1}: a label`);
    if (c.entry !== undefined && (!text(c.entry, 200) || !safeKitPath(c.entry))) return fail(`check ${c.label}: entry must be a project path`);
    const args = c.args ?? [];
    if (!Array.isArray(args) || args.length > 20 || !args.every((a) => text(a, 400))) return fail(`check ${c.label}: args must be strings`);
    if (c.expect !== undefined) {
      if (!text(c.expect, 400)) return fail(`check ${c.label}: expect too long`);
      try {
        new RegExp(c.expect);
      } catch {
        return fail(`check ${c.label}: expect is not a valid regular expression`);
      }
    }
    if (!c.entry && !v.entry) return fail(`check ${c.label}: needs an entry`);
    return { label: c.label, args: args as string[], ...(c.entry ? { entry: c.entry } : {}), ...(c.expect ? { expect: c.expect } : {}) };
  });
  if ('error' in checks) return checks;

  return {
    format: KIT_FORMAT,
    id: v.id,
    name: v.name.trim(),
    version: v.version,
    publisher: v.publisher.trim(),
    audience: v.audience,
    summary: v.summary,
    ...(v.entry ? { entry: v.entry } : {}),
    ...(v.focus ? { focus: v.focus } : {}),
    env,
    connectors,
    steps,
    checks,
  };
}

/** The kit a project carries, if any */
export function kitOf(files: Record<string, string>): Kit | null {
  const raw = files[KIT_FILE];
  if (!raw) return null;
  try {
    const kit = parseKit(JSON.parse(raw));
    return 'error' in kit ? null : kit;
  } catch {
    return null;
  }
}

/** The error in a project's kit file, for the editor (null when fine or absent) */
export function kitError(files: Record<string, string>): string | null {
  const raw = files[KIT_FILE];
  if (!raw) return null;
  try {
    const kit = parseKit(JSON.parse(raw));
    return 'error' in kit ? kit.error : null;
  } catch (error) {
    return `Not valid JSON: ${(error as Error).message}`;
  }
}

// ---------------------------------------------------------------------------
// Bundles: a whole kit as one file
// ---------------------------------------------------------------------------

export function parseBundle(json: string): Result<{ kit: Kit; files: Record<string, string> }> {
  if (json.length > LIMITS.bundleBytes) return fail('The kit is larger than 5 MB');
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return fail('Not a kit: the file is not JSON');
  }
  if (!isObj(data) || data.nanokit !== KIT_FORMAT || !isObj(data.files)) return fail('Not an Aha! kit (.nanokit.json)');
  const kit = parseKit(data.kit);
  if ('error' in kit) return kit;
  const entries = Object.entries(data.files);
  if (entries.length > LIMITS.files) return fail(`A kit holds at most ${LIMITS.files} files`);
  const files: Record<string, string> = {};
  for (const [path, content] of entries) {
    if (!safeKitPath(path)) return fail(`Unsafe file path in the kit: ${path.slice(0, 80)}`);
    if (!text(content, LIMITS.fileBytes)) return fail(`${path}: not text, or larger than 1 MB`);
    files[path] = content;
  }
  if (kit.entry && !(kit.entry in files)) return fail(`The entry ${kit.entry} is not in the kit`);
  files[KIT_FILE] = JSON.stringify(kit, null, 2) + '\n';
  return { kit, files };
}

export interface ExportResult {
  bundle: KitBundle;
  /** Files left out, and why */
  left: { path: string; reason: string }[];
}

/** A project as a shareable kit, with anything secret left out */
export function exportBundle(kit: Kit, files: Record<string, string>): ExportResult {
  const left: ExportResult['left'] = [];
  const kept: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    if (path === KIT_FILE) continue;
    if (!safeKitPath(path)) left.push({ path, reason: 'not part of the project' });
    else if (SECRET_FILE.test(path) && !EXAMPLE_FILE.test(path)) left.push({ path, reason: 'holds secrets by convention' });
    else if (content.length > LIMITS.fileBytes) left.push({ path, reason: 'larger than 1 MB' });
    else {
      const found = findSecrets(content);
      if (found.length) left.push({ path, reason: `looks like it holds a ${found[0]}` });
      else kept[path] = content;
    }
  }
  kept[KIT_FILE] = JSON.stringify(kit, null, 2) + '\n';
  return { bundle: { nanokit: KIT_FORMAT, kit, files: kept }, left };
}

/** A starting kit for a project that has none */
export function draftKit(name: string, entry?: string): Kit {
  const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'my-kit';
  return {
    format: KIT_FORMAT,
    id,
    name,
    version: '0.1.0',
    publisher: 'Your team',
    audience: 'team',
    summary: 'What this kit sets up, and for whom.',
    ...(entry ? { entry } : {}),
    env: [],
    connectors: [],
    steps: [{ title: 'Run it', detail: 'Run the project and check the output.' }],
    checks: entry ? [{ label: 'It runs', args: [] }] : [],
  };
}

// ---------------------------------------------------------------------------
// Using a kit here
// ---------------------------------------------------------------------------

/** ${NAME} placeholders filled from the environment; which ones had no value */
export function fillPlaceholders<T>(value: T, env: Record<string, string>, fallback?: string): { value: T; missing: string[] } {
  const missing = new Set<string>();
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string')
      return v.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name: string) => {
        if (env[name]) return env[name];
        missing.add(name);
        return fallback ?? '';
      });
    if (Array.isArray(v)) return v.map(walk);
    if (isObj(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { value: walk(value) as T, missing: [...missing] };
}

/** The connector a kit asks for, ready to add (or why it can't be yet) */
export function kitConnector(c: KitConnector, env: Record<string, string>, id: string): Result<Connector> {
  const { value, missing } = fillPlaceholders(c.config, env);
  if (missing.length) return fail(`Set ${missing.join(', ')} first`);
  // A kit never pre-approves anything: every call the agent makes through it asks you first
  return parseConnector({ ...value, id, name: c.name, enabled: true, trustReads: false });
}

/** What a kit's connector would run or reach, in one line, so you know before you add it */
export function describeConnector(c: KitConnector): string {
  const cfg = c.config as Record<string, unknown>;
  const tool = cfg.tool as Record<string, unknown> | undefined;
  switch (cfg.kind) {
    case 'mcp-stdio':
      return `Runs: ${[cfg.command, ...((cfg.args as string[]) ?? [])].join(' ')}`;
    case 'command':
      return `Runs: ${[tool?.command, ...((tool?.args as string[]) ?? [])].join(' ')}`;
    case 'mcp-http':
    case 'postgres':
      return `Connects to: ${String(cfg.url).replace(/\/\/[^@/]*@/, '//…@')}`;
    case 'sqlite':
      return `Opens: ${cfg.path}`;
    default:
      return String(cfg.kind);
  }
}

export type ReadinessItem = { kind: 'env' | 'connector' | 'entry'; label: string; ok: boolean; detail: string };

/** What is missing before the kit works here */
export function readiness(kit: Kit, files: Record<string, string>, env: Record<string, string>, connectorNames: string[]): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  if (kit.entry) items.push({ kind: 'entry', label: kit.entry, ok: kit.entry in files, detail: kit.entry in files ? 'Entry file present' : 'The entry file is missing' });
  for (const e of kit.env) {
    if (!e.required && !env[e.name]) continue;
    items.push({ kind: 'env', label: e.name, ok: !!env[e.name], detail: e.description });
  }
  const have = new Set(connectorNames.map((n) => n.toLowerCase()));
  for (const c of kit.connectors) items.push({ kind: 'connector', label: c.name, ok: have.has(c.name.toLowerCase()), detail: c.description });
  return items;
}

/** Did a check's output pass? */
export function checkPassed(check: KitCheck, ok: boolean, output: string): boolean {
  if (!ok) return false;
  if (!check.expect) return true;
  try {
    return new RegExp(check.expect).test(output);
  } catch {
    return false;
  }
}
