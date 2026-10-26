import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { zipSync } from 'fflate';
import {
  childEnv,
  isPackageName,
  isPackageSpec,
  parseEnv,
  parsePythonRequest,
  projectName,
  PY_PROJECTS,
  resolveUv,
  runPython,
  uvSteps,
  type PythonRequest,
} from '../src/lib/python.ts';
import { UV_VERSION, installUv, parseSha256File, untar, uvAsset } from '../src/lib/uv-install.ts';

const base = { projectId: 'proj-12345678', files: { 'main.py': 'print(1)' }, env: {} };

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test('package specs allow names, extras and version constraints, and nothing uv would fetch or read from elsewhere', () => {
  for (const ok of ['requests', 'httpx>=0.27', 'numpy==2.1.0', 'uvicorn[standard]', 'pandas>=2,<3', 'torch ~= 2.4', 'my_pkg.sub-name']) {
    assert.ok(isPackageSpec(ok), ok);
  }
  for (const bad of ['', 'git+https://github.com/x/y', 'https://evil.example/pkg.whl', './local', '../up', '/etc/passwd', 'C:\\x', '--index-url', 'a; rm -rf /', 'pkg @ file:///x', 'a b', '-e .', 'x'.repeat(200)]) {
    assert.ok(!isPackageSpec(bad), bad);
  }
  assert.ok(isPackageName('requests') && !isPackageName('requests>=1') && !isPackageName('a/b'));
});

test('environment variables: sane names, and none that change how programs load', () => {
  assert.deepEqual(parseEnv({ OPENAI_API_KEY: 'sk-x' }), { env: { OPENAI_API_KEY: 'sk-x' } });
  assert.deepEqual(parseEnv(undefined), { env: {} });
  for (const name of ['PATH', 'path', 'HOME', 'PYTHONPATH', 'PYTHONSTARTUP', 'LD_PRELOAD', 'DYLD_INSERT_LIBRARIES', 'UV_INDEX_URL', 'NODE_OPTIONS', 'VIRTUAL_ENV']) {
    assert.ok('error' in (parseEnv({ [name]: 'x' }) as object), name);
  }
  assert.ok('error' in (parseEnv({ '1BAD': 'x' }) as object));
  assert.ok('error' in (parseEnv({ A: 'x\0y' }) as object));
  assert.ok('error' in (parseEnv(Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`V${i}`, 'x']))) as object));
});

