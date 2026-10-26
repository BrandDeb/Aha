/**
 * VS Code extensions from Open VSX, the declarative part only: colour themes and snippets are read from the
 * extension's JSON files and turned into what the editor understands. Nothing in an extension is ever run, so an
 * extension that works through code (a language server, a command, Vim) is listed with what it would need instead.
 */

export interface ThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: { token: string; foreground?: string; background?: string; fontStyle?: string }[];
  colors: Record<string, string>;
}

export interface PackTheme {
  id: string;
  label: string;
  dark: boolean;
  data: ThemeData;
}

export interface PackSnippet {
  /** The editor's language ids it applies to */
  languages: string[];
  prefix: string;
  body: string;
  description: string;
}

export interface Pack {
  /** publisher.name */
  id: string;
  version: string;
  displayName: string;
  publisher: string;
  description: string;
  themes: PackTheme[];
  snippets: PackSnippet[];
  /** What it contributes that the studio does not run, in words */
  unsupported: string[];
}

/* ------------------------------------------------------------------ JSON with comments */

/** JSON with // and /* comments and trailing commas, as VS Code writes its files */
export function parseJsonc(text: string): unknown {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end < 0 ? n : end + 2;
    } else {
      out += c;
      i++;
    }
  }
  // Trailing commas before } or ] (outside strings: strings were copied whole above, and cannot contain a raw newline)
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1').replace(/^﻿/, ''));
}

/* ------------------------------------------------------------------ themes */

/**
 * TextMate scopes (what VS Code themes colour) to the token names the editor's highlighters produce. The first
 * scope prefix that matches wins, so the more specific ones come first.
 */
const SCOPE_TOKENS: [scope: string, token: string][] = [
  ['comment', 'comment'],
  ['string.regexp', 'regexp'],
  ['constant.character.escape', 'string.escape'],
  ['string', 'string'],
  ['constant.numeric', 'number'],
  ['constant.language', 'keyword'],
  ['keyword.operator', 'operator'],
  ['keyword', 'keyword'],
  ['storage.type', 'keyword'],
  ['storage.modifier', 'keyword'],
  ['entity.name.type', 'type'],
  ['entity.name.class', 'type'],
  ['support.type', 'type'],
  ['support.class', 'type'],
  ['entity.name.tag', 'tag'],
  ['entity.other.attribute-name', 'attribute.name'],
  ['entity.name.function', 'function'],
  ['support.function', 'function'],
  ['variable', 'variable'],
  ['punctuation', 'delimiter'],
  ['meta.brace', 'delimiter'],
];

const hex = (color: unknown): string | undefined => {
  if (typeof color !== 'string') return undefined;
  const m = /^#([0-9a-f]{3,8})$/i.exec(color.trim());
  if (!m) return undefined;
  const h = m[1];
  if (h.length === 3 || h.length === 4) return h.slice(0, 3).split('').map((x) => x + x).join('').toLowerCase();
  return h.slice(0, 6).toLowerCase();
};

const EDITOR_COLOR = /^(editor|editorGutter|editorLineNumber|editorCursor|editorWhitespace|editorIndentGuide|editorBracket\w*|editorSuggestWidget|editorWidget|editorHoverWidget|editorError|editorWarning|editorInfo|editorOverviewRuler|editorRuler|editorCodeLens|editorLink|editorInlayHint|editorGhostText|diffEditor|minimap|minimapSlider|scrollbar|scrollbarSlider|peekView\w*|list|input|focusBorder|widget|textLink)\./;

