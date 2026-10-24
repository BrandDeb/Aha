/**
 * Contracts: rules about a project that stay true. Each one is a sentence a
 * person wrote ("no console.log in src", "the API tests pass") plus the check
 * that proves it, so the agent, the worker and every proposal can be held to
 * it instead of to a hope:
 *
 *   forbid   a pattern that must not appear in some files
 *   require  a pattern that must appear in every one of them (a licence header, an export)
 *   command  a command that must pass (exit 0), and optionally print something
 *
 * They live in the project at .nanocli/contracts.json, so they travel with it,
 * get reviewed like code, and the agent can't quietly change them: a proposal
 * that does is flagged. Pure: parsing, the pattern checks, and their reports.
 */

export const CONTRACTS_FILE = '.nanocli/contracts.json';

export type ContractKind = 'forbid' | 'require' | 'command';

export interface Contract {
  id: string;
  /** The rule, in words: what the agent is told to keep true */
  rule: string;
  kind: ContractKind;
  /** forbid / require: a regular expression */
  pattern?: string;
  /** forbid / require: which files (a glob such as src/**\/*.ts); default every code file */
  files?: string;
  /** command: run in the project folder */
  command?: string;
  /** command: a regular expression its output must match */
  expect?: string;
}

export type ContractStatus = 'pass' | 'fail' | 'skip';

export interface ContractResult {
  id: string;
  rule: string;
  kind: ContractKind;
  status: ContractStatus;
  /** Why it failed or was skipped, or how it passed */
  detail: string;
  /** forbid / require: where */
  where?: { path: string; line?: number; text?: string }[];
  ms?: number;
}

const KINDS: ContractKind[] = ['forbid', 'require', 'command'];
const CODE = /\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|cs|rb|php|swift|dart|c|cc|cpp|h|hpp|zig|ex|exs|lua|sol|vue|svelte|astro)$/i;
const IGNORED = /(^|\/)(node_modules|dist|build|out|target|\.next|vendor|\.venv|\.nanocli)\//;

/** A glob (`*` within a folder, `**` across folders, `{a,b}`) as a regular expression over project paths */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      // **/ matches zero or more folders
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
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

/** The files a forbid/require contract looks at */
export function filesFor(contract: Contract, files: Record<string, string>): string[] {
  const match = contract.files ? globToRegExp(contract.files) : null;
  return Object.keys(files)
    .filter((p) => !IGNORED.test(p) && p !== CONTRACTS_FILE)
    .filter((p) => (match ? match.test(p) : CODE.test(p)))
    .sort();
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rule';

/** Read .nanocli/contracts.json: `{ "contracts": [...] }` or a bare list */
export function parseContracts(text: string): { contracts: Contract[] } | { error: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    return { error: `${CONTRACTS_FILE} is not valid JSON: ${(error as Error).message}` };
  }
  const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { contracts?: unknown }).contracts : undefined;
  if (!Array.isArray(list)) return { error: `${CONTRACTS_FILE} needs a "contracts" list` };
  if (list.length > 100) return { error: 'At most 100 contracts' };
  const contracts: Contract[] = [];
  const ids = new Set<string>();
  for (const [i, raw] of list.entries()) {
    if (!raw || typeof raw !== 'object') return { error: `Contract ${i + 1} is not an object` };
    const c = raw as Record<string, unknown>;
    const text = (k: string) => (typeof c[k] === 'string' ? (c[k] as string).trim() : undefined);
    const rule = text('rule');
    const kind = text('kind') as ContractKind | undefined;
    if (!rule) return { error: `Contract ${i + 1} needs a "rule": the sentence to keep true` };
    if (!kind || !KINDS.includes(kind)) return { error: `Contract ${i + 1} (“${rule.slice(0, 40)}”): "kind" must be forbid, require or command` };
    const contract: Contract = { id: text('id') || slug(rule), rule: rule.slice(0, 300), kind };
    if (kind === 'command') {
      const command = text('command');
      if (!command) return { error: `“${rule.slice(0, 40)}” is a command contract with no "command"` };
      contract.command = command.slice(0, 500);
    } else {
      const pattern = text('pattern');
      if (!pattern) return { error: `“${rule.slice(0, 40)}” needs a "pattern" (a regular expression)` };
      try {
        new RegExp(pattern, 'm');
      } catch (error) {
        return { error: `“${rule.slice(0, 40)}”: the pattern is not a valid regular expression (${(error as Error).message})` };
      }
      contract.pattern = pattern;
    }
    const files = text('files');
    if (files) contract.files = files;
    const expect = text('expect');
    if (expect) {
      try {
        new RegExp(expect, 'm');
      } catch {
        return { error: `“${rule.slice(0, 40)}”: "expect" is not a valid regular expression` };
      }
      contract.expect = expect;
    }
    while (ids.has(contract.id)) contract.id += '-2';
    ids.add(contract.id);
    contracts.push(contract);
  }
  return { contracts };
}

