/**
 * Solidity in the studio, like Remix IDE: the official compiler (soljson, the same build Remix uses) runs in a
 * worker in your browser, at the version your pragma asks for. Imports are gathered first: project files by
 * relative path or remapping, and npm packages (@openzeppelin/contracts, forge-std, solmate…) from jsDelivr at the
 * version package.json pins. This module is the pure part: choosing the version, finding imports, building the
 * compiler's standard JSON input and reading its output. Tested without the compiler.
 */

export interface CompilerSettings {
  version: string;
  optimize: boolean;
  runs: number;
  /** "paris", "shanghai", "cancun", "prague"…; empty for the compiler's default */
  evmVersion: string;
  viaIR: boolean;
}

export const DEFAULT_SETTINGS: Omit<CompilerSettings, 'version'> = { optimize: true, runs: 200, evmVersion: '', viaIR: false };

type Version = [number, number, number];
const parse = (v: string): Version | null => {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const cmp = (a: Version, b: Version) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** Whether a version satisfies one pragma comparator ("^0.8.20", ">=0.8.0", "<0.9.0", "0.8.24", "~0.8.1") */
function satisfiesOne(v: Version, comparator: string): boolean {
  const m = comparator.trim().match(/^(\^|~|>=|<=|>|<|=)?\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/);
  if (!m) return true;
  const op = m[1] ?? '=';
  const target: Version = [Number(m[2]), Number(m[3] ?? 0), Number(m[4] ?? 0)];
  const c = cmp(v, target);
  switch (op) {
    case '^':
      // ^0.8.20 means >=0.8.20 <0.9.0 (minor is the breaking part below 1.0)
      return c >= 0 && (target[0] === 0 ? v[0] === 0 && v[1] === target[1] : v[0] === target[0]);
    case '~':
      return c >= 0 && v[0] === target[0] && v[1] === target[1];
    case '>=':
      return c >= 0;
    case '<=':
      return c <= 0;
    case '>':
      return c > 0;
    case '<':
      return c < 0;
    default:
      return c === 0;
  }
}

/** The pragma's version range, or null when there is none */
export function pragmaRange(source: string): string | null {
  return source.match(/^\s*pragma\s+solidity\s+([^;]+);/m)?.[1].trim() ?? null;
}

/** Whether a version satisfies a pragma range ("^0.8.0", ">=0.8.0 <0.9.0", "0.8.20 || ^0.8.24") */
export function satisfies(version: string, range: string): boolean {
  const v = parse(version);
  if (!v) return false;
  return range.split('||').some((alt) => alt.trim().split(/\s+/).filter(Boolean).every((c) => satisfiesOne(v, c)));
}

/** The newest release every file's pragma accepts (newest first in `releases`), or null when none does */
export function pickVersion(sources: string[], releases: string[]): string | null {
  const ranges = sources.map(pragmaRange).filter((r): r is string => !!r);
  const sorted = [...releases].filter((r) => parse(r)).sort((a, b) => cmp(parse(b)!, parse(a)!));
  return sorted.find((r) => ranges.every((range) => satisfies(r, range))) ?? null;
}

/** The import paths in a Solidity source */
export function importsOf(source: string): string[] {
  const out: string[] = [];
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  for (const m of code.matchAll(/^\s*import\s+(?:[^"';]*?\s+from\s+)?["']([^"']+)["']/gm)) out.push(m[1]);
  return out;
}

/** "remappings.txt" lines and foundry.toml remappings: prefix → target */
export function remappingsOf(files: Record<string, string>): [string, string][] {
  const lines: string[] = [];
  if (files['remappings.txt']) lines.push(...files['remappings.txt'].split('\n'));
  const toml = files['foundry.toml']?.match(/remappings\s*=\s*\[([\s\S]*?)\]/)?.[1];
  if (toml) lines.push(...[...toml.matchAll(/["']([^"']+)["']/g)].map((m) => m[1]));
  return lines
    .map((l) => l.trim())
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const [from, to] = l.replace(/^[^:]*:/, '').split('=');
      return [from.trim(), to.trim()] as [string, string];
    });
}

const normalize = (path: string) => {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part !== '.' && part !== '') out.push(part);
  }
  return out.join('/');
};

export type ImportTarget = { kind: 'project'; path: string } | { kind: 'npm'; path: string; url: string };

