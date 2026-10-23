/**
 * Specs: say what must always be true about a function, in plain words ("sortPrices keeps the number of
 * items", "decode(encode(x)) gives back x", "total never returns a negative number"), and the studio turns it
 * into a property-based test (fast-check for TypeScript and JavaScript, Hypothesis for Python) that throws
 * hundreds of random inputs at the function, plus a contract that runs it, so the rule is checked on every
 * proposal from then on. Common properties are recognised here without a model; anything else goes to the agent
 * with the same instructions. Pure, so it is tested directly.
 */

import { contractsOf, CONTRACTS_FILE, serializeContracts, type Contract } from './contracts.ts';

export type SpecLang = 'ts' | 'js' | 'py';

export interface FnParam {
  name: string;
  /** As written: "number", "string[]", "list[int]"; '' when untyped */
  type: string;
}

export interface FnInfo {
  file: string;
  name: string;
  params: FnParam[];
  returns: string;
  lang: SpecLang;
}

export type PropertyKind = 'never-throws' | 'deterministic' | 'idempotent' | 'length-preserved' | 'sorted' | 'non-negative' | 'commutative' | 'round-trip' | 'in-range';

export interface Spec {
  /** The sentence, as the rule of the contract */
  rule: string;
  kind: PropertyKind;
  fn: FnInfo;
  /** round-trip: the function that undoes fn */
  partner?: FnInfo;
  /** in-range: the bounds */
  min?: number;
  max?: number;
}

const LANG_OF = (path: string): SpecLang | null => (/\.(ts|tsx|mts|cts)$/.test(path) ? 'ts' : /\.(js|jsx|mjs|cjs)$/.test(path) ? 'js' : /\.py$/.test(path) ? 'py' : null);
const SKIP = /(^|\/)(node_modules|dist|build|\.venv|venv|\.nanocli)\/|\.d\.ts$|(^|\/)(tests?|__tests__)\/|\.(test|spec)\.\w+$|(^|\/)test_\w+\.py$/;

/** Split "a: number, b: Map<string, number>" at top-level commas */
function splitParams(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if ('<([{'.includes(c)) depth++;
    else if ('>)]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

function param(text: string, lang: SpecLang): FnParam {
  const clean = text.replace(/=.*$/, '').replace(/^\.\.\./, '').trim();
  const colon = clean.indexOf(':');
  if (colon < 0) return { name: clean.replace(/[?*]/g, ''), type: '' };
  return { name: clean.slice(0, colon).replace(/[?*]/g, '').trim(), type: clean.slice(colon + 1).trim().replace(lang === 'py' ? /\s+/g : /$^/, '') };
}

/** Exported functions (TypeScript, JavaScript) and top-level functions (Python) a spec can be about */
export function findFunctions(files: Record<string, string>): FnInfo[] {
  const out: FnInfo[] = [];
  for (const [file, text] of Object.entries(files)) {
    const lang = LANG_OF(file);
    if (!lang || SKIP.test(file)) continue;
    if (lang === 'py') {
      for (const m of text.matchAll(/^def\s+([A-Za-z]\w*)\s*\(([^)]*)\)\s*(?:->\s*([^:]+))?:/gm)) {
        if (m[1].startsWith('_')) continue;
        out.push({ file, name: m[1], params: splitParams(m[2]).filter((p) => p !== 'self' && !p.startsWith('*')).map((p) => param(p, lang)), returns: (m[3] ?? '').trim(), lang });
      }
      continue;
    }
    const seen = new Set<string>();
    const fnDecl = /export\s+(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^{]+))?\{/g;
    const arrow = /export\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:<[^>]*>)?\s*\(([^)]*)\)\s*(?::\s*([^=]+?))?\s*=>/g;
    for (const re of [fnDecl, arrow]) {
      for (const m of text.matchAll(re)) {
        if (seen.has(m[1])) continue;
        seen.add(m[1]);
        out.push({ file, name: m[1], params: splitParams(m[2]).map((p) => param(p, lang)), returns: (m[3] ?? '').trim(), lang });
      }
    }
  }
  return out;
}