/** A VS Code colour theme as an editor theme; `uiTheme` is the extension's vs / vs-dark / hc-black / hc-light */
export function themeToEditor(theme: Record<string, unknown>, uiTheme: string): ThemeData {
  const base: ThemeData['base'] = uiTheme === 'vs' ? 'vs' : uiTheme === 'hc-black' ? 'hc-black' : uiTheme === 'hc-light' ? 'hc-light' : 'vs-dark';
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries((theme.colors as Record<string, unknown>) ?? {})) {
    // Only what the editor draws (VS Code's own chrome, such as the activity bar, is not here)
    if (!EDITOR_COLOR.test(key)) continue;
    if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value.trim())) colors[key] = value.trim();
  }
  const rules: ThemeData['rules'] = [];
  // Per token, the rule for the most general scope ("keyword" over "keyword.control.flow"); later rules win ties, as in VS Code
  const best = new Map<string, { depth: number; rule: ThemeData['rules'][number] }>();
  const editorFg = hex(colors['editor.foreground']);
  if (editorFg) rules.push({ token: '', foreground: editorFg });
  for (const entry of Array.isArray(theme.tokenColors) ? theme.tokenColors : []) {
    if (!entry || typeof entry !== 'object') continue;
    const { scope, settings } = entry as { scope?: unknown; settings?: { foreground?: unknown; background?: unknown; fontStyle?: unknown } };
    if (!settings) continue;
    if (scope === undefined && !editorFg) {
      // The theme's default colour
      const fg = hex(settings.foreground);
      if (fg) rules.push({ token: '', foreground: fg });
      continue;
    }
    const scopes = (Array.isArray(scope) ? scope : typeof scope === 'string' ? scope.split(',') : []).map((s) => String(s).trim()).filter(Boolean);
    for (const s of scopes) {
      // Only plain scopes: "source.js keyword" style selectors are about context the editor does not have
      if (/\s/.test(s)) continue;
      const match = SCOPE_TOKENS.find(([prefix]) => s === prefix || s.startsWith(`${prefix}.`));
      if (!match) continue;
      const [prefix, token] = match;
      const rule: ThemeData['rules'][number] = { token };
      const fg = hex(settings.foreground);
      if (fg) rule.foreground = fg;
      if (typeof settings.fontStyle === 'string') rule.fontStyle = settings.fontStyle;
      if (!rule.foreground && !rule.fontStyle) continue;
      const depth = s.split('.').length - prefix.split('.').length;
      const current = best.get(token);
      if (!current || depth <= current.depth) best.set(token, { depth, rule });
    }
  }
  rules.push(...[...best.values()].map((b) => b.rule));
  return { base, inherit: true, rules, colors };
}

/* ------------------------------------------------------------------ snippets */

/** VS Code language ids to the editor's (React flavours share the plain language's highlighter) */
const LANGUAGE_IDS: Record<string, string> = { javascriptreact: 'javascript', typescriptreact: 'typescript', 'jsonc': 'json', shellscript: 'shell' };
export const editorLanguage = (id: string) => LANGUAGE_IDS[id.trim()] ?? id.trim();