/** npm packages Solidity code commonly imports, and the version used when package.json doesn't pin one */
export const NPM_DEFAULTS: Record<string, string> = {
  '@openzeppelin/contracts': '5',
  '@openzeppelin/contracts-upgradeable': '5',
  'forge-std': '1',
  solmate: '6',
  solady: '0',
  '@chainlink/contracts': '1',
  '@uniswap/v3-core': '1',
  '@uniswap/v2-core': '1',
};

/** Where an import comes from: a project file (relative, remapped or under lib/ / node_modules), or npm via jsDelivr */
export function resolveImport(from: string, spec: string, files: Record<string, string>, versions: Record<string, string> = {}): ImportTarget | null {
  if (spec.startsWith('./') || spec.startsWith('../')) {
    const path = normalize(`${from.split('/').slice(0, -1).join('/')}/${spec}`);
    return { kind: 'project', path };
  }
  for (const [prefix, target] of remappingsOf(files)) {
    if (spec.startsWith(prefix)) {
      const path = normalize(target + spec.slice(prefix.length));
      if (path in files) return { kind: 'project', path };
      spec = target.replace(/^(node_modules|lib)\//, '').replace(/\/(src|contracts)\/$/, '/') + spec.slice(prefix.length);
      break;
    }
  }
  if (spec in files) return { kind: 'project', path: spec };
  for (const base of ['node_modules/', 'lib/']) if (base + spec in files) return { kind: 'project', path: base + spec };
  const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
  const rest = spec.slice(pkg.length + 1);
  if (!rest) return null;
  const declared = versions[pkg]?.replace(/^[\^~>=<\s]+/, '').trim();
  const version = declared && /^[\w.-]+$/.test(declared) ? declared : (NPM_DEFAULTS[pkg] ?? 'latest');
  // forge-std is published to npm with its sources under src/
  const file = pkg === 'forge-std' && !rest.startsWith('src/') ? `src/${rest}` : rest;
  return { kind: 'npm', path: spec, url: `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${file}` };
}

/** Every source the entry files need, fetching npm imports with `fetchText`; missing ones are reported, not thrown */
export async function gatherSources(
  files: Record<string, string>,
  entries: string[],
  fetchText: (url: string) => Promise<string | null>,
  versions: Record<string, string> = {}
): Promise<{ sources: Record<string, { content: string }>; missing: { from: string; spec: string }[] }> {
  const sources: Record<string, { content: string }> = {};
  const missing: { from: string; spec: string }[] = [];
  const queue = entries.map((path) => ({ key: path, content: files[path] }));
  while (queue.length) {
    const { key, content } = queue.shift()!;
    if (key in sources || content === undefined) continue;
    sources[key] = { content };
    if (Object.keys(sources).length > 400) break;
    for (const spec of importsOf(content)) {
      // The compiler resolves the import by its spec relative to the importer; sources are keyed to match
      const relative = spec.startsWith('.');
      const name = relative ? normalize(`${key.split('/').slice(0, -1).join('/')}/${spec}`) : spec;
      // A relative import inside a package (OpenZeppelin's own ../utils/Context.sol) stays in that package
      const target = relative && !(key in files) ? resolveImport(key, name, files, versions) : resolveImport(key, spec, files, versions);
      if (name in sources || queue.some((q) => q.key === name)) continue;
      if (!target) missing.push({ from: key, spec });
      else if (target.kind === 'project') {
        if (target.path in files) queue.push({ key: name, content: files[target.path] });
        else missing.push({ from: key, spec });
      } else {
        const text = await fetchText(target.url);
        if (text === null) missing.push({ from: key, spec });
        else queue.push({ key: name, content: text });
      }
    }
  }
  return { sources, missing };
}

/** The compiler's standard JSON input */
export function standardInput(sources: Record<string, { content: string }>, settings: Omit<CompilerSettings, 'version'>): string {
  return JSON.stringify({
    language: 'Solidity',
    sources,
    settings: {
      optimizer: { enabled: settings.optimize, runs: settings.runs },
      ...(settings.evmVersion ? { evmVersion: settings.evmVersion } : {}),
      ...(settings.viaIR ? { viaIR: true } : {}),
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.gasEstimates', 'evm.methodIdentifiers', 'metadata', 'devdoc', 'userdoc'], '': ['ast'] } },
    },
  });
}

export interface CompileMessage {
  severity: 'error' | 'warning' | 'info';
  message: string;
  /** e.g. "TypeError", "Warning" */
  type: string;
  file?: string;
  line?: number;
  column?: number;
  formatted: string;
}

export interface CompiledContract {
  file: string;
  name: string;
  abi: AbiItem[];
  bytecode: string;
  deployedBytecode: string;
  /** Deployed size in bytes; over 24,576 can't be deployed on mainnet (EIP-170) */
  size: number;
  gas?: { creation?: Record<string, string>; external?: Record<string, string> };
  methods: Record<string, string>;
  /** NatSpec @notice / @dev per function signature */
  docs: Record<string, string>;
}

export interface AbiParam {
  name: string;
  type: string;
  internalType?: string;
  components?: AbiParam[];
  indexed?: boolean;
}

export interface AbiItem {
  type: 'function' | 'constructor' | 'event' | 'error' | 'fallback' | 'receive';
  name?: string;
  inputs?: AbiParam[];
  outputs?: AbiParam[];
  stateMutability?: 'pure' | 'view' | 'nonpayable' | 'payable';
  anonymous?: boolean;
}

const lineCol = (text: string | undefined, offset: number | undefined) => {
  if (text === undefined || offset === undefined || offset < 0) return {};
  const before = text.slice(0, offset);
  return { line: before.split('\n').length, column: offset - before.lastIndexOf('\n') };
};

interface SolcOutput {
  errors?: { severity: string; type: string; message: string; formattedMessage?: string; sourceLocation?: { file: string; start: number; end: number } }[];
  contracts?: Record<string, Record<string, { abi: AbiItem[]; evm?: { bytecode?: { object?: string }; deployedBytecode?: { object?: string }; gasEstimates?: CompiledContract['gas']; methodIdentifiers?: Record<string, string> }; devdoc?: { methods?: Record<string, { details?: string }> }; userdoc?: { methods?: Record<string, { notice?: string }> } }>>;
}

/** Messages and contracts from the compiler's output; positions are lines and columns in the source */
export function readOutput(output: SolcOutput, sources: Record<string, { content: string }>): { messages: CompileMessage[]; contracts: CompiledContract[] } {
  const messages: CompileMessage[] = (output.errors ?? []).map((e) => ({
    severity: e.severity === 'error' ? 'error' : e.severity === 'warning' ? 'warning' : 'info',
    type: e.type,
    message: e.message,
    file: e.sourceLocation?.file,
    ...lineCol(sources[e.sourceLocation?.file ?? '']?.content, e.sourceLocation?.start),
    formatted: (e.formattedMessage ?? e.message).trim(),
  }));
  const contracts: CompiledContract[] = [];
  for (const [file, byName] of Object.entries(output.contracts ?? {})) {
    for (const [name, c] of Object.entries(byName)) {
      const bytecode = c.evm?.bytecode?.object ?? '';
      const deployed = c.evm?.deployedBytecode?.object ?? '';
      const docs: Record<string, string> = {};
      for (const [sig, d] of Object.entries(c.userdoc?.methods ?? {})) if (d.notice) docs[sig] = d.notice;
      for (const [sig, d] of Object.entries(c.devdoc?.methods ?? {})) if (d.details) docs[sig] = docs[sig] ? `${docs[sig]} ${d.details}` : d.details;
      contracts.push({ file, name, abi: c.abi ?? [], bytecode, deployedBytecode: deployed, size: deployed.length / 2, gas: c.evm?.gasEstimates, methods: c.evm?.methodIdentifiers ?? {}, docs });
    }
  }
  return { messages, contracts };
}

/** Contracts worth deploying: ones from the project (not imported libraries) with code, abstract ones and interfaces left out */
export function deployable(contracts: CompiledContract[], projectFiles: Record<string, string>): CompiledContract[] {
  return contracts.filter((c) => c.bytecode.length > 0 && c.file in projectFiles);
}

/** The project's Solidity sources that aren't dependencies or tests */
export function solidityEntries(files: Record<string, string>): string[] {
  return Object.keys(files).filter((p) => p.endsWith('.sol') && !/^(lib|out|cache|artifacts)\/|(^|\/)node_modules\//.test(p) && !/\.t\.sol$|\.s\.sol$/.test(p)).sort();
}
