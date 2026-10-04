import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDependencyGraph,
  buildTree,
  comboFromEvent,
  deletePath,
  diffStatus,
  formatCombo,
  lineDelta,
  movePath,
  parseImports,
  resolvePath,
  type Project,
} from '../src/workspace/project.ts';

const project = (files: Record<string, string>, entry = 'src/main.ts', folders: string[] = []): Project => ({
  name: 'p', files, folders, entry,
});

test('resolvePath behaves like a shell', () => {
  assert.equal(resolvePath('src', 'lib/a.ts'), 'src/lib/a.ts');
  assert.equal(resolvePath('src/lib', '../main.ts'), 'src/main.ts');
  assert.equal(resolvePath('src', '/README.md'), 'README.md');
  assert.equal(resolvePath('', '..'), null);
  assert.equal(resolvePath('src', '.'), 'src');
});

test('buildTree lists folders first, including empty folders', () => {
  const tree = buildTree(project({ 'src/main.ts': '', 'src/lib/a.ts': '', 'README.md': '' }, 'src/main.ts', ['assets']));
  assert.deepEqual(tree.map((n) => `${n.type}:${n.path}`), ['folder:assets', 'folder:src', 'file:README.md']);
  const src = tree[1];
  assert.deepEqual(src.children.map((n) => n.name), ['lib', 'main.ts']);
});

test('movePath renames files and folders and keeps the entry', () => {
  const p = project({ 'src/main.ts': 'm', 'src/lib/a.ts': 'a' });
  const renamed = movePath(p, 'src', 'app');
  assert.ok(!('error' in renamed));
  assert.deepEqual(Object.keys(renamed.files).sort(), ['app/lib/a.ts', 'app/main.ts']);
  assert.equal(renamed.entry, 'app/main.ts');
  assert.ok('error' in movePath(p, 'src/main.ts', 'src/lib/a.ts'));
  assert.ok('error' in movePath(p, 'src', 'src/inner'));
  assert.ok('error' in movePath(p, 'src/main.ts', '../x.ts'));
});

test('deletePath removes folders recursively and picks a new entry', () => {
  const p = project({ 'src/main.ts': '', 'src/lib/a.ts': '', 'tools/run.ts': '' });
  const next = deletePath(p, 'src');
  assert.deepEqual(Object.keys(next.files), ['tools/run.ts']);
  assert.equal(next.entry, 'tools/run.ts');
});

test('diffStatus and lineDelta summarise changes', () => {
  assert.deepEqual(diffStatus({ a: '1', b: '2', c: '3' }, { a: '1', b: '22', d: '4' }), { b: 'modified', d: 'added', c: 'deleted' });
  assert.deepEqual(lineDelta('a\nb\nc', 'a\nB\nc\nd'), { added: 2, removed: 1 });
});

test('parseImports finds static, re-export, dynamic and require imports but skips comments', () => {
  const src = `import { a } from './a';\nimport type { T } from "./types";\nexport * from './b';\nconst c = await import('./c');\nconst fs = require('node:fs');\n// import x from './nope';\n/* import y from './nope2' */\nimport './side-effect';`;
  assert.deepEqual(parseImports(src).sort(), ['./a', './b', './c', './side-effect', './types', 'node:fs']);
});

test('buildDependencyGraph resolves imports, finds cycles and unreachable files', () => {
  const graph = buildDependencyGraph({
    'src/main.ts': "import './a';\nimport { readFileSync } from 'node:fs';",
    'src/a.ts': "import { b } from './lib/b.js';",
    'src/lib/b.ts': "import '../a';\nimport './missing';",
    'src/unused.ts': 'export {};',
    'README.md': 'import x from "./a"',
  }, 'src/main.ts');
  assert.deepEqual(graph.edges['src/main.ts'], ['src/a.ts']);
  assert.deepEqual(graph.edges['src/a.ts'], ['src/lib/b.ts']);
  assert.deepEqual(graph.external['src/main.ts'], ['node:fs']);
  assert.deepEqual(graph.unresolved['src/lib/b.ts'], ['./missing']);
  assert.deepEqual(graph.cycles, [['src/a.ts', 'src/lib/b.ts']]);
  assert.deepEqual(graph.unreachable, ['src/unused.ts']);
  assert.deepEqual(graph.depth, { 'src/main.ts': 0, 'src/a.ts': 1, 'src/lib/b.ts': 2 });
});

test('keybindings normalise across platforms', () => {
  const ev = (o: Partial<KeyboardEvent>) => ({ key: '', code: '', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...o });
  assert.equal(comboFromEvent(ev({ key: 'Enter', code: 'Enter', metaKey: true }), true), 'Mod+Enter');
  assert.equal(comboFromEvent(ev({ key: 'Enter', code: 'Enter', ctrlKey: true }), false), 'Mod+Enter');
  assert.equal(comboFromEvent(ev({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }), false), 'Mod+Shift+F');
  assert.equal(comboFromEvent(ev({ key: '|', code: 'Backslash', metaKey: true, shiftKey: true }), true), 'Mod+Shift+\\');
  assert.equal(comboFromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true), null);
  assert.equal(formatCombo('Mod+Shift+F', true), '⌘⇧F');
  assert.equal(formatCombo('Mod+Shift+F', false), 'Ctrl+Shift+F');
});
