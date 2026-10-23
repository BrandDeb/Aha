/**
 * Optimize: an audit of a web project for every kind of "engine optimisation"
 * and the basics underneath it, from its files alone (no network, instant):
 *
 * - SEO: titles, descriptions, canonical URLs, headings, robots.txt, sitemap
 * - AEO (answer engines: featured answers, voice assistants): structured data,
 *   question-shaped headings with short direct answers, FAQ data
 * - GEO (generative engines: ChatGPT, Claude, Perplexity, AI Overviews):
 *   llms.txt, content that exists without JavaScript, AI crawlers allowed,
 *   a clear entity (who and what this is)
 * - SMO (social): Open Graph and Twitter cards
 * - Accessibility, mobile, performance and internationalisation, which every
 *   engine and every person depends on
 *
 * Each check says what it found, why it matters, and how to fix it: some fix
 * themselves (a file or a tag added), the rest become a precise brief for the
 * agent. Pure, so it is tested directly.
 */

export type Area = 'seo' | 'aeo' | 'geo' | 'social' | 'a11y' | 'perf' | 'mobile' | 'intl';

export const AREAS: { id: Area; name: string; short: string; about: string }[] = [
  { id: 'seo', name: 'Search (SEO)', short: 'SEO', about: 'Found and ranked by Google, Bing and the rest.' },
  { id: 'aeo', name: 'Answer engines (AEO)', short: 'AEO', about: 'Quoted in featured answers and by voice assistants.' },
  { id: 'geo', name: 'Generative engines (GEO)', short: 'GEO', about: 'Read, understood and cited by ChatGPT, Claude, Perplexity and AI Overviews.' },
  { id: 'social', name: 'Social cards (SMO)', short: 'Social', about: 'A title, description and image when a link is shared.' },
  { id: 'a11y', name: 'Accessibility', short: 'A11y', about: 'Usable by everyone, with any device; engines read the same signals.' },
  { id: 'mobile', name: 'Mobile and app', short: 'Mobile', about: 'Fits phones, installs as an app, has an icon.' },
  { id: 'perf', name: 'Performance', short: 'Speed', about: 'Loads fast (Core Web Vitals), which search ranks and people notice.' },
  { id: 'intl', name: 'International', short: 'Intl', about: 'The right language declared, and every translation linked.' },
];

export type Status = 'pass' | 'warn' | 'fail';

export interface Finding {
  id: string;
  area: Area;
  status: Status;
  title: string;
  /** What was found, specifically */
  detail: string;
  /** Why it matters, in one line */
  why: string;
  /** Files to add or replace that fix it, when it can fix itself */
  fix?: Record<string, string>;
  /** What to ask the agent, when it can't */
  brief?: string;
  /** Where to look */
  file?: string;
}

export interface Audit {
  kind: SiteKind;
  /** The page whose <head> was checked */
  page: string | null;
  findings: Finding[];
  /** 0-100 per area: passes count 1, warnings half */
  scores: Record<Area, number | null>;
  overall: number;
}

type Files = Record<string, string>;
export type SiteKind = 'static' | 'vite' | 'next' | 'astro' | 'nuxt' | 'sveltekit' | 'python' | 'other';

const lower = (s: string) => s.toLowerCase();
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function kindOf(files: Files): SiteKind {
  const pkg = files['package.json'] ?? '';
  if (/"next"\s*:/.test(pkg)) return 'next';
  if (/"astro"\s*:/.test(pkg)) return 'astro';
  if (/"nuxt"\s*:/.test(pkg)) return 'nuxt';
  if (/"@sveltejs\/kit"\s*:/.test(pkg)) return 'sveltekit';
  if (/"vite"\s*:/.test(pkg)) return 'vite';
  if ('pyproject.toml' in files || 'requirements.txt' in files) return 'python';
  if ('index.html' in files) return 'static';
  return 'other';
}

/** Where static files are served from */
function publicDir(kind: SiteKind): string {
  return kind === 'static' ? '' : kind === 'sveltekit' ? 'static/' : 'public/';
}

