import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_SERVERS, detectAppServer, detectWebApp, manifestKey, nodeEntry } from '../src/lib/app-servers.ts';
import { APP_PAGE, APP_STARTERS } from '../src/lib/app-templates.ts';
import { TEMPLATES } from '../src/lib/templates.ts';

const filesOf = (id: string) => {
  const s = APP_STARTERS.find((x) => x.id === id)!;
  return { ...s.files, [s.filename]: s.code };
};

test('every full app is recognised as the server it is, and starts with the right command', () => {
  const expected: Record<string, [string, RegExp]> = {
    'app-fastapi': ['fastapi', /^uv run uvicorn main:app --host 127\.0\.0\.1 --port 4000 --reload$/],
    'app-flask': ['flask', /^uv run flask --app app:app run --host 127\.0\.0\.1 --port 4000 --debug$/],
    'app-go': ['go', /^go run \.$/],
    'app-rust': ['rust', /^cargo run --quiet$/],
    'app-sinatra': ['sinatra', /^bundle exec ruby app\.rb -o 127\.0\.0\.1 -p 4000$/],
    'app-php': ['php', /^php -S 127\.0\.0\.1:4000 -t \.$/],
    'app-java': ['java', /^java Main\.java$/],
    'app-express': ['node', /^node --watch server\.js$/],
    'app-bun': ['bun', /^bun --hot run server\.ts$/],
    'app-deno': ['deno', /^deno run --watch --allow-net --allow-env --allow-read main\.ts$/],
    'app-aspnet': ['aspnet', /^dotnet run --no-build --urls http:\/\/127\.0\.0\.1:4000$/],
    'app-elixir': ['elixir', /^mix run --no-halt$/],
  };
  assert.deepEqual(APP_STARTERS.map((s) => s.id).sort(), Object.keys(expected).sort());
  for (const [id, [server, command]] of Object.entries(expected)) {
    const files = filesOf(id);
    const app = detectAppServer(files);
    assert.equal(app?.id, server, id);
    assert.match(app!.start(files, 4000), command, id);
    const web = detectWebApp(files);
    assert.equal(web?.kind, 'app');
    assert.equal(web?.label, app!.label);
    assert.ok(files['index.html'].includes('<h1>Todos</h1>'), `${id} serves the page`);
    assert.ok(TEMPLATES.some((t) => t.id === id && t.app), `${id} is in the New project dialog`);
  }
});

test('JavaScript frameworks keep their dev server; plain projects are not web apps', () => {
  assert.equal(detectWebApp({ 'package.json': '{"devDependencies":{"vite":"^8"}}', 'index.html': '' })?.kind, 'framework');
  assert.equal(detectWebApp({ 'main.py': 'print(1)', 'pyproject.toml': '[project]\nname="x"' }), null);
  assert.equal(detectWebApp({ 'main.go': 'package main\nfunc main() {}', 'go.mod': 'module x' }), null, 'a Go CLI is not a server');
  assert.equal(detectAppServer({ 'manage.py': '', 'pyproject.toml': 'dependencies = ["django>=5"]' })?.id, 'django');
  assert.equal(detectAppServer({ 'public/index.php': '<?php' })?.start({ 'public/index.php': '' }, 9), 'php -S 127.0.0.1:9 -t public');
});

test('installs: only when the manifests change; Node entries; the page', () => {
  const rust = APP_SERVERS.find((s) => s.id === 'rust')!;
  const files = filesOf('app-rust');
  assert.equal(manifestKey(rust, files), manifestKey(rust, { ...files, 'src/main.rs': '// edited' }), 'code edits do not reinstall');
  assert.notEqual(manifestKey(rust, files), manifestKey(rust, { ...files, 'Cargo.toml': files['Cargo.toml'] + 'rand = "0.9"\n' }));
  assert.equal(nodeEntry({ 'package.json': '{"main":"./src/app.js"}', 'src/app.js': '' }), 'src/app.js');
  assert.equal(nodeEntry({ 'package.json': '{}', 'index.js': '' }), 'index.js');
  assert.match(APP_PAGE('Go'), /<title>Todos · Go<\/title>/);
});
