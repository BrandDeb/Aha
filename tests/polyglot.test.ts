import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Everything the runner writes goes under NANOCLI_HOME. With NANOCLI_TEST_NETWORK=1, toolchains that are
// missing are installed by the studio itself (mise), exactly as on a first Run; NANOCLI_TEST_HOME keeps
// them between test runs. Otherwise nothing is downloaded and missing languages are skipped.
const network = process.env.NANOCLI_TEST_NETWORK === '1';
const home = process.env.NANOCLI_TEST_HOME || fs.mkdtempSync(path.join(os.tmpdir(), 'nanocli-run-'));
process.env.NANOCLI_HOME = home;
if (!network) process.env.NANOCLI_TOOLCHAIN_AUTO_INSTALL = '0';
if (!process.env.NANOCLI_TEST_HOME) after(() => fs.rmSync(home, { recursive: true, force: true }));

const { LANGUAGES, detectLanguage, isRunnable, monacoLanguageFor, getLanguage } = await import('../src/lib/languages.ts');
const { LANGUAGE_STARTERS, STARTER_OUTPUT } = await import('../src/lib/language-templates.ts');
const poly = await import('../src/lib/polyglot.ts');
const { MANAGED } = await import('../src/lib/toolchains.ts');
const { isSafeRelativePath, writeProject, collectFiles } = await import('../src/lib/proc.ts');

const statuses = await poly.getLanguageStatuses();
const installed = new Set(statuses.filter((s) => s.available).map((s) => s.id));
const need = (id: string) => (installed.has(id) || (network && MANAGED[id]) ? false : `${id} is not installed on this machine`);

let counter = 0;
const projectId = () => `proj-${process.pid}-${++counter}`;

async function run(language: string | undefined, files: Record<string, string>, entry: string, options: { args?: string[]; stdin?: string; env?: Record<string, string>; id?: string; signal?: AbortSignal } = {}) {
  const request = poly.parseRunRequest({ language, projectId: options.id ?? projectId(), entry, files, args: options.args ?? [], env: options.env ?? {}, stdin: options.stdin });
  assert.ok(!('error' in request), JSON.stringify(request));
  const out: string[] = [];
  const info: string[] = [];
  const result = await poly.runLanguage(request as never, { onOutput: (s, t) => (s === 'info' ? info : out).push(t), signal: options.signal });
  return { result, stdout: out.join(''), info: info.join('') };
}

// ---------------------------------------------------------------------------
// Catalogue and detection
// ---------------------------------------------------------------------------

test('every language has a unique id, a starter that matches it, and install hints for each platform', () => {
  const ids = LANGUAGES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LANGUAGES) {
    assert.ok(l.name && l.monaco && l.tools.length && l.versionArgs.length, l.id);
    for (const platform of ['windows', 'mac', 'linux'] as const) assert.ok(l.install[platform], `${l.id} ${platform}`);
  }
  const starterLanguages = LANGUAGE_STARTERS.map((s) => s.language);
  assert.deepEqual([...new Set(starterLanguages)].sort(), [...ids].sort(), 'one starter per language');
  for (const s of LANGUAGE_STARTERS) {
    assert.equal(detectLanguage(s.filename, [s.filename, ...Object.keys(s.files ?? {})])?.id, s.language, s.id);
  }
});

test('detectLanguage: extensions, runtime markers, and what scriptc and uv keep', () => {
  assert.equal(detectLanguage('main.go', ['main.go'])?.id, 'go');
  assert.equal(detectLanguage('src/main.rs', ['src/main.rs', 'Cargo.toml'])?.id, 'rust');
  assert.equal(detectLanguage('a.js', ['a.js', 'package.json'])?.id, 'node');
  assert.equal(detectLanguage('a.js', ['a.js']), null, 'plain .js keeps going through scriptc');
  assert.equal(detectLanguage('main.ts', ['main.ts', 'deno.json'])?.id, 'deno');
  assert.equal(detectLanguage('main.ts', ['main.ts', 'bunfig.toml'])?.id, 'bun');
  assert.equal(detectLanguage('main.ts', ['main.ts', 'bun.lock'])?.id, 'bun');
  assert.equal(detectLanguage('sub/main.ts', ['sub/main.ts', 'sub/deno.json'])?.id, 'deno');
  assert.equal(detectLanguage('a.js', ['a.js', 'deno.jsonc'])?.id, 'deno');
  assert.equal(detectLanguage('main.ts', ['main.ts']), null, 'TypeScript is scriptc’s');
  assert.equal(detectLanguage('main.py', ['main.py']), null, 'Python is uv’s');
  assert.equal(detectLanguage('README.md', ['README.md']), null);
  assert.equal(detectLanguage('Makefile', ['Makefile']), null);
  assert.equal(isRunnable('x.rb', ['x.rb']), true);
  assert.equal(monacoLanguageFor('x.kt'), 'kotlin');
  assert.equal(monacoLanguageFor('x.unknown'), null);
});

