/**
 * How the site presents itself to search engines (SEO), answer engines (AEO:
 * featured answers, voice assistants) and generative engines (GEO: ChatGPT,
 * Claude, Perplexity, Google AI Overviews): one canonical address, a clear
 * entity (what Aha! is, who makes it, what it costs), schema.org
 * structured data per page, and llms.txt — a plain-text map of the site
 * written for language models. Pure: the routes in app/ only serialise these.
 */

import type { DocPage } from './docs.ts';
import type { FAQItem } from './faq.ts';
import type { Plan } from './pricing.ts';

/** The public address. Set NEXT_PUBLIC_SITE_URL (or NEXT_PUBLIC_BASE_URL) in production so canonical URLs, the sitemap and social cards point at it */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const raw = env.NEXT_PUBLIC_SITE_URL || env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
  return raw.replace(/\/+$/, '');
}

export const SITE = {
  name: 'Aha!',
  shortName: 'Aha!',
  tagline: 'The IDE where AI does the work and proves it',
  description:
    'Aha! is an editor and an AI teammate in one workspace. Describe an app or write it yourself in 40+ languages; the agent works on a private copy and every change arrives as a proposal with the diff and evidence that it builds and runs. Live values, contracts, a second reviewer, live preview, native desktop apps, and your own model.',
  publisher: 'BrandDeb',
  category: 'DeveloperApplication',
  keywords: ['AI code editor', 'AI IDE', 'coding agent', 'vibe coding', 'app builder', 'TypeScript to native binary', 'scriptc', 'live preview', 'stack builder', 'online IDE', 'browser IDE', 'polyglot IDE'],
  /** The things the site is about, for structured data and llms.txt */
  features: [
    'Describe an app in plain words and get a plan: the language and stack that fit, and why',
    'A gallery of 23 apps, each on the stack that suits it, many in several languages',
    'A stack builder: framework, styling, UI kit, data, routing, state, forms, testing, lint, API and database, with every dependency wired in',
    'An AI agent that works on a private copy and hands back proposals with the diff and evidence that it builds and runs',
    'Live values: what every line did, written onto the code as you type',
    'Contracts: rules the agent must keep, checked by a pattern or a command',
    'A second reviewer from a different model family on every proposal',
    'An autonomous worker that fixes, tests and improves while you pause',
    'Toolchains for 40+ languages installed and kept current, with templates, tests and CI for each',
    'TypeScript compiled to a small native binary with scriptc',
    'Native apps for macOS, Windows and Linux',
    'Bring your own model: Anthropic, OpenAI, Gemini, Groq, OpenRouter, Ollama and more',
  ],
} as const;

type Json = Record<string, unknown>;
const ctx = (o: Json): Json => ({ '@context': 'https://schema.org', ...o });

/** The organisation and the product: the entity every other page refers to */
export function organizationLd(base: string): Json {
  return ctx({ '@type': 'Organization', '@id': `${base}/#organization`, name: SITE.publisher, url: base, logo: `${base}/icon.svg` });
}

export function websiteLd(base: string): Json {
  return ctx({
    '@type': 'WebSite',
    '@id': `${base}/#website`,
    name: SITE.name,
    url: base,
    description: SITE.description,
    publisher: { '@id': `${base}/#organization` },
    inLanguage: 'en',
  });
}

/** The product, with its plans as offers */
export function softwareLd(base: string, plans: Plan[]): Json {
  return ctx({
    '@type': 'SoftwareApplication',
    '@id': `${base}/#software`,
    name: SITE.name,
    description: SITE.description,
    url: base,
    applicationCategory: SITE.category,
    operatingSystem: 'Web, macOS, Windows, Linux',
    publisher: { '@id': `${base}/#organization` },
    featureList: SITE.features,
    keywords: SITE.keywords.join(', '),
    // A plan with no list price (Enterprise) isn't an offer with a price of zero
    offers: plans.filter((p) => !p.contact).map((p) => ({
      '@type': 'Offer',
      name: p.name,
      price: String(p.monthly ?? 0),
      priceCurrency: 'USD',
      url: `${base}/pricing`,
      ...(p.monthly ? { priceSpecification: { '@type': 'UnitPriceSpecification', price: String(p.monthly), priceCurrency: 'USD', unitText: 'MONTH' } } : {}),
    })),
  });
}

/** FAQPage: each question and its answer, the format answer engines quote from */
export function faqLd(items: { question: string; answer: string }[]): Json {
  return ctx({ '@type': 'FAQPage', mainEntity: items.map((f) => ({ '@type': 'Question', name: f.question, acceptedAnswer: { '@type': 'Answer', text: f.answer } })) });
}

export function breadcrumbLd(base: string, trail: { name: string; path: string }[]): Json {
  return ctx({ '@type': 'BreadcrumbList', itemListElement: trail.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, item: `${base}${t.path}` })) });
}

