import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentBrief, applyFixes, audit } from '../src/lib/optimize.ts';
import { faqLd, ldJson, llmsTxt, publicPages, siteUrl, softwareLd } from '../src/lib/site.ts';
import { docsFromReadme } from '../src/lib/docs.ts';
import { README } from '../src/lib/docs-readme.ts';
import { FAQS } from '../src/lib/faq.ts';
import { PLANS } from '../src/lib/pricing.ts';
import { buildStack, DEFAULT_STACK } from '../src/lib/stack/index.ts';

const BARE = { 'index.html': '<!doctype html>\n<html>\n  <head>\n    <title>Hi</title>\n  </head>\n  <body><h1>Hi</h1><img src="a.png"></body>\n</html>\n', 'README.md': '# Bakery\n\nFresh bread delivered every morning in Cape Town.\n' };

test('optimize: a bare page fails the basics in every area, and says why', () => {
  const a = audit(BARE, 'https://bakery.example');
  assert.equal(a.kind, 'static');
  const status = (id: string) => a.findings.find((f) => f.id === id)?.status;
  for (const id of ['description', 'robots', 'og', 'jsonld', 'llms', 'lang', 'alt', 'viewport']) assert.equal(status(id), 'fail', id);
  assert.equal(status('title'), 'warn');
  assert.ok(a.overall < 40);
  for (const f of a.findings.filter((x) => x.status !== 'pass')) assert.ok(f.why, `${f.id} explains why`);
});

test('optimize: the self-fixes all apply together and lift every fixable check', () => {
  const before = audit(BARE, 'https://bakery.example');
  const changed = applyFixes(BARE, before.findings, 'https://bakery.example');
  for (const p of ['robots.txt', 'sitemap.xml', 'llms.txt', 'manifest.webmanifest', 'favicon.svg', 'index.html']) assert.ok(p in changed, p);
  const html = changed['index.html'];
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta name="description" content="Fresh bread delivered every morning in Cape Town\." \/>/);
  assert.match(html, /property="og:title" content="Hi"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(changed['llms.txt'], /^# Hi\n\n> Fresh bread/);
  const after = audit({ ...BARE, ...changed }, 'https://bakery.example');
  for (const f of after.findings.filter((x) => x.fix)) assert.equal(f.status, 'pass', `${f.id} fixed`);
  assert.ok(after.overall > before.overall + 30);
  // What's left goes to the agent as one brief
  assert.match(agentBrief(after) ?? '', /alt/);
});

test('optimize: knows a Vite SPA shell is empty without JavaScript, and Next.js metadata', () => {
  const spa = buildStack({ ...DEFAULT_STACK, libraries: [] }).files;
  const a = audit(spa);
  assert.equal(a.kind, 'vite');
  assert.equal(a.findings.find((f) => f.id === 'no-js')?.status, 'warn');
  assert.ok(applyFixes(spa, a.findings)['public/robots.txt']);
  const next = audit({ 'package.json': '{"dependencies":{"next":"16"}}', 'app/layout.tsx': "export const metadata = { title: 'A', description: 'B', openGraph: {}, alternates: { canonical: '/' } };\nexport default function L({children}){return <html lang=\"en\"><body>{children}</body></html>}", 'app/robots.ts': '', 'app/sitemap.ts': '' });
  assert.equal(next.kind, 'next');
  for (const id of ['title', 'description', 'canonical', 'robots', 'sitemap', 'og', 'lang']) assert.equal(next.findings.find((f) => f.id === id)?.status, 'pass', id);
  // Next.js gets briefs for the agent, not file patches in the wrong place
  assert.equal(next.findings.find((f) => f.id === 'llms')?.fix, undefined);
});

test('site: llms.txt, structured data and the sitemap describe the real site', () => {
  const docs = docsFromReadme(README);
  const txt = llmsTxt('https://nano.example', docs, FAQS, PLANS);
  assert.match(txt, /^# Aha!\n\n> /);
  assert.match(txt, /\n## Pages\n/);
  assert.match(txt, /- \[Live values\]\(https:\/\/nano\.example\/docs\/live-values\): /);
  const full = llmsTxt('https://nano.example', docs, FAQS, PLANS, true);
  assert.ok(full.length > txt.length * 3 && full.includes(FAQS[0].answer));
  const sw = softwareLd('https://nano.example', PLANS) as { offers: { price: string }[] };
  assert.deepEqual(sw.offers.map((o) => o.price), PLANS.map((p) => String(p.monthly ?? 0)));
  assert.equal((faqLd(FAQS) as { mainEntity: unknown[] }).mainEntity.length, FAQS.length);
  assert.ok(!ldJson({ x: '</script><script>alert(1)</script>' }).includes('</script>'));
  assert.equal(publicPages(docs).length, 5 + docs.length);
  assert.equal(siteUrl({ NEXT_PUBLIC_SITE_URL: 'https://a.b/' }), 'https://a.b');
});
