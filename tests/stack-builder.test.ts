import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStack, DEFAULT_STACK, LIBRARIES, resolveStack, unavailable, type StackChoice } from '../src/lib/stack/index.ts';
import { GALLERY } from '../src/lib/gallery.ts';
import { planApp, PLAN_EXAMPLES } from '../src/lib/planner.ts';
import { TEMPLATES } from '../src/lib/templates.ts';
import { detectStacks } from '../src/lib/pipelines/stack.ts';
import { detectAppServer } from '../src/lib/app-servers.ts';

const web = (framework: StackChoice['framework'], styling: StackChoice['styling'], libraries: string[]): StackChoice => ({ ...DEFAULT_STACK, framework, styling, libraries });

test('stack: requirements are added, conflicts resolved, misfits dropped, all explained', () => {
  const { choice, notes } = resolveStack(web('vue', 'bootstrap', ['shadcn', 'zustand', 'drizzle', 'pinia', 'eslint', 'biome']));
  assert.deepEqual(choice.libraries, ['drizzle', 'pinia', 'biome', 'hono']);
  assert.ok(notes.some((n) => n.startsWith('shadcn/ui left out: needs react')));
  assert.ok(notes.includes('ESLint replaced by Biome.'));
  assert.ok(notes.includes('Hono API added: Drizzle + SQLite needs it.'));
  assert.equal(unavailable(LIBRARIES.find((l) => l.id === 'shadcn')!, web('react', 'css', [])), 'Needs Tailwind CSS');
});

test('stack: every dependency is in package.json, and each library is used in the code', () => {
  const built = buildStack(web('react', 'tailwind', ['shadcn', 'tanstack-query', 'tanstack-router', 'react-hook-form', 'zod', 'zustand', 'hono', 'drizzle', 'vitest', 'eslint']));
  const pkg = JSON.parse(built.files['package.json']);
  for (const dep of ['react', '@tanstack/react-query', '@tanstack/react-router', 'react-hook-form', '@hookform/resolvers', 'zod', 'zustand', 'hono', 'drizzle-orm', 'better-sqlite3', 'radix-ui']) assert.ok(pkg.dependencies[dep], dep);
  for (const dep of ['vite', 'tailwindcss', 'vitest', 'eslint', '@hono/vite-dev-server']) assert.ok(pkg.devDependencies[dep], dep);
  const code = Object.values(built.files).join('\n');
  for (const used of ['@tanstack/react-query', '@tanstack/react-router', 'react-hook-form', 'zustand', 'drizzle-orm', '@/components/ui/button']) assert.ok(code.includes(`from '${used}`), used);
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'db:generate', 'dev', 'lint', 'preview', 'start', 'test', 'typecheck']);
  assert.ok(built.commands[0].startsWith('npm install '));
  // The studio runs it, and CI tests and lints it
  const ci = detectStacks(built.files)[0];
  assert.ok(ci.checks.some((c) => c.run === 'npm run test') && ci.checks.some((c) => c.run === 'npm run lint'));
});

test('stack: Python packages go into pyproject.toml the way uv add writes them', () => {
  const built = buildStack({ ...DEFAULT_STACK, kind: 'python', pyFramework: 'fastapi', libraries: ['sqlmodel', 'pandas', 'pytest', 'ruff'] });
  assert.match(built.files['pyproject.toml'], /dependencies = \[\n {4}"fastapi>=[\d.]+",\n {4}"pandas>=[\d.]+",\n {4}"sqlmodel>=[\d.]+",\n {4}"uvicorn>=[\d.]+",\n\]/);
  assert.match(built.files['pyproject.toml'], /\[dependency-groups\]\ndev = \[\n {4}"httpx>=[\d.]+",\n {4}"pytest>=[\d.]+",\n {4}"ruff>=[\d.]+",\n\]/);
  assert.deepEqual(built.commands, ['uv add fastapi pandas sqlmodel uvicorn', 'uv add --dev httpx pytest ruff']);
  assert.equal(detectAppServer(built.files)?.id, 'fastapi');
});

test('gallery: every app starts from a template that exists or a stack that resolves cleanly', () => {
  const ids = new Set(TEMPLATES.map((t) => t.id));
  for (const app of GALLERY) {
    for (const source of [app.source, ...(app.variants ?? []).map((v) => v.source)]) {
      if ('template' in source) assert.ok(ids.has(source.template), `${app.id}: ${source.template}`);
      else assert.deepEqual(resolveStack(source.stack).notes, [], `${app.id}: stack resolves without changes`);
    }
    assert.ok(app.brief.length > 80 && app.why.length > 30, app.id);
  }
  assert.ok(GALLERY.length >= 20);
});

test('planner: picks a stack that fits, honours what you name, and says why', () => {
  const expenses = planApp('An expense tracker that saves to a database, with charts by category');
  assert.ok('stack' in expenses.source);
  const libs = (expenses.source as { stack: StackChoice }).stack.libraries;
  for (const id of ['hono', 'drizzle', 'recharts', 'shadcn']) assert.ok(libs.includes(id), id);
  assert.equal(expenses.similar?.id, 'expenses');
  assert.equal(expenses.name, 'expense-tracker-saves');

  assert.deepEqual(planApp('A URL shortener in Go').source, { template: 'app-go' });
  assert.deepEqual(planApp('A landing page for my coffee shop').source, { template: 'web-astro' });
  assert.equal((planApp('Analyse a CSV of sales and chart revenue per month').source as { stack: StackChoice }).stack.kind, 'python');
  assert.deepEqual(planApp('A CLI that renames photos').source, { template: 'modular-cli' });
  const svelte = planApp('A habit tracker in Svelte with streaks').source as { stack: StackChoice };
  assert.equal(svelte.stack.framework, 'svelte');
  assert.ok(svelte.stack.libraries.includes('date-fns'));
  const vueBootstrap = (planApp('a recipe site in vue with bootstrap and pages').source as { stack: StackChoice }).stack;
  assert.equal(vueBootstrap.styling, 'bootstrap');
  assert.ok(vueBootstrap.libraries.includes('vue-router'));
  for (const example of PLAN_EXAMPLES) {
    const plan = planApp(example);
    assert.ok(plan.reasons.length >= 1 && plan.brief.includes(example), example);
    if ('stack' in plan.source) assert.deepEqual(resolveStack(plan.source.stack).notes, [], `${example}: plan resolves cleanly`);
  }
});