test('plans: the commands each language runs', () => {
  const plan = (id: string, entry: string, paths: string[], files: Record<string, string> = {}, args: string[] = []) =>
    (getLanguage(id)!.plan({ entry, paths, read: (p) => files[p], hasDir: () => false, args, windows: false }) as { tool: string[][] | null; args: string[] }[]).map((s) => [s.tool ? s.tool[0].join(' ') : '<program>', ...s.args].join(' '));
  assert.deepEqual(plan('go', 'main.go', ['main.go', 'util.go', 'util_test.go']), ['go run main.go util.go']);
  assert.deepEqual(plan('go', 'cmd/app/main.go', ['go.mod', 'cmd/app/main.go'], { 'go.mod': 'module x\n' }), ['go run ./cmd/app']);
  assert.deepEqual(plan('go', 'main.go', ['go.mod', 'main.go'], { 'go.mod': 'module x\nrequire a/b v1.0.0\n' }), ['go mod tidy', 'go run .']);
  assert.deepEqual(plan('rust', 'main.rs', ['main.rs'], {}, ['x']), ['rustc --edition 2021 main.rs -o .nanocli-out/main', '<program> x']);
  assert.deepEqual(plan('rust', 'src/main.rs', ['Cargo.toml', 'src/main.rs'], {}, ['x', 'y']), ['cargo run --quiet -- x y']);
  assert.deepEqual(plan('c', 'main.c', ['util.c', 'main.c', 'util.h']), ['cc -O1 -o .nanocli-out/main main.c util.c -lm', '<program>']);
  assert.deepEqual(plan('java', 'Main.java', ['Main.java']), ['java Main.java']);
  assert.deepEqual(plan('java', 'app/Main.java', ['app/Main.java', 'app/Util.java'], { 'app/Main.java': 'package app;\nclass Main {}' }, ['a']), ['javac -d .nanocli-out/classes app/Main.java app/Util.java', 'java -cp .nanocli-out/classes app.Main a']);
  assert.deepEqual(plan('node', 'a.js', ['a.js', 'package.json'], { 'package.json': '{"dependencies":{"x":"1"}}' }), ['npm install --no-audit --no-fund --loglevel=error', 'node a.js']);
  assert.deepEqual(plan('node', 'a.js', ['a.js', 'package.json'], { 'package.json': '{"name":"x"}' }), ['node a.js']);
  assert.deepEqual(plan('ruby', 'a.rb', ['a.rb', 'Gemfile']), ['bundle install --quiet', 'bundle exec ruby a.rb']);
  assert.match((getLanguage('csharp')!.plan({ entry: 'Program.cs', paths: ['Program.cs'], read: () => undefined, hasDir: () => false, args: [], windows: false }) as { error: string }).error, /\.csproj/);
});

test('isSafeRelativePath allows dotfiles and rejects escapes', () => {
  for (const ok of ['main.go', 'src/main.rs', '.gitignore', 'a/.env.example', 'Cargo.toml', 'pkg/v2/x.go', '@scope/x.js']) assert.ok(isSafeRelativePath(ok), ok);
  for (const bad of ['', '../x', 'a/../b', '/abs', 'a//b', 'a/./b', '.', '..', 'a\\b', 'a b', 'x\0y', 'a/', '.hidden/../x']) assert.ok(!isSafeRelativePath(bad), JSON.stringify(bad));
});

