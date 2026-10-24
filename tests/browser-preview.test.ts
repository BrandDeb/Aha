import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPreviewSupport, htmlWithBundle, npmUrl, previewEntry, resolveProjectPath } from '../src/lib/browser-preview.ts';
import { WEB_STARTERS } from '../src/lib/web-templates.ts';

const starter = (id: string) => {
  const s = WEB_STARTERS.find((w) => w.id === id)!;
  return { ...s.files, [s.filename]: s.code };
};

test('in-browser preview: Vite apps yes, server frameworks and Solid no', () => {
  const expected: Record<string, string | false> = { 'web-react': 'react', 'web-preact': 'preact', 'web-vue': 'vue', 'web-svelte': 'svelte', 'web-vanilla': 'vanilla', 'web-solid': false, 'web-next': false, 'web-nuxt': false, 'web-sveltekit': false, 'web-astro': false, 'web-react-router': false, 'web-angular': false };
  for (const [id, flavour] of Object.entries(expected)) {
    const support = browserPreviewSupport(starter(id));
    assert.equal(support.ok ? support.flavour : false, flavour, id);
    if (!support.ok) assert.match(support.reason, /dev server|compiler/);
  }
  assert.equal(browserPreviewSupport({ 'package.json': '{' }).ok, false);
});

test('entry: the module index.html loads, or the usual files', () => {
  assert.deepEqual(previewEntry(starter('web-react')), { entry: 'src/main.tsx', src: '/src/main.tsx' });
  assert.deepEqual(previewEntry(starter('web-vue')), { entry: 'src/main.ts', src: '/src/main.ts' });
  assert.deepEqual(previewEntry({ 'src/index.js': '' }), { entry: 'src/index.js', src: null });
  assert.equal(previewEntry({ 'README.md': '' }), null);
  assert.deepEqual(previewEntry({ 'index.html': '<script src="./app.js" type="module"></script>', 'app.js': '' }), { entry: 'app.js', src: './app.js' });
});

test('imports resolve inside the project, with the extensions bundlers try', () => {
  const files = { 'src/main.ts': '', 'src/App.tsx': '', 'src/lib/index.ts': '', 'src/style.css': '', 'shared.json': '' };
  assert.equal(resolveProjectPath('src/main.ts', './App', files), 'src/App.tsx');
  assert.equal(resolveProjectPath('src/main.ts', './lib', files), 'src/lib/index.ts');
  assert.equal(resolveProjectPath('src/main.ts', './style.css', files), 'src/style.css');
  assert.equal(resolveProjectPath('src/lib/index.ts', '../../shared.json', files), 'shared.json');
  assert.equal(resolveProjectPath('src/main.ts', '/src/App', files), 'src/App.tsx');
  assert.equal(resolveProjectPath('src/main.ts', './missing', files), null);
  assert.equal(resolveProjectPath('src/main.ts', '../../../../etc/passwd', files), null);
});

test('npm packages: esm.sh at the declared version, the other packages kept shared', () => {
  const versions = { react: '^19.3.1', 'react-dom': '^19.3.1', '@tanstack/query': '5.0.0', local: 'file:../x', '@types/react': '^19' };
  assert.equal(npmUrl('react', versions), 'https://esm.sh/react@%5E19.3.1?dev&external=react-dom,@tanstack/query,local');
  assert.equal(npmUrl('react-dom/client', versions), 'https://esm.sh/react-dom@%5E19.3.1/client?dev&external=react,@tanstack/query,local');
  assert.match(npmUrl('@tanstack/query/core', versions), /^https:\/\/esm\.sh\/@tanstack\/query@5\.0\.0\/core\?dev/);
  assert.match(npmUrl('local', versions), /^https:\/\/esm\.sh\/local@latest\?/, 'non-registry versions fall back to latest');
  assert.equal(npmUrl('lodash', {}), 'https://esm.sh/lodash@latest?dev');
});

test('page: the entry script is replaced by the import map and the bundle', () => {
  const html = '<!doctype html><html><head><title>x</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
  const out = htmlWithBundle(html, '/src/main.tsx', { imports: { react: 'https://esm.sh/react' } }, 'console.log("</script>")');
  assert.ok(!out.includes('src="/src/main.tsx"'));
  assert.match(out, /<head>\n<script type="importmap">\{"imports":\{"react":"https:\/\/esm\.sh\/react"\}\}<\/script>/);
  assert.ok(out.includes('console.log("<\\/script>")'), 'a </script> inside the bundle cannot end the tag');
  assert.ok(out.indexOf('type="module">') > out.indexOf('<div id="root">'));
  assert.match(htmlWithBundle(undefined, null, {}, 'x'), /<div id="app"><\/div>/);
});

test('the helpers still work when rebuilt from their source, as the preview frame does', () => {
  for (const fn of [browserPreviewSupport, previewEntry, resolveProjectPath, npmUrl, htmlWithBundle]) {
    const rebuilt = new Function(`return (${fn.toString()})`)();
    assert.equal(typeof rebuilt, 'function', fn.name);
  }
  const rebuiltUrl = new Function(`return (${npmUrl.toString()})`)() as typeof npmUrl;
  assert.equal(rebuiltUrl('vue', { vue: '3.5.44' }), npmUrl('vue', { vue: '3.5.44' }));
  const rebuiltEntry = new Function(`return (${previewEntry.toString()})`)() as typeof previewEntry;
  assert.deepEqual(rebuiltEntry(starter('web-svelte')), previewEntry(starter('web-svelte')));
});
