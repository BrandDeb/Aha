import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { browse, closeFolder, inSkippedDir, LIMITS, looksBinary, makeDir, movePath, openFolder, reloadFolder, removePath, resolveInside, watchFolder, writeFile, type FolderChange } from '../src/lib/folder.ts';
import { folderEnv, parseShellRequest, runShell } from '../src/lib/shell.ts';
import { diffAgainstDisk, folderProject, moveInBaseline } from '../src/workspace/folder-diff.ts';

const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aha-folder-')));
const opened: string[] = [];
after(() => {
  for (const id of opened) closeFolder(id);
  fs.rmSync(tmp, { recursive: true, force: true });
});

function project(name: string, files: Record<string, string | Buffer>): string {
  const root = path.join(tmp, name);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return root;
}

async function open(root: string) {
  const f = await openFolder(root);
  opened.push(f.id);
  return f;
}

const hasGit = (() => {
  try {
    execFileSync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

test('helpers: skipped folders, binary files, paths that would leave the folder', () => {
  assert.equal(inSkippedDir('node_modules/x/index.js'), true);
  assert.equal(inSkippedDir('src/dist/x.js'), true);
  assert.equal(inSkippedDir('src/distribution.ts'), false);
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x00, 0x47])), true);
  assert.equal(looksBinary(Buffer.from('plain text')), false);
  assert.equal(resolveInside('/p', 'src/a.ts'), path.resolve('/p/src/a.ts'));
  for (const bad of ['../x', '/etc/passwd', 'a/../../x', '', 'a\0b']) assert.equal(resolveInside('/p', bad), null, bad);
});

test('a plain folder: text files load, dependencies and binaries stay out', async () => {
  const root = project('plain', {
    'src/main.ts': 'console.log(1)\n',
    'README.md': '# hi\n',
    'node_modules/dep/index.js': 'module.exports = 1',
    'dist/out.js': 'built',
    'logo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]),
    'big.txt': 'x'.repeat(LIMITS.fileBytes + 1),
    'has space.txt': 'odd name',
  });
  const f = await open(root);
  assert.equal(f.root, root);
  assert.equal(f.name, 'plain');
  assert.equal(f.git, false);
  assert.deepEqual(Object.keys(f.files).sort(), ['README.md', 'src/main.ts']);
  assert.deepEqual(f.skipped.map((s) => `${s.path}:${s.reason}`).sort(), ['big.txt:large', 'has space.txt:name', 'logo.png:binary']);
  // Opening it again gives the same folder
  assert.equal((await openFolder(root)).id, f.id);
  assert.equal((await reloadFolder(f.id)).files['src/main.ts'], 'console.log(1)\n');
  const p = folderProject(f);
  assert.equal(p.entry, 'src/main.ts');
  assert.deepEqual(p.disk, { id: f.id, root });
});

test('a Git repository: Git’s file list, so .gitignore is respected', { skip: !hasGit }, async () => {
  const root = project('repo', { 'app.py': 'print(1)\n', '.gitignore': 'secret.env\nlogs/\n', 'secret.env': 'KEY=1', 'logs/today.log': 'x', 'new.txt': 'untracked but not ignored' });
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['add', 'app.py', '.gitignore'], { cwd: root });
  const f = await open(root);
  assert.equal(f.git, true);
  assert.deepEqual(Object.keys(f.files).sort(), ['.gitignore', 'app.py', 'new.txt']);
});

test('opening refuses what isn’t a project folder', async () => {
  await assert.rejects(openFolder('relative/path'), /full path/);
  await assert.rejects(openFolder(path.join(tmp, 'nope')), /no folder/);
  const file = path.join(tmp, 'a-file.txt');
  fs.writeFileSync(file, 'x');
  await assert.rejects(openFolder(file), /not a folder/);
  await assert.rejects(openFolder(path.parse(tmp).root), /whole disk/);
  await assert.rejects(reloadFolder('not-an-open-id'), (e: Error & { status?: number }) => e.status === 404);
});