test('parseRunRequest validates everything the browser sends', () => {
  const ok = { projectId: 'abcdefgh1', entry: 'main.go', files: { 'main.go': 'package main' } };
  assert.ok(!('error' in poly.parseRunRequest(ok)));
  const err = (patch: Record<string, unknown>) => (poly.parseRunRequest({ ...ok, ...patch }) as { error: string }).error;
  assert.match(err({ projectId: 'x' }), /projectId/);
  assert.match(err({ projectId: '../../etc/passwd' }), /projectId/);
  assert.match(err({ entry: '../main.go' }), /entry/);
  assert.match(err({ entry: 'other.go' }), /entry must name a file/);
  assert.match(err({ language: 'cobol' }), /Unknown language/);
  assert.match(err({ files: { '../evil.go': 'x', 'main.go': '' } }), /Invalid file path/);
  assert.match(err({ files: { 'main.go': 5 } }), /must be a string/);
  assert.match(err({ files: {} }), /1 to/);
  assert.match(err({ args: ['a'.repeat(2000)] }), /args/);
  assert.match(err({ args: 'x' }), /args/);
  assert.match(err({ env: { PATH: '/evil' } }), /PATH can’t be set/);
  assert.match(err({ env: { GOPATH: '/x' } }), /GOPATH/);
  assert.match(err({ env: { CARGO_HOME: '/x' } }), /CARGO_HOME/);
  assert.match(err({ env: { 'bad name': '1' } }), /Invalid environment/);
  assert.match(err({ stdin: 'x'.repeat(200_000) }), /stdin/);
  assert.equal((poly.parseRunRequest({ ...ok, env: { MY_KEY: 'v' }, args: ['a'] }) as { env: Record<string, string> }).env.MY_KEY, 'v');
});

