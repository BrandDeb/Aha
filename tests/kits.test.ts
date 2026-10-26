import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isValidProjectPath } from '../src/lib/compiler.ts';
import { KIT_LIBRARY } from '../src/lib/kit-library.ts';
import { checkPassed, draftKit, exportBundle, fillPlaceholders, findSecrets, KIT_FILE, kitConnector, kitError, kitOf, parseBundle, parseKit, readiness, safeKitPath } from '../src/lib/kits.ts';

const kit = KIT_LIBRARY[0].kit;

test('every built-in kit is valid, and its entry and check files exist', () => {
  for (const { kit: k, files } of KIT_LIBRARY) {
    const parsed = parseKit(JSON.parse(JSON.stringify(k)));
    assert.ok(!('error' in parsed), `${k.id}: ${'error' in parsed ? parsed.error : ''}`);
    assert.ok(!k.entry || k.entry in files, `${k.id}: entry`);
    for (const c of k.checks) assert.ok((c.entry ?? k.entry)! in files, `${k.id}: ${c.label}`);
    assert.ok(files['agent/prompt.md'], `${k.id}: house rules for the agent`);
    assert.deepEqual(Object.values(files).flatMap(findSecrets), [], `${k.id} ships no secrets`);
  }
});

test('a kit is untrusted input: bad ids, paths, regexes and embedded secrets are refused', () => {
  const bad = (patch: Record<string, unknown>) => {
    const r = parseKit({ ...JSON.parse(JSON.stringify(kit)), ...patch });
    return 'error' in r ? r.error : null;
  };
  assert.match(bad({ format: 2 })!, /format/);
  assert.match(bad({ id: 'Has Spaces' })!, /id/);
  assert.match(bad({ entry: '../etc/passwd' })!, /entry/);
  assert.match(bad({ checks: [{ label: 'x', args: [], expect: '(' }] })!, /regular expression/);
  assert.match(bad({ env: [{ name: 'API_KEY', description: 'k', example: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123' }] })!, /harmless/);
  assert.match(bad({ connectors: [{ name: 'gh', description: 'd', config: { kind: 'github', token: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' } }] })!, /GitHub token.*placeholder/);
  assert.match(bad({ connectors: [{ name: 'x', description: 'd', config: { kind: 'shell' } }] })!, /unknown kind/);
  assert.equal(bad({ connectors: [{ name: 'db', description: 'd', config: { kind: 'postgres', url: '${DATABASE_URL}' } }] }), null, 'a placeholder is fine');
  for (const p of ['a/../b', '/abs', 'node_modules/x/y.js', '.git/config', 'a\\b']) assert.equal(safeKitPath(p), false, p);
  assert.equal(safeKitPath('.nanocli/kit.json'), true);
  // A project carrying a kit still builds and runs: the servers accept the manifest, and nothing else hidden
  assert.equal(isValidProjectPath(KIT_FILE), true);
  for (const p of ['.nanocli/../x', '.nanocli/a/b.json', '.git/config', '.env']) assert.equal(isValidProjectPath(p), false, p);
});

test('secrets: found in common shapes, not in look-alikes', () => {
  assert.deepEqual(findSecrets('key = "AKIAABCDEFGHIJKLMNOP"'), ['AWS access key']);
  assert.deepEqual(findSecrets('-----BEGIN OPENSSH PRIVATE KEY-----'), ['private key']);
  assert.deepEqual(findSecrets('postgres://admin:hunter22@db:5432/x'), ['password in a URL']);
  assert.deepEqual(findSecrets('postgres://user:${DB_PASSWORD}@db/x and sk-short and https://example.com'), []);
});

test('export: .env files and anything holding a key stay behind, and say so', () => {
  const files = {
    ...KIT_LIBRARY[0].files,
    '.env': 'CUSTOMER_API_KEY=abc',
    'src/debug.js': 'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD";',
    'certs/server.pem': 'x',
  };
  const { bundle, left } = exportBundle(kit, files);
  assert.deepEqual(left.map((l) => l.path).sort(), ['.env', 'certs/server.pem', 'src/debug.js']);
  assert.match(left.find((l) => l.path === 'src/debug.js')!.reason, /OpenAI-style key/);
  assert.ok('.env.example' in bundle.files, 'documented examples are kept');
  assert.ok(KIT_FILE in bundle.files);
  // And it reads back as the same kit
  const back = parseBundle(JSON.stringify(bundle));
  assert.ok(!('error' in back));
  assert.deepEqual(back.kit, kit);
  assert.deepEqual(kitOf(back.files), kit);
});

test('import: refuses what is not a kit or would write outside the project', () => {
  const bundle = exportBundle(kit, KIT_LIBRARY[0].files).bundle;
  const err = (b: unknown) => {
    const r = parseBundle(JSON.stringify(b));
    return 'error' in r ? r.error : null;
  };
  assert.match(err({ hello: 1 })!, /Not a NanoCLI kit/);
  assert.match(err({ ...bundle, files: { ...bundle.files, '../../.bashrc': 'x' } })!, /Unsafe file path/);
  assert.match(err({ ...bundle, files: { 'README.md': 'x' } })!, /entry src\/index\.js is not in the kit/);
  assert.match((parseBundle('{') as { error: string }).error, /not JSON/);
  assert.equal(kitError({ [KIT_FILE]: '{ nope' })?.startsWith('Not valid JSON'), true);
  assert.equal(kitError({ [KIT_FILE]: JSON.stringify(draftKit('My Kit', 'main.ts')) }), null);
});

test('placeholders and connectors: filled from the environment, never pre-approved', () => {
  assert.deepEqual(fillPlaceholders({ url: '${A}/x', list: ['${B}'] }, { A: 'https://a' }), { value: { url: 'https://a/x', list: [''] }, missing: ['B'] });
  const warehouse = KIT_LIBRARY[2].kit.connectors[0];
  assert.match((kitConnector(warehouse, {}, 'c1') as { error: string }).error, /Set DATABASE_URL/);
  const added = kitConnector(warehouse, { DATABASE_URL: 'postgresql://u@h/db' }, 'c1');
  assert.ok(!('error' in added) && added.kind === 'postgres' && added.trustReads === false);
});

test('readiness: what is missing before the kit works here', () => {
  const items = readiness(kit, KIT_LIBRARY[0].files, { CUSTOMER_API_BASE_URL: 'https://x' }, ['web pages']);
  assert.deepEqual(items.map((i) => `${i.label}:${i.ok}`), ['src/index.js:true', 'CUSTOMER_API_BASE_URL:true', 'CUSTOMER_API_KEY:false', 'Web pages:true']);
  // Optional variables only show once set
  assert.equal(readiness(KIT_LIBRARY[2].kit, {}, {}, []).some((i) => i.label === 'DATABASE_URL'), false);
  assert.equal(checkPassed({ label: 'x', args: [], expect: 'Synced 3' }, true, 'Synced 3 records'), true);
  assert.equal(checkPassed({ label: 'x', args: [], expect: 'Synced 3' }, false, 'Synced 3 records'), false);
});

// The kits' own checks, run for real: each one works the moment it opens
const python = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return 'python3';
  } catch {
    return null;
  }
})();

for (const { kit: k, files } of KIT_LIBRARY) {
  const usesPython = (k.entry ?? '').endsWith('.py');
  test(`${k.name}: its checks pass on a fresh copy`, { skip: usesPython && !python ? 'no python3' : false }, () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kit-'));
    try {
      for (const [p, content] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
        writeFileSync(path.join(dir, p), content);
      }
      for (const check of k.checks) {
        const entry = check.entry ?? k.entry!;
        const run = spawnSync(entry.endsWith('.py') ? python! : process.execPath, [entry, ...check.args], { cwd: dir, encoding: 'utf8', timeout: 60_000, env: { ...process.env, NODE_TEST_CONTEXT: undefined } });
        // Both streams, as the studio shows them (unittest prints its summary on stderr)
        const output = `${run.stdout}${run.stderr}`;
        const ok = run.status === 0;
        assert.ok(checkPassed(check, ok, output), `${check.label}\n${output}`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
