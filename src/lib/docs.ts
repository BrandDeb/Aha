/**
 * The developer docs (/docs), made from README.md: every "## " section is a
 * page, grouped for the sidebar, with its "### " sections as the page's
 * contents. One source, so the docs never drift from the README. The markdown
 * is parsed here into plain blocks and inline runs (the subset the README
 * uses: headings, paragraphs, lists, code, tables, quotes, links), which
 * components/DocBody renders. Pure, so it is tested directly.
 */

export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'strong'; c: Inline[] }
  | { t: 'em'; c: Inline[] }
  | { t: 'link'; href: string; c: Inline[] };

export type Block =
  | { t: 'h'; level: 3 | 4; id: string; c: Inline[] }
  | { t: 'p'; c: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'code'; lang: string; v: string }
  | { t: 'quote'; c: Inline[] }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

export interface DocPage {
  slug: string;
  title: string;
  group: string;
  /** First paragraph, as plain text: the page's description and its line in search */
  summary: string;
  blocks: Block[];
  /** The page's sections, for "On this page" */
  toc: { id: string; title: string; level: 3 | 4 }[];
  /** Plain text of the whole page, for search */
  text: string;
}

/** Sidebar groups, in order; a README section not listed goes under "More" */
export const DOC_GROUPS: { name: string; pages: string[] }[] = [
  { name: 'Getting started', pages: ['Quick start', 'Features', "What's measured"] },
  { name: 'Writing code', pages: ['Live values', 'Contracts', 'Web apps and live preview', 'Other languages', 'Python and uv'] },
  { name: 'AI', pages: ['Assistant', 'Agent'] },
  { name: 'Shipping', pages: ['DevOps: pipelines in the studio', 'Field kits', 'Desktop app (Windows and macOS)', 'Signing in with GitHub'] },
  { name: 'Reference', pages: ['Configuration', 'API', 'Scripts', 'Pages', 'Architecture', 'Project structure', 'Performance', 'Maintenance', 'Security', 'Contributing'] },
];
const SKIP = new Set(['License']);

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

const plain = (runs: Inline[]): string => runs.map((r) => (r.t === 'text' || r.t === 'code' ? r.v : plain(r.c))).join('');

