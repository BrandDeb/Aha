import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findFunctions, parseSpec, partnerOf, propertiesFor, propertyTest, pyStrategy, specFiles, specPrompt, specSuggestions, tsArbitrary } from '../src/lib/specs.ts';
import { contractsOf, CONTRACTS_FILE } from '../src/lib/contracts.ts';

const files: Record<string, string> = {
  'package.json': '{"name":"x","devDependencies":{"typescript":"^6"}}',
  'src/prices.ts': `export function sortPrices(prices: number[]): number[] {
  return [...prices].sort((a, b) => a - b);
}
export const total = (items: number[]): number => items.reduce((s, n) => s + n, 0);
export function add(a: number, b: number): number { return a + b; }
export function slugify(text: string): string { return text.toLowerCase(); }
function hidden(x: number) { return x; }
`,
  'src/codec.ts': `export function encodeName(name: string): string { return btoa(name); }
export function decodeName(text: string): string { return atob(text); }
`,
  'src/prices.test.ts': 'export function notThis() {}',
  'app/tools.py': `def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))

def dedupe(items: list[int]) -> list[int]:
    return sorted(set(items))

def _private(x):
    return x
`,
};
const fns = findFunctions(files);
const fn = (name: string) => fns.find((f) => f.name === name)!;

test('finds exported functions with their types, and Python defs; skips private, unexported and test code', () => {
  assert.deepEqual(fns.map((f) => f.name).sort(), ['add', 'clamp', 'decodeName', 'dedupe', 'encodeName', 'slugify', 'sortPrices', 'total']);
  assert.deepEqual(fn('sortPrices').params, [{ name: 'prices', type: 'number[]' }]);
  assert.equal(fn('sortPrices').returns, 'number[]');
  assert.equal(fn('total').returns, 'number');
  assert.deepEqual(fn('dedupe'), { file: 'app/tools.py', name: 'dedupe', params: [{ name: 'items', type: 'list[int]' }], returns: 'list[int]', lang: 'py' });
});

test('properties fit the shape of the function; partners are found by name', () => {
  assert.ok(propertiesFor(fn('sortPrices')).includes('sorted'));
  assert.ok(propertiesFor(fn('add')).includes('commutative'));
  assert.ok(propertiesFor(fn('slugify')).includes('idempotent'));
  assert.ok(!propertiesFor(fn('slugify')).includes('sorted'));
  assert.equal(partnerOf(fn('encodeName'), fns)?.name, 'decodeName');
  assert.ok(propertiesFor(fn('encodeName'), fns).includes('round-trip'));
});

test('plain sentences become specs', () => {
  assert.equal(parseSpec('sortPrices returns prices in ascending order', fns)?.kind, 'sorted');
  assert.equal(parseSpec('sortPrices keeps the number of items', fns)?.kind, 'length-preserved');
  assert.equal(parseSpec('total never returns a negative number', fns)?.kind, 'non-negative');
  assert.equal(parseSpec('the order of the arguments does not matter for add', fns)?.kind, 'commutative');
  assert.equal(parseSpec('slugify twice is the same as once', fns)?.kind, 'idempotent');
  const rt = parseSpec('decodeName(encodeName(x)) gives back x', fns);
  assert.equal(rt?.kind, 'round-trip');
  assert.equal(rt?.fn.name, 'encodeName');
  assert.equal(rt?.partner?.name, 'decodeName');
  assert.equal(parseSpec('encodeName round-trips', fns)?.partner?.name, 'decodeName');
  const range = parseSpec('clamp returns a number between 0 and 100', fns);
  assert.deepEqual([range?.kind, range?.min, range?.max], ['in-range', 0, 100]);
  assert.equal(parseSpec('add never throws', fns)?.kind, 'never-throws');
  assert.equal(parseSpec('something vague about nothing', fns), null);
  assert.equal(parseSpec('sortPrices is fast', fns), null);
});