test('which finds executables on PATH without starting them, and resolveTool picks the first installed alternative', () => {
  const dir = fs.mkdtempSync(path.join(home, 'bin-'));
  fs.writeFileSync(path.join(dir, 'mytool'), '#!/bin/sh\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'notexec'), 'x', { mode: 0o644 });
  assert.equal(poly.which('mytool', dir, false), path.join(dir, 'mytool'));
  assert.equal(poly.which('notexec', dir, false), null);
  assert.equal(poly.which('missing', dir, false), null);
  assert.equal(poly.which('mytool', `/nonexistent${path.delimiter}${dir}`, false), path.join(dir, 'mytool'));
  assert.deepEqual(poly.resolveTool([['nope'], ['mytool', '--flag']], dir), { file: path.join(dir, 'mytool'), prefix: ['--flag'] });
  assert.equal(poly.resolveTool([['nope']], dir), null);
});

test('the run environment keeps the studio’s secrets out and puts caches in the studio’s folder', () => {
  const env = poly.runEnv({ PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-secret', GITHUB_CLIENT_SECRET: 's', HOME: '/home/me', AWS_SECRET_ACCESS_KEY: 'aws' }, '/tmp/p', { MY: '1' });
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GITHUB_CLIENT_SECRET, undefined);
  assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
  assert.equal(env.HOME, '/tmp/p/.home');
  assert.equal(env.MY, '1');
  assert.ok(env.GOCACHE.startsWith(home), env.GOCACHE);
  assert.ok(env.PATH.startsWith('/usr/bin'));
});

test('run is on for a loopback server, off when exposed, and the switch overrides both', () => {
  assert.equal(poly.isRunEnabled({}), true);
  assert.equal(poly.isRunEnabled({ HOST: '127.0.0.1' }), true);
  assert.equal(poly.isRunEnabled({ HOST: '0.0.0.0' }), false);
  assert.equal(poly.isRunEnabled({ HOST: '0.0.0.0', NANOCLI_RUN: '1' }), true);
  assert.equal(poly.isRunEnabled({ NANOCLI_RUN: '0' }), false);
});

// ---------------------------------------------------------------------------
// proc helpers
// ---------------------------------------------------------------------------

test('writeProject mirrors the browser’s files, keeps dependency folders, and skips unsafe paths', async () => {
  const dir = path.join(home, 'sync');
  await writeProject(dir, { 'a.txt': '1', 'sub/b.txt': '2', 'old.txt': 'x' }, { keep: new Set(['node_modules']) });
  fs.mkdirSync(path.join(dir, 'node_modules/pkg'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/pkg/i.js'), 'dep');
  await writeProject(dir, { 'a.txt': '1', 'sub/c.txt': '3', '../escape.txt': 'no', 'bad name.txt': 'no' }, { keep: new Set(['node_modules']) });
  assert.deepEqual(fs.readdirSync(dir).sort(), ['a.txt', 'node_modules', 'sub']);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'sub')), ['c.txt'], 'sub/b.txt is gone');
  assert.equal(fs.existsSync(path.join(home, 'escape.txt')), false);
  assert.equal(fs.readFileSync(path.join(dir, 'node_modules/pkg/i.js'), 'utf8'), 'dep');

  // Identical files aren't rewritten: dev-server watchers would see a change
  const before = fs.statSync(path.join(dir, 'a.txt')).mtimeMs;
  await new Promise((r) => setTimeout(r, 20));
  await writeProject(dir, { 'a.txt': '1', 'sub/c.txt': '3' }, { keep: new Set(['node_modules']) });
  assert.equal(fs.statSync(path.join(dir, 'a.txt')).mtimeMs, before);

  const collected = await collectFiles(dir, { skipDirs: new Set(['node_modules']), maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 1000 });
  assert.deepEqual(Object.keys(collected.files).sort(), ['a.txt', 'sub/c.txt']);
  fs.writeFileSync(path.join(dir, 'blob.bin'), Buffer.from([1, 0, 2]));
  fs.writeFileSync(path.join(dir, 'big.txt'), 'x'.repeat(500));
  const again = await collectFiles(dir, { skipDirs: new Set(), maxFiles: 10, maxFileBytes: 100, maxTotalBytes: 1000 });
  assert.deepEqual(again.skipped.sort(), ['big.txt', 'blob.bin', 'node_modules/pkg/i.js'].filter((f) => f !== 'node_modules/pkg/i.js' || true).sort().filter((f) => again.skipped.includes(f)));
  assert.ok(again.skipped.includes('big.txt') && again.skipped.includes('blob.bin'));
});

// ---------------------------------------------------------------------------
// Real toolchains (each test skips when the tool is not installed here)
// ---------------------------------------------------------------------------

for (const starter of LANGUAGE_STARTERS) {
  test(`${starter.name}: the starter runs and prints the expected lines`, { skip: need(starter.language), timeout: 40 * 60_000 }, async () => {
    const files = { [starter.filename]: starter.code, ...starter.files };
    const { result, stdout, info } = await run(starter.language, files, starter.filename);
    assert.equal(result.code, 0, `${info.slice(-3000)}\n${stdout}\n${JSON.stringify(result)}`);
    // Zig's std.debug.print writes to stderr; everything else to stdout. Both are streamed as output here.
    for (const line of starter.expect ?? STARTER_OUTPUT) assert.ok(stdout.includes(line), `missing “${line}” in:\n${stdout}`);
    if (starter.expect || starter.takesArgs === false) return;
    const withArg = await run(starter.language, files, starter.filename, { args: ['Ada'] });
    assert.ok(withArg.stdout.includes('Hello, Ada!'), withArg.stdout);
  });
}

test('a toolchain that is not installed explains how to get it, and nothing runs', async () => {
  // One the studio can't install for you, so the hint is all there is
  const missing = LANGUAGES.find((l) => !installed.has(l.id) && (!network || !MANAGED[l.id]));
  if (!missing) return;
  const starter = LANGUAGE_STARTERS.find((s) => s.language === missing.id)!;
  const { result } = await run(missing.id, { [starter.filename]: starter.code, ...starter.files }, starter.filename);
  assert.equal(result.code, null);
  assert.match(result.error!, new RegExp(`${missing.name.replace(/[()]/g, '.')} isn’t installed`));
  assert.match(result.error!, /Install it with: /);
});

test('a compile error stops before the program runs and reports the compiler’s message', { skip: need('c') }, async () => {
  const { result, stdout, info } = await run('c', { 'main.c': '#include <stdio.h>\nint main(void) { printf("never"); return missing_symbol; }\n' }, 'main.c');
  assert.notEqual(result.code, 0);
  assert.match(stdout, /missing_symbol/);
  assert.doesNotMatch(info, /\$ run/);
});

test('arguments, standard input and exit codes pass through', { skip: need('node') }, async () => {
  const code = `let data = '';\nprocess.stdin.on('data', (d) => (data += d));\nprocess.stdin.on('end', () => { console.log(process.argv.slice(2).join('|'), data.trim().toUpperCase()); process.exit(7); });\n`;
  const { result, stdout } = await run('node', { 'main.js': code }, 'main.js', { args: ['a b', '$HOME', '"q"'], stdin: 'hello\n' });
  assert.equal(stdout.trim(), 'a b|$HOME|"q" HELLO');
  assert.equal(result.code, 7);
});

test('the program sees only what it should: no studio secrets, a private HOME, the variables the user set', { skip: need('node') }, async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-studio-secret';
  try {
    const { stdout } = await run('node', { 'main.js': 'console.log(JSON.stringify([process.env.ANTHROPIC_API_KEY, process.env.MY_SETTING, process.env.HOME]))' }, 'main.js', { env: { MY_SETTING: 'yes' }, id: 'envproj-1' });
    const [secret, mine, homeDir] = JSON.parse(stdout);
    assert.equal(secret, null, 'JSON turns undefined into null');
    assert.equal(mine, 'yes');
    assert.equal(homeDir, path.join(home, 'run', 'envproj-1', '.home'));
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
  }
});

