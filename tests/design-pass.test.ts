import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDesign, compareScores, designBrief, offGrid, parseReport, scoreOf, stateFindings, type DesignReport } from '../src/lib/design-pass.ts';
import { DESIGN_PROBE } from '../src/lib/design-probe.ts';

const tidy: DesignReport = { fontSizes: { 14: 10, 16: 30, 24: 3, 32: 1 }, spacing: { 4: 8, 8: 20, 16: 12, 24: 4 }, contrast: [], empty: [], width: 1024, height: 900, elements: 80 };
const messy: DesignReport = {
  fontSizes: { 11: 2, 13: 4, 14: 6, 15: 3, 16: 20, 19: 1, 22: 2, 30: 1 },
  spacing: { 1: 3, 4: 5, 7: 2, 8: 9, 13: 4, 16: 6, 18: 1 },
  contrast: [{ text: 'Sign up free', label: 'button.cta', src: 'src/App.tsx:12:7', fg: '#aaaaaa', bg: '#ffffff', ratio: 2.32, large: false }],
  empty: ['ul.todos (src/App.tsx:20:9)'],
  width: 1024,
  height: 1200,
  elements: 120,
};

test('a tidy page has nothing to fix', () => {
  assert.deepEqual(analyzeDesign(tidy, { 'src/App.tsx': 'export const App = () => <main>Hi</main>;' }), []);
});

test('spacing off the 4px grid is flagged; hairlines are not', () => {
  assert.deepEqual(offGrid(messy.spacing), [7, 13, 18]);
  assert.deepEqual(offGrid({ 1: 4, 2: 2, 4: 1 }), []);
});

test('a messy page: type scale, spacing, contrast and an empty list', () => {
  const f = analyzeDesign(messy, {});
  assert.deepEqual(f.map((x) => x.kind), ['type', 'spacing', 'contrast', 'empty']);
  assert.equal(f[0].title, '8 font sizes');
  assert.match(f[0].detail, /14px, 15px, 16px are within 2px/);
  assert.equal(f[1].title, '3 spacing values off the 4px grid');
  assert.match(f[2].detail, /“Sign up free” \(button\.cta, src\/App\.tsx:12:7\) is #aaaaaa on #ffffff: 2\.32:1, under the 4\.5:1/);
  assert.match(f[3].detail, /ul\.todos/);
});

test('the source says where loading and empty states are missing', () => {
  const files = {
    'src/Users.tsx': "export function Users() {\n  const [users, setUsers] = useState([]);\n  useEffect(() => { fetch('/api/users').then((r) => r.json()).then(setUsers); }, []);\n  return <ul>{users.map((u) => <li>{u.name}</li>)}</ul>;\n}\n",
    'src/Done.tsx': "export function Done({ items, loading }) {\n  if (loading) return <p>Loading…</p>;\n  if (!items.length) return <p>No items yet</p>;\n  return <ul>{items.map((i) => <li>{i}</li>)}</ul>;\n}\n",
    'src/api.ts': "export const load = () => fetch('/x');",
  };
  assert.deepEqual(stateFindings(files).map((f) => `${f.kind}: ${f.detail.split(' ')[0]}`), ['loading: src/Users.tsx', 'empty: src/Users.tsx']);
  // An empty list already seen on screen is not reported twice
  assert.deepEqual(analyzeDesign({ ...tidy, empty: ['ul'] }, files).map((f) => f.kind), ['empty', 'loading']);
});

test('the brief lists every finding, the rules and the numbers to beat', () => {
  const brief = designBrief(analyzeDesign(messy, {}), scoreOf(messy));
  assert.match(brief, /^Design pass on this web app\. A screenshot/);
  assert.match(brief, /1\. 8 font sizes\./);
  assert.match(brief, /keep the layout, content and behaviour/);
  assert.match(brief, /Add no dependencies/);
  assert.match(brief, /Measured now: 8 font sizes, 3 spacing values off the 4px grid, 1 text elements with too little contrast, 1 empty lists/);
});

test('before and after are compared on what changed', () => {
  assert.deepEqual(compareScores(scoreOf(messy), scoreOf(tidy)), ['font sizes: 8 → 4', 'spacing values off the grid: 3 → 0', 'contrast failures: 1 → 0', 'empty lists on screen: 1 → 0']);
});

test('what the page sends back is checked before use', () => {
  assert.equal(parseReport(null), null);
  assert.equal(parseReport('x'), null);
  const r = parseReport({ fontSizes: { 16: 3, evil: 'x', 12: 'y' }, spacing: { 8: 2 }, contrast: [{ ratio: 2, text: 'a'.repeat(500), src: 5 }, { text: 'no ratio' }], empty: [1, 'ul'], width: '800' })!;
  assert.deepEqual(r.fontSizes, { 16: 3 });
  assert.equal(r.contrast.length, 1);
  assert.equal(r.contrast[0].text.length, 60);
  assert.equal(r.contrast[0].src, null);
  assert.deepEqual(r.empty, ['', 'ul']);
  assert.equal(r.width, 800);
});

test('the probe is valid script', () => {
  assert.doesNotThrow(() => new Function(DESIGN_PROBE));
  assert.doesNotMatch(DESIGN_PROBE, /<\/script/i);
});
