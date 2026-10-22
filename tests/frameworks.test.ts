import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { atLeast, dependencyKey, detectFramework, localUrlIn, packageManagerFor } from '../src/lib/frameworks.ts';
import { WEB_STARTERS } from '../src/lib/web-templates.ts';

const EXPECTED: Record<string, string> = {
  'web-react': 'Vite · React',
  'web-vue': 'Vite · Vue',
  'web-svelte': 'Vite · Svelte',
  'web-solid': 'Vite · Solid',
  'web-preact': 'Vite · Preact',
  'web-vanilla': 'Vite',
  'web-next': 'Next.js',
  'web-nuxt': 'Nuxt',
  'web-sveltekit': 'SvelteKit',
  'web-astro': 'Astro',
  'web-react-router': 'React Router',
  'web-angular': 'Angular',
};

const filesOf = (s: (typeof WEB_STARTERS)[number]) => ({ ...s.files, [s.filename]: s.code });

test('every web starter is recognised as its framework', () => {
  assert.equal(WEB_STARTERS.length, Object.keys(EXPECTED).length);
  for (const starter of WEB_STARTERS) {
    const detected = detectFramework(filesOf(starter));
    assert.equal(detected?.label, EXPECTED[starter.id], starter.id);
    assert.ok(JSON.parse(starter.files['package.json']), `${starter.id} has valid package.json`);
    assert.ok(starter.code.includes('Edit'), `${starter.id} names the file to edit`);
  }
});

test('frameworks: detection needs a package.json with a known dependency', () => {
  assert.equal(detectFramework({ 'main.ts': '' }), null);
  assert.equal(detectFramework({ 'package.json': '{ not json' }), null);
  assert.equal(detectFramework({ 'package.json': '{"dependencies":{"express":"^5"}}' }), null);
  // A meta-framework wins over the bundler it is built on
  assert.equal(detectFramework({ 'package.json': '{"devDependencies":{"vite":"^8","@sveltejs/kit":"^3"}}' })?.framework.id, 'sveltekit');
});

test('frameworks: dependency key changes only with dependencies or the lockfile', () => {
  const base = { 'package.json': '{"name":"a","dependencies":{"react":"^19"}}', 'src/App.tsx': 'x' };
  const key = dependencyKey(base);
  assert.equal(dependencyKey({ ...base, 'src/App.tsx': 'y' }), key);
  assert.equal(dependencyKey({ ...base, 'package.json': '{"name":"b","dependencies":{"react":"^19"}}' }), key, 'renaming is not a dependency change');
  assert.notEqual(dependencyKey({ ...base, 'package.json': '{"dependencies":{"react":"^19","zod":"^4"}}' }), key);
  assert.notEqual(dependencyKey({ ...base, 'package-lock.json': '{}' }), key);
});

test('frameworks: package manager, versions and printed URLs', () => {
  assert.equal(packageManagerFor({ 'package.json': '{}' }), 'npm');
  assert.equal(packageManagerFor({ 'pnpm-lock.yaml': '' }), 'pnpm');
  assert.equal(packageManagerFor({ 'bun.lock': '' }), 'bun');
  assert.ok(atLeast('v22.22.0', '22.17.0'));
  assert.ok(!atLeast('22.22.0', '22.22.3'));
  assert.ok(atLeast('24.0.0', '22.99.0'));
  assert.equal(localUrlIn('  \x1b[32m➜\x1b[39m  Local:   http://localhost:5174/'), 'http://localhost:5174/');
  assert.equal(localUrlIn('- Local:        http://127.0.0.1:3001'), 'http://127.0.0.1:3001');
  assert.equal(localUrlIn('Network: use --host to expose'), null);
});

test('dev server requests: paths stay out of generated folders', async () => {
  const { isSyncablePath, parseFiles, isProjectId } = await import('../src/lib/devserver.ts');
  assert.ok(isSyncablePath('src/App.tsx'));
  assert.ok(!isSyncablePath('node_modules/react/index.js'));
  assert.ok(!isSyncablePath('.next/server/app.js'));
  assert.ok(!isSyncablePath('../escape.js'));
  assert.ok('error' in parseFiles({ 'node_modules/x.js': '' }));
  assert.ok('error' in parseFiles({}));
  assert.deepEqual(parseFiles({}, { allowEmpty: true }), {});
  assert.ok(isProjectId('abcdefgh12') && !isProjectId('../x') && !isProjectId('short'));
});

/**
 * The real thing, per starter: install, start, fetch the page, edit a file and
 * see the change served. Needs the npm registry: NANOCLI_TEST_NETWORK=1.
 */
test('every web starter installs, serves its page and picks up edits', { skip: process.env.NANOCLI_TEST_NETWORK !== '1', timeout: 30 * 60_000 }, async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'nanocli-dev-'));
  process.env.NANOCLI_HOME = home;
  const dev = await import('../src/lib/devserver.ts');
  const only = process.env.NANOCLI_TEST_STARTERS?.split(',');
  const failures: string[] = [];
  for (const starter of WEB_STARTERS.filter((s) => !only || only.includes(s.id))) {
    const id = `test-${starter.id}`.slice(0, 40);
    const started = Date.now();
    const state = await dev.startServer(id, filesOf(starter));
    if (state.status !== 'ready' || !state.url) {
      failures.push(`${starter.id}: ${state.status} ${state.error ?? ''}\n${state.log.slice(-15).map((l) => l.d).join('')}`);
      dev.stopServer(id);
      continue;
    }
    // Server-rendered frameworks put the text in the page; client-rendered ones serve it from the entry module
    const fetchText = async (url: string) => (await fetch(url)).text();
    const page = await fetchText(state.url);
    // Angular compiles to one bundle; Vite serves each module at its own path
    const moduleUrl = starter.id === 'web-angular' ? new URL('main.js', state.url).href : new URL(starter.filename, state.url).href;
    const served = /\.(tsx?|vue|svelte)$/.test(starter.filename) && !page.includes('Hello from') ? await fetchText(moduleUrl) : page;
    const visible = page.includes('Hello from') || served.includes('Hello from');
    if (!visible) failures.push(`${starter.id}: page did not contain the starter (${page.slice(0, 200)})`);

    // An edit reaches the dev server
    await dev.syncServer(id, { [starter.filename]: starter.code.replace('Hello from', 'Edited in') }, []);
    let edited = false;
    for (let i = 0; i < 40 && !edited; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const again = await fetchText(state.url).catch(() => '');
      const moduleAgain = /\.(tsx?|vue|svelte)$/.test(starter.filename) ? await fetchText(moduleUrl).catch(() => '') : '';
      edited = again.includes('Edited in') || moduleAgain.includes('Edited in');
    }
    if (!edited) failures.push(`${starter.id}: the edit was not served`);
    console.log(`  ${starter.id}: ready in ${((Date.now() - started) / 1000).toFixed(1)} s at ${state.url}${visible && edited ? '' : ' (failed)'}`);
    dev.stopServer(id);
  }
  await fs.rm(home, { recursive: true, force: true }).catch(() => {});
  assert.deepEqual(failures, []);
});
