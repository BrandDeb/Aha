import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Sessions write their project under AHA_HOME
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-debugger-'));
process.env.AHA_HOME = home;
after(() => fs.rmSync(home, { recursive: true, force: true }));

const { createDapReader, encodeDap } = await import('../src/lib/debug/dap.ts');
const { describeRemote } = await import('../src/lib/debug/node.ts');
const { debugpyCommand } = await import('../src/lib/debug/python.ts');
const { command, debugLanguage, parseBreakpoints, parseCommand, sessionState, startSession, stopSession } = await import('../src/lib/debug/session.ts');
const { resolveUv } = await import('../src/lib/python.ts');

const wait = async <T>(read: () => T, ok: (v: T) => boolean, ms = 30_000): Promise<T> => {
  const until = Date.now() + ms;
  for (;;) {
    const v = read();
    if (ok(v)) return v;
    if (Date.now() > until) throw new Error(`timed out; last: ${JSON.stringify(v).slice(0, 600)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
const req = (entry: string, files: Record<string, string>) => ({ projectId: `dbgtest${Math.random().toString(36).slice(2, 10)}`, entry, files, args: [], env: {} });

test('DAP framing: split, joined and partial messages; garbage skipped', () => {
  const read = createDapReader();
  const a = encodeDap({ seq: 1, type: 'event', event: 'stopped', body: { reason: 'breakpoint' } });
  const b = encodeDap({ seq: 2, type: 'response', request_seq: 7, success: true, command: 'next' });
  const both = Buffer.from(a + 'junk\r\n\r\n' + b);
  assert.deepEqual(read(both.subarray(0, 10)), []);
  const got = read(both.subarray(10));
  assert.deepEqual(got.map((m) => m.seq), [1, 2]);
  const unicode = encodeDap({ seq: 3, type: 'event', event: 'output', body: { output: 'héllo ✓' } });
  assert.equal(read(Buffer.from(unicode))[0].body?.output, 'héllo ✓', 'Content-Length counts bytes, not characters');
});

test('values, languages, breakpoints and commands are read the way the debugger needs them', () => {
  assert.equal(describeRemote({ type: 'string', value: 'a"b' }), '"a\\"b"');
  assert.equal(describeRemote({ type: 'object', subtype: 'null' }), 'null');
  assert.equal(describeRemote({ type: 'number', value: 5, description: '5' }), '5');
  assert.equal(describeRemote({ type: 'function', description: 'function add(a, b) { return a + b }' }), 'ƒ function add(a, b)');
  assert.equal(describeRemote({ type: 'object', subtype: 'array', description: 'Array(3)' }), 'Array(3)');
  assert.deepEqual(['a.py', 'src/main.ts', 'x.mjs', 'types.d.ts', 'main.go'].map(debugLanguage), ['python', 'node', 'node', null, null]);
  assert.deepEqual(parseBreakpoints({ 'a.ts': [3, 1, 3], 'gone.ts': [1] }, { 'a.ts': '' }), { 'a.ts': [1, 3] });
  assert.ok('error' in (parseBreakpoints({ 'a.ts': [0] }, { 'a.ts': '' }) as object));
  assert.ok('error' in (parseBreakpoints({ 'a.ts': ['1; rm'] }, { 'a.ts': '' }) as object));
  assert.deepEqual(parseCommand({ action: 'step', kind: 'into' }), { action: 'step', kind: 'into' });
  assert.ok('error' in parseCommand({ action: 'step', kind: 'sideways' }));
  assert.ok('error' in parseCommand({ action: 'evaluate', expression: '' }));
  assert.ok('error' in parseCommand({ action: 'eval' }));
  // debugpy listens on loopback only, and uv adds it for this run without touching the project
  assert.deepEqual(debugpyCommand({ entry: 'main.py', args: ['--x'] }, 5678, false), ['run', '--no-project', '--with', 'debugpy', 'python', '-Xfrozen_modules=off', '-m', 'debugpy', '--listen', '127.0.0.1:5678', '--wait-for-client', 'main.py', '--x']);
});

test('Node + TypeScript: a breakpoint stops, locals show, stepping moves, an expression evaluates, the program finishes', async () => {
  const files = {
    'src/main.ts': [
      "import { add } from './math';",
      'const items: number[] = [1, 2, 3];',
      'let total = 0;',
      'for (const n of items) {',
      '  total = add(total, n);',
      '}',
      "console.log('total', total);",
      '',
    ].join('\n'),
    'src/math.ts': ['export function add(a: number, b: number): number {', '  const sum = a + b;', '  return sum;', '}', ''].join('\n'),
  };
  const started = await startSession(req('src/main.ts', files), { 'src/math.ts': [2] });
  assert.notEqual(started.status, 'failed', started.error);
  assert.deepEqual(started.breakpoints, { 'src/math.ts': [2] });
  const id = started.id;
  try {
    let s = await wait(() => sessionState(id), (v) => v.status === 'paused' && v.scopes.length > 0);
    assert.equal(s.reason, 'breakpoint');
    assert.deepEqual([s.frames[0].file, s.frames[0].line, s.frames[0].name], ['src/math.ts', 2, 'add']);
    assert.equal(s.frames[1].file, 'src/main.ts', 'the caller is on the stack');
    const local = s.scopes[0].variables;
    assert.equal(local.find((v) => v.name === 'a')?.value, '0');
    assert.equal(local.find((v) => v.name === 'b')?.value, '1');
    // Step over: sum is now set
    await command(id, { action: 'step', kind: 'over' });
    s = await wait(() => sessionState(id), (v) => v.status === 'paused' && v.frames[0]?.line === 3 && v.scopes.length > 0);
    assert.equal(s.scopes[0].variables.find((v) => v.name === 'sum')?.value, '1');
    assert.deepEqual(await command(id, { action: 'evaluate', expression: 'sum * 10' }), { result: { name: 'sum * 10', value: '10', type: 'number' } });
    // The caller's frame: its locals, and an array that expands
    const caller = s.frames[1].id;
    const { scopes } = (await command(id, { action: 'frame', frameId: caller })) as { scopes: { name: string; variables: { name: string; value: string; ref?: string }[] }[] };
    const items = scopes.flatMap((x) => x.variables).find((v) => v.name === 'items');
    assert.equal(items?.value, 'Array(3)');
    const children = (await command(id, { action: 'children', ref: items!.ref! })) as { variables: { name: string; value: string }[] };
    assert.deepEqual(children.variables.filter((v) => /^\d$/.test(v.name)).map((v) => v.value), ['1', '2', '3']);
    // Remove the breakpoint and run to the end
    await command(id, { action: 'breakpoints', file: 'src/math.ts', lines: [] });
    await command(id, { action: 'continue' });
    s = await wait(() => sessionState(id), (v) => v.status === 'exited');
    assert.equal(s.exitCode, 0);
    assert.match(s.output.map((o) => o.text).join(''), /total 6/);
    assert.doesNotMatch(s.output.map((o) => o.text).join(''), /Debugger listening|Debugger attached/, 'inspector chatter is not the program output');
  } finally {
    stopSession(id);
  }
});

test('Python (debugpy): a breakpoint stops, locals show, stepping moves, the program finishes', { skip: !(await resolveUv()) && 'uv is not installed' }, async () => {
  const files = { 'main.py': ['def add(a, b):', '    total = a + b', '    return total', '', 'values = [add(1, 2), add(3, 4)]', 'print("values", values)', ''].join('\n') };
  const started = await startSession(req('main.py', files), { 'main.py': [2] });
  assert.notEqual(started.status, 'failed', started.error);
  const id = started.id;
  try {
    let s = await wait(() => sessionState(id), (v) => (v.status === 'paused' && v.scopes.length > 0) || v.status === 'failed' || v.status === 'exited', 150_000);
    assert.equal(s.status, 'paused', s.error ?? s.output.map((o) => o.text).join(''));
    assert.deepEqual([s.frames[0].file, s.frames[0].line, s.frames[0].name], ['main.py', 2, 'add']);
    const locals = s.scopes[0].variables;
    assert.deepEqual([locals.find((v) => v.name === 'a')?.value, locals.find((v) => v.name === 'b')?.value], ['1', '2']);
    await command(id, { action: 'step', kind: 'over' });
    s = await wait(() => sessionState(id), (v) => v.status === 'paused' && v.frames[0]?.line === 3 && v.scopes.length > 0);
    assert.equal(s.scopes[0].variables.find((v) => v.name === 'total')?.value, '3');
    assert.equal(((await command(id, { action: 'evaluate', expression: 'total * 2' })) as { result: { value: string } }).result.value, '6');
    await command(id, { action: 'breakpoints', file: 'main.py', lines: [] });
    await command(id, { action: 'continue' });
    s = await wait(() => sessionState(id), (v) => v.status === 'exited', 30_000);
    assert.match(s.output.map((o) => o.text).join(''), /values \[3, 7\]/);
  } finally {
    stopSession(id);
  }
});