/** The documents that make up the site's HTML: index.html, other .html pages, Astro pages, HTML in Python templates or strings */
function documents(files: Files): { path: string; html: string }[] {
  const out: { path: string; html: string }[] = [];
  for (const [path, text] of Object.entries(files)) {
    if (/(^|\/)(node_modules|dist|build|\.next)\//.test(path)) continue;
    if (/\.html?$/.test(path) || (/\.astro$/.test(path) && /<html/i.test(text))) out.push({ path, html: text });
    else if (/\.py$/.test(path)) {
      const m = text.match(/<!doctype html>[\s\S]*?<\/html>/i);
      if (m) out.push({ path, html: m[0] });
    }
  }
  // index.html first
  return out.sort((a, b) => (/(^|\/)index\.html$/.test(b.path) ? 1 : 0) - (/(^|\/)index\.html$/.test(a.path) ? 1 : 0));
}

const attr = (tag: string, name: string) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|\\{([^}]*)\\})`, 'i'))?.slice(2).find((v) => v !== undefined);
const metaContent = (html: string, key: string) => {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const k = attr(tag, 'name') ?? attr(tag, 'property');
    if (k && lower(k) === lower(key)) return attr(tag, 'content') ?? '';
  }
  return undefined;
};

/** Next.js App Router metadata, read loosely from layout/page files */
function nextMetadata(files: Files) {
  const text = Object.entries(files)
    .filter(([p]) => /(^|\/)app\/.*(layout|page)\.(t|j)sx?$/.test(p))
    .map(([, t]) => t)
    .join('\n');
  return {
    title: /\btitle\s*:/.test(text) && /export const metadata|generateMetadata/.test(text),
    description: /\bdescription\s*:/.test(text) && /export const metadata|generateMetadata/.test(text),
    openGraph: /\bopenGraph\s*:/.test(text) || Object.keys(files).some((p) => /opengraph-image\.(png|jpg|tsx?|jsx?)$/.test(p)),
    canonical: /\bcanonical\s*:/.test(text),
    lang: /<html[^>]*\blang=/.test(text),
    robots: Object.keys(files).some((p) => /(^|\/)app\/robots\.(t|j)s$/.test(p)),
    sitemap: Object.keys(files).some((p) => /(^|\/)app\/sitemap\.(t|j)s$/.test(p)),
    manifest: Object.keys(files).some((p) => /(^|\/)app\/manifest\.(t|j)s$/.test(p)),
    text,
  };
}

/** The site's name and one-line description, from what the project already says */
function identity(files: Files, html: string | null): { name: string; description: string } {
  let name = '';
  try {
    name = JSON.parse(files['package.json'] ?? '{}').name ?? '';
  } catch {}
  const title = html?.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim();
  const readme = files['README.md'] ?? '';
  const heading = readme.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const para = readme
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .find((p) => p && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('-') && !p.startsWith('|') && !p.startsWith('!['));
  const desc = (html && metaContent(html, 'description')) || para?.replace(/\s+/g, ' ').replace(/[*_`]/g, '') || '';
  return { name: title || heading || name || 'My site', description: desc.slice(0, 300) };
}

