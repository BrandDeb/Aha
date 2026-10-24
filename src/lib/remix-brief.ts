/**
 * The browser-safe half of Remix (see remix.ts): reading what was pasted, the agent's brief and the names.
 */

export type RemixSource = { kind: 'repo'; owner: string; repo: string; ref?: string } | { kind: 'site'; url: string };

const PART = /^[A-Za-z0-9_.-]{1,100}$/;

/** "owner/repo", "github.com/owner/repo[/tree/ref]", or any other public http(s) address */
export function parseRemixSource(input: string): RemixSource | null {
  const text = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const gh = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)(?:\/tree\/([^#?]+))?/i.exec(text) ?? /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(text); // GitHub owners have no dots, so stripe.com/pricing is a site
  if (gh) {
    const [, owner, repo, ref] = gh;
    if (!PART.test(owner) || !PART.test(repo) || repo === '.' || repo === '..') return null;
    if (ref && !/^[\w./-]{1,200}$/.test(ref)) return null;
    return { kind: 'repo', owner, repo, ...(ref ? { ref } : {}) };
  }
  try {
    const url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes('.')) return null;
    return { kind: 'site', url: url.href };
  } catch {
    return null;
  }
}

export interface SiteOutline {
  url: string;
  title: string;
  /** Headings in order, with their level */
  headings: { level: number; text: string }[];
  /** Navigation link labels */
  nav: string[];
  /** The readable text, cut short */
  text: string;
}

/** The agent's brief for a remix */
export function remixBrief(source: RemixSource, note: string, extra: { license?: string | null; outline?: SiteOutline }): string {
  const ask = note.trim() || (source.kind === 'repo' ? 'Get it running here, then improve it: tidy the README, fix anything broken, and suggest the next three improvements.' : 'Build a fresh, original version with the same structure and purpose.');
  if (source.kind === 'repo') {
    return `This project is a copy of github.com/${source.owner}/${source.repo} (${extra.license ? `licence: ${extra.license}` : 'no licence file: all rights reserved by its authors, so treat this as a private experiment'}).

Remix it: ${ask}

Start by reading the README and the entry points so you know how it is built and run. Keep what works, change what the request asks for, and make it build and run here. Keep the original licence and credit the original repository in the README.`;
  }
  const o = extra.outline;
  return `Build an original web app inspired by ${source.url}${o?.title ? ` ("${o.title}")` : ''}.

What to do: ${ask}

Its structure, as read from the page:
${o ? [o.nav.length ? `- Navigation: ${o.nav.join(' · ')}` : '', ...o.headings.map((h) => `${'  '.repeat(Math.max(0, h.level - 1))}- ${h.text}`)].filter(Boolean).join('\n') : '(not available)'}

${o?.text ? `Its text, for reference (summarise and rewrite it, don't paste it):\n"""\n${o.text.slice(0, 3000)}\n"""\n\n` : ''}Rebuild the same kinds of sections, the same journey and a similar level of polish, in your own design and words. Do not copy its logo, brand name, images or long passages of its text; use placeholders for images. Make every link and button work, and make it hold up on a phone.`;
}

/** A project name for the remix */
export function remixName(source: RemixSource, outline?: SiteOutline): string {
  const base = source.kind === 'repo' ? source.repo : (outline?.title || new URL(source.url).hostname.replace(/^www\./, '').split('.')[0]);
  return `${base}-remix`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'remix';
}

/** The file to open first: the usual entry points across languages, then any code file */
export function guessEntry(files: Record<string, string>): string {
  const known = ['src/main.ts', 'src/main.tsx', 'src/index.ts', 'src/index.tsx', 'main.ts', 'index.ts', 'src/main.js', 'index.js', 'main.py', 'app.py', 'src/main.py', 'main.go', 'cmd/main.go', 'src/main.rs', 'src/App.tsx', 'src/App.vue', 'index.html', 'README.md'];
  return known.find((f) => f in files) ?? Object.keys(files).find((f) => /\.(ts|tsx|js|py|go|rs|rb|java|kt|cs|swift)$/.test(f) && !f.endsWith('.d.ts')) ?? Object.keys(files)[0] ?? '';
}