/** The project's contracts, or none (a broken file is reported as one failing contract, so it is never silently ignored) */
export function contractsOf(files: Record<string, string>): { contracts: Contract[]; error?: string } {
  const text = files[CONTRACTS_FILE];
  if (text === undefined) return { contracts: [] };
  const parsed = parseContracts(text);
  return 'error' in parsed ? { contracts: [], error: parsed.error } : parsed;
}

export function serializeContracts(contracts: Contract[]): string {
  return `${JSON.stringify({ contracts: contracts.map(({ id, rule, kind, pattern, files, command, expect }) => ({ id, rule, kind, pattern, files, command, expect })) }, null, 2)}\n`;
}

/** forbid / require, against the files as they are (or as a proposal would leave them) */
export function checkPattern(contract: Contract, files: Record<string, string>): ContractResult {
  const base = { id: contract.id, rule: contract.rule, kind: contract.kind };
  const paths = filesFor(contract, files);
  const pattern = new RegExp(contract.pattern ?? '', 'm');
  if (contract.kind === 'forbid') {
    const where: ContractResult['where'] = [];
    for (const path of paths) {
      const lines = files[path].split('\n');
      for (let i = 0; i < lines.length && where.length < 20; i++) {
        if (pattern.test(lines[i])) where.push({ path, line: i + 1, text: lines[i].trim().slice(0, 120) });
      }
      // a pattern that spans lines
      if (!where.some((w) => w.path === path) && pattern.test(files[path])) where.push({ path });
    }
    const found = [...new Set(where.map((w) => w.path))];
    return where.length
      ? { ...base, status: 'fail', detail: `Found in ${found.length === 1 ? found[0] : `${found.length} files`}`, where }
      : { ...base, status: 'pass', detail: `Not found in ${paths.length} file${paths.length === 1 ? '' : 's'}` };
  }
  if (!paths.length) return { ...base, status: 'skip', detail: `No files match ${contract.files ?? 'the code files'}` };
  const missing = paths.filter((p) => !pattern.test(files[p]));
  return missing.length
    ? { ...base, status: 'fail', detail: `Missing in ${missing.length === 1 ? missing[0] : `${missing.length} files`}`, where: missing.slice(0, 20).map((path) => ({ path })) }
    : { ...base, status: 'pass', detail: `Present in all ${paths.length} file${paths.length === 1 ? '' : 's'}` };
}

/** Did a command contract pass? */
export function commandPassed(contract: Contract, code: number | null, output: string): boolean {
  if (code !== 0) return false;
  if (!contract.expect) return true;
  try {
    return new RegExp(contract.expect, 'm').test(output);
  } catch {
    return false;
  }
}

/** The last lines of a command's output: where the reason usually is */
export function tail(output: string, lines = 25): string {
  const all = output.trimEnd().split('\n');
  return (all.length > lines ? ['…', ...all.slice(-lines)] : all).join('\n');
}

export type CommandRunner = (command: string, signal?: AbortSignal) => Promise<{ code: number | null; output: string; error?: string; unavailable?: boolean }>;

/**
 * Check every contract against `files`. Pattern contracts are checked here; command contracts go
 * to `runCommand`, or are skipped when there is none (or it can't run commands on this machine).
 */