const isArray = (t: string) => /\[\]$|^Array<|^(readonly\s+)?\w+\[\]$|^list\[|^List\[|^Sequence\[/.test(t);
const isNumber = (t: string) => /^(number|bigint|int|float)$/.test(t);
const sameType = (a: string, b: string) => a.replace(/\s/g, '') === b.replace(/\s/g, '');

/** Which properties make sense for a function, by its shape */
export function propertiesFor(fn: FnInfo, all: FnInfo[] = []): PropertyKind[] {
  const kinds: PropertyKind[] = ['never-throws', 'deterministic'];
  const [a, b] = fn.params;
  if (fn.params.length === 1 && a.type && sameType(a.type, fn.returns)) kinds.push('idempotent');
  if (fn.params.length === 1 && isArray(a.type) && isArray(fn.returns)) kinds.push('length-preserved', 'sorted');
  if (isNumber(fn.returns)) kinds.push('non-negative', 'in-range');
  if (fn.params.length === 2 && a.type && sameType(a.type, b.type)) kinds.push('commutative');
  if (partnerOf(fn, all)) kinds.push('round-trip');
  return kinds;
}

const PAIRS: [RegExp, string][] = [
  [/^encode/i, 'decode'],
  [/^serialize/i, 'deserialize'],
  [/^stringify/i, 'parse'],
  [/^compress/i, 'decompress'],
  [/^encrypt/i, 'decrypt'],
  [/^to([A-Z]\w*)$/, 'from$1'],
  [/^format/i, 'parse'],
  [/^pack/i, 'unpack'],
  [/^escape/i, 'unescape'],
];

/** The function that undoes this one, by name: encode → decode, toJson → fromJson, format → parse */
export function partnerOf(fn: FnInfo, all: FnInfo[]): FnInfo | undefined {
  for (const [re, to] of PAIRS) {
    if (!re.test(fn.name)) continue;
    const want = fn.name.replace(re, to).toLowerCase();
    const hit = all.find((g) => g !== fn && g.lang === fn.lang && g.name.toLowerCase() === want);
    if (hit) return hit;
  }
  return undefined;
}

/** The sentence a property reads as, for suggestions */
export function sentenceFor(kind: PropertyKind, fn: FnInfo, partner?: FnInfo): string {
  const f = fn.name;
  switch (kind) {
    case 'never-throws': return `${f} never throws`;
    case 'deterministic': return `${f} always gives the same answer for the same input`;
    case 'idempotent': return `applying ${f} twice is the same as applying it once`;
    case 'length-preserved': return `${f} keeps the number of items`;
    case 'sorted': return `${f} returns the items in ascending order`;
    case 'non-negative': return `${f} never returns a negative number`;
    case 'commutative': return `${f}(a, b) is the same as ${f}(b, a)`;
    case 'round-trip': return `${partner?.name ?? 'decode'}(${f}(x)) gives back x`;
    case 'in-range': return `${f} returns a number between 0 and 100`;
  }
}

const KEYWORDS: [PropertyKind, RegExp][] = [
  ['round-trip', /gives? back|round.?trip|inverse|undoes|get(s)? (the )?(original|input) back|returns? the original/i],
  ['commutative', /order (of (the )?arguments )?(does ?n[o']t|does not|never) matter|commutative|swap|same as \w+\s*\(\s*b\s*,\s*a\s*\)/i],
  ['idempotent', /twice|idempotent|again (changes|does) nothing|second time/i],
  ['length-preserved', /(keeps?|preserves?|same) (the )?(number|count|length|size)|loses? (no|nothing)|drops? nothing/i],
  ['sorted', /sorted|ascending|in order|smallest (first|to largest)|increasing/i],
  ['in-range', /between\s+-?\d/i],
  ['non-negative', /negative|below zero|less than (0|zero)|at least (0|zero)|>=\s*0/i],
  ['never-throws', /never (throws?|crash(es)?|fails?|errors?)|does ?n[o']t (throw|crash)|no (exceptions?|errors?)/i],
  ['deterministic', /same (answer|result|output|value)|deterministic|pure/i],
];

/**
 * Read a sentence as a spec: which property, about which function (named in the sentence; the one that
 * appears first wins). Null when the sentence names no known function or no property is recognised: then the
 * agent writes it.
 */
export function parseSpec(sentence: string, fns: FnInfo[]): Spec | null {
  const text = sentence.trim();
  if (!text) return null;
  const named = fns
    .map((fn) => ({ fn, at: text.search(new RegExp(`(^|[^\\w$])${fn.name.replace(/\$/g, '\\$')}(?![\\w$])`)) }))
    .filter((x) => x.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (!named.length) return null;
  const kind = KEYWORDS.find(([, re]) => re.test(text))?.[0];
  if (!kind) return null;
  if (kind === 'round-trip') {
    // "decode(encode(x)) gives back x": the inner call is the function, the outer one its partner
    const inner = text.match(/(\w+)\s*\(\s*(\w+)\s*\(/);
    const outerFn = inner ? fns.find((f) => f.name === inner[1]) : undefined;
    const innerFn = inner ? fns.find((f) => f.name === inner[2]) : undefined;
    if (outerFn && innerFn) return { rule: text, kind, fn: innerFn, partner: outerFn };
    const fn = named[0].fn;
    const partner = named[1]?.fn ?? partnerOf(fn, fns);
    return partner ? { rule: text, kind, fn, partner } : null;
  }
  const fn = named[0].fn;
  if (kind === 'in-range') {
    const m = text.match(/between\s+(-?\d+(?:\.\d+)?)\s+(?:and|to)\s+(-?\d+(?:\.\d+)?)/i);
    if (!m) return null;
    return { rule: text, kind, fn, min: Number(m[1]), max: Number(m[2]) };
  }
  return { rule: text, kind, fn };
}

// ─── Generating the test ────────────────────────────────────────────────────

/** A fast-check arbitrary for a TypeScript type; untyped and unknown types get a mix of plain values */
export function tsArbitrary(type: string): string {
  const t = type.replace(/\s/g, '').replace(/^readonly/, '');
  if (!t) return 'fc.oneof(fc.integer(), fc.string(), fc.boolean())';
  if (t === 'number') return 'fc.integer({ min: -1e6, max: 1e6 })';
  if (t === 'bigint') return 'fc.bigInt()';
  if (t === 'string') return 'fc.string()';
  if (t === 'boolean') return 'fc.boolean()';
  const arr = t.match(/^(.+)\[\]$/) ?? t.match(/^Array<(.+)>$/);
  if (arr) return `fc.array(${tsArbitrary(arr[1])})`;
  const union = t.split('|');
  if (union.length > 1 && union.every((u) => /^'[^']*'$|^"[^"]*"$/.test(u))) return `fc.constantFrom(${union.join(', ')})`;
  if (union.length > 1) return `fc.oneof(${union.map(tsArbitrary).join(', ')})`;
  if (t === 'null') return 'fc.constant(null)';
  if (t === 'undefined') return 'fc.constant(undefined)';
  return 'fc.anything()';
}

/** A Hypothesis strategy for a Python annotation */
export function pyStrategy(type: string): string {
  const t = type.replace(/\s/g, '');
  if (!t) return 'st.one_of(st.integers(), st.text(), st.booleans())';
  if (t === 'int') return 'st.integers()';
  if (t === 'float') return 'st.floats(allow_nan=False, allow_infinity=False)';
  if (t === 'str') return 'st.text()';
  if (t === 'bool') return 'st.booleans()';
  if (t === 'bytes') return 'st.binary()';
  const list = t.match(/^(?:list|List|Sequence)\[(.+)\]$/);
  if (list) return `st.lists(${pyStrategy(list[1])})`;
  const opt = t.match(/^Optional\[(.+)\]$/) ?? t.match(/^(.+)\|None$/);
  if (opt) return `st.none() | ${pyStrategy(opt[1])}`;
  const dict = t.match(/^dict\[(.+),(.+)\]$/);
  if (dict) return `st.dictionaries(${pyStrategy(dict[1])}, ${pyStrategy(dict[2])})`;
  return 'st.from_type(object)';
}

const slug = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Where the test goes, how to import the function from there, and the test runner */
export function testPlan(spec: Spec, files: Record<string, string>): { path: string; command: string; runner: 'vitest' | 'node' | 'pytest' } {
  const name = `${slug(spec.fn.name)}-${spec.kind}`;
  if (spec.fn.lang === 'py') {
    const path = `tests/test_${name.replace(/-/g, '_')}.py`;
    const uv = 'pyproject.toml' in files;
    // uv brings pytest and Hypothesis along for the run: nothing to install first
    return { path, runner: 'pytest', command: uv ? `uv run --with pytest --with hypothesis pytest -q ${path}` : `uvx --with hypothesis pytest -q ${path}` };
  }
  let vitest = false;
  try {
    const pkg = JSON.parse(files['package.json'] ?? '{}');
    vitest = 'vitest' in { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  } catch {
    // not JSON: the node runner works without it
  }
  const ext = spec.fn.lang === 'ts' ? 'ts' : 'mjs';
  const path = `tests/props/${name}.prop.test.${ext}`;
  // Install the packages first when fast-check isn't there yet (a fresh checkout); the same syntax works in sh and cmd
  const install = `node -e "require.resolve('fast-check')" || npm install --no-audit --no-fund --silent && `;
  return vitest
    ? { path, runner: 'vitest', command: `${install}npx vitest run ${path}` }
    : { path, runner: 'node', command: `${install}${spec.fn.lang === 'ts' ? 'node --experimental-strip-types --test' : 'node --test'} ${path}` };
}

/** "src/sort.ts" imported from "tests/props/x.prop.test.ts": "../../src/sort.ts" */
function importPath(from: string, to: string, runner: string): string {
  const up = from.split('/').length - 1;
  const rel = `${'../'.repeat(up)}${to}`;
  // vitest resolves without extensions; node needs the real file
  return runner === 'vitest' ? rel.replace(/\.(ts|tsx|mts|js|mjs)$/, '') : rel;
}

/** The property, as the body of a fast-check / Hypothesis check */
function tsBody(spec: Spec): { args: string; body: string } {
  const f = spec.fn.name;
  const ps = spec.fn.params.length ? spec.fn.params : [{ name: 'x', type: '' }];
  const names = ps.map((p, i) => p.name || `a${i}`);
  const call = `${f}(${names.join(', ')})`;
  const arbs = ps.map((p) => tsArbitrary(p.type)).join(', ');
  const args = `${arbs}, (${names.join(', ')}) =>`;
  switch (spec.kind) {
    case 'never-throws': return { args, body: `{ ${call}; }` };
    case 'deterministic': return { args, body: `{ assert.deepStrictEqual(${call}, ${call}); }` };
    case 'idempotent': return { args, body: `{ const once = ${call}; assert.deepStrictEqual(${f}(once), once); }` };
    case 'length-preserved': return { args, body: `{ assert.strictEqual(${call}.length, ${names[0]}.length); }` };
    case 'sorted': return { args, body: `{ const out = ${call}; for (let i = 1; i < out.length; i++) assert.ok(out[i - 1] <= out[i], \`\${JSON.stringify(out[i - 1])} comes before \${JSON.stringify(out[i])}\`); }` };
    case 'non-negative': return { args, body: `{ assert.ok(${call} >= 0); }` };
    case 'in-range': return { args, body: `{ const v = ${call}; assert.ok(v >= ${spec.min} && v <= ${spec.max}, \`\${v} is outside ${spec.min}..${spec.max}\`); }` };
    case 'commutative': return { args, body: `{ assert.deepStrictEqual(${f}(${names[0]}, ${names[1]}), ${f}(${names[1]}, ${names[0]})); }` };
    case 'round-trip': return { args, body: `{ assert.deepStrictEqual(${spec.partner!.name}(${call}), ${names[0]}); }` };
  }
}

function pyBody(spec: Spec): { given: string; params: string; body: string } {
  const f = spec.fn.name;
  const ps = spec.fn.params.length ? spec.fn.params : [{ name: 'x', type: '' }];
  const names = ps.map((p, i) => p.name || `a${i}`);
  const call = `${f}(${names.join(', ')})`;
  const given = ps.map((p, i) => `${names[i]}=${pyStrategy(p.type)}`).join(', ');
  const params = names.join(', ');
  switch (spec.kind) {
    case 'never-throws': return { given, params, body: `    ${call}` };
    case 'deterministic': return { given, params, body: `    assert ${call} == ${call}` };
    case 'idempotent': return { given, params, body: `    once = ${call}\n    assert ${f}(once) == once` };
    case 'length-preserved': return { given, params, body: `    assert len(${call}) == len(${names[0]})` };
    case 'sorted': return { given, params, body: `    out = ${call}\n    assert all(a <= b for a, b in zip(out, out[1:])), out` };
    case 'non-negative': return { given, params, body: `    assert ${call} >= 0` };
    case 'in-range': return { given, params, body: `    v = ${call}\n    assert ${spec.min} <= v <= ${spec.max}, v` };
    case 'commutative': return { given, params, body: `    assert ${f}(${names[0]}, ${names[1]}) == ${f}(${names[1]}, ${names[0]})` };
    case 'round-trip': return { given, params, body: `    assert ${spec.partner!.name}(${call}) == ${names[0]}` };
  }
}

/** The test file for a spec */
export function propertyTest(spec: Spec, files: Record<string, string>): { path: string; content: string; command: string } {
  const plan = testPlan(spec, files);
  if (spec.fn.lang === 'py') {
    const mod = spec.fn.file.replace(/\.py$/, '').replace(/^src\//, '').replace(/\//g, '.');
    const imports = [spec.fn.name, spec.partner?.name].filter(Boolean).join(', ');
    const b = pyBody(spec);
    const content = `"""Property: ${spec.rule.replace(/"""/g, "'''")}

Hypothesis tries hundreds of random inputs and, when one breaks the rule, shrinks it to the smallest example.
Written by NanoCLI Studio from the spec; the contract "${spec.rule.replace(/"/g, "'")}" runs it.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from hypothesis import given, settings, strategies as st

from ${mod} import ${imports}


@settings(max_examples=200, deadline=None)
@given(${b.given})
def test_${slug(spec.fn.name).replace(/-/g, '_')}_${spec.kind.replace(/-/g, '_')}(${b.params}):
${b.body}
`;
    return { path: plan.path, content, command: plan.command };
  }
  const b = tsBody(spec);
  const from = importPath(plan.path, spec.fn.file, plan.runner);
  const partnerFrom = spec.partner ? importPath(plan.path, spec.partner.file, plan.runner) : null;
  const imports = partnerFrom && partnerFrom !== from ? `import { ${spec.fn.name} } from '${from}';\nimport { ${spec.partner!.name} } from '${partnerFrom}';` : `import { ${[spec.fn.name, spec.partner?.name].filter(Boolean).join(', ')} } from '${from}';`;
  const content = `// Property: ${spec.rule.replace(/\n/g, ' ')}
// fast-check tries hundreds of random inputs and, when one breaks the rule, shrinks it to the smallest example.
// Written by NanoCLI Studio from the spec; the contract "${spec.rule.replace(/"/g, "'")}" runs it.
import ${plan.runner === 'vitest' ? "{ test } from 'vitest'" : "{ test } from 'node:test'"};
import assert from 'node:assert/strict';
import fc from 'fast-check';
${imports}

test(${JSON.stringify(spec.rule)}, () => {
  fc.assert(fc.property(${b.args} ${b.body}), { numRuns: 200 });
});
`;
  return { path: plan.path, content, command: plan.command };
}

/**
 * Everything a spec adds to the project: the test, fast-check in package.json when it is missing, and the
 * contract that runs the test. Returned as files to write.
 */
export function specFiles(spec: Spec, files: Record<string, string>): { files: Record<string, string>; contract: Omit<Contract, 'id'>; test: string } {
  const test = propertyTest(spec, files);
  const out: Record<string, string> = { [test.path]: test.content };
  if (spec.fn.lang !== 'py' && !files['package.json']) out['package.json'] = `${JSON.stringify({ private: true, devDependencies: { 'fast-check': '^4.3.0' } }, null, 2)}\n`;
  else if (spec.fn.lang !== 'py') {
    try {
      const pkg = JSON.parse(files['package.json']);
      if (!pkg.dependencies?.['fast-check'] && !pkg.devDependencies?.['fast-check']) {
        pkg.devDependencies = { ...(pkg.devDependencies ?? {}), 'fast-check': '^4.3.0' };
        out['package.json'] = `${JSON.stringify(pkg, null, 2)}\n`;
      }
    } catch {
      // leave a package.json that isn't JSON alone; the agent can sort it out
    }
  }
  const contract: Omit<Contract, 'id'> = { rule: spec.rule, kind: 'command', command: test.command };
  const existing = contractsOf(files).contracts.filter((c) => !(c.kind === 'command' && c.command === test.command));
  out[CONTRACTS_FILE] = serializeContracts([...existing, { ...contract, id: '' }]);
  // serializeContracts keeps ids it is given; give the new one its own
  out[CONTRACTS_FILE] = serializeContracts(contractsOf({ [CONTRACTS_FILE]: out[CONTRACTS_FILE] }).contracts);
  return { files: out, contract, test: test.path };
}

/** What the agent is asked when a spec isn't one of the recognised properties */
export function specPrompt(sentence: string, fns: FnInfo[]): string {
  const ts = fns.some((f) => f.lang !== 'py');
  const py = fns.some((f) => f.lang === 'py');
  const tools = [ts ? 'fast-check (add it to devDependencies) with the project\'s test runner (vitest when it has one, otherwise node:test)' : '', py ? 'Hypothesis with pytest' : ''].filter(Boolean).join(', or ');
  return `Turn this spec into a property-based test and a contract that runs it: "${sentence.trim()}".

1. Work out which function(s) it is about${fns.length ? ` (the project's functions include ${fns.slice(0, 12).map((f) => `${f.name} in ${f.file}`).join(', ')})` : ''}.
2. Write a property-based test with ${tools || 'the language\'s property-testing library'}: generate random inputs of the right types (a few hundred runs), and assert the property for every one. Put it under tests/ named after the function and the property.
3. Add a "command" contract to ${CONTRACTS_FILE} whose rule is the spec sentence and whose command runs just that test. Keep the existing contracts.
4. Run it (check_contracts). If the property fails, report the smallest counterexample the library found and whether the code or the spec is wrong; do not change the code to make it pass unless that is clearly a bug, and say so either way.`;
}

/** Suggestions for the spec box: for each function, the properties that fit its shape */
export function specSuggestions(fns: FnInfo[], limit = 8): string[] {
  const out: string[] = [];
  const interesting: PropertyKind[] = ['round-trip', 'sorted', 'length-preserved', 'idempotent', 'commutative', 'non-negative'];
  for (const kind of interesting) {
    for (const fn of fns) {
      if (out.length >= limit) return out;
      if (propertiesFor(fn, fns).includes(kind)) out.push(sentenceFor(kind, fn, partnerOf(fn, fns)));
    }
  }
  for (const fn of fns) {
    if (out.length >= limit) break;
    out.push(sentenceFor('never-throws', fn));
  }
  return out;
}
