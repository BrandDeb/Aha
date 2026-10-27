import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-lsp-'));
process.env.AHA_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));

const { lspNotify, lspPoll, lspRequest, mapUris, startLsp, stopLsp, toClientUri, toServerUri } = await import('../src/lib/lsp/session.ts');
const { findServer, serverForFile } = await import('../src/lib/lsp/servers.ts');

test('URIs: editor paths map into the project folder and back; nothing outside it can be named', () => {
  const root = 'file:///home/me/.aha/lsp/p-python';
  assert.equal(toServerUri('file:///src/a+b.py', root), `${root}/src/a%2Bb.py`);
  assert.equal(toClientUri(`${root}/src/a%2Bb.py`, root), 'file:///src/a+b.py');
  assert.equal(toClientUri('file:///usr/lib/python3/os.py', root), 'file:///usr/lib/python3/os.py', 'library files stay as they are');
  for (const bad of ['file:///../etc/passwd', 'file:///src/%2e%2e/%2e%2e/x', 'file:///./x', 'https://x', 'file:///%zz']) assert.equal(toServerUri(bad, root), null, bad);
  assert.throws(() => mapUris({ textDocument: { uri: 'file:///../../etc/passwd' } }, (u) => toServerUri(u, root)), /outside the project/);
  const edit = mapUris({ changes: { [`${root}/a.py`]: [{ newText: 'x' }] } }, (u) => toClientUri(u, root));
  assert.deepEqual(edit, { changes: { 'file:///a.py': [{ newText: 'x' }] } }, 'WorkspaceEdit keys are URIs too');
  assert.equal(serverForFile('main.go')?.id, 'go');
  assert.equal(serverForFile('a.ts'), undefined);
});

const wait = async (id: string, file: string, ms = 60_000) => {
  let since = 0;
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const { messages } = await lspPoll(id, since, 2000);
    for (const m of messages) {
      since = m.seq;
      const p = m.params as { uri: string; diagnostics: { message: string }[] };
      // The first report can be from opening the file: wait for the one that finds the problem
      if (p.uri === file && p.diagnostics.length) return p.diagnostics;
    }
  }
  throw new Error('no diagnostics');
};

async function exercise(language: 'python' | 'go', files: Record<string, string>, main: string, use: { line: number; character: number }, defFile: string, defLine: number, broken: string, newName: string) {
  const { id, capabilities } = await startLsp({ projectId: `t${language}${Date.now()}`, language, files });
  assert.ok(capabilities.definitionProvider, 'the server can go to definitions');
  try {
    for (const [p, text] of Object.entries(files)) {
      if (!p.endsWith(language === 'python' ? '.py' : '.go')) continue;
      lspNotify(id, 'textDocument/didOpen', { textDocument: { uri: `file:///${p}`, languageId: language, version: 1, text } });
    }
    // Go to definition across files
    const def = (await lspRequest(id, 'textDocument/definition', { textDocument: { uri: `file:///${main}` }, position: use })) as { uri: string; range: { start: { line: number } } }[] | { uri: string; range: { start: { line: number } } };
    const first = Array.isArray(def) ? def[0] : def;
    assert.equal(first.uri, `file:///${defFile}`);
    assert.equal(first.range.start.line, defLine);
    // Rename touches both files
    const edit = (await lspRequest(id, 'textDocument/rename', { textDocument: { uri: `file:///${main}` }, position: use, newName })) as { changes?: Record<string, unknown[]>; documentChanges?: { textDocument: { uri: string } }[] };
    const touched = edit.changes ? Object.keys(edit.changes) : (edit.documentChanges ?? []).map((d) => d.textDocument.uri);
    assert.deepEqual([...new Set(touched)].sort(), [`file:///${defFile}`, `file:///${main}`].sort());
    // Hover
    const hover = (await lspRequest(id, 'textDocument/hover', { textDocument: { uri: `file:///${main}` }, position: use })) as { contents: unknown };
    assert.ok(JSON.stringify(hover.contents).length > 10);
    // A type error comes back as a diagnostic after an edit
    lspNotify(id, 'textDocument/didChange', { textDocument: { uri: `file:///${main}`, version: 2 }, contentChanges: [{ text: broken }] });
    const diagnostics = await wait(id, `file:///${main}`);
    assert.ok(diagnostics.length > 0, 'the broken code is reported');
    await assert.rejects(lspRequest(id, 'workspace/executeCommand', {}), /not allowed/);
    await assert.rejects(lspRequest(id, 'textDocument/hover', { textDocument: { uri: 'file:///../../../etc/passwd' }, position: { line: 0, character: 0 } }), /outside the project/);
  } finally {
    stopLsp(id);
  }
}

test('Python (pyright): definition and rename across files, hover, diagnostics', { skip: !findServer('python') && 'no pyright here (installed on first use in the studio)', timeout: 180_000 }, async () => {
  await exercise(
    'python',
    { 'pkg/util.py': 'def greet(name: str) -> str:\n    return "hi " + name\n', 'main.py': 'from pkg.util import greet\n\nprint(greet("ada"))\n', 'pkg/__init__.py': '' },
    'main.py',
    { line: 2, character: 7 },
    'pkg/util.py',
    0,
    'from pkg.util import greet\n\nprint(greet(1, 2))\n',
    'welcome'
  );
});

test('Go (gopls): definition and rename across files, hover, diagnostics', { skip: !findServer('go') && 'no gopls here (installed on first use in the studio)', timeout: 180_000 }, async () => {
  await exercise(
    'go',
    { 'go.mod': 'module example.com/app\n\ngo 1.22\n', 'main.go': 'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(Greet("ada"))\n}\n', 'greet.go': 'package main\n\nfunc Greet(name string) string {\n\treturn "hi " + name\n}\n' },
    'main.go',
    { line: 5, character: 14 },
    'greet.go',
    2,
    'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println(Greet(1))\n}\n',
    'Welcome'
  );
});