function addToHead(html: string, tags: string[]): string {
  if (!tags.length) return html;
  const block = tags.map((t) => `    ${t}`).join('\n');
  return /<\/head>/i.test(html) ? html.replace(/(\s*)<\/head>/i, `\n${block}$1</head>`) : html.replace(/<html[^>]*>/i, (m) => `${m}\n  <head>\n${block}\n  </head>`);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function audit(files: Files, siteUrl = 'https://example.com'): Audit {
  const kind = kindOf(files);
  const docs = documents(files);
  const main = docs[0] ?? null;
  const html = main?.html ?? '';
  const pub = publicDir(kind);
  const next = kind === 'next' ? nextMetadata(files) : null;
  const findings: Finding[] = [];
  const add = (f: Finding) => findings.push(f);
  const id = identity(files, main?.html ?? null);
  const at = (path: string) => (path in files ? path : null);
  const indexFix = (tags: string[]) => (main && /\.html?$/.test(main.path) ? { [main.path]: addToHead(main.html, tags) } : undefined);
  const agentFor = (what: string) => `${what} Follow ${kind === 'next' ? 'the Next.js Metadata API (metadata exports, app/robots.ts, app/sitemap.ts, app/manifest.ts)' : kind === 'astro' ? "Astro's conventions (a shared layout's <head>, files in public/)" : kind === 'python' ? 'the framework the project uses (a template, or a route that returns the file)' : 'the conventions of this project'}, keep the existing content, and say what you changed.`;

  // ── SEO ────────────────────────────────────────────────────────────────────
  const title = next ? (next.title ? 'set in metadata' : '') : (html.match(/<title>([^<]*)<\/title>/i)?.[1]?.trim() ?? '');
  if (!title)
    add({ id: 'title', area: 'seo', status: 'fail', title: 'Page title', detail: 'No <title>.', why: 'The title is the blue link in search results and the name AI answers cite.', fix: indexFix([`<title>${esc(id.name)}</title>`]), brief: agentFor(`Give every page a specific, unique title of 30–60 characters (for example "${id.name}").`), file: main?.path });
  else if (!next && (title.length < 15 || title.length > 65))
    add({ id: 'title', area: 'seo', status: 'warn', title: 'Page title', detail: `"${title}" is ${title.length} characters; 30–60 reads best.`, why: 'Short titles say too little; long ones are cut off in results.', brief: agentFor(`Rewrite the page title "${title}" to 30–60 characters that say what the site is and who it is for.`), file: main?.path });
  else add({ id: 'title', area: 'seo', status: 'pass', title: 'Page title', detail: next ? 'Set in the metadata.' : `"${title}"`, why: '' });

  const description = next ? (next.description ? 'set' : '') : metaContent(html, 'description');
  if (!description)
    add({ id: 'description', area: 'seo', status: 'fail', title: 'Meta description', detail: 'No description.', why: 'Search shows it under the title; answer engines use it to decide what the page is about.', fix: id.description ? indexFix([`<meta name="description" content="${esc(id.description.slice(0, 158))}" />`]) : undefined, brief: agentFor('Add a meta description of 70–160 characters to every page that says what it offers and to whom.'), file: main?.path });
  else if (!next && (description.length < 50 || description.length > 170))
    add({ id: 'description', area: 'seo', status: 'warn', title: 'Meta description', detail: `${description.length} characters; 70–160 works best.`, why: 'Too short says little; too long is cut off.', brief: agentFor('Rewrite the meta description to 70–160 characters.'), file: main?.path });
  else add({ id: 'description', area: 'seo', status: 'pass', title: 'Meta description', detail: 'Present.', why: '' });

  const canonical = next ? next.canonical : /<link[^>]+rel=["']canonical["']/i.test(html);
  add(
    canonical
      ? { id: 'canonical', area: 'seo', status: 'pass', title: 'Canonical URL', detail: 'Set.', why: '' }
      : { id: 'canonical', area: 'seo', status: 'warn', title: 'Canonical URL', detail: 'No canonical link.', why: 'Tells engines which address is the real one when the same page is reachable several ways.', fix: indexFix([`<link rel="canonical" href="${siteUrl}/" />`]), brief: agentFor(`Add a canonical URL to every page (the site lives at ${siteUrl}).`), file: main?.path },
  );

  const robotsPath = at(`${pub}robots.txt`) ?? (next?.robots ? 'app/robots.ts' : null);
  const robotsTxt = robotsPath && robotsPath.endsWith('.txt') ? files[robotsPath] : '';
  add(
    robotsPath
      ? { id: 'robots', area: 'seo', status: 'pass', title: 'robots.txt', detail: robotsPath, why: '' }
      : { id: 'robots', area: 'seo', status: 'fail', title: 'robots.txt', detail: 'Missing.', why: 'Crawlers look for it first: it says what they may read and where the sitemap is.', fix: kind === 'python' || kind === 'next' ? undefined : { [`${pub}robots.txt`]: `User-agent: *\nAllow: /\n\nSitemap: ${siteUrl}/sitemap.xml\n` }, brief: agentFor(`Serve a robots.txt that allows everything public and points to ${siteUrl}/sitemap.xml.`) },
  );

  const pages = docs.filter((d) => /\.html?$/.test(d.path)).map((d) => d.path.replace(/^(public\/|static\/)/, ''));
  const sitemapPath = at(`${pub}sitemap.xml`) ?? (next?.sitemap ? 'app/sitemap.ts' : null);
  add(
    sitemapPath
      ? { id: 'sitemap', area: 'seo', status: 'pass', title: 'Sitemap', detail: sitemapPath, why: '' }
      : {
          id: 'sitemap',
          area: 'seo',
          status: 'warn',
          title: 'Sitemap',
          detail: 'No sitemap.xml.',
          why: 'Lists every page so engines find them all, including ones nothing links to yet.',
          fix: kind === 'static' || kind === 'vite' ? { [`${pub}sitemap.xml`]: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${(pages.length ? pages : ['index.html']).map((p) => `  <url><loc>${siteUrl}/${p === 'index.html' ? '' : p.replace(/index\.html$/, '')}</loc></url>`).join('\n')}\n</urlset>\n` } : undefined,
          brief: agentFor('Generate a sitemap.xml listing every public page.'),
        },
  );

  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? '';
  const h1s = (html.match(/<h1\b/gi) ?? []).length;
  const appRoot = /<div id="(root|app)"><\/div>/.test(body) && strip(body).length < 20;
  if (main && !appRoot && kind !== 'next')
    add(h1s === 1 ? { id: 'h1', area: 'seo', status: 'pass', title: 'One main heading', detail: 'One <h1>.', why: '' } : { id: 'h1', area: 'seo', status: 'warn', title: 'One main heading', detail: h1s ? `${h1s} <h1> elements.` : 'No <h1>.', why: 'One clear main heading tells engines and screen readers what the page is about.', brief: agentFor('Give each page exactly one <h1> that names its topic, with <h2>/<h3> for sections.'), file: main.path });

  if (/<meta[^>]+name=["']robots["'][^>]+noindex/i.test(html) || /\brobots\s*:\s*\{[^}]*index\s*:\s*false/.test(next?.text ?? ''))
    add({ id: 'noindex', area: 'seo', status: 'fail', title: 'Hidden from search', detail: 'The page says noindex.', why: 'Search engines will drop it. Remove noindex unless the page is meant to be private.', brief: agentFor('Remove noindex from public pages.'), file: main?.path });

  // ── Social ─────────────────────────────────────────────────────────────────
  const og = next ? next.openGraph : !!metaContent(html, 'og:title');
  const ogImage = next ? next.openGraph : !!metaContent(html, 'og:image');
  add(
    og
      ? { id: 'og', area: 'social', status: 'pass', title: 'Open Graph tags', detail: 'Present.', why: '' }
      : { id: 'og', area: 'social', status: 'fail', title: 'Open Graph tags', detail: 'No og:title / og:description.', why: 'Without them, links shared on LinkedIn, Slack, iMessage or WhatsApp show a bare URL.', fix: indexFix([`<meta property="og:type" content="website" />`, `<meta property="og:title" content="${esc(id.name)}" />`, ...(id.description ? [`<meta property="og:description" content="${esc(id.description.slice(0, 200))}" />`] : []), `<meta property="og:url" content="${siteUrl}/" />`]), brief: agentFor('Add Open Graph tags (og:title, og:description, og:url, og:type) to every page.'), file: main?.path },
  );
  add(
    ogImage
      ? { id: 'og-image', area: 'social', status: 'pass', title: 'Share image', detail: 'Present.', why: '' }
      : { id: 'og-image', area: 'social', status: 'warn', title: 'Share image', detail: 'No og:image.', why: 'Posts with a 1200×630 image get far more clicks than text-only links.', brief: agentFor(`Create a 1200×630 share image for the site (an SVG converted to PNG, or a generated image route) and reference it with og:image and twitter:image using an absolute URL on ${siteUrl}.`), file: main?.path },
  );
  const twitter = next ? /\btwitter\s*:/.test(next.text) : !!metaContent(html, 'twitter:card');
  add(twitter ? { id: 'twitter', area: 'social', status: 'pass', title: 'X / Twitter card', detail: 'Present.', why: '' } : { id: 'twitter', area: 'social', status: 'warn', title: 'X / Twitter card', detail: 'No twitter:card.', why: 'X shows a large preview only when the card type is set.', fix: indexFix([`<meta name="twitter:card" content="summary_large_image" />`]), brief: agentFor('Add twitter:card summary_large_image to every page.'), file: main?.path });

  // ── AEO ────────────────────────────────────────────────────────────────────
  const allText = Object.entries(files)
    .filter(([p]) => !/(^|\/)(node_modules|dist)\//.test(p))
    .map(([, t]) => t)
    .join('\n');
  const jsonLd = /application\/ld\+json/.test(allText);
  add(
    jsonLd
      ? { id: 'jsonld', area: 'aeo', status: 'pass', title: 'Structured data', detail: 'schema.org JSON-LD found.', why: '' }
      : {
          id: 'jsonld',
          area: 'aeo',
          status: 'fail',
          title: 'Structured data',
          detail: 'No schema.org JSON-LD.',
          why: 'Structured data states facts (what this is, who makes it, prices, questions and answers) that answer engines quote directly.',
          fix: indexFix([`<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebSite', name: id.name, url: `${siteUrl}/`, ...(id.description ? { description: id.description } : {}) })}</script>`]),
          brief: agentFor('Add schema.org JSON-LD: WebSite and Organization on the home page, plus the type that fits each page (Product, SoftwareApplication, Article, FAQPage, HowTo, LocalBusiness, Event…).'),
          file: main?.path,
        },
  );
  const faq = /"FAQPage"|'FAQPage'/.test(allText);
  const questions = (allText.match(/<h[23][^>]*>[^<]{6,}\?\s*<\/h[23]>/gi) ?? []).length;
  add(
    faq || questions >= 3
      ? { id: 'questions', area: 'aeo', status: 'pass', title: 'Questions answered directly', detail: faq ? 'FAQPage data present.' : `${questions} question headings.`, why: '' }
      : { id: 'questions', area: 'aeo', status: 'warn', title: 'Questions answered directly', detail: 'No FAQ section or question-shaped headings.', why: 'Answer engines lift a question heading and the 40–60 words right after it. Write the questions people ask, answered in the first sentence.', brief: agentFor('Add an FAQ section with the 5–8 questions a visitor would actually ask, each as an <h2>/<h3> question answered in the first 1–2 sentences (under 60 words), and mark it up as FAQPage JSON-LD.') },
  );

  // ── GEO ────────────────────────────────────────────────────────────────────
  const llms = at(`${pub}llms.txt`) ?? Object.keys(files).find((p) => /llms\.txt/.test(p)) ?? null;
  add(
    llms
      ? { id: 'llms', area: 'geo', status: 'pass', title: 'llms.txt', detail: llms, why: '' }
      : {
          id: 'llms',
          area: 'geo',
          status: 'fail',
          title: 'llms.txt',
          detail: 'Missing.',
          why: 'A plain-text map of the site for language models (llmstxt.org): what it is, the key facts, and links to the pages worth reading.',
          fix: kind === 'python' || kind === 'next' ? undefined : { [`${pub}llms.txt`]: `# ${id.name}\n\n> ${id.description || `What ${id.name} is, in one or two sentences.`}\n\n## Pages\n\n${(pages.length ? pages : ['index.html']).map((p) => `- [${p === 'index.html' ? 'Home' : p.replace(/\.html?$/, '')}](${siteUrl}/${p === 'index.html' ? '' : p}): `).join('\n')}\n` },
          brief: agentFor(`Serve /llms.txt (llmstxt.org): "# ${id.name}", a one-paragraph "> " summary, the key facts as a list, and "## " sections linking each important page with a one-line description.`),
        },
  );
  const blocked = robotsTxt && /User-agent:\s*(GPTBot|ClaudeBot|OAI-SearchBot|PerplexityBot|Claude-User|ChatGPT-User|\*)\s*\n(?:[^\n]*\n)*?Disallow:\s*\/\s*$/im.test(robotsTxt);
  if (robotsPath)
    add(blocked ? { id: 'ai-crawlers', area: 'geo', status: 'fail', title: 'AI crawlers allowed', detail: 'robots.txt blocks some crawlers from the whole site.', why: 'Blocked assistants can’t read the site to answer about it or cite it.', brief: agentFor('Allow AI search and answer crawlers (OAI-SearchBot, ChatGPT-User, Claude-SearchBot, Claude-User, PerplexityBot) in robots.txt; keep training crawlers as the owner prefers.'), file: robotsPath } : { id: 'ai-crawlers', area: 'geo', status: 'pass', title: 'AI crawlers allowed', detail: 'Nothing public is blocked.', why: '' });
  if (main && appRoot && (kind === 'vite' || kind === 'static'))
    add({ id: 'no-js', area: 'geo', status: 'warn', title: 'Content without JavaScript', detail: `${main.path} is an empty shell filled in by JavaScript.`, why: 'Many AI crawlers and some search crawlers don’t run JavaScript: they see an empty page. Key text in the HTML (or prerendering) fixes that.', brief: agentFor('Make the main content readable without JavaScript: prerender the pages at build time (or add the key text, headings and a <noscript> summary to index.html) so crawlers that don’t run scripts see it.'), file: main.path });
  const entity = /"Organization"|"Person"|"LocalBusiness"|"SoftwareApplication"|"Product"/.test(allText);
  add(entity ? { id: 'entity', area: 'geo', status: 'pass', title: 'Clear entity', detail: 'Organization / Product data present.', why: '' } : { id: 'entity', area: 'geo', status: 'warn', title: 'Clear entity', detail: 'Nothing says who is behind the site or what the product is.', why: 'Generative engines cite sources they can identify: name, what it is, who makes it, where else it lives (sameAs links).', brief: agentFor('Add Organization (or Person) and Product/SoftwareApplication JSON-LD with name, description, url, logo and sameAs links to the official profiles, and an About section that states the same facts in plain words.') });
  const facts = strip(body);
  if (main && !appRoot && words(facts) < 120 && kind !== 'next')
    add({ id: 'thin', area: 'geo', status: 'warn', title: 'Enough to cite', detail: `About ${words(facts)} words of text on ${main.path}.`, why: 'Engines quote specific facts, numbers and definitions. Thin pages are skipped.', brief: agentFor('Expand the main page with specific, factual content: what it is, who it is for, how it works, numbers that matter, and a short FAQ.'), file: main.path });

  // ── Accessibility ──────────────────────────────────────────────────────────
  const lang = next ? next.lang : /<html[^>]*\blang=["'][a-z]/i.test(html);
  if (main || next)
    add(lang ? { id: 'lang', area: 'a11y', status: 'pass', title: 'Page language', detail: 'Declared.', why: '' } : { id: 'lang', area: 'a11y', status: 'fail', title: 'Page language', detail: '<html> has no lang.', why: 'Screen readers pronounce the page in the wrong language, and engines guess.', fix: main && /\.html?$/.test(main.path) ? { [main.path]: html.replace(/<html(?![^>]*\blang=)/i, '<html lang="en"') } : undefined, brief: agentFor('Set lang on the <html> element.'), file: main?.path });
  const imgs = allText.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((t) => !/\balt\s*=/.test(t));
  if (imgs.length) add(noAlt.length ? { id: 'alt', area: 'a11y', status: 'fail', title: 'Image descriptions', detail: `${noAlt.length} of ${imgs.length} images have no alt text.`, why: 'People using screen readers, and image search, need to know what an image shows (alt="" for decoration).', brief: agentFor('Give every <img> an alt that describes it, or alt="" when it is decorative.') } : { id: 'alt', area: 'a11y', status: 'pass', title: 'Image descriptions', detail: `All ${imgs.length} images have alt.`, why: '' });
  const vague = (allText.match(/<a\b[^>]*>\s*(click here|here|read more|more|link)\s*<\/a>/gi) ?? []).length;
  if (vague) add({ id: 'link-text', area: 'a11y', status: 'warn', title: 'Link text', detail: `${vague} links say only "click here", "here" or "read more".`, why: 'Link text is how engines and screen-reader users learn where a link goes.', brief: agentFor('Rewrite vague link text ("click here", "read more") to say where the link goes.') });
  if (/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?\b/i.test(html)) add({ id: 'zoom', area: 'a11y', status: 'fail', title: 'Zoom allowed', detail: 'The viewport disables zooming.', why: 'People with low vision need to zoom; browsers may ignore it anyway.', fix: main ? { [main.path]: html.replace(/,?\s*(user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:\.0)?)/gi, '') } : undefined, file: main?.path });

  // ── Mobile and app ─────────────────────────────────────────────────────────
  if (main && kind !== 'next')
    add(/<meta[^>]+name=["']viewport["']/i.test(html) ? { id: 'viewport', area: 'mobile', status: 'pass', title: 'Mobile viewport', detail: 'Set.', why: '' } : { id: 'viewport', area: 'mobile', status: 'fail', title: 'Mobile viewport', detail: 'No viewport meta.', why: 'Without it phones show a zoomed-out desktop page; Google ranks mobile pages first.', fix: indexFix(['<meta name="viewport" content="width=device-width, initial-scale=1" />']), file: main.path });
  const icon = /<link[^>]+rel=["'][^"']*icon/i.test(html) || Object.keys(files).some((p) => /(favicon\.(ico|svg|png)|(^|\/)app\/icon\.)/.test(p));
  add(icon ? { id: 'icon', area: 'mobile', status: 'pass', title: 'Icon', detail: 'Present.', why: '' } : { id: 'icon', area: 'mobile', status: 'warn', title: 'Icon', detail: 'No favicon.', why: 'Shown in tabs, bookmarks and next to the site in search results.', fix: kind === 'python' || kind === 'next' ? undefined : { [`${pub}favicon.svg`]: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#6366f1"/><text x="32" y="43" font-family="system-ui,sans-serif" font-size="34" font-weight="700" text-anchor="middle" fill="#fff">${esc(id.name.trim().charAt(0).toUpperCase() || 'A')}</text></svg>\n`, ...(main && /\.html?$/.test(main.path) ? { [main.path]: addToHead(html, ['<link rel="icon" href="/favicon.svg" type="image/svg+xml" />']) } : {}) }, brief: agentFor('Add a favicon (SVG plus a 180×180 apple-touch-icon).') });
  const manifest = Object.keys(files).some((p) => /manifest\.(webmanifest|json)$/.test(p) && /"name"/.test(files[p])) || next?.manifest;
  add(manifest ? { id: 'manifest', area: 'mobile', status: 'pass', title: 'Installable', detail: 'Web app manifest present.', why: '' } : { id: 'manifest', area: 'mobile', status: 'warn', title: 'Installable', detail: 'No web app manifest.', why: 'Lets people install the site like an app, with its own icon and colours.', fix: kind === 'python' || kind === 'next' ? undefined : { [`${pub}manifest.webmanifest`]: `${JSON.stringify({ name: id.name, short_name: id.name.slice(0, 12), start_url: '/', display: 'standalone', background_color: '#ffffff', theme_color: '#6366f1', icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }] }, null, 2)}\n`, ...(main && /\.html?$/.test(main.path) ? { [main.path]: addToHead(html, ['<link rel="manifest" href="/manifest.webmanifest" />', '<meta name="theme-color" content="#6366f1" />']) } : {}) }, brief: agentFor('Add a web app manifest with name, icons, start_url, display and theme colour.') });

  // ── Performance ────────────────────────────────────────────────────────────
  const blocking = (html.match(/<script\b(?![^>]*\b(defer|async|type=["']module["']))[^>]*\bsrc=/gi) ?? []).length;
  if (main) add(blocking ? { id: 'blocking', area: 'perf', status: 'warn', title: 'Scripts don’t block', detail: `${blocking} script(s) without defer or async.`, why: 'They stop the page from showing until they download and run, which hurts LCP.', brief: agentFor('Add defer to scripts that don’t need to run before the page shows.'), file: main.path } : { id: 'blocking', area: 'perf', status: 'pass', title: 'Scripts don’t block', detail: 'No render-blocking scripts.', why: '' });
  const unsized = imgs.filter((t) => !/\bwidth\s*=/.test(t) || !/\bheight\s*=/.test(t)).length;
  if (imgs.length) add(unsized ? { id: 'img-size', area: 'perf', status: 'warn', title: 'Images sized', detail: `${unsized} images without width and height.`, why: 'The page jumps as they load (layout shift, CLS).', brief: agentFor('Give every <img> width and height (or aspect-ratio in CSS) and loading="lazy" below the fold.') } : { id: 'img-size', area: 'perf', status: 'pass', title: 'Images sized', detail: 'All images have dimensions.', why: '' });
  const heavy = Object.entries(files).filter(([p, c]) => /\.(png|jpe?g|gif)$/i.test(p) && c.length > 400_000);
  if (heavy.length) add({ id: 'heavy-images', area: 'perf', status: 'warn', title: 'Image weight', detail: `${heavy.map(([p]) => p).join(', ')} over 300 KB.`, why: 'Large images slow the first view, especially on phones.', brief: agentFor(`Convert ${heavy.map(([p]) => p).join(', ')} to WebP/AVIF at the size they are shown.`) });

  // ── International ──────────────────────────────────────────────────────────
  const locales = Object.keys(files).filter((p) => /(^|\/)(locales?|i18n|messages|translations)\/[a-z]{2}(-[A-Z]{2})?(\.json|\/)/.test(p));
  const langs = new Set(locales.map((p) => p.match(/\/([a-z]{2}(?:-[A-Z]{2})?)(?:\.json|\/)/)?.[1]));
  if (langs.size > 1) add(/hreflang/i.test(allText) ? { id: 'hreflang', area: 'intl', status: 'pass', title: 'Translations linked', detail: 'hreflang present.', why: '' } : { id: 'hreflang', area: 'intl', status: 'warn', title: 'Translations linked', detail: `${langs.size} languages, no hreflang links.`, why: 'Engines show each person the version in their language only when the versions are linked.', brief: agentFor('Give each language its own URL and link them with <link rel="alternate" hreflang="…"> (plus x-default).') });

  const scores = Object.fromEntries(
    AREAS.map((a) => {
      const fs = findings.filter((f) => f.area === a.id);
      return [a.id, fs.length ? Math.round((100 * fs.reduce((s, f) => s + (f.status === 'pass' ? 1 : f.status === 'warn' ? 0.5 : 0), 0)) / fs.length) : null];
    }),
  ) as Record<Area, number | null>;
  const scored = Object.values(scores).filter((s): s is number => s !== null);
  return { kind, page: main?.path ?? null, findings, scores, overall: scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : 0 };
}

/** Apply every self-fix at once; fixes to the same file are applied in order on top of each other */
export function applyFixes(files: Files, findings: Finding[], siteUrl?: string): Files {
  let current = { ...files };
  const changed: Files = {};
  for (const f of findings) {
    if (f.status === 'pass' || !f.fix) continue;
    // Re-run the audit on the current files so each fix builds on the previous ones
    const again = audit(current, siteUrl).findings.find((x) => x.id === f.id);
    if (!again?.fix || again.status === 'pass') continue;
    Object.assign(changed, again.fix);
    current = { ...current, ...again.fix };
  }
  return changed;
}

/** One brief for the agent covering everything that can't fix itself */
export function agentBrief(audit: Audit): string | null {
  const open = audit.findings.filter((f) => f.status !== 'pass' && f.brief);
  if (!open.length) return null;
  return `Improve this site for search engines (SEO), answer engines (AEO), generative AI engines (GEO), social sharing, accessibility, mobile and performance. Fix each of these:\n\n${open.map((f, i) => `${i + 1}. [${AREAS.find((a) => a.id === f.area)!.short}] ${f.title}: ${f.detail} ${f.brief}`).join('\n')}\n\nDon't invent facts about the business: where content is needed, write it from what the project already says and mark anything that needs the owner's input with TODO.`;
}
