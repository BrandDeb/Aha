import { test } from 'node:test';
import assert from 'node:assert/strict';
import { changesSince, debugBrief, excerpt, failureSignature, headline, lineDiff, makeFailure, parseLocations, projectPathFor } from '../src/lib/debug.ts';

const RUN = '/root/.nanocli/run/proj-1234abcd';

// Real-world error output, one per toolchain, and where it should point
const CASES: { name: string; paths: string[]; output: string; expect: string; title: RegExp }[] = [
  {
    name: 'scriptc / tsc',
    paths: ['src/main.ts', 'src/util.ts'],
    output: `src/util.ts:4:10 - error SC2020: Type 'string' is not assignable to type 'number'.\n\n4   return "x";\n           ~~~`,
    expect: 'src/util.ts:4:10',
    title: /error SC2020/,
  },
  {
    name: 'Node stack',
    paths: ['main.js', 'lib/math.js'],
    output: `${RUN}/lib/math.js:3\n  return a.b.c;\n             ^\n\nTypeError: Cannot read properties of undefined (reading 'c')\n    at add (${RUN}/lib/math.js:3:14)\n    at Object.<anonymous> (${RUN}/main.js:2:1)\n    at Module._compile (node:internal/modules/cjs/loader:1554:14)`,
    expect: 'lib/math.js:3',
    title: /TypeError: Cannot read properties of undefined/,
  },
  {
    name: 'Python traceback',
    paths: ['main.py', 'app/util.py'],
    output: `Traceback (most recent call last):\n  File "${RUN}/main.py", line 5, in <module>\n    total(items)\n  File "${RUN}/app/util.py", line 9, in total\n    return sum(x["price"] for x in items)\nKeyError: 'price'`,
    expect: 'main.py:5',
    title: /^KeyError: 'price'/,
  },
  {
    name: 'Rust compile error',
    paths: ['src/main.rs', 'Cargo.toml'],
    output: `error[E0308]: mismatched types\n --> src/main.rs:7:20\n  |\n7 |     let n: u32 = "5";\n  |            ---   ^^^ expected \`u32\`, found \`&str\``,
    expect: 'src/main.rs:7:20',
    title: /error\[E0308\]: mismatched types/,
  },
  {
    name: 'Rust panic',
    paths: ['src/main.rs'],
    output: `thread 'main' panicked at src/main.rs:12:5:\nindex out of bounds: the len is 3 but the index is 7\nnote: run with \`RUST_BACKTRACE=1\``,
    expect: 'src/main.rs:12:5',
    title: /panicked/,
  },
  {
    name: 'Go panic',
    paths: ['main.go', 'go.mod'],
    output: `panic: runtime error: index out of range [5] with length 3\n\ngoroutine 1 [running]:\nmain.main()\n\t${RUN}/main.go:9 +0x1d\nexit status 2`,
    expect: 'main.go:9',
    title: /panic: runtime error/,
  },
  {
    name: 'Java exception',
    paths: ['Main.java'],
    output: `Exception in thread "main" java.lang.NullPointerException: Cannot invoke "String.length()" because "s" is null\n\tat Main.count(Main.java:8)\n\tat Main.main(Main.java:3)`,
    expect: 'Main.java:8',
    title: /NullPointerException/,
  },
  {
    name: 'C# build error',
    paths: ['Program.cs', 'app.csproj'],
    output: `${RUN}/Program.cs(6,13): error CS0103: The name 'nmae' does not exist in the current context [${RUN}/app.csproj]`,
    expect: 'Program.cs:6:13',
    title: /error CS0103/,
  },
  {
    name: 'gcc',
    paths: ['main.c'],
    output: `main.c: In function 'main':\nmain.c:4:12: error: 'count' undeclared (first use in this function)\n    4 |     return count;`,
    expect: 'main.c:4:12',
    title: /error: 'count' undeclared/,
  },
  {
    name: 'Ruby',
    paths: ['main.rb'],
    output: `main.rb:3:in 'greet': undefined method 'upcase' for nil (NoMethodError)\n\tfrom main.rb:6:in '<main>'`,
    expect: 'main.rb:3',
    title: /NoMethodError/,
  },
  {
    name: 'PHP',
    paths: ['main.php'],
    output: `PHP Fatal error:  Uncaught Error: Call to undefined function gret() in ${RUN}/main.php:4\nStack trace:\n#0 {main}\n  thrown in ${RUN}/main.php on line 4`,
    expect: 'main.php:4',
    title: /Uncaught Error: Call to undefined function/,
  },
  {
    name: 'Solidity (forge)',
    paths: ['src/Counter.sol', 'test/Counter.t.sol', 'foundry.toml'],
    output: `Error (7576): Undeclared identifier. Did you mean "number"?\n  --> src/Counter.sol:12:9:\n   |\n12 |         numbr++;`,
    expect: 'src/Counter.sol:12:9',
    title: /Undeclared identifier/,
  },
  {
    name: 'Browser preview',
    paths: ['src/App.tsx', 'src/main.tsx'],
    output: `TypeError: items.map is not a function (App.tsx:14)`,
    expect: 'src/App.tsx:14',
    title: /items\.map is not a function/,
  },
];

