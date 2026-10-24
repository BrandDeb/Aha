import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/lib/templates.ts';
import { PROJECT_TEMPLATES as BASE, WORDSTATS_OUTPUT } from '../src/lib/project-templates.ts';
import { MORE_PROJECT_TEMPLATES } from '../src/lib/project-templates-more.ts';
import { detectStacks } from '../src/lib/pipelines/stack.ts';
import { packageManagerFor } from '../src/lib/frameworks.ts';
import { parsePipeline } from '../src/lib/pipelines/parse.ts';
import { getLanguage } from '../src/lib/languages.ts';

const PROJECT_TEMPLATES = [...BASE, ...MORE_PROJECT_TEMPLATES];

// Running each template and its CI for real needs the toolchains and package registries; that is done by
// npm run verify:templates and by the studio's own Pipelines tab. Here: the shape of each one.

test('project templates: one per language, each with a program, tests, sample data and CI', () => {
  assert.ok(PROJECT_TEMPLATES.length >= 17);
  assert.equal(new Set(PROJECT_TEMPLATES.map((t) => t.language)).size, PROJECT_TEMPLATES.length, 'one per language');
  for (const pt of PROJECT_TEMPLATES) {
    assert.ok(pt.language === 'python' || getLanguage(pt.language), `${pt.id}: known language`);
    assert.ok(pt.filename in pt.files, `${pt.id}: entry file`);
    assert.ok(Object.keys(pt.files).some((p) => /(^|\/)(tests?|Tests|src\/test)\/|_test\.(go|ts)$|\.test\.ts$|\.(rs|zig)$/.test(p)), `${pt.id}: has tests`);
    assert.equal(pt.files['sample.txt'].split('\n').length, 4, `${pt.id}: sample`);

    const t = TEMPLATES.find((x) => x.id === pt.id);
    assert.ok(t, `${pt.id} is offered in New project`);
    const ci = t!.files?.['.github/workflows/ci.yml'];
    assert.ok(ci, `${pt.id}: ships with CI`);
    const pipeline = parsePipeline('.github/workflows/ci.yml', ci!);
    assert.ok(!('error' in pipeline), `${pt.id}: CI parses`);
    const runs = (pipeline as Exclude<typeof pipeline, { error: string }>).jobs.flatMap((j) => j.steps.map((s) => s.run ?? '')).join('\n');
    const testCommand = { node: 'npm run test', python: 'uv run pytest', go: 'go test', rust: 'cargo test', java: 'mvn -B verify', ruby: 'bundle exec rake test', php: 'vendor/bin/phpunit', c: 'make test', cpp: 'ctest', bun: 'bun run test', deno: 'deno test', csharp: 'dotnet test tests/WordStats.Tests', kotlin: 'java -cp build/test.jar WordStatsTestKt', swift: 'swift test', zig: 'zig test src/main.zig', dart: 'dart test', elixir: 'mix test' }[pt.language];
    assert.ok(testCommand && runs.includes(testCommand), `${pt.id}: CI runs ${testCommand}\n${runs}`);
  }
});

test('the sample gives the documented answer', () => {
  // The reference computation every template implements
  const text = PROJECT_TEMPLATES[0].files['sample.txt'];
  const words = text.toLowerCase().match(/[a-z0-9']+/g)!;
  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3).map(([w, c]) => `${w} ${c}`).join(', ');
  assert.deepEqual([`lines: ${text.trimEnd().split('\n').length}`, `words: ${words.length}`, `top: ${top}`], WORDSTATS_OUTPUT);
});

test('stacks: Swift packages, Kotlin without Gradle, Zig without build.zig, .NET version from the project', () => {
  const ids = (files: Record<string, string>) => detectStacks(files).map((s) => s.id);
  assert.deepEqual(ids({ 'Package.swift': '', 'Sources/a/main.swift': '' }), ['swift']);
  assert.deepEqual(ids({ 'src/Main.kt': 'fun main() {}' }), ['kotlin']);
  assert.deepEqual(ids({ 'build.gradle.kts': '', 'src/Main.kt': '' }), ['gradle']);
  const zig = detectStacks({ 'src/main.zig': '' })[0];
  assert.ok(zig.checks.some((c) => c.run === 'zig test src/main.zig'));
  const dotnet = detectStacks({ 'App.csproj': '<TargetFramework>net10.0</TargetFramework>' })[0];
  assert.equal(dotnet.setup[0].with?.['dotnet-version'], '10.0.x');
  assert.ok(dotnet.checks.some((c) => c.run === 'dotnet test --no-build -c Release'));
});

test('package manager: lockfile, then bunfig.toml or the packageManager field', () => {
  assert.equal(packageManagerFor({ 'package.json': '{}' }), 'npm');
  assert.equal(packageManagerFor({ 'package.json': '{}', 'bunfig.toml': '' }), 'bun');
  assert.equal(packageManagerFor({ 'package.json': '{"packageManager": "pnpm@10.0.0"}' }), 'pnpm');
  assert.equal(packageManagerFor({ 'package.json': '{"packageManager": "pnpm@10.0.0"}', 'yarn.lock': '' }), 'yarn');
});