test('writes go in place, atomically, keeping the file’s mode; escapes are refused', async () => {
  const root = project('writes', { 'run.sh': '#!/bin/sh\necho hi\n', 'src/a.ts': 'a' });
  fs.chmodSync(path.join(root, 'run.sh'), 0o755);
  fs.symlinkSync(tmp, path.join(root, 'outside'));
  const f = await open(root);
  await writeFile(f.id, 'run.sh', '#!/bin/sh\necho changed\n');
  assert.equal(fs.readFileSync(path.join(root, 'run.sh'), 'utf8'), '#!/bin/sh\necho changed\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(root, 'run.sh')).mode & 0o777, 0o755);
  await writeFile(f.id, 'src/deep/new.ts', 'export {}');
  assert.equal(fs.readFileSync(path.join(root, 'src/deep/new.ts'), 'utf8'), 'export {}');
  assert.deepEqual(fs.readdirSync(path.join(root, 'src')).filter((n) => n.includes('.aha-')), []);
  await assert.rejects(writeFile(f.id, '../escape.txt', 'x'), /Invalid path/);
  await assert.rejects(writeFile(f.id, 'outside/escape.txt', 'x'), /outside the folder/);
  await assert.rejects(writeFile(f.id, '.git/config', 'x'), /Invalid path|outside/);
  assert.equal(fs.existsSync(path.join(tmp, 'escape.txt')), false);
});

test('moving a folder takes the files the studio doesn’t show; delete and mkdir', async () => {
  const root = project('moves', { 'assets/readme.txt': 'r', 'assets/logo.png': Buffer.from([0, 1, 2]) });
  const f = await open(root);
  await movePath(f.id, 'assets', 'public/assets');
  assert.deepEqual(fs.readdirSync(path.join(root, 'public/assets')).sort(), ['logo.png', 'readme.txt']);
  assert.equal(fs.existsSync(path.join(root, 'assets')), false);
  await assert.rejects(movePath(f.id, 'public', 'public/assets'), /already exists|EINVAL/);
  await makeDir(f.id, 'empty/dir');
  assert.ok(fs.statSync(path.join(root, 'empty/dir')).isDirectory());
  await removePath(f.id, 'public');
  assert.equal(fs.existsSync(path.join(root, 'public')), false);
});

test('changes other programs make are reported; the studio’s own writes are not', async () => {
  const root = project('watched', { 'a.txt': 'one' });
  const f = await open(root);
  const changes: FolderChange[] = [];
  const stop = watchFolder(f.id, (c) => changes.push(c), () => {});
  const settle = () => new Promise((r) => setTimeout(r, 600));
  await settle();
  await writeFile(f.id, 'a.txt', 'two');
  await settle();
  assert.deepEqual(changes, [], 'our own write');
  fs.writeFileSync(path.join(root, 'a.txt'), 'three');
  fs.mkdirSync(path.join(root, 'lib'));
  fs.writeFileSync(path.join(root, 'lib/b.txt'), 'new');
  fs.writeFileSync(path.join(root, 'node_modules.txt'), 'a file, not the folder');
  await settle();
  const changed = Object.assign({}, ...changes.map((c) => c.changed));
  assert.equal(changed['a.txt'], 'three');
  assert.equal(changed['lib/b.txt'], 'new');
  fs.rmSync(path.join(root, 'lib'), { recursive: true });
  await settle();
  assert.ok(changes.some((c) => c.removed.includes('lib/b.txt')), JSON.stringify(changes));
  stop();
});

test('the folder picker lists folders, not files, hidden ones or dependencies', async () => {
  const root = project('pick', { 'b/x': '', 'a/x': '', '.hidden/x': '', 'node_modules/x': '', 'file.txt': '', 'package.json': '{}' });
  const l = await browse(root);
  assert.equal(l.path, root);
  assert.deepEqual(l.dirs, ['a', 'b']);
  assert.equal(l.project, true);
  assert.equal(l.parent, tmp);
  await assert.rejects(browse('relative'), /full path/);
});

test('the terminal runs in the opened folder itself, with the user’s home', async () => {
  const root = project('term', { 'notes.txt': 'one two three\n' });
  const f = await open(root);
  const parsed = parseShellRequest({ projectId: 'abcdefgh12', folder: f.id, command: process.platform === 'win32' ? 'echo made> out.txt' : 'wc -w notes.txt && echo made > out.txt', cwd: '' });
  assert.ok(!('error' in parsed));
  let output = '';
  const result = await runShell(parsed as Exclude<typeof parsed, { error: string }>, { onOutput: (_s, d) => (output += d) });
  assert.equal(result.code, 0, result.error);
  if (process.platform !== 'win32') assert.match(output, /3 notes\.txt/);
  assert.equal(fs.readFileSync(path.join(root, 'out.txt'), 'utf8').trim(), 'made');
  assert.equal(fs.existsSync(path.join(root, '.home')), false);
  assert.deepEqual(result.changed, {});
  assert.deepEqual(parseShellRequest({ projectId: 'abcdefgh12', folder: '../x', command: 'ls', cwd: '' }), { error: 'folder is invalid' });
  const env = folderEnv({ HOME: '/scratch/.home', GOPATH: '/cache/gopath', PATH: '/bin' }, {}, '/home/me');
  assert.deepEqual(env, { HOME: '/home/me', USERPROFILE: '/home/me', DOTNET_CLI_HOME: '/home/me', PATH: '/bin' });
});

test('saving: only what changed since the baseline, and moves keep the baseline in step', () => {
  const base = new Map([['a.ts', '1'], ['b.ts', '2'], ['dir/c.ts', '3']]);
  assert.deepEqual(diffAgainstDisk({ 'a.ts': '1', 'b.ts': 'changed', 'new.ts': 'n' }, base), { write: { 'b.ts': 'changed', 'new.ts': 'n' }, remove: ['dir/c.ts'] });
  moveInBaseline(base, 'dir', 'lib/dir');
  assert.deepEqual([...base.keys()].sort(), ['a.ts', 'b.ts', 'lib/dir/c.ts']);
  assert.deepEqual(diffAgainstDisk({ 'a.ts': '1', 'b.ts': '2', 'lib/dir/c.ts': '3' }, base), { write: {}, remove: [] });
});