/** A docs page as a technical article, with its sections */
export function docLd(base: string, page: DocPage): Json {
  return ctx({
    '@type': 'TechArticle',
    headline: page.title,
    description: page.summary,
    url: `${base}/docs/${page.slug}`,
    isPartOf: { '@id': `${base}/#website` },
    about: { '@id': `${base}/#software` },
    publisher: { '@id': `${base}/#organization` },
    inLanguage: 'en',
    ...(page.toc.length ? { hasPart: page.toc.map((t) => ({ '@type': 'WebPageElement', name: t.title, url: `${base}/docs/${page.slug}#${t.id}` })) } : {}),
  });
}

/** Serialise for a <script type="application/ld+json">, safe inside HTML */
export function ldJson(data: Json | Json[]): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The public pages, for the sitemap and llms.txt */
export function publicPages(docs: DocPage[]): { path: string; title: string; summary: string; priority: number; changeFrequency: 'weekly' | 'monthly' }[] {
  return [
    { path: '/landing', title: SITE.name, summary: SITE.tagline, priority: 1, changeFrequency: 'weekly' },
    { path: '/pricing', title: 'Pricing', summary: 'Free with your own model; Pro, Team, Business and Enterprise plans.', priority: 0.9, changeFrequency: 'monthly' },
    { path: '/download', title: 'Download', summary: 'Native apps for macOS, Windows and Linux.', priority: 0.8, changeFrequency: 'monthly' },
    { path: '/docs', title: 'Documentation', summary: 'Every feature, configuration and the API.', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/faq', title: 'FAQ', summary: 'Answers about the agent, plans, languages, privacy and self-hosting.', priority: 0.7, changeFrequency: 'monthly' },
    ...docs.map((d) => ({ path: `/docs/${d.slug}`, title: d.title, summary: d.summary, priority: 0.6, changeFrequency: 'monthly' as const })),
  ];
}

/**
 * llms.txt (llmstxt.org): what the site is, in a form a language model reads well — a title, a one-paragraph
 * summary, then sections of links with a line each. llms-full.txt adds the full text of the docs and FAQ.
 */
export function llmsTxt(base: string, docs: DocPage[], faq: FAQItem[], plans: Plan[], full = false): string {
  const lines: string[] = [`# ${SITE.name}`, '', `> ${SITE.description}`, '', 'Key facts:', ...SITE.features.map((f) => `- ${f}`), ''];
  lines.push('Plans:', ...plans.map((p) => `- ${p.name}: ${p.contact ? 'contact us' : p.monthly ? `$${p.monthly}/month${p.perSeat ? ' per seat' : ''}` : 'free'} — ${p.tagline}`), '');
  lines.push('## Pages', '', ...publicPages([]).map((p) => `- [${p.title}](${base}${p.path}): ${p.summary}`), '');
  const groups = [...new Set(docs.map((d) => d.group))];
  for (const g of groups) {
    lines.push(`## Docs: ${g}`, '');
    for (const d of docs.filter((x) => x.group === g)) lines.push(`- [${d.title}](${base}/docs/${d.slug}): ${d.summary || d.title}`);
    lines.push('');
  }
  lines.push('## Optional', '', `- [Full text for language models](${base}/llms-full.txt): every docs page and FAQ answer in one file`, '');
  if (full) {
    lines.push('---', '', '# Documentation', '');
    for (const d of docs) lines.push(`## ${d.title}`, '', `Source: ${base}/docs/${d.slug}`, '', d.text, '');
    lines.push('---', '', '# Frequently asked questions', '');
    for (const f of faq) lines.push(`## ${f.question}`, '', f.answer, '');
  }
  return lines.join('\n');
}

/**
 * Crawlers by purpose. Search engines and AI assistants fetching a page for a user are welcome everywhere public;
 * AI training crawlers are allowed too by default (being in models is how GEO works), and SITE_AI_TRAINING=off
 * turns them away without affecting search or answers.
 */
export const AI_ANSWER_BOTS = ['OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User', 'DuckAssistBot', 'MistralAI-User'];
export const AI_TRAINING_BOTS = ['GPTBot', 'ClaudeBot', 'anthropic-ai', 'Google-Extended', 'Applebot-Extended', 'CCBot', 'Meta-ExternalAgent', 'Amazonbot', 'Bytespider', 'cohere-ai'];
/** Paths with no public content: the API, the editor's assets, the preview sandbox */
export const PRIVATE_PATHS = ['/api/', '/monaco/', '/esbuild/', '/preview-frame', '/onboarding', '/studio'];

/**
 * A page's metadata: title, description, canonical address, and the Open Graph and Twitter cards with the shared
 * image. Every page goes through this, because Next.js replaces (not merges) a parent's openGraph, which would
 * otherwise drop the image.
 */
export function pageMeta({ title, description, path, type = 'website', absoluteTitle = false }: { title: string; description: string; path: string; type?: 'website' | 'article'; absoluteTitle?: boolean }) {
  const images = [{ url: '/opengraph-image', width: 1200, height: 630, alt: `${SITE.name}: ${SITE.tagline}` }];
  const full = absoluteTitle ? title : `${title} · ${SITE.name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type, siteName: SITE.name, title: full, description, url: path, locale: 'en_US', images },
    twitter: { card: 'summary_large_image' as const, title: full, description, images: images.map((i) => i.url) },
  };
}