test('parsePythonRequest validates every field', () => {
  const run = parsePythonRequest({ ...base, action: 'run', entry: 'main.py', args: ['--n', '3'] }) as PythonRequest;
  assert.equal(run.entry, 'main.py');
  assert.deepEqual(run.args, ['--n', '3']);

  assert.ok('error' in parsePythonRequest({ ...base, action: 'rm -rf' }));
  assert.ok('error' in parsePythonRequest({ ...base, projectId: '../../etc', action: 'sync' }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'run', entry: 'missing.py' }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'run', entry: 'main.ts', files: { 'main.ts': '' } }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'run', entry: 'main.py', args: [1] }));
  assert.ok('error' in parsePythonRequest({ ...base, files: { '../escape.py': 'x' }, action: 'sync' }));
  assert.ok('error' in parsePythonRequest({ ...base, files: { '/abs.py': 'x' }, action: 'sync' }));
  assert.ok(!('error' in parsePythonRequest({ ...base, files: { '.python-version': '3.12\n' }, action: 'sync' })));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'add', packages: [] }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'add', packages: ['git+https://x/y'] }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'remove', packages: ['numpy>=1'] }));
  assert.ok('error' in parsePythonRequest({ ...base, action: 'pin', version: '3.12; id' }));
  assert.deepEqual((parsePythonRequest({ ...base, action: 'pin', version: '3.12' }) as PythonRequest).version, '3.12');
  assert.ok('error' in parsePythonRequest({ ...base, action: 'sync', files: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.py`, ''])) }));
});

test('uvSteps: install and run are separate steps, and nothing is invented without a pyproject', () => {
  const req = (over: Partial<PythonRequest>): PythonRequest => ({ ...base, action: 'sync', ...over });
  const add = uvSteps(req({ action: 'add', packages: ['httpx>=0.27'], dev: true }), false);
  assert.ok(Array.isArray(add));
  assert.deepEqual((add as { args: string[] }[]).map((s) => s.args[0]), ['init', 'add']);
  assert.deepEqual((add as { args: string[] }[])[1].args, ['add', '--dev', 'httpx>=0.27']);

  const withProject = uvSteps(req({ action: 'run', entry: 'main.py', args: ['-x'] }), true) as { args: string[]; timeoutMs: number }[];
  assert.deepEqual(withProject.map((s) => s.args[0]), ['sync', 'run']);
  assert.deepEqual(withProject[1].args, ['run', '--no-sync', 'main.py', '-x']);
  assert.ok(withProject[0].timeoutMs > withProject[1].timeoutMs, 'installing may take longer than a program run');

  const script = uvSteps(req({ action: 'run', entry: 'main.py', packages: ['rich'] }), false) as { args: string[] }[];
  assert.deepEqual(script[0].args, ['run', '--no-project', '--with', 'rich', 'main.py']);

  assert.ok('error' in (uvSteps(req({ action: 'sync' }), false) as object));
  assert.ok('error' in (uvSteps(req({ action: 'init' }), true) as object));
  assert.deepEqual((uvSteps(req({ action: 'lock', upgrade: true }), true) as { args: string[] }[])[0].args, ['lock', '--upgrade']);
});

test('projectName produces valid pyproject names', () => {
  assert.equal(projectName('My CLI!'), 'my-cli');
  assert.equal(projectName('123'), 'app-123');
  assert.equal(projectName(''), 'app-project');
  assert.match(projectName('Ünïcode ✓'), /^[a-z][a-z0-9-]*$/);
});

test('the child environment never includes the server’s secrets', () => {
  const host = {
    PATH: '/usr/bin',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    ANTHROPIC_AUTH_TOKEN: 'tok',
    HTTPS_PROXY: 'http://proxy:3128',
  } as unknown as NodeJS.ProcessEnv;
  const env = childEnv(host, '/tmp/proj', { OPENAI_API_KEY: 'user-key' });
  assert.equal(env.PATH, '/usr/bin');
  assert.equal(env.HTTPS_PROXY, 'http://proxy:3128');
  assert.equal(env.OPENAI_API_KEY, 'user-key');
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.GITHUB_CLIENT_SECRET, undefined);
  assert.equal(env.ANTHROPIC_AUTH_TOKEN, undefined);
  assert.equal(env.HOME, path.join('/tmp/proj', '.home'));
});

// ---------------------------------------------------------------------------
// Installing uv (offline: the download is faked)
// ---------------------------------------------------------------------------

test('uvAsset names the official archive for each platform', () => {
  assert.equal(uvAsset('win32', 'x64'), 'uv-x86_64-pc-windows-msvc.zip');
  assert.equal(uvAsset('win32', 'arm64'), 'uv-aarch64-pc-windows-msvc.zip');
  assert.equal(uvAsset('darwin', 'arm64'), 'uv-aarch64-apple-darwin.tar.gz');
  assert.equal(uvAsset('linux', 'x64'), 'uv-x86_64-unknown-linux-gnu.tar.gz');
  assert.equal(uvAsset('linux', 'x64', true), 'uv-x86_64-unknown-linux-musl.tar.gz');
  assert.equal(uvAsset('freebsd', 'x64'), null);
  assert.equal(uvAsset('linux', 'ia32'), null);
});

test('parseSha256File reads sha256sum files in both spellings', () => {
  const hash = 'a'.repeat(64);
  assert.equal(parseSha256File(`${hash}  uv.tar.gz\n`), hash);
  assert.equal(parseSha256File(`${hash.toUpperCase()} *uv.zip\n`), hash);
  assert.equal(parseSha256File('not a hash'), null);
});

function tarFile(name: string, content: string): Uint8Array {
  const body = new TextEncoder().encode(content);
  const header = new Uint8Array(512);
  header.set(new TextEncoder().encode(name));
  header.set(new TextEncoder().encode(`${body.length.toString(8).padStart(11, '0')}\0`), 124);
  header.set(new TextEncoder().encode('0'), 156);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  return Uint8Array.from([...header, ...padded]);
}

test('untar extracts only the files asked for', () => {
  const archive = Uint8Array.from([...tarFile('uv-x/uv', 'BINARY'), ...tarFile('uv-x/README.md', 'docs'), ...new Uint8Array(1024)]);
  const files = untar(archive, (n) => n.endsWith('/uv'));
  assert.deepEqual(Object.keys(files), ['uv-x/uv']);
  assert.equal(new TextDecoder().decode(files['uv-x/uv']), 'BINARY');
});

test('installUv rejects a download that fails its checksum, and a failed fetch', async () => {
  const dest = mkdtempSync(path.join(tmpdir(), 'uv-install-'));
  try {
    const zip = zipSync({ 'uv.exe': new TextEncoder().encode('x'), 'uv': new TextEncoder().encode('x') });
    const wrongHash = 'b'.repeat(64);
    const fetchBad = async (url: string) => new Response(url.endsWith('.sha256') ? `${wrongHash}  file\n` : zip.slice().buffer);
    await assert.rejects(() => installUv(dest, () => {}, fetchBad), /SHA-256/);
    const fetchDown = async () => new Response('nope', { status: 404 });
    await assert.rejects(() => installUv(dest, () => {}, fetchDown), /Could not download uv/);
  } finally {
    rmSync(dest, { recursive: true, force: true });
  }
  assert.match(UV_VERSION, /^\d+\.\d+\.\d+$/);
});

// ---------------------------------------------------------------------------
// Real runs (need uv and a Python on this machine; no network)
// ---------------------------------------------------------------------------

const uv = await resolveUv();
const skip = uv ? false : 'uv is not installed';
const out = () => {
  const chunks: string[] = [];
  return { chunks, onOutput: (_s: string, text: string) => void chunks.push(text), text: () => chunks.join('') };
};

test('runPython runs a script and returns the files it wrote', { skip }, async () => {
  const sink = out();
  const files = { 'main.py': "import sys\nprint('hello', *sys.argv[1:])\nopen('out.txt', 'w').write('written')\n" };
  const result = await runPython({ ...base, projectId: 'test-run-0001', action: 'run', entry: 'main.py', args: ['a', 'b'], files }, sink);
  assert.equal(result.code, 0, sink.text());
  assert.match(sink.text(), /hello a b/);
  assert.equal(result.changed['out.txt'], 'written');
  assert.deepEqual(result.removed, []);
});

test('runPython does not expose the server’s secrets to the program', { skip }, async () => {
  process.env.ANTHROPIC_API_KEY = 'sk-ant-should-not-leak';
  process.env.GITHUB_CLIENT_SECRET = 'gh-should-not-leak';
  try {
    const sink = out();
    const files = { 'main.py': "import os\nprint('LEAK' if any('should-not-leak' in v for v in os.environ.values()) else 'clean')\nprint('user=' + os.environ.get('MY_KEY', ''))\n" };
    const result = await runPython({ ...base, projectId: 'test-env-0001', action: 'run', entry: 'main.py', files, env: { MY_KEY: 'mine' } }, sink);
    assert.equal(result.code, 0, sink.text());
    assert.match(sink.text(), /clean/);
    assert.doesNotMatch(sink.text(), /LEAK/);
    assert.match(sink.text(), /user=mine/);
  } finally {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.GITHUB_CLIENT_SECRET;
  }
});

test('runPython reports a failing program with its exit code and traceback', { skip }, async () => {
  const sink = out();
  const result = await runPython({ ...base, projectId: 'test-fail-0001', action: 'run', entry: 'main.py', files: { 'main.py': "raise SystemExit('boom')\n" } }, sink);
  assert.notEqual(result.code, 0);
  assert.match(sink.text(), /boom/);
});

test('uv init and uv lock work offline and hand pyproject.toml and uv.lock back', { skip }, async () => {
  const sink = out();
  const init = await runPython({ ...base, projectId: 'test-init-0001', action: 'init', name: 'Demo App', files: { 'main.py': 'print(1)' } }, sink);
  assert.equal(init.code, 0, sink.text());
  assert.match(init.changed['pyproject.toml'], /name = "demo-app"/);

  const lock = await runPython({ ...base, projectId: 'test-init-0001', action: 'lock', files: { 'main.py': 'print(1)', 'pyproject.toml': init.changed['pyproject.toml'] } }, out());
  assert.equal(lock.code, 0);
  assert.ok('uv.lock' in lock.changed);

  const again = await runPython({ ...base, projectId: 'test-init-0001', action: 'init', files: { 'pyproject.toml': init.changed['pyproject.toml'] } }, out());
  assert.match(again.error ?? '', /already has/);
});

test('aborting stops the program and everything it started', { skip }, async () => {
  const sink = out();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 1500);
  const started = Date.now();
  const files = { 'main.py': "import subprocess, sys, time\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])\nprint('started', flush=True)\ntime.sleep(60)\n" };
  const result = await runPython({ ...base, projectId: 'test-abort-0001', action: 'run', entry: 'main.py', files }, { onOutput: sink.onOutput, signal: controller.signal });
  assert.ok(Date.now() - started < 15_000, 'returned long before the 60 s sleep');
  assert.notEqual(result.code, 0);
  assert.match(sink.text(), /started/);
  const left = execFileSync('sh', ['-c', "ps -eo args | grep -c '[t]ime.sleep(60)' || true"], { encoding: 'utf8' }).trim();
  assert.equal(left, '0', 'no orphaned child processes');
});

test('input is mirrored: files the browser removed are gone on the next run', { skip }, async () => {
  const id = 'test-mirror-0001';
  await runPython({ ...base, projectId: id, action: 'run', entry: 'a.py', files: { 'a.py': "print('a')", 'stale.txt': 'old' } }, out());
  const sink = out();
  const result = await runPython({ ...base, projectId: id, action: 'run', entry: 'a.py', files: { 'a.py': "import os\nprint(os.path.exists('stale.txt'))" } }, sink);
  assert.equal(result.code, 0, sink.text());
  assert.match(sink.text(), /False/);
  assert.equal(existsSync(path.join(PY_PROJECTS, id, 'stale.txt')), false);
});

// ---------------------------------------------------------------------------
// Host header (DNS rebinding)
// ---------------------------------------------------------------------------

import { isTrustedHost } from '../src/lib/host.ts';

test('isTrustedHost accepts this machine and the configured site, and refuses rebinding hosts', () => {
  const base = 'https://studio.example.com';
  for (const host of ['localhost:3000', 'localhost', '127.0.0.1:3000', '[::1]:3000', 'studio.example.com', 'STUDIO.example.com:443']) {
    assert.ok(isTrustedHost(host, base), host);
  }
  for (const host of ['evil.example', 'evil.example:3000', '192.168.1.5:3000', 'localhost.evil.example', '127.0.0.1.evil.example', null, '']) {
    assert.ok(!isTrustedHost(host, base), String(host));
  }
  assert.ok(isTrustedHost('studio.internal:3000', base, 'studio.internal, other.example'));
  assert.ok(isTrustedHost('other.example', base, 'studio.internal, other.example'));
  assert.ok(!isTrustedHost('studio.internal', 'not a url'));
});

test('a project file too large to send back is not reported as removed', { skip }, async () => {
  const big = 'x'.repeat(300 * 1024);
  const sink = out();
  const result = await runPython({ ...base, projectId: 'test-big-0001', action: 'run', entry: 'main.py', files: { 'main.py': "import os\nprint(os.path.getsize('data.txt'))", 'data.txt': big, 'gone.txt': 'y' } }, sink);
  assert.equal(result.code, 0, sink.text());
  assert.match(sink.text(), /307200/);
  assert.ok(result.skipped.includes('data.txt'));
  assert.ok(!result.removed.includes('data.txt'), 'still on the server, just not returned');
  assert.deepEqual(result.removed, []);
});
