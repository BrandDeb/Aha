'use client';

/**
 * Language intelligence for Python, Go and Rust from real language servers (/api/lsp): completion, hover, go to
 * definition, references, rename and diagnostics in the editor. A server starts the first time a file of its
 * language is open, and only where the studio runs on your own machine; elsewhere the editor keeps its
 * highlighting and the providers stay quiet.
 */

import { useSyncExternalStore } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor as MonacoEditorNs, languages as MonacoLanguages, IRange, Position as MonacoPosition } from 'monaco-editor';

type Lang = 'python' | 'go' | 'rust';
const LANGS: Record<string, Lang> = { python: 'python', go: 'go', rust: 'rust' };
const TRIGGERS: Record<Lang, string[]> = { python: ['.', '(', '['], go: ['.'], rust: ['.', ':'] };

interface Session {
  id: string;
  capabilities: Record<string, unknown>;
  versions: Map<string, number>;
  since: number;
  alive: boolean;
}

export type LspState = Partial<Record<Lang, { status: 'starting' | 'ready' | 'off' | 'failed'; message?: string }>>;

/* ------------------------------------------------------------------ status, for the status bar */

let status: LspState = {};
const listeners = new Set<() => void>();
const setStatus = (lang: Lang, next: LspState[Lang]) => {
  status = { ...status, [lang]: next };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
const EMPTY: LspState = {};
export const useLspStatus = () => useSyncExternalStore(subscribe, () => status, () => EMPTY);

/* ------------------------------------------------------------------ the project */

interface Project {
  id: string;
  files: () => Record<string, string>;
  write: (path: string, content: string) => void;
  open: (path: string, line: number, column: number) => void;
}

let project: Project | null = null;
const sessions = new Map<Lang, Promise<Session | null>>();
let enabled: Promise<boolean> | null = null;
let monaco: Monaco | null = null;

/** Called by the workspace: which project the servers work on, and how to change and open its files */
export function setLspProject(next: Project) {
  if (project?.id !== next.id) {
    for (const [, s] of sessions) void s.then((x) => x && stop(x));
    sessions.clear();
    status = {};
    listeners.forEach((l) => l());
  }
  project = next;
}

const pathOf = (uri: { scheme: string; path: string }) => (uri.scheme === 'file' ? decodeURIComponent(uri.path.replace(/^\//, '')) : null);

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const r = await fetch('/api/lsp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(data.error ?? `The language server answered ${r.status}`));
  return data;
}

function stop(s: Session) {
  s.alive = false;
  void post({ id: s.id, action: 'stop' }).catch(() => {});
}

/** The session for a language, started on first use; null when servers are off here or it failed */
function session(lang: Lang): Promise<Session | null> {
  const existing = sessions.get(lang);
  if (existing) return existing;
  const started = (async () => {
    enabled ??= fetch('/api/lsp', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => d.enabled === true)
      .catch(() => false);
    if (!(await enabled) || !project) {
      setStatus(lang, { status: 'off' });
      return null;
    }
    setStatus(lang, { status: 'starting' });
    try {
      const r = await post({ action: 'start', projectId: project.id, language: lang, files: project.files() });
      const s: Session = { id: String(r.id), capabilities: (r.capabilities as Record<string, unknown>) ?? {}, versions: new Map(), since: 0, alive: true };
      setStatus(lang, { status: 'ready' });
      for (const model of monaco?.editor.getModels() ?? []) if (LANGS[model.getLanguageId()] === lang) open(s, model);
      void poll(s, lang);
      return s;
    } catch (error) {
      setStatus(lang, { status: 'failed', message: (error as Error).message });
      // Try again the next time a file of this language opens
      setTimeout(() => sessions.delete(lang), 30_000);
      return null;
    }
  })();
  sessions.set(lang, started);
  return started;
}

function open(s: Session, model: MonacoEditorNs.ITextModel) {
  const uri = model.uri.toString();
  if (!uri.startsWith('file:///') || s.versions.has(uri)) return;
  s.versions.set(uri, model.getVersionId());
  void post({ id: s.id, action: 'notify', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: model.getLanguageId(), version: model.getVersionId(), text: model.getValue() } } }).catch(() => {});
}

const changeTimers = new Map<string, ReturnType<typeof setTimeout>>();
function changed(model: MonacoEditorNs.ITextModel) {
  const lang = LANGS[model.getLanguageId()];
  if (!lang || !sessions.has(lang)) return;
  const uri = model.uri.toString();
  clearTimeout(changeTimers.get(uri));
  changeTimers.set(
    uri,
    setTimeout(async () => {
      const s = await sessions.get(lang);
      if (!s?.alive || model.isDisposed()) return;
      if (!s.versions.has(uri)) return open(s, model);
      s.versions.set(uri, model.getVersionId());
      void post({ id: s.id, action: 'notify', method: 'textDocument/didChange', params: { textDocument: { uri, version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }] } }).catch(() => {});
    }, 150)
  );
}

/** Diagnostics, as they are published */
async function poll(s: Session, lang: Lang) {
  while (s.alive) {
    try {
      const r = await fetch(`/api/lsp?id=${s.id}&since=${s.since}`, { cache: 'no-store' });
      if (r.status === 404) break;
      const data = (await r.json()) as { messages?: { seq: number; method: string; params: { uri: string; diagnostics: LspDiagnostic[] } }[]; exited?: string | null };
      for (const m of data.messages ?? []) {
        s.since = m.seq;
        if (m.method === 'textDocument/publishDiagnostics') showDiagnostics(m.params.uri, m.params.diagnostics);
      }
      if (data.exited) {
        setStatus(lang, { status: 'failed', message: `The server stopped (${data.exited})` });
        break;
      }
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  s.alive = false;
  sessions.delete(lang);
}

interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  message: string;
  source?: string;
  code?: string | number;
}
interface LspRange {
  start: { line: number; character: number };
  end: { line: number; character: number };
}

const toRange = (r: LspRange): IRange => ({ startLineNumber: r.start.line + 1, startColumn: r.start.character + 1, endLineNumber: r.end.line + 1, endColumn: r.end.character + 1 });
const toPosition = (p: MonacoPosition) => ({ line: p.lineNumber - 1, character: p.column - 1 });

const pendingDiagnostics = new Map<string, LspDiagnostic[]>();
function showDiagnostics(uri: string, diagnostics: LspDiagnostic[]) {
  if (!monaco) return;
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (!model) {
    pendingDiagnostics.set(uri, diagnostics);
    return;
  }
  const severity = (n?: number) => (n === 1 ? monaco!.MarkerSeverity.Error : n === 2 ? monaco!.MarkerSeverity.Warning : n === 3 ? monaco!.MarkerSeverity.Info : monaco!.MarkerSeverity.Hint);
  monaco.editor.setModelMarkers(
    model,
    'lsp',
    diagnostics.map((d) => ({ ...toRange(d.range), message: d.message, severity: severity(d.severity), source: d.source, code: d.code === undefined ? undefined : String(d.code) }))
  );
}

/* ------------------------------------------------------------------ providers */

/** A model for a project file (needed to show or edit a file that isn't open) */
function ensureModel(uri: string): MonacoEditorNs.ITextModel | null {
  if (!monaco || !project) return null;
  const parsed = monaco.Uri.parse(uri);
  const existing = monaco.editor.getModel(parsed);
  if (existing) return existing;
  const path = pathOf(parsed);
  const content = path !== null ? project.files()[path] : undefined;
  return content === undefined ? null : monaco.editor.createModel(content, undefined, parsed);
}

async function ask<T>(model: MonacoEditorNs.ITextModel, method: string, params: Record<string, unknown>): Promise<T | null> {
  const lang = LANGS[model.getLanguageId()];
  if (!lang) return null;
  const s = await session(lang);
  if (!s?.alive) return null;
  const uri = model.uri.toString();
  open(s, model);
  // Edits wait 150 ms before they are sent; a request about the newest text sends them first
  if (changeTimers.has(uri) && s.versions.get(uri) !== model.getVersionId()) {
    clearTimeout(changeTimers.get(uri));
    s.versions.set(uri, model.getVersionId());
    await post({ id: s.id, action: 'notify', method: 'textDocument/didChange', params: { textDocument: { uri, version: model.getVersionId() }, contentChanges: [{ text: model.getValue() }] } }).catch(() => {});
  }
  try {
    const r = await post({ id: s.id, action: 'request', method, params: { textDocument: { uri }, ...params } });
    return (r.result ?? null) as T | null;
  } catch {
    return null;
  }
}

type Location = { uri: string; range: LspRange };
type LocationLink = { targetUri: string; targetRange: LspRange; targetSelectionRange?: LspRange };
const toLocations = (result: Location | Location[] | LocationLink[] | null): MonacoLanguages.Location[] => {
  if (!result || !monaco) return [];
  const list = (Array.isArray(result) ? result : [result]) as (Location | LocationLink)[];
  return list
    .map((l) => ('targetUri' in l ? { uri: l.targetUri, range: l.targetSelectionRange ?? l.targetRange } : l))
    // Only project files can be shown (library sources aren't in the editor)
    .filter((l) => ensureModel(l.uri))
    .map((l) => ({ uri: monaco!.Uri.parse(l.uri), range: toRange(l.range) }));
};

const markdown = (contents: unknown): { value: string }[] => {
  const one = (c: unknown): string => (typeof c === 'string' ? c : c && typeof c === 'object' && 'value' in c ? ('language' in c ? `\`\`\`${(c as { language: string }).language}\n${(c as { value: string }).value}\n\`\`\`` : String((c as { value: string }).value)) : '');
  return (Array.isArray(contents) ? contents : [contents]).map(one).filter(Boolean).map((value) => ({ value }));
};

/** LSP CompletionItemKind (1–25) → Monaco's */
function completionKind(kind: number | undefined): MonacoLanguages.CompletionItemKind {
  const K = monaco!.languages.CompletionItemKind;
  const map: Record<number, MonacoLanguages.CompletionItemKind> = { 1: K.Text, 2: K.Method, 3: K.Function, 4: K.Constructor, 5: K.Field, 6: K.Variable, 7: K.Class, 8: K.Interface, 9: K.Module, 10: K.Property, 11: K.Unit, 12: K.Value, 13: K.Enum, 14: K.Keyword, 15: K.Snippet, 16: K.Color, 17: K.File, 18: K.Reference, 19: K.Folder, 20: K.EnumMember, 21: K.Constant, 22: K.Struct, 23: K.Event, 24: K.Operator, 25: K.TypeParameter };
  return map[kind ?? 1] ?? K.Text;
}

interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: unknown;
  insertText?: string;
  insertTextFormat?: number;
  textEdit?: { range?: LspRange; insert?: LspRange; newText: string };
  sortText?: string;
  filterText?: string;
}

/** Called once Monaco has loaded */
export function attachLsp(instance: Monaco) {
  if (monaco === instance) return;
  monaco = instance;
  const m = instance;
  const selector = Object.keys(LANGS);

  m.editor.onDidCreateModel((model: MonacoEditorNs.ITextModel) => {
    const lang = LANGS[model.getLanguageId()];
    const uri = model.uri.toString();
    const waiting = pendingDiagnostics.get(uri);
    if (waiting) {
      pendingDiagnostics.delete(uri);
      setTimeout(() => showDiagnostics(uri, waiting), 0);
    }
    if (lang && uri.startsWith('file:///')) {
      void session(lang).then((s) => s && open(s, model));
      model.onDidChangeContent(() => {
        changed(model);
        // Rename edits files that aren't open: those changes go to the project too
        const path = pathOf(model.uri);
        if (path !== null && project && project.files()[path] !== undefined && project.files()[path] !== model.getValue()) project.write(path, model.getValue());
      });
    }
  });

  for (const language of selector) {
    m.languages.registerCompletionItemProvider(language, {
      triggerCharacters: TRIGGERS[LANGS[language]],
      async provideCompletionItems(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        const result = await ask<CompletionItem[] | { items: CompletionItem[]; isIncomplete?: boolean }>(model, 'textDocument/completion', { position: toPosition(position) });
        if (!result) return { suggestions: [] };
        const items = Array.isArray(result) ? result : result.items;
        const word = model.getWordUntilPosition(position);
        const fallback = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        return {
          incomplete: !Array.isArray(result) && !!result.isIncomplete,
          suggestions: items.slice(0, 300).map((item) => {
            const edit = item.textEdit;
            const range = edit ? toRange(edit.range ?? edit.insert!) : fallback;
            return {
              label: item.label,
              kind: completionKind(item.kind),
              detail: item.detail,
              documentation: item.documentation ? markdown(item.documentation)[0] : undefined,
              insertText: edit?.newText ?? item.insertText ?? item.label,
              insertTextRules: item.insertTextFormat === 2 ? m.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
              sortText: item.sortText,
              filterText: item.filterText,
              range,
            };
          }),
        };
      },
    });
    m.languages.registerHoverProvider(language, {
      async provideHover(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        const r = await ask<{ contents: unknown; range?: LspRange }>(model, 'textDocument/hover', { position: toPosition(position) });
        if (!r?.contents) return null;
        const contents = markdown(r.contents);
        return contents.length ? { contents, ...(r.range ? { range: toRange(r.range) } : {}) } : null;
      },
    });
    m.languages.registerDefinitionProvider(language, {
      async provideDefinition(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        return toLocations(await ask(model, 'textDocument/definition', { position: toPosition(position) }));
      },
    });
    m.languages.registerReferenceProvider(language, {
      async provideReferences(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        return toLocations(await ask(model, 'textDocument/references', { position: toPosition(position), context: { includeDeclaration: true } }));
      },
    });
    m.languages.registerRenameProvider(language, {
      async provideRenameEdits(model: MonacoEditorNs.ITextModel, position: MonacoPosition, newName: string) {
        const r = await ask<{ changes?: Record<string, { range: LspRange; newText: string }[]>; documentChanges?: { textDocument: { uri: string }; edits: { range: LspRange; newText: string }[] }[] }>(model, 'textDocument/rename', { position: toPosition(position), newName });
        if (!r) return { edits: [], rejectReason: 'Nothing to rename here' };
        const groups = r.changes ? Object.entries(r.changes) : (r.documentChanges ?? []).map((d) => [d.textDocument.uri, d.edits] as const);
        const edits: MonacoLanguages.IWorkspaceTextEdit[] = [];
        for (const [uri, list] of groups) {
          // Files outside the project (the standard library) are never edited
          if (!ensureModel(uri)) continue;
          for (const e of list) edits.push({ resource: m.Uri.parse(uri), textEdit: { range: toRange(e.range), text: e.newText }, versionId: undefined });
        }
        return { edits };
      },
    });
  }

  // Go to definition in another file opens it in the studio's own tabs
  m.editor.registerEditorOpener({
    openCodeEditor(_source: unknown, resource: { scheme: string; path: string }, selectionOrPosition?: IRange | { lineNumber: number; column: number }) {
      const path = pathOf(resource);
      if (path === null || !project || project.files()[path] === undefined) return false;
      const at = selectionOrPosition && 'startLineNumber' in selectionOrPosition ? { lineNumber: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn } : (selectionOrPosition as { lineNumber: number; column: number } | undefined);
      project.open(path, at?.lineNumber ?? 1, at?.column ?? 1);
      return true;
    },
  });
}