test('types map to generators', () => {
  assert.equal(tsArbitrary('number[]'), 'fc.array(fc.integer({ min: -1e6, max: 1e6 }))');
  assert.equal(tsArbitrary("'a' | 'b'"), "fc.constantFrom('a', 'b')");
  assert.equal(tsArbitrary('Array<string>'), 'fc.array(fc.string())');
  assert.equal(pyStrategy('list[int]'), 'st.lists(st.integers())');
  assert.equal(pyStrategy('Optional[str]'), 'st.none() | st.text()');
});

test('a TypeScript spec becomes a fast-check test, a dev dependency and a contract that runs it', () => {
  const spec = parseSpec('sortPrices returns the items in ascending order', fns)!;
  const out = specFiles(spec, files);
  assert.equal(out.test, 'tests/props/sort-prices-sorted.prop.test.ts');
  const t = out.files[out.test];
  assert.match(t, /import fc from 'fast-check';/);
  assert.match(t, /import \{ sortPrices \} from '\.\.\/\.\.\/src\/prices\.ts';/);
  assert.match(t, /fc\.property\(fc\.array\(fc\.integer\(\{ min: -1e6, max: 1e6 \}\)\), \(prices\) =>/);
  assert.match(JSON.parse(out.files['package.json']).devDependencies['fast-check'], /^\^4/);
  const contracts = contractsOf({ [CONTRACTS_FILE]: out.files[CONTRACTS_FILE] }).contracts;
  assert.deepEqual(contracts.map((c) => [c.kind, c.command]), [['command', `node -e "require.resolve('fast-check')" || npm install --no-audit --no-fund --silent && node --experimental-strip-types --test tests/props/sort-prices-sorted.prop.test.ts`]]);
  // Adding it again doesn't duplicate the contract
  const again = specFiles(spec, { ...files, ...out.files });
  assert.equal(contractsOf({ [CONTRACTS_FILE]: again.files[CONTRACTS_FILE] }).contracts.length, 1);
  assert.equal(again.files['package.json'], undefined);
});

test('with vitest, the test uses it; a round trip imports both functions', () => {
  const vitest = { ...files, 'package.json': '{"devDependencies":{"vitest":"^4"}}' };
  const t = propertyTest(parseSpec('decodeName(encodeName(x)) gives back x', fns)!, vitest);
  assert.match(t.content, /from 'vitest'/);
  assert.match(t.content, /import \{ encodeName, decodeName \} from '\.\.\/\.\.\/src\/codec';/);
  assert.match(t.content, /decodeName\(encodeName\(name\)\), name/);
  assert.match(t.command, /&& npx vitest run tests\/props\/encode-name-round-trip\.prop\.test\.ts$/);
  // No package.json: one is created with fast-check
  const bare = { 'src/a.ts': 'export function twice(n: number): number { return n * 2; }' };
  const made = specFiles(parseSpec('twice never throws', findFunctions(bare))!, bare);
  assert.deepEqual(JSON.parse(made.files['package.json']), { private: true, devDependencies: { 'fast-check': '^4.3.0' } });
});

test('a Python spec becomes a Hypothesis test run with pytest', () => {
  const t = propertyTest(parseSpec('dedupe returns the items in ascending order', fns)!, { ...files, 'pyproject.toml': '' });
  assert.equal(t.path, 'tests/test_dedupe_sorted.py');
  assert.match(t.content, /from app\.tools import dedupe/);
  assert.match(t.content, /@given\(items=st\.lists\(st\.integers\(\)\)\)/);
  assert.match(t.content, /assert all\(a <= b for a, b in zip\(out, out\[1:\]\)\), out/);
  assert.equal(t.command, 'uv run --with pytest --with hypothesis pytest -q tests/test_dedupe_sorted.py');
});

test('suggestions and the agent fallback', () => {
  const s = specSuggestions(fns);
  assert.ok(s.includes('decodeName(encodeName(x)) gives back x'));
  assert.ok(s.includes('sortPrices returns the items in ascending order'));
  assert.ok(s.every((x) => parseSpec(x, fns)), 'every suggestion parses back');
  assert.match(specPrompt('prices never lose a cent', fns), /property-based test.*\n[\s\S]*fast-check[\s\S]*Hypothesis/);
});
