import { test } from 'node:test';
import assert from 'node:assert/strict';
import { browserPreviewSupport, cssModule, cssRuntimes, cssUrl, htmlWithBundle, rewriteCssImports, tailwindSource } from '../src/lib/browser-preview.ts';
import { CSS_STARTERS } from '../src/lib/css-templates.ts';
import { TEMPLATES } from '../src/lib/templates.ts';

test('CSS Modules: classes renamed per file in selectors only, never in values', () => {
  const { css, classes } = cssModule('.card { background: url(img.png); padding: .5em }\n.card:hover .title, a.link { opacity: 0.5 }\n@media (min-width: 40em) { .card { margin: 0 } }', 'src/A.module.css');
  assert.deepEqual(Object.keys(classes).sort(), ['card', 'link', 'title']);
  assert.match(classes.card, /^card_[a-z0-9]+$/);
  assert.ok(css.includes(`.${classes.card}:hover .${classes.title}, a.${classes.link}`));
  assert.ok(css.includes('url(img.png)') && css.includes('padding: .5em'), 'values untouched');
  assert.notEqual(cssModule('.card{}', 'src/B.module.css').classes.card, classes.card, 'another file, another name');
});

test('Tailwind: which runtime, and what goes to it', () => {
  assert.equal(cssRuntimes({ tailwindcss: '^4.1.0' }, {}).tailwind, 4);
  assert.match(cssRuntimes({ tailwindcss: '^4.1.0' }, {}).head, /@tailwindcss\/browser@4/);
  assert.match(cssRuntimes({ tailwindcss: '3.4.1' }, {}).head, /cdn\.tailwindcss\.com/);
  assert.equal(cssRuntimes({}, { 'src/a.css': '@import "tailwindcss";' }).tailwind, 4, 'found from the stylesheet alone');
  assert.equal(cssRuntimes({ react: '19' }, { 'a.css': 'body{}' }).tailwind, null);
  const daisy = cssRuntimes({ daisyui: '^5', tailwindcss: '^4' }, {}).head;
  assert.match(daisy, /daisyui@5/);
  assert.match(cssRuntimes({ unocss: '^66' }, {}).head, /@unocss\/runtime/);
  assert.equal(tailwindSource('@import "tailwindcss";\n@plugin "daisyui";\n@theme { --color-brand: #5eead4; }').trim(), '@theme { --color-brand: #5eead4; }');
  assert.equal(tailwindSource('body { margin: 0 }'), null, 'plain CSS stays plain');
});

test('npm stylesheets: from the package at its version', () => {
  assert.equal(cssUrl('bootstrap/dist/css/bootstrap.min.css', { bootstrap: '^5.3.3' }), 'https://esm.sh/bootstrap@%5E5.3.3/dist/css/bootstrap.min.css');
  assert.equal(cssUrl('@picocss/pico/css/pico.min.css', {}), 'https://esm.sh/@picocss/pico@latest/css/pico.min.css');
  assert.equal(rewriteCssImports('@import "bulma/css/bulma.css";\n@import "./local.css";\n@import url("https://x/y.css");', { bulma: '1.0.4' }), '@import url("https://esm.sh/bulma@1.0.4/css/bulma.css");\n@import "./local.css";\n@import url("https://x/y.css");');
  assert.match(htmlWithBundle(undefined, null, {}, 'x', '', '<script src="https://cdn.tailwindcss.com"></script>'), /<head>[\s\S]*cdn\.tailwindcss\.com[\s\S]*<\/head>/);
});

test('every CSS starter is a template and previews in the browser', () => {
  assert.equal(CSS_STARTERS.length, 9);
  for (const s of CSS_STARTERS) {
    assert.ok(TEMPLATES.some((t) => t.id === s.id && t.language === 'web'), s.id);
    const support = browserPreviewSupport({ ...s.files, [s.filename]: s.code });
    assert.ok(support.ok, `${s.id}: ${'reason' in support ? support.reason : ''}`);
    assert.ok(JSON.parse(s.files['package.json']).devDependencies.vite, `${s.id} builds with Vite`);
  }
});
