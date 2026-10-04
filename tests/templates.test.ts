import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_CODE, TEMPLATES } from '../src/lib/templates.ts';

const SCRIPTC = path.join(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'scriptc.cmd' : 'scriptc');

function scriptcAvailable(): boolean {
  try {
    execFileSync(SCRIPTC, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skip = scriptcAvailable() ? false : 'scriptc is not installed';
const dir = mkdtempSync(path.join(tmpdir(), 'nanocli-templates-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

function build(name: string, code: string): string {
  const source = path.join(dir, `${name}.ts`);
  const binary = path.join(dir, name);
  writeFileSync(source, code);
  execFileSync(SCRIPTC, ['build', source, '-o', binary], { stdio: 'pipe', timeout: 120_000 });
  return binary;
}

function run(binary: string, args: string[] = []): string {
  return execFileSync(binary, args, { encoding: 'utf8', timeout: 10_000 }).trim();
}

test('template ids and filenames are unique', () => {
  assert.equal(new Set(TEMPLATES.map((t) => t.id)).size, TEMPLATES.length);
  assert.equal(new Set(TEMPLATES.map((t) => t.filename)).size, TEMPLATES.length);
});

test('the default editor program compiles and runs', { skip }, () => {
  assert.equal(run(build('default', DEFAULT_CODE), ['scriptc']), 'Hello, scriptc!\n3 + 5 = 8');
});

for (const template of TEMPLATES) {
  test(`template "${template.name}" compiles with scriptc`, { skip }, () => {
    build(template.id, template.code);
  });
}

test('compiled templates behave correctly', { skip }, () => {
  const calc = path.join(dir, 'calculator');
  assert.equal(run(calc, ['2 * (3 + 4) - -1']), '2 * (3 + 4) - -1 = 15');
  assert.throws(() => run(calc, ['1 / 0']));
  assert.equal(run(path.join(dir, 'math'), ['6', '7', 'multiply']), '6 multiply 7 = 42');
  assert.match(run(path.join(dir, 'fibonacci'), ['20']), /^fib\(20\) = 6765 in /);
});