/** Inline markdown: `code`, **strong**, *em* / _em_, [text](href); images (badges) are dropped */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ t: 'text', v: text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpMatchArray | null;
    if ((m = rest.match(/^!?\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/)) || (m = rest.match(/^!\[[^\]]*\]\([^)]*\)/))) {
      i += m[0].length;
    } else if ((m = rest.match(/^(`+)([\s\S]+?)\1/))) {
      flush();
      out.push({ t: 'code', v: m[2].trim() });
      i += m[0].length;
    } else if ((m = rest.match(/^\*\*(.+?)\*\*/))) {
      flush();
      out.push({ t: 'strong', c: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^\[((?:[^\][]|\[[^\]]*\])+)\]\(([^)\s]+)\)/))) {
      flush();
      out.push({ t: 'link', href: m[2], c: parseInline(m[1]) });
      i += m[0].length;
    } else if ((m = rest.match(/^(\*|_)(?=\S)(.+?)(?<=\S)\1(?![\w*])/)) && !/\w/.test(src[i - 1] ?? '')) {
      flush();
      out.push({ t: 'em', c: parseInline(m[2]) });
      i += m[0].length;
    } else {
      text += src[i];
      i++;
    }
  }
  flush();
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((c) => parseInline(c.trim().replace(/\\\|/g, '|')));

/** Block markdown for one page's body */
export function parseBlocks(md: string): Block[] {
  const lines = md.split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^---+\s*$/.test(line)) {
      i++;
      continue;
    }
    const fence = line.match(/^```(\S*)/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) body.push(lines[i++]);
      i++;
      blocks.push({ t: 'code', lang: fence[1], v: body.join('\n') });
      continue;
    }
    const heading = line.match(/^(#{3,4})\s+(.*)$/);
    if (heading) {
      blocks.push({ t: 'h', level: heading[1].length as 3 | 4, id: slugify(heading[2]), c: parseInline(heading[2]) });
      i++;
      continue;
    }
    if (/^\s*\|/.test(line) && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(cells(lines[i++]));
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    if (/^>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', c: parseInline(body.join(' ')) });
      continue;
    }
    const bullet = /^(\s*)([-*]|\d+\.)\s+/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && lines[i].trim()) {
        if (bullet.test(lines[i])) items.push(lines[i].replace(bullet, ''));
        else if (items.length) items[items.length - 1] += ' ' + lines[i].trim();
        i++;
      }
      blocks.push({ t: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{3,4}\s|>|\s*([-*]|\d+\.)\s)/.test(lines[i]) && !(/^\s*\|/.test(lines[i]) && /^\s*\|?[\s:|-]+\|/.test(lines[i + 1] ?? ''))) para.push(lines[i++].trim());
    blocks.push({ t: 'p', c: parseInline(para.join(' ')) });
  }
  return blocks;
}

/** Every page of the docs, in sidebar order */
export function docsFromReadme(readme: string): DocPage[] {
  const parts = readme.split(/^## /m).slice(1);
  const pages: DocPage[] = [];
  for (const part of parts) {
    const newline = part.indexOf('\n');
    const title = part.slice(0, newline).trim();
    if (SKIP.has(title)) continue;
    const blocks = parseBlocks(part.slice(newline + 1));
    const first = blocks.find((b) => b.t === 'p');
    const group = DOC_GROUPS.find((g) => g.pages.includes(title))?.name ?? 'More';
    const text = blocks
      .map((b) => (b.t === 'code' ? b.v : b.t === 'list' ? b.items.map(plain).join(' ') : b.t === 'table' ? [...b.head, ...b.rows.flat()].map(plain).join(' ') : plain(b.c)))
      .join('\n');
    pages.push({
      slug: slugify(title),
      title,
      group,
      summary: first && first.t === 'p' ? plain(first.c).replace(/:$/, '.') : '',
      blocks,
      toc: blocks.flatMap((b) => (b.t === 'h' ? [{ id: b.id, title: plain(b.c), level: b.level }] : [])),
      text,
    });
  }
  const order = (p: DocPage) => {
    const g = DOC_GROUPS.findIndex((x) => x.name === p.group);
    return (g < 0 ? DOC_GROUPS.length : g) * 100 + (g < 0 ? 0 : DOC_GROUPS[g].pages.indexOf(p.title));
  };
  return pages.map((p, i) => ({ p, i })).sort((a, b) => order(a.p) - order(b.p) || a.i - b.i).map(({ p }) => p);
}

/**
 * Where a README link goes in the docs: "#assistant" or "#which-model-for-which-job" become the page
 * (and section) that holds that heading; anything else is left as it is.
 */
export function docHref(href: string, pages: DocPage[]): string {
  if (!href.startsWith('#')) return href;
  const anchor = href.slice(1);
  const page = pages.find((p) => p.slug === anchor);
  if (page) return `/docs/${page.slug}`;
  const holder = pages.find((p) => p.toc.some((t) => t.id === anchor));
  return holder ? `/docs/${holder.slug}#${anchor}` : href;
}

/** Pages matching a search, best first: title, then summary, then body */
export function searchDocs<P extends SearchEntry>(pages: P[], query: string): P[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const score = (p: SearchEntry) => {
    const title = p.title.toLowerCase();
    const sections = p.toc.map((t) => t.title.toLowerCase()).join(' ');
    const text = p.text.toLowerCase();
    let s = 0;
    for (const w of words) {
      if (!text.includes(w) && !title.includes(w)) return 0;
      s += (title.includes(w) ? 10 : 0) + (sections.includes(w) ? 4 : 0) + (p.summary.toLowerCase().includes(w) ? 2 : 0) + 1;
    }
    return s;
  };
  return pages
    .map((p) => ({ p, s: score(p) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}

export type SearchEntry = Pick<DocPage, 'slug' | 'title' | 'group' | 'summary' | 'toc' | 'text'>;

/** What the search box needs from each page, kept small: the text is cut to its first few thousand characters */
export function searchEntries(pages: DocPage[]): SearchEntry[] {
  return pages.map(({ slug, title, group, summary, toc, text }) => ({ slug, title, group, summary, toc, text: text.slice(0, 4000) }));
}