/** One snippets file; `language` is the contribution's (a file may also scope each snippet itself) */
export function readSnippets(json: unknown, language: string | undefined): PackSnippet[] {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return [];
  const out: PackSnippet[] = [];
  for (const [name, raw] of Object.entries(json as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const s = raw as { prefix?: unknown; body?: unknown; description?: unknown; scope?: unknown };
    const prefixes = (Array.isArray(s.prefix) ? s.prefix : [s.prefix]).filter((p): p is string => typeof p === 'string' && p.trim() !== '');
    const body = Array.isArray(s.body) ? s.body.filter((l) => typeof l === 'string').join('\n') : typeof s.body === 'string' ? s.body : '';
    if (!prefixes.length || !body) continue;
    const scoped = typeof s.scope === 'string' && s.scope.trim() ? s.scope.split(',') : language ? [language] : [];
    const languages = [...new Set(scoped.map(editorLanguage))];
    if (!languages.length) continue;
    const description = typeof s.description === 'string' && s.description ? s.description : name;
    for (const prefix of prefixes) out.push({ languages, prefix: prefix.trim(), body, description });
  }
  return out;
}

/** The same snippet contributed for several languages from one file counts once */
function mergeSnippets(list: PackSnippet[]): PackSnippet[] {
  const byKey = new Map<string, PackSnippet>();
  for (const s of list) {
    const key = `${s.prefix}\n${s.body}`;
    const had = byKey.get(key);
    if (had) had.languages = [...new Set([...had.languages, ...s.languages])];
    else byKey.set(key, { ...s, languages: [...s.languages] });
  }
  return [...byKey.values()];
}

/* ------------------------------------------------------------------ the package */

const MAX_SNIPPETS = 2000;

/** What an extension's files (paths as in the .vsix, decoded as text) give the studio */
export function readPack(files: Record<string, string>, meta: { namespace: string; name: string; version: string }): Pack {
  const manifestText = files['extension/package.json'];
  if (!manifestText) throw new Error('Not a VS Code extension (no extension/package.json)');
  const manifest = parseJsonc(manifestText) as Record<string, unknown>;
  const contributes = (manifest.contributes ?? {}) as Record<string, unknown>;
  const id = `${meta.namespace}.${meta.name}`;
  const fileAt = (rel: unknown) => {
    if (typeof rel !== 'string') return undefined;
    const clean = rel.replace(/^\.\//, '').replace(/^\//, '');
    if (clean.split('/').includes('..')) return undefined;
    return files[`extension/${clean}`];
  };
  const dirOf = (rel: string) => rel.replace(/^\.\//, '').split('/').slice(0, -1).join('/');

  const themes: PackTheme[] = [];
  const themeList = Array.isArray(contributes.themes) ? contributes.themes : [];
  themeList.forEach((raw, i) => {
    const t = raw as { label?: unknown; uiTheme?: unknown; path?: unknown };
    const text = fileAt(t.path);
    if (!text || !String(t.path).endsWith('.json')) return;
    let theme = parseJsonc(text) as Record<string, unknown>;
    // "include": a base theme next to it (one level, as most themes use it)
    if (typeof theme.include === 'string') {
      const base = fileAt(`${dirOf(String(t.path))}/${theme.include.replace(/^\.\//, '')}`);
      if (base) {
        const parent = parseJsonc(base) as Record<string, unknown>;
        theme = {
          ...parent,
          ...theme,
          colors: { ...((parent.colors as object) ?? {}), ...((theme.colors as object) ?? {}) },
          tokenColors: [...((parent.tokenColors as unknown[]) ?? []), ...((theme.tokenColors as unknown[]) ?? [])],
        };
      }
    }
    // tokenColors may be a path to a .json next to the theme (a .tmTheme is XML: left out)
    if (typeof theme.tokenColors === 'string') {
      const colorsText = fileAt(`${dirOf(String(t.path))}/${theme.tokenColors.replace(/^\.\//, '')}`);
      theme.tokenColors = colorsText && theme.tokenColors.endsWith('.json') ? parseJsonc(colorsText) : [];
    }
    const uiTheme = typeof t.uiTheme === 'string' ? t.uiTheme : 'vs-dark';
    const label = typeof t.label === 'string' && t.label ? t.label : typeof theme.name === 'string' ? theme.name : `${id} ${i + 1}`;
    themes.push({ id: `${id}/${i}`, label, dark: uiTheme !== 'vs' && uiTheme !== 'hc-light', data: themeToEditor(theme, uiTheme) });
  });

  let snippets: PackSnippet[] = [];
  for (const raw of Array.isArray(contributes.snippets) ? contributes.snippets : []) {
    const s = raw as { language?: unknown; path?: unknown };
    const text = fileAt(s.path);
    if (!text) continue;
    snippets.push(...readSnippets(parseJsonc(text), typeof s.language === 'string' ? s.language : undefined));
  }
  snippets = mergeSnippets(snippets).slice(0, MAX_SNIPPETS);

  const unsupported: string[] = [];
  if (manifest.main || manifest.browser) unsupported.push('code that runs inside VS Code (the studio never runs extension code)');
  const labels: Record<string, string> = {
    commands: 'commands',
    keybindings: 'keybindings for its own commands',
    grammars: 'syntax grammars (TextMate)',
    iconThemes: 'file icon themes',
    productIconThemes: 'product icon themes',
    languages: 'language definitions',
    debuggers: 'a debugger',
    views: 'views',
  };
  for (const [key, label] of Object.entries(labels)) if (contributes[key]) unsupported.push(label);

  return {
    id,
    version: meta.version,
    displayName: typeof manifest.displayName === 'string' && manifest.displayName ? manifest.displayName : String(manifest.name ?? meta.name),
    publisher: typeof manifest.publisher === 'string' ? manifest.publisher : meta.namespace,
    description: typeof manifest.description === 'string' ? manifest.description : '',
    themes,
    snippets,
    unsupported,
  };
}

/* ------------------------------------------------------------------ recommendations */

/** Well-known extensions that work here (themes and snippets), offered before you search */
export const RECOMMENDED: { id: string; why: string }[] = [
  { id: 'dracula-theme.theme-dracula', why: 'Dracula, the dark theme' },
  { id: 'zhuangtongfa.material-theme', why: 'One Dark Pro, Atom’s theme' },
  { id: 'GitHub.github-vscode-theme', why: 'GitHub’s light and dark themes' },
  { id: 'Catppuccin.catppuccin-vsc', why: 'Catppuccin: Mocha, Macchiato, Frappé, Latte' },
  { id: 'enkia.tokyo-night', why: 'Tokyo Night' },
  { id: 'arcticicestudio.nord-visual-studio-code', why: 'Nord' },
  { id: 'dsznajder.es7-react-js-snippets', why: 'React, Redux and React Native snippets (rafce, useState…)' },
];

/** The project's recommendations from .vscode/extensions.json */
export function projectRecommendations(files: Record<string, string>): string[] {
  const text = files['.vscode/extensions.json'];
  if (!text) return [];
  try {
    const json = parseJsonc(text) as { recommendations?: unknown };
    return Array.isArray(json.recommendations) ? json.recommendations.filter((r): r is string => typeof r === 'string' && /^[\w-]+\.[\w.-]+$/.test(r)) : [];
  } catch {
    return [];
  }
}

/** "publisher.name" as Open VSX's namespace and name, or null */
export function splitId(id: string): { namespace: string; name: string } | null {
  const m = /^([\w-]+)\.([\w.-]+)$/.exec(id.trim());
  return m ? { namespace: m[1], name: m[2] } : null;
}
