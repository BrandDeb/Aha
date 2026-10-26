'use client';

/**
 * Installed extensions, kept in this browser (localStorage). Each one is the declarative part the server read from
 * the .vsix (themes and snippets): the editor gets its themes and a completion provider per language for its
 * snippets. Uninstalling removes both, and the editor goes back to the studio theme.
 */

import { useSyncExternalStore } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { IDisposable, Position as MonacoPosition, editor as MonacoEditorNs, languages as MonacoLanguages } from 'monaco-editor';
import type { Pack } from '@/lib/extensions';

export type Installed = Pack & { enabled: boolean };

interface ExtensionsState {
  installed: Installed[];
  /** The chosen theme (a PackTheme id), or null for the studio's own */
  theme: string | null;
}

const KEY = 'aha:extensions';
const EMPTY: ExtensionsState = { installed: [], theme: null };
const listeners = new Set<() => void>();
let cached: ExtensionsState | null = null;

function read(): ExtensionsState {
  if (cached) return cached;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ExtensionsState> | null;
    cached = { installed: Array.isArray(stored?.installed) ? stored.installed : [], theme: typeof stored?.theme === 'string' ? stored.theme : null };
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function write(next: ExtensionsState) {
  // A theme that is no longer installed and enabled is not chosen any more
  const themes = new Set(next.installed.filter((e) => e.enabled).flatMap((e) => e.themes.map((t) => t.id)));
  cached = { ...next, theme: next.theme && themes.has(next.theme) ? next.theme : null };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // storage full or blocked: keep it for this tab only
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useExtensions(): ExtensionsState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

/** Download and read an extension from Open VSX, then keep it (replacing an older version) */
export async function installExtension(id: string): Promise<Installed> {
  const response = await fetch('/api/extensions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
  const data = (await response.json().catch(() => ({}))) as { pack?: Pack; error?: string };
  if (!response.ok || !data.pack) throw new Error(data.error ?? `Install failed (${response.status})`);
  const ext: Installed = { ...data.pack, enabled: true };
  const state = read();
  const others = state.installed.filter((e) => e.id.toLowerCase() !== ext.id.toLowerCase());
  // A theme extension is installed to be used: pick its first theme unless one is already chosen
  write({ installed: [...others, ext], theme: state.theme ?? ext.themes[0]?.id ?? null });
  return ext;
}

export function uninstallExtension(id: string) {
  const state = read();
  write({ ...state, installed: state.installed.filter((e) => e.id !== id) });
}

export function setExtensionEnabled(id: string, enabled: boolean) {
  const state = read();
  write({ ...state, installed: state.installed.map((e) => (e.id === id ? { ...e, enabled } : e)) });
}

/** null goes back to the studio theme */
export function chooseExtensionTheme(themeId: string | null) {
  write({ ...read(), theme: themeId });
}

/* ------------------------------------------------------------------ the editor */

/** Monaco theme names allow letters, digits and dashes only */
export const editorThemeName = (themeId: string) => `ext-${themeId.replace(/[^a-z0-9]+/gi, '-')}`;

let monaco: Monaco | null = null;
let snippetProviders: IDisposable[] = [];
let applied = '';

function apply() {
  if (!monaco) return;
  const { installed, theme } = read();
  const enabled = installed.filter((e) => e.enabled);
  const key = JSON.stringify(enabled.map((e) => [e.id, e.version]));
  if (key === applied) return;
  applied = key;
  for (const ext of enabled) for (const t of ext.themes) {
    try {
      monaco.editor.defineTheme(editorThemeName(t.id), t.data);
    } catch {
      // a colour Monaco can't read: that theme is skipped, the rest still work
    }
  }
  if (theme) monaco.editor.setTheme(editorThemeName(theme));

  snippetProviders.forEach((d) => d.dispose());
  snippetProviders = [];
  const byLanguage = new Map<string, Pack['snippets']>();
  for (const ext of enabled) for (const s of ext.snippets) for (const language of s.languages) {
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), s]);
  }
  const m = monaco;
  for (const [language, snippets] of byLanguage) {
    snippetProviders.push(m.languages.registerCompletionItemProvider(language, {
      provideCompletionItems(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        const word = model.getWordUntilPosition(position);
        const range = new m.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
        const suggestions: MonacoLanguages.CompletionItem[] = snippets.map((s) => ({
          label: { label: s.prefix, description: s.description },
          kind: m.languages.CompletionItemKind.Snippet,
          insertText: s.body,
          insertTextRules: m.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          documentation: { value: '```\n' + s.body + '\n```' },
          detail: s.description,
          range,
        }));
        return { suggestions };
      },
    }));
  }
}

/** Called once Monaco has loaded: define the installed themes, register snippets, and follow later changes */
export function attachExtensions(instance: Monaco) {
  if (monaco === instance) return;
  monaco = instance;
  applied = '';
  apply();
  listeners.add(apply);
}

const themeFor = (theme: string | null, mode: 'dark' | 'light') => (theme ? editorThemeName(theme) : mode === 'light' ? 'aha-light' : 'aha-dark');

/** The Monaco theme to show: an extension's when one is chosen, else the studio's */
export function useEditorTheme(mode: 'dark' | 'light'): string {
  return themeFor(useExtensions().theme, mode);
}

/** The same, outside React */
export const currentEditorTheme = (mode: 'dark' | 'light') => themeFor(read().theme, mode);