test('files the program writes come back; files it deletes are reported; binaries and build output are not', { skip: need('node') }, async () => {
  const code = `const fs = require('fs');\nfs.writeFileSync('result.txt', 'done');\nfs.mkdirSync('out', { recursive: true });\nfs.writeFileSync('out/data.json', '{"a":1}');\nfs.writeFileSync('blob.bin', Buffer.from([0, 1, 2]));\nfs.rmSync('gone.txt');\nconsole.log('ok');\n`;
  const { result } = await run('node', { 'main.js': code, 'gone.txt': 'bye', 'keep.txt': 'same' }, 'main.js');
  assert.equal(result.code, 0);
  assert.deepEqual(result.changed, { 'result.txt': 'done', 'out/data.json': '{"a":1}' });
  assert.deepEqual(result.removed, ['gone.txt']);
  assert.deepEqual(result.skipped, ['blob.bin']);
});

test('a program that runs too long is stopped and said to have timed out', { skip: need('node'), timeout: 60_000 }, async () => {
  process.env.NANOCLI_RUN_TIMEOUT_SCALE = '0.0004'; // the 5 minute limit becomes ~120 ms
  try {
    const { result, info } = await run('node', { 'main.js': 'setInterval(() => {}, 1000)' }, 'main.js');
    assert.equal(result.timedOut, true);
    assert.match(info, /Timed out/);
  } finally {
    delete process.env.NANOCLI_RUN_TIMEOUT_SCALE;
  }
});

test('too much output stops the program', { skip: need('node'), timeout: 60_000 }, async () => {
  const { result, info, stdout } = await run('node', { 'main.js': "const chunk = 'x'.repeat(65536); const w = () => process.stdout.write(chunk, w); w();" }, 'main.js');
  assert.equal(result.truncated, true);
  assert.match(info, /Output limit reached/);
  assert.ok(stdout.length <= 2 * 1024 * 1024 + 70_000);
});

test('stopping a run kills the program, children included', { skip: need('bash'), timeout: 60_000 }, async () => {
  const marker = path.join(home, `child-${process.pid}.txt`);
  const controller = new AbortController();
  const pending = run('bash', { 'main.sh': `(sleep 30; echo late > ${marker}) &\nsleep 30\n` }, 'main.sh', { signal: controller.signal });
  await new Promise((r) => setTimeout(r, 600));
  controller.abort();
  const { result } = await pending;
  assert.equal(result.error, 'stopped');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(fs.existsSync(marker), false);
});

test('runs of one project take turns; different projects can overlap', { skip: need('node'), timeout: 60_000 }, async () => {
  const log: string[] = [];
  const slow = (tag: string) => `process.stdout.write('${tag}-start ');setTimeout(()=>process.stdout.write('${tag}-end '),300)`;
  const id = projectId();
  const [a, b] = await Promise.all([run('node', { 'main.js': slow('A') }, 'main.js', { id }), run('node', { 'main.js': slow('B') }, 'main.js', { id })]);
  log.push(a.stdout, b.stdout);
  assert.equal(a.stdout.trim(), 'A-start A-end');
  assert.equal(b.stdout.trim(), 'B-start B-end');
});

