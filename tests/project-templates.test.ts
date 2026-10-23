import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEMPLATES } from '../src/lib/templates.ts';
import { PROJECT_TEMPLATES, WORDSTATS_OUTPUT } from '../src/lib/project-templates.ts';
import { parsePipeline } from '../src/lib/pipelines/parse.ts';
import { getLanguage } from '../src/lib/languages.ts';

// Running each template and its CI for real needs the toolchains and package registries; that is done by
// npm run verify:templates and by the studio's own Pipelines tab. Here: the shape of each one.

test('project templates: one per language, each with a program, tests, sample data and CI', () => {
  assert.ok(PROJECT_TEMPLATES.length >= 9);
  assert.equal(new Set(PROJECT_TEMPLATES.map((t) => t.language)).size, PROJECT_TEMPLATES.length, 'one per language');
  for (const pt of PROJECT_TEMPLATES) {
    assert.ok(pt.language === 'python' || getLanguage(pt.language), `${pt.id}: known language`);
    assert.ok(pt.filename in pt.files, `${pt.id}: entry file`);
    assert.ok(Object.keys(pt.files).some((p) => /(^|\/)(tests?|src\/test)\/|_test\.go$|\.rs$/.test(p)), `${pt.id}: has tests`);
    assert.equal(pt.files['sample.txt'].split('\n').length, 4, `${pt.id}: sample`);

    const t = TEMPLATES.find((x) => x.id === pt.id);
    assert.ok(t, `${pt.id} is offered in New project`);
    const ci = t!.files?.['.github/workflows/ci.yml'];
    assert.ok(ci, `${pt.id}: ships with CI`);
    const pipeline = parsePipeline('.github/workflows/ci.yml', ci!);
    assert.ok(!('error' in pipeline), `${pt.id}: CI parses`);
    const runs = (pipeline as Exclude<typeof pipeline, { error: string }>).jobs.flatMap((j) => j.steps.map((s) => s.run ?? '')).join('\n');
    const testCommand = { node: 'npm run test', python: 'uv run pytest', go: 'go test', rust: 'cargo test', java: 'mvn -B verify', ruby: 'bundle exec rake test', php: 'vendor/bin/phpunit', c: 'make test', cpp: 'ctest' }[pt.language];
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
