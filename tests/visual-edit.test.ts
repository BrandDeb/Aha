import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, classAttr, editableAt, jsxStampModule, locateElement, offsetOf, openingTag, parseSrc, visualEditPrompt } from '../src/lib/visual-edit.ts';

const APP = `export function App() {
  const [n, setN] = useState(0);
  return (
    <main className="p-4">
      <h1 className="text-2xl font-bold">Hello there</h1>
      <button className={"btn"} onClick={() => setN(n + 1)}>Count: {n}</button>
      <img src="/x.png" alt="x" />
    </main>
  );
}
`;
const files = { 'src/App.tsx': APP, 'index.html': '<div id="root"></div>' };

test('a JSX stamp points straight at the element', () => {
  assert.deepEqual(parseSrc('src/App.tsx:5:7', files), { file: 'src/App.tsx', line: 5, column: 7, exact: true });
  assert.equal(parseSrc('project:src/App.tsx:5:7', files)?.file, 'src/App.tsx');
  assert.equal(parseSrc('src/Gone.tsx:5:7', files), null);
  assert.equal(parseSrc(null, files), null);
});

test('without a stamp, the element is found by its text or classes', () => {
  const byText = locateElement(files, { src: null, tag: 'h1', text: 'Hello there', classes: 'x', html: '' });
  assert.deepEqual(byText, { file: 'src/App.tsx', line: 5, column: 7, exact: false });
  const byClass = locateElement(files, { src: null, tag: 'h1', text: '', classes: 'text-2xl font-bold', html: '' });
  assert.equal(byClass?.line, 5);
  assert.equal(locateElement(files, { src: null, tag: 'p', text: 'Nowhere to be seen', classes: '', html: '' }), null);
});

test('the opening tag is read past braces, arrows and quotes', () => {
  const tag = openingTag(APP, offsetOf(APP, 6, 7));
  assert.ok(tag);
  assert.equal(tag.name, 'button');
  assert.equal(APP.slice(tag.start, tag.end), '<button className={"btn"} onClick={() => setN(n + 1)}>');
  assert.equal(classAttr(APP, tag)?.value, 'btn');
  assert.equal(openingTag(APP, offsetOf(APP, 7, 7))?.selfClosing, true);
});

test('literal text and classes are editable; expressions are left to the agent', () => {
  assert.deepEqual(editableAt(APP, { line: 5, column: 7 }), { tag: 'h1', text: 'Hello there', classes: 'text-2xl font-bold' });
  assert.deepEqual(editableAt(APP, { line: 6, column: 7 }), { tag: 'button', text: 'Count:', classes: 'btn' });
  assert.deepEqual(editableAt(APP, { line: 7, column: 7 }), { tag: 'img', text: null, classes: null });
});

test('edits land in the source, both at once, and stay valid JSX', () => {
  const out = applyEdit(APP, { line: 5, column: 7 }, { text: 'Hi {you} <3', classes: 'text-4xl text-blue-600' });
  assert.ok(out);
  assert.match(out, /<h1 className="text-4xl text-blue-600">Hi \{'\{'\}you\{'\}'\} \{'<'\}3<\/h1>/);
  assert.equal(out.split('\n').length, APP.split('\n').length);
  const pressed = applyEdit(APP, { line: 6, column: 7 }, { text: 'Clicks:' });
  assert.match(pressed!, />Clicks: \{n\}<\/button>/);
  assert.equal(applyEdit(APP, { line: 7, column: 7 }, { text: 'x' }), null);
});

test('the agent gets the element, where it is, the code around it and the ask', () => {
  const el = { src: 'src/App.tsx:5:7', tag: 'h1', text: 'Hello there', classes: 'text-2xl', html: '<h1>', chain: ['src/App.tsx:4:5'] };
  const prompt = visualEditPrompt(el, parseSrc(el.src, files), 'make it a gradient', APP);
  assert.match(prompt, /<h1> with the text "Hello there"/);
  assert.match(prompt, /src\/App\.tsx:5/);
  assert.match(prompt, /5\|\s+<h1 className/);
  assert.match(prompt, /Change: make it a gradient/);
  assert.match(visualEditPrompt(el, null, 'x'), /not found in the code/);
});

test('the JSX runtime wrapper stamps page elements only', async () => {
  const code = jsxStampModule('https://esm.sh/react/jsx-dev-runtime');
  const calls: unknown[][] = [];
  (globalThis as Record<string, unknown>).__rt = { Fragment: 'F', jsxDEV: (...a: unknown[]) => calls.push(a) };
  const mod = await import(`data:text/javascript,${encodeURIComponent(code.replace(/^import .*$/m, 'const rt = globalThis.__rt;'))}`);
  mod.jsxDEV('div', { id: 'a' }, undefined, false, { fileName: 'src/App.tsx', lineNumber: 3, columnNumber: 5 });
  mod.jsxDEV(function C() {}, { id: 'b' }, undefined, false, { fileName: 'src/App.tsx', lineNumber: 4, columnNumber: 5 });
  assert.deepEqual(calls[0][1], { id: 'a', 'data-nano-src': 'src/App.tsx:3:5' });
  assert.deepEqual(calls[1][1], { id: 'b' });
});