for (const c of CASES) {
  test(`locations and headline: ${c.name}`, () => {
    const locations = parseLocations(c.output, c.paths);
    assert.ok(locations.length, `nothing found in:\n${c.output}`);
    const first = locations[0];
    assert.equal(`${first.file}:${first.line}${first.column ? `:${first.column}` : ''}`, c.expect);
    assert.match(headline(c.output), c.title);
  });
}

test('headline: the message of a "file:line:col: message" error, not the code under it', () => {
  assert.equal(headline('src/main.ts:19:12: ERROR: Expected ";" but found "?"\n    const sheme?: { color: string } } = {};\n               ^'), 'ERROR: Expected ";" but found "?"');
  assert.equal(headline('./main.go:9:2: undefined: fmtt'), 'undefined: fmtt');
});

test('paths: suffix of the run folder, unique basenames, and nothing outside the project', () => {
  const paths = ['src/main.ts', 'src/a/util.ts', 'src/b/util.ts', 'README.md'];
  assert.equal(projectPathFor(`${RUN}/src/main.ts`, paths), 'src/main.ts');
  assert.equal(projectPathFor('./src/main.ts', paths), 'src/main.ts');
  assert.equal(projectPathFor('main.ts', paths), 'src/main.ts', 'a unique basename');
  assert.equal(projectPathFor('util.ts', paths), null, 'ambiguous basename');
  assert.equal(projectPathFor('/usr/lib/node_modules/x/main.ts', paths), null);
  assert.equal(parseLocations('at foo (node:internal/process:12:3)\nat https://esm.sh/react@19/index.mjs:5:1', paths).length, 0);
});

test('signatures: the same failure again is the same; another one is not', () => {
  const a = makeFailure('run', "TypeError: Cannot read properties of undefined (reading 'c')\n    at add (/x/lib/math.js:3:14)", ['lib/math.js']);
  const again = makeFailure('run', "TypeError: Cannot read properties of undefined (reading 'd')\n    at add (/y/lib/math.js:5:2)", ['lib/math.js']);
  const other = makeFailure('run', 'RangeError: Maximum call stack size exceeded\n    at f (/x/lib/math.js:3:1)', ['lib/math.js']);
  assert.equal(a.signature, again.signature, 'line numbers and quoted names do not make a new failure');
  assert.notEqual(a.signature, other.signature);
  assert.notEqual(failureSignature('build', a.title, a.locations), a.signature, 'where it failed matters');
});

test('diffs: what changed since it last worked', () => {
  assert.equal(lineDiff('a\nb\nc', 'a\nB\nc'), '   2 - b\n   2 + B');
  const changes = changesSince({ 'a.ts': 'x\n', 'gone.ts': '1' }, { 'a.ts': 'y\n', 'new.ts': 'z' });
  assert.deepEqual(changes.map((c) => `${c.kind} ${c.path}`), ['modified a.ts', 'added new.ts', 'deleted gone.ts']);
  assert.deepEqual(changesSince(null, { 'a.ts': '' }), []);
  assert.match(lineDiff('x\n'.repeat(600), 'y\n'.repeat(600)), /too large/);
});

test('the brief gives the agent the error, the code it points at, what changed and the method', () => {
  const files = { 'lib/math.js': 'function add(a) {\n  // sum\n  return a.b.c;\n}\nmodule.exports = { add };\n', 'main.js': "require('./lib/math').add({})\n" };
  const failure = makeFailure('run', `TypeError: Cannot read properties of undefined (reading 'c')\n    at add (${RUN}/lib/math.js:3:14)`, Object.keys(files), 'node');
  const brief = debugBrief(failure, files, { ...files, 'lib/math.js': files['lib/math.js'].replace('a.b.c', 'a.b') });
  assert.match(brief, /The program failed when run \(node\): TypeError/);
  assert.ok(brief.includes('>   3 |   return a.b.c;'), brief);
  assert.match(brief, /Changed since it last worked[\s\S]*modified lib\/math\.js[\s\S]*- {3}return a\.b;[\s\S]*\+ {3}return a\.b\.c;/);
  assert.match(brief, /1\. Reproduce[\s\S]*5\. Verify/);
  assert.match(debugBrief(failure, files, files), /Nothing changed since it last worked/);
  assert.equal(excerpt('a\nb\nc\nd', 2, 1), '    1 | a\n>   2 | b\n    3 | c');
});

test('a usage message without arguments is not a failure to debug', async () => {
  const { isUsageExit } = await import('../src/lib/debug.ts');
  assert.equal(isUsageExit('Usage: calc "1 + 2 * 3"\n', []), true);
  assert.equal(isUsageExit('usage: tool [-h] file\n', undefined), true);
  assert.equal(isUsageExit('Usage: calc "1 + 2 * 3"\n', ['1+'] ), false, 'with arguments, a non-zero exit is a real failure');
  assert.equal(isUsageExit('Traceback (most recent call last):\n  ...\nusage: x\n', []), false);
  assert.equal(isUsageExit('TypeError: x is undefined\n', []), false);
});