export async function checkContracts(files: Record<string, string>, runCommand?: CommandRunner, options: { signal?: AbortSignal; onResult?: (r: ContractResult) => void } = {}): Promise<ContractResult[]> {
  const { contracts, error } = contractsOf(files);
  if (error) return [{ id: 'contracts-file', rule: `${CONTRACTS_FILE} can be read`, kind: 'require', status: 'fail', detail: error }];
  const results: ContractResult[] = [];
  for (const c of contracts) {
    let result: ContractResult;
    const base = { id: c.id, rule: c.rule, kind: c.kind };
    if (c.kind !== 'command') result = checkPattern(c, files);
    else if (!runCommand) result = { ...base, status: 'skip', detail: 'Not run (commands run when you check them)' };
    else {
      const started = Date.now();
      const outcome = await runCommand(c.command!, options.signal);
      const ms = Date.now() - started;
      if (outcome.unavailable) result = { ...base, status: 'skip', detail: outcome.error ?? 'Commands only run on your own machine' };
      else if (!outcome.error && commandPassed(c, outcome.code, outcome.output)) result = { ...base, status: 'pass', ms, detail: `\`${c.command}\` passed` };
      else {
        const why = outcome.error ?? (outcome.code === 0 ? `printed nothing matching /${c.expect}/` : `exited with ${outcome.code}`);
        result = { ...base, status: 'fail', ms, detail: `\`${c.command}\` ${why}${outcome.output.trim() ? `:\n${tail(outcome.output)}` : ''}` };
      }
    }
    results.push(result);
    options.onResult?.(result);
  }
  return results;
}

export function contractCounts(results: ContractResult[]): { pass: number; fail: number; skip: number } {
  return {
    pass: results.filter((r) => r.status === 'pass').length,
    fail: results.filter((r) => r.status === 'fail').length,
    skip: results.filter((r) => r.status === 'skip').length,
  };
}

/** For the agent: each contract and how it stands, with what to fix */
export function describeContracts(results: ContractResult[]): string {
  if (!results.length) return 'The project has no contracts.';
  const { pass, fail, skip } = contractCounts(results);
  const head = fail
    ? `${fail} of ${results.length} contract${results.length === 1 ? ' is' : 's are'} broken.`
    : `${pass === 1 ? 'The contract holds' : `All ${pass} contracts hold`}${skip ? ` (${skip} not checked here)` : ''}.`;
  const lines = results.map((r) => {
    const mark = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✕' : '–';
    const where = r.where?.length ? `\n${r.where.slice(0, 8).map((w) => `    ${w.path}${w.line ? `:${w.line}` : ''}${w.text ? `  ${w.text}` : ''}`).join('\n')}` : '';
    return `${mark} ${r.rule} — ${r.detail}${where}`;
  });
  return `${head}\n${lines.join('\n')}`;
}

/** What the agent is told up front when the project has contracts */
export function contractsPrompt(contracts: Contract[]): string {
  if (!contracts.length) return '';
  return `The project has contracts: rules the developer wrote that must stay true. Keep every one of them true, and run check_contracts before you finish to prove it. Never edit ${CONTRACTS_FILE} unless the developer asked you to change a contract.\n${contracts.map((c) => `- ${c.rule}`).join('\n')}`;
}

/** A proposal changed the contracts themselves: worth a careful look */
export function changesContracts(before: Record<string, string>, after: Record<string, string>): boolean {
  return (before[CONTRACTS_FILE] ?? null) !== (after[CONTRACTS_FILE] ?? null);
}

/** Starting points for the Add contract form */
export const CONTRACT_EXAMPLES: Omit<Contract, 'id'>[] = [
  { rule: 'No console.log left in the source', kind: 'forbid', pattern: 'console\\.log\\(', files: 'src/**/*.{ts,tsx,js,jsx}' },
  { rule: 'No secrets or API keys in the code', kind: 'forbid', pattern: '(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)', files: '**/*' },
  { rule: 'Every source file starts with the licence header', kind: 'require', pattern: '^// Copyright', files: 'src/**/*.ts' },
  { rule: 'The tests pass', kind: 'command', command: 'npm test' },
];