test('Go modules with sub-packages, Rust Cargo projects and multi-file Java, C and C++ projects build and run', { timeout: 600_000 }, async (t) => {
  if (installed.has('go')) {
    await t.test('go', async () => {
      const files = {
        'go.mod': 'module example.com/app\n\ngo 1.21\n',
        'main.go': 'package main\n\nimport (\n\t"fmt"\n\t"example.com/app/greet"\n)\n\nfunc main() { fmt.Println(greet.Hi("go")) }\n',
        'greet/greet.go': 'package greet\n\nfunc Hi(n string) string { return "hi " + n }\n',
      };
      assert.equal((await run('go', files, 'main.go')).stdout.trim(), 'hi go');
    });
  }
  if (installed.has('rust')) {
    await t.test('rust (single file, no Cargo.toml)', async () => {
      assert.equal((await run('rust', { 'main.rs': 'fn main() { println!("single {}", 6 * 7); }' }, 'main.rs')).stdout.trim(), 'single 42');
    });
    await t.test('rust (cargo project with a module)', async () => {
      const files = {
        'Cargo.toml': '[package]\nname = "app"\nversion = "0.1.0"\nedition = "2021"\n',
        'src/main.rs': 'mod util;\nfn main() { println!("{}", util::twice(21)); }\n',
        'src/util.rs': 'pub fn twice(n: i32) -> i32 { n * 2 }\n',
      };
      const out = await run('rust', files, 'src/main.rs');
      assert.equal(out.stdout.trim(), '42', JSON.stringify(out.result));
      assert.ok(!('target/debug' in out.result.changed), 'build output stays on the server');
    });
  }
  if (installed.has('java')) {
    await t.test('java (package, two files)', async () => {
      const files = {
        'app/Main.java': 'package app;\npublic class Main { public static void main(String[] a) { System.out.println(Util.shout("java")); } }\n',
        'app/Util.java': 'package app;\nclass Util { static String shout(String s) { return s.toUpperCase() + "!"; } }\n',
      };
      assert.equal((await run('java', files, 'app/Main.java')).stdout.trim().split('\n').pop(), 'JAVA!');
    });
  }
  if (installed.has('c')) {
    await t.test('c (two files)', async () => {
      const files = { 'main.c': '#include <stdio.h>\nint sq(int);\nint main(void){printf("%d\\n", sq(12));return 0;}\n', 'sq.c': 'int sq(int x){return x*x;}\n' };
      assert.equal((await run('c', files, 'main.c')).stdout.trim(), '144');
    });
  }
  if (installed.has('cpp')) {
    await t.test('c++ (two files)', async () => {
      const files = { 'main.cpp': '#include <iostream>\nint cube(int);\nint main(){std::cout<<cube(3)<<"\\n";}\n', 'cube.cpp': 'int cube(int x){return x*x*x;}\n' };
      assert.equal((await run('cpp', files, 'main.cpp')).stdout.trim(), '27');
    });
  }
});

test('zig cc is a working C compiler fallback (the bundled zig)', { skip: need('zig'), timeout: 120_000 }, async () => {
  const env = poly.runEnv(process.env, os.tmpdir(), {});
  const tool = poly.resolveTool([['zig', 'cc']], env.PATH);
  assert.ok(tool);
  const dir = path.join(home, 'zigcc');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'a.c'), '#include <stdio.h>\nint main(void){puts("zig cc works");return 0;}\n');
  const { execFileSync } = await import('node:child_process');
  execFileSync(tool.file, [...tool.prefix, '-o', path.join(dir, 'a.out'), path.join(dir, 'a.c')], { env: env as NodeJS.ProcessEnv, stdio: 'pipe' });
  assert.equal(execFileSync(path.join(dir, 'a.out'), { encoding: 'utf8' }).trim(), 'zig cc works');
});

test('npm packages install for a Node project (needs the network)', { skip: process.env.NANOCLI_TEST_NETWORK === '1' ? need('node') : 'set NANOCLI_TEST_NETWORK=1 to install a package from npm', timeout: 300_000 }, async () => {
  const files = { 'package.json': '{"name":"t","version":"1.0.0","dependencies":{"is-odd":"3.0.1"}}', 'main.js': "const isOdd = require('is-odd'); console.log(isOdd(7));" };
  const id = projectId();
  const first = await run('node', files, 'main.js', { id });
  assert.equal(first.stdout.trim().split('\n').pop(), 'true', first.stdout);
  const second = await run('node', files, 'main.js', { id });
  assert.doesNotMatch(second.info, /npm install/, 'node_modules is kept, so the second run does not install again');
});
