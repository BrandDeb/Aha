import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { docHref, docsFromReadme, parseBlocks, parseInline, searchDocs, slugify } from '../src/lib/docs.ts';

const pages = docsFromReadme(readFileSync('README.md', 'utf8'));

test('docs: every README section is a page, grouped, with a unique slug', () => {
  assert.ok(pages.length >= 20);
  assert.equal(new Set(pages.map((p) => p.slug)).size, pages.length);
  assert.equal(pages[0].title, 'Quick start');
  assert.ok(!pages.some((p) => p.title === 'License'));
  for (const p of pages) assert.ok(p.blocks.length, `${p.title} has content`);
  assert.equal(pages.find((p) => p.title === 'Agent')!.group, 'AI');
});

test('docs: README links to headings go to the page that holds them', () => {
  assert.equal(docHref('#assistant', pages), '/docs/assistant');
  assert.equal(docHref('#which-model-for-which-job', pages), '/docs/assistant#which-model-for-which-job');
  assert.equal(docHref('https://scriptc.dev', pages), 'https://scriptc.dev');
  // No README link is left pointing at a heading the docs don't have
  const anchors = pages.flatMap((p) => p.blocks.flatMap((b) => JSON.stringify(b).match(/"href":"#[^"]+"/g) ?? []));
  for (const a of anchors) assert.ok(docHref(a.slice(8, -1), pages).startsWith('/docs/'), `${a} resolves`);
});

test('docs: markdown blocks and inline runs', () => {
  const blocks = parseBlocks('Intro **bold** and `code`.\n\n```bash\nnpm run dev\n```\n\n### A section\n\n- one\n- two\n  continued\n\n| A | B |\n|---|---|\n| `x \\| y` | 2 |\n\n> Note');
  assert.deepEqual(
    blocks.map((b) => b.t),
    ['p', 'code', 'h', 'list', 'table', 'quote'],
  );
  assert.deepEqual(blocks[3], { t: 'list', ordered: false, items: [[{ t: 'text', v: 'one' }], [{ t: 'text', v: 'two continued' }]] });
  assert.deepEqual(parseInline('[the *docs*](#a) x'), [{ t: 'link', href: '#a', c: [{ t: 'text', v: 'the ' }, { t: 'em', c: [{ t: 'text', v: 'docs' }] }] }, { t: 'text', v: ' x' }]);
  assert.deepEqual(parseInline('snake_case_name stays'), [{ t: 'text', v: 'snake_case_name stays' }]);
  assert.deepEqual(parseInline('[![badge](https://x/y.svg)](https://x) text'), [{ t: 'text', v: ' text' }]);
  assert.equal(slugify('`POST /api/compile`'), 'post-apicompile');
  assert.equal(slugify("What's measured"), 'whats-measured');
});

test('docs: search ranks titles first and needs every word', () => {
  assert.equal(searchDocs(pages, 'agent')[0].title, 'Agent');
  assert.ok(searchDocs(pages, 'tauri desktop').some((p) => p.title.startsWith('Desktop app')));
  assert.deepEqual(searchDocs(pages, 'zzqx-nothing'), []);
  assert.deepEqual(searchDocs(pages, '  '), []);
});
