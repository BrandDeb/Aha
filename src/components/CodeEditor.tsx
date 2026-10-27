'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import loader from '@monaco-editor/loader';
import type { BeforeMount, DiffOnMount, Monaco, OnMount } from '@monaco-editor/react';
import type { editor as MonacoEditorNs, Position as MonacoPosition, CancellationToken, languages as MonacoLanguages } from 'monaco-editor';
import type { Diagnostic } from '@/lib/compiler-browser';
import { NODE_TYPES } from '@/lib/monaco-node-types';
import { DEFAULT_APPEARANCE, accentTokens, syntaxColors } from '@/workspace/appearance';
import { liveView } from '@/lib/live/display';
import { attachExtensions, currentEditorTheme, useEditorTheme } from '@/workspace/extensions-client';
import { currentDebugSession, evaluateExpression, pausedLineIn, toggleBreakpoint, useBreakpoints, useDebugSession } from '@/workspace/debug-client';
import type { LiveResult } from '@/lib/live/shared';

// Serve the editor from this server instead of a public CDN: it works offline, loads from the same
// origin as the app, and never sends a request to a third party. (See src/app/monaco/.)
loader.config({ paths: { vs: `/monaco/${process.env.NEXT_PUBLIC_MONACO_VERSION}/vs` } });
// Start loading the editor as soon as this module runs, not when the editor component mounts
// (the page preloads the files; this begins executing them). init() is memoized: the editor reuses it.
if (typeof window !== 'undefined') loader.init().catch(() => {});

const loading = (
  <div className="flex h-full items-center justify-center font-mono text-sm text-gray-500">Loading editor…</div>
);

const MonacoEditor = dynamic(() => import('@monaco-editor/react').then((mod) => mod.default), { ssr: false, loading: () => loading });
const MonacoDiffEditor = dynamic(() => import('@monaco-editor/react').then((mod) => mod.DiffEditor), { ssr: false, loading: () => loading });

type EditorInstance = Parameters<OnMount>[0];

export interface EditorExtensions {
  minimap?: boolean;
  wordWrap?: boolean;
  bracketPairs?: boolean;
  stickyScroll?: boolean;
  todoHighlights?: boolean;
}

const uriFor = (path: string) => `file:///${path}`;

let languageConfigured = false;

/** Highlighting for what the compiler emits: LLVM IR, assembly and WebAssembly text */
function registerCompilerOutputLanguages(monaco: Monaco) {
  const languages = monaco.languages;
  languages.register({ id: 'llvm' });
  languages.setMonarchTokensProvider('llvm', {
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/[%@](?:[-\w$.]+|"[^"]*")/, 'variable'],
        [/![\w.]*/, 'variable'],
        [/\b(?:define|declare|global|constant|private|internal|external|linkonce_odr|unnamed_addr|align|ret|br|switch|call|invoke|unreachable|load|store|alloca|getelementptr|inbounds|phi|select|icmp|fcmp|add|sub|mul|sdiv|udiv|srem|urem|fadd|fsub|fmul|fdiv|and|or|xor|shl|lshr|ashr|trunc|zext|sext|fptosi|sitofp|bitcast|ptrtoint|inttoptr|extractvalue|insertvalue|to|label|type|nsw|nuw|tail|noundef|nonnull|attributes|source_filename|target|datalayout|triple|eq|ne|slt|sgt|sle|sge|ult|ugt|ule|uge|oeq|one|olt|ogt|ole|oge|true|false|null|undef|zeroinitializer)\b/, 'keyword'],
        [/\b(?:void|ptr|i\d+|float|double|half)\b/, 'type'],
        [/-?\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)\b/, 'number'],
      ],
    },
  });
  languages.register({ id: 'asm' });
  languages.setMonarchTokensProvider('asm', {
    tokenizer: {
      root: [
        [/(?:#|\/\/|;).*$/, 'comment'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/^\s*[.\w$@]+:/, 'type'],
        [/\.[a-zA-Z_][\w.]*/, 'keyword'],
        [/%[a-z][a-z0-9]*|\b(?:[xwvqsdb][0-9]{1,2}|sp|lr|fp|xzr|wzr)\b/, 'variable'],
        [/\$?-?(?:0x[0-9a-fA-F]+|\d+)\b/, 'number'],
        [/^\s*[a-z][a-z0-9.]*/, 'keyword'],
      ],
    },
  });
  languages.register({ id: 'wat' });
  languages.setMonarchTokensProvider('wat', {
    tokenizer: {
      root: [
        [/;;.*$/, 'comment'],
        [/\(;[\s\S]*?;\)/, 'comment'],
        [/"(?:[^"\\]|\\.)*"/, 'string'],
        [/\$[\w!#$%&'*+\-./:<=>?@\\^_`|~]+/, 'variable'],
        [/\b(?:i32|i64|f32|f64|v128|funcref|externref)\b(?!\.)/, 'type'],
        [/\b(?:module|func|param|result|local|global|memory|data|table|elem|type|import|export|start|block|loop|if|else|end|br|br_if|br_table|return|call|call_indirect|drop|select|unreachable|nop|mut)\b/, 'keyword'],
        [/\b(?:i32|i64|f32|f64|local|global|memory|table)\.[a-z_0-9.]+/, 'keyword'],
        [/-?\b(?:0x[0-9a-fA-F_]+|\d[\d_]*(?:\.[\d_]*)?(?:[eEpP][-+]?\d+)?)\b/, 'number'],
      ],
    },
  });
}

/** Editor chrome colours for a mode, with the accent on the cursor and selection */
function colors(dark: boolean, accent: string) {
  return dark
    ? {
        'editor.background': '#00000000',
        'editor.foreground': '#f5f5f4',
        'editorLineNumber.foreground': '#55555f',
        'editorLineNumber.activeForeground': '#d4d4d9',
        'editor.lineHighlightBackground': '#ffffff08',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': `${accent}33`,
        'editor.inactiveSelectionBackground': '#ffffff14',
        'editorCursor.foreground': accent,
        'editorIndentGuide.background1': '#ffffff10',
        'editorIndentGuide.activeBackground1': '#ffffff30',
        'editorWidget.background': '#141418',
        'editorWidget.border': '#ffffff24',
        'editorHoverWidget.background': '#141418',
        'editorHoverWidget.border': '#ffffff24',
        'editorSuggestWidget.background': '#141418',
        'editorSuggestWidget.selectedBackground': '#ffffff1a',
        'editorBracketMatch.background': '#ffffff14',
        'editorBracketMatch.border': '#ffffff40',
        'editorStickyScroll.background': '#0c0c0f',
        'scrollbarSlider.background': '#ffffff14',
        'scrollbarSlider.hoverBackground': '#ffffff24',
        'diffEditor.insertedTextBackground': '#ffffff1f',
        'diffEditor.removedTextBackground': '#ff6b6b26',
        'diffEditor.insertedLineBackground': '#ffffff0d',
        'diffEditor.removedLineBackground': '#ff6b6b12',
      }
    : {
        'editor.background': '#00000000',
        'editor.foreground': '#0b0b0c',
        'editorLineNumber.foreground': '#b5b5b5',
        'editorLineNumber.activeForeground': '#3a3a3a',
        'editor.lineHighlightBackground': '#0000000a',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#00000024',
        'editorCursor.foreground': accent,
        'editorWidget.background': '#fafaf9',
        'editorWidget.border': '#00000024',
        'editorHoverWidget.background': '#fafaf9',
        'editorSuggestWidget.background': '#fafaf9',
        'editorStickyScroll.background': '#f4f4f3',
        'diffEditor.insertedTextBackground': '#0000001a',
        'diffEditor.removedTextBackground': '#c6282826',
      };
}

/** The accent the editor themes are built from; the appearance settings change it */
let editorAccent = DEFAULT_APPEARANCE.accent;

function defineThemes(monaco: Monaco) {
  const dark = { ...syntaxColors(editorAccent, 'dark'), accent: accentTokens(editorAccent, 'dark').accent };
  const light = { ...syntaxColors(editorAccent, 'light'), accent: accentTokens(editorAccent, 'light').accent };
  const strip = (hex: string) => hex.replace('#', '');
  monaco.editor.defineTheme('aha-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'ededf0' },
      { token: 'comment', foreground: '6b6b76', fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(dark.keyword) },
      { token: 'string', foreground: strip(dark.string) },
      { token: 'number', foreground: strip(dark.number) },
      { token: 'type', foreground: 'b9b9c0', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '8a8a93' },
      { token: 'regexp', foreground: strip(dark.string), fontStyle: 'underline' },
    ],
    colors: colors(true, dark.accent),
  });
  monaco.editor.defineTheme('aha-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '0e0e10' },
      { token: 'comment', foreground: '8a8a93', fontStyle: 'italic' },
      { token: 'keyword', foreground: strip(light.keyword) },
      { token: 'string', foreground: strip(light.string) },
      { token: 'number', foreground: strip(light.number) },
      { token: 'type', foreground: '43434a', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '6e6e78' },
    ],
    colors: colors(false, light.accent),
  });
}

let monacoInstance: Monaco | null = null;

/**
 * Re-colour every editor for a new accent. Before Monaco has loaded this only
 * remembers the accent (the themes are built from it when it does), so
 * changing the look never downloads the editor.
 */
export function setEditorAccent(hex: string): void {
  editorAccent = hex;
  if (!monacoInstance) return;
  defineThemes(monacoInstance);
  monacoInstance.editor.setTheme(currentEditorTheme(document.documentElement.classList.contains('light') ? 'light' : 'dark'));
}

/**
 * Web projects (React, Vue, Svelte…) run in a browser, with JSX and npm packages whose types are not
 * installed here: the editor gets DOM types and JSX, and stops reporting what only a missing package
 * explains (cannot find module, no JSX types). Errors in your own code still show. null = scriptc's Node setup.
 */
let webProject: { jsxImportSource: string } | null = null;
// Cannot find module (2307, 2792), no declaration file (7016), JSX runtime or JSX types missing (2875, 7026)
const WEB_IGNORED_DIAGNOSTICS = [2307, 2792, 7016, 2875, 7026];

function applyProjectKind(monaco: Parameters<BeforeMount>[0]) {
  const ts = monaco.languages.typescript;
  const base = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeJs,
    strict: true,
    noEmit: true,
    allowNonTsExtensions: true,
    allowJs: true,
    moduleDetection: 3, // force: treat every file as a module
  };
  const options = webProject
    ? // Without the packages' types, callbacks like setCount((c) => …) can't be typed: implicit any is allowed there
      { ...base, lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'], jsx: ts.JsxEmit.ReactJSX, jsxImportSource: webProject.jsxImportSource, noImplicitAny: false }
    : { ...base, lib: ['lib.es2023.d.ts'] };
  for (const defaults of [ts.typescriptDefaults, ts.javascriptDefaults]) {
    defaults.setCompilerOptions(options);
    defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions(), diagnosticCodesToIgnore: webProject ? WEB_IGNORED_DIAGNOSTICS : [] });
  }
}

/** Errors the editor currently shows, across the project's files (for the worker) */
export function editorProblems(): { file: string; line: number; message: string }[] {
  if (!monacoInstance) return [];
  type Marker = { severity: number; resource: { scheme: string; path: string }; startLineNumber: number; message: string };
  return (monacoInstance.editor.getModelMarkers({}) as Marker[])
    .filter((m) => m.severity === monacoInstance!.MarkerSeverity.Error && m.resource.scheme === 'file')
    .map((m) => ({ file: decodeURIComponent(m.resource.path.replace(/^\//, '')), line: m.startLineNumber, message: m.message.split('\n')[0].slice(0, 200) }));
}

/** Switch the editor's TypeScript setup between scriptc (Node) and a web app */
export function setEditorProjectKind(web: { jsxImportSource: string } | null): void {
  if (JSON.stringify(web) === JSON.stringify(webProject)) return;
  webProject = web;
  if (monacoInstance) applyProjectKind(monacoInstance);
}

/** Asks for the text to suggest at the cursor (AI autocomplete); set by the workspace, null when off */
export type InlineCompleter = (req: { path: string; language: string; prefix: string; suffix: string }, signal: AbortSignal) => Promise<string>;
let inlineCompleter: InlineCompleter | null = null;
export function setInlineCompleter(fn: InlineCompleter | null): void {
  inlineCompleter = fn;
}
/** Wait this long after the last keystroke before asking: typing fast shouldn't fire a request per key */
const COMPLETE_DEBOUNCE_MS = 280;

export const configureMonaco: BeforeMount = (monaco) => {
  // scriptc programs target Node, not the browser: no DOM lib, Node globals,
  // and every file is its own module so top-level names don't collide.
  if (!languageConfigured) {
    languageConfigured = true;
    const ts = monaco.languages.typescript;
    applyProjectKind(monaco);
    // Without this the worker only sees the open file, so imports between project files can't resolve
    ts.typescriptDefaults.setEagerModelSync(true);
    ts.javascriptDefaults.setEagerModelSync(true);
    ts.typescriptDefaults.addExtraLib(NODE_TYPES, 'file:///node_modules/@types/node-lite/index.d.ts');
    registerCompilerOutputLanguages(monaco);
    // AI autocomplete: grey text at the cursor, Tab accepts, Ctrl+→ accepts a word
    monaco.languages.registerInlineCompletionsProvider('*', {
      async provideInlineCompletions(model: MonacoEditorNs.ITextModel, position: MonacoPosition, _context: MonacoLanguages.InlineCompletionContext, token: CancellationToken) {
        const complete = inlineCompleter;
        if (!complete) return { items: [] };
        await new Promise((resolve) => setTimeout(resolve, COMPLETE_DEBOUNCE_MS));
        if (token.isCancellationRequested) return { items: [] };
        const full = model.getValue();
        const offset = model.getOffsetAt(position);
        const controller = new AbortController();
        const listener = token.onCancellationRequested(() => controller.abort());
        try {
          const path = model.uri.path.replace(/^\//, '');
          const text = await complete({ path, language: model.getLanguageId(), prefix: full.slice(0, offset), suffix: full.slice(offset) }, controller.signal);
          if (!text || token.isCancellationRequested) return { items: [] };
          return { items: [{ insertText: text, range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column) }] };
        } catch {
          return { items: [] };
        } finally {
          listener.dispose();
        }
      },
      disposeInlineCompletions() {},
    });
    // While the debugger is paused, hovering a name (or a.b.c) shows its value in the selected frame
    monaco.languages.registerHoverProvider(['typescript', 'javascript', 'python'], {
      async provideHover(model: MonacoEditorNs.ITextModel, position: MonacoPosition) {
        if (currentDebugSession()?.status !== 'paused') return null;
        const word = model.getWordAtPosition(position);
        if (!word) return null;
        const before = model.getLineContent(position.lineNumber).slice(0, word.endColumn - 1);
        const expression = /[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/.exec(before)?.[0];
        if (!expression || /^(const|let|var|function|return|if|else|for|while|def|class|import|from|export|async|await|new|this|self)$/.test(expression)) return null;
        const result = await evaluateExpression(expression);
        if (!result || result.type === 'error') return null;
        return {
          range: new monaco.Range(position.lineNumber, before.length - expression.length + 1, position.lineNumber, word.endColumn),
          contents: [{ value: `\`${expression}\` = \`${result.value.replace(/`/g, "'")}\`${result.type ? ` · ${result.type}` : ''}` }],
        };
      },
    });
  }

  monacoInstance = monaco;
  defineThemes(monaco);
  attachExtensions(monaco);
};

function editorOptions(fontSize: number, extensions: EditorExtensions) {
  return {
    minimap: { enabled: !!extensions.minimap },
    fontSize,
    fontFamily: "'IBM Plex Mono', ui-monospace, Menlo, monospace",
    lineHeight: 1.7,
    padding: { top: 14, bottom: 14 },
    wordWrap: extensions.wordWrap ? ('on' as const) : ('off' as const),
    bracketPairColorization: { enabled: !!extensions.bracketPairs },
    guides: { bracketPairs: !!extensions.bracketPairs, indentation: true },
    stickyScroll: { enabled: !!extensions.stickyScroll },
    scrollBeyondLastLine: false,
    automaticLayout: true,
    renderLineHighlight: 'line' as const,
    smoothScrolling: true,
    cursorBlinking: 'smooth' as const,
    cursorSmoothCaretAnimation: 'on' as const,
    tabSize: 2,
    overviewRulerBorder: false,
    scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
    accessibilitySupport: 'auto' as const,
    ariaLabel: 'Code editor',
    // Breakpoints: click left of the line numbers
    glyphMargin: true,
    inlineSuggest: { enabled: true, mode: 'subwordSmart' as const, showToolbar: 'onHover' as const },
  };
}

interface CodeEditorProps {
  /** Project-relative path; each path gets its own model (undo history, IntelliSense) */
  path?: string;
  language?: string;
  value: string;
  onChange: (value: string) => void;
  /** Other project files, kept in sync as models so imports resolve */
  files?: Record<string, string>;
  /** scriptc diagnostics for this file */
  diagnostics?: Diagnostic[];
  /** Called with Cmd/Ctrl+Enter inside the editor */
  onRun?: () => void;
  onFocus?: () => void;
  /** Receives the editor so callers can read the selection */
  onEditor?: (editor: EditorInstance | null) => void;
  fontSize?: number;
  theme?: 'dark' | 'light';
  extensions?: EditorExtensions;
  /**
   * Live values for this file. stale: the file changed since that run, so what is shown stays
   * (it moves with the edits) until the next result. null: live mode is off.
   */
  live?: { file: LiveResult['files'][string] | undefined; stale: boolean } | null;
  /** Lines an accepted proposal wrote, and why (hover the line number) */
  why?: { line: number; text: string }[];
  /** Rewind: the line that ran at the chosen moment, and what it did then */
  rewind?: { line: number; text: string } | null;
}

/** Files the TypeScript worker needs as models to resolve imports across the project */
const TYPED_SOURCE = /\.(?:[cm]?[jt]sx?|json)$/i;
const MAX_BACKGROUND_MODELS = 150;

export function CodeEditor({
  path = 'main.ts',
  language = 'typescript',
  value,
  onChange,
  files,
  diagnostics = [],
  onRun,
  onFocus,
  onEditor,
  fontSize = 14,
  theme = 'dark',
  extensions = { wordWrap: true },
  live = null,
  why,
  rewind,
}: CodeEditorProps) {
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const onRunRef = useRef(onRun);
  const decorationsRef = useRef<{ clear: () => void } | null>(null);

  useEffect(() => {
    onRunRef.current = onRun;
  }, [onRun]);

  const applyMarkers = () => {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    const model = editor?.getModel();
    if (!editor || !monaco || !model) return;
    monaco.editor.setModelMarkers(
      model,
      'scriptc',
      diagnostics.map((d) => {
        const line = Math.min(Math.max(d.line, 1), model.getLineCount());
        return {
          startLineNumber: line,
          startColumn: d.column,
          endLineNumber: line,
          endColumn: Math.max(model.getLineMaxColumn(line), d.column + 1),
          message: d.hint ? `${d.message}\n\nHint: ${d.hint}` : d.message,
          code: d.code,
          source: 'scriptc',
          severity: d.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        };
      })
    );
  };

  // TODO/FIXME highlighter extension
  const applyTodoHighlights = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    decorationsRef.current?.clear();
    decorationsRef.current = null;
    if (!editor || !model || !extensions.todoHighlights) return;
    const matches = model.findMatches('\\b(TODO|FIXME|HACK|NOTE)\\b', false, true, true, null, false);
    decorationsRef.current = editor.createDecorationsCollection(
      matches.map((m) => ({ range: m.range, options: { inlineClassName: 'todo-highlight', hoverMessage: { value: 'Marked for follow-up' } } }))
    );
  };

  useEffect(() => {
    applyMarkers();
    applyTodoHighlights();
  });

  const liveRef = useRef<{ clear: () => void } | null>(null);
  const livePathRef = useRef<string | null>(null);
  const applyLive = () => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (live?.stale && livePathRef.current === path) return;
    liveRef.current?.clear();
    liveRef.current = null;
    livePathRef.current = null;
    if (!editor || !model || !live || live.stale || !live.file) return;
    const { lines, unrun } = liveView(live.file);
    const count = model.getLineCount();
    const whole = (line: number) => ({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: model.getLineMaxColumn(line) });
    liveRef.current = editor.createDecorationsCollection([
      ...lines.filter((l) => l.line <= count).map((l) => ({
        range: whole(l.line),
        options: { after: { content: l.text, inlineClassName: l.kind === 'threw' ? 'live-value live-threw' : 'live-value' }, hoverMessage: { value: l.hover } },
      })),
      ...unrun.filter((line) => line <= count).map((line) => ({ range: whole(line), options: { inlineClassName: 'live-unrun', hoverMessage: { value: 'This line did not run' } } })),
    ]);
    livePathRef.current = path;
  };
  const whyRef = useRef<{ clear: () => void } | null>(null);
  const applyWhy = () => {
    whyRef.current?.clear();
    whyRef.current = null;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !why?.length) return;
    const count = model.getLineCount();
    whyRef.current = editor.createDecorationsCollection(
      why
        .filter((w) => w.line <= count)
        .map((w) => ({
          range: { startLineNumber: w.line, startColumn: 1, endLineNumber: w.line, endColumn: 1 },
          options: { linesDecorationsClassName: 'why-line', lineNumberHoverMessage: { value: w.text }, linesDecorationsTooltip: 'Written by an accepted proposal: hover the line number for why' },
        }))
    );
  };
  // Breakpoints in the gutter, and the line the debugger is stopped on
  const allBreakpoints = useBreakpoints();
  const { session: debugSession } = useDebugSession();
  const pausedLine = pausedLineIn(debugSession, path);
  const fileBreakpoints = allBreakpoints[path];
  const debugRef = useRef<{ clear: () => void } | null>(null);
  const applyDebug = () => {
    debugRef.current?.clear();
    debugRef.current = null;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model) return;
    const count = model.getLineCount();
    const at = (line: number) => ({ startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 });
    debugRef.current = editor.createDecorationsCollection([
      ...(fileBreakpoints ?? []).filter((l) => l <= count).map((line) => ({ range: at(line), options: { glyphMarginClassName: 'debug-breakpoint', glyphMarginHoverMessage: { value: 'Breakpoint: click to remove' }, stickiness: 1 } })),
      ...(pausedLine && pausedLine <= count ? [{ range: at(pausedLine), options: { isWholeLine: true, className: 'debug-paused-line', glyphMarginClassName: 'debug-paused-glyph', glyphMarginHoverMessage: { value: 'Paused here' } } }] : []),
    ]);
    if (pausedLine && pausedLine <= count) editor.revealLineInCenterIfOutsideViewport(pausedLine);
  };
  const breakpointKey = fileBreakpoints?.join(',') ?? '';
  useEffect(() => {
    applyDebug();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyDebug reads the current values
  }, [breakpointKey, pausedLine, path]);
  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  const rewindRef = useRef<{ clear: () => void } | null>(null);
  const rewindLine = rewind?.line ?? 0;
  const rewindText = rewind?.text ?? '';
  useEffect(() => {
    rewindRef.current?.clear();
    rewindRef.current = null;
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !rewindLine || rewindLine > model.getLineCount()) return;
    rewindRef.current = editor.createDecorationsCollection([
      {
        range: { startLineNumber: rewindLine, startColumn: 1, endLineNumber: rewindLine, endColumn: model.getLineMaxColumn(rewindLine) },
        options: { isWholeLine: true, className: 'rewind-line', linesDecorationsClassName: 'rewind-gutter', ...(rewindText ? { after: { content: `  ${rewindText}`, inlineClassName: 'rewind-value' } } : {}) },
      },
    ]);
    editor.revealLineInCenterIfOutsideViewport(rewindLine);
  }, [rewindLine, rewindText, path]);

  // Callers build the list each render: re-apply only when what it says changes
  const whyKey = why?.length ? why.map((w) => `${w.line}:${w.text.length}`).join(',') : '';
  useEffect(() => {
    applyWhy();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyWhy reads the current props
  }, [whyKey, path]);

  // Re-applied when the result, its freshness or the file changes (not on every render)
  const liveFile = live?.file;
  const liveStale = live?.stale;
  const liveOff = live === null;
  useEffect(() => {
    applyLive();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyLive reads the current props
  }, [liveFile, liveStale, liveOff, path]);

  // Keep the other project files registered as models for cross-file IntelliSense
  const syncModels = () => {
    const monaco = monacoRef.current;
    if (!monaco || !files) return;
    // Compared in Monaco's own form: it percent-encodes characters such as + and @ (SvelteKit's +page.svelte)
    const wanted = new Set(Object.keys(files).map((p) => monaco.Uri.parse(uriFor(p)).toString()));
    let added = false;
    // Only files the TypeScript worker resolves imports from get a model ahead of time, and at most
    // MAX_BACKGROUND_MODELS of them: every model listens to Monaco's language service, which reports a
    // listener leak at 200. Other files get their model when they are opened.
    let budget = MAX_BACKGROUND_MODELS;
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === path) continue;
      const existing = monaco.editor.getModel(monaco.Uri.parse(uriFor(filePath)));
      if (!existing && (!TYPED_SOURCE.test(filePath) || budget <= 0)) continue;
      if (!existing) budget--;
      const uri = monaco.Uri.parse(uriFor(filePath));
      const model = monaco.editor.getModel(uri);
      if (!model) {
        monaco.editor.createModel(content, undefined, uri);
        added = true;
      } else if (model.getValue() !== content) model.setValue(content);
    }
    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString();
      if (uri.startsWith('file:///') && !uri.includes('node_modules') && !wanted.has(uri)) model.dispose();
    }
    // Files that were already open were checked before their imports existed;
    // re-applying the diagnostics options makes the TypeScript worker re-validate them
    if (added) {
      const defaults = monaco.languages.typescript.typescriptDefaults;
      defaults.setDiagnosticsOptions({ ...defaults.getDiagnosticsOptions() });
    }
  };

  useEffect(() => {
    syncModels();
  });

  // Callers pass a new callback each render: tell the latest one, and only on unmount that the editor is gone
  const onEditorRef = useRef(onEditor);
  useEffect(() => {
    onEditorRef.current = onEditor;
  }, [onEditor]);
  useEffect(() => () => onEditorRef.current?.(null), []);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
    editor.onDidFocusEditorText(() => onFocus?.());
    editor.onMouseDown((e) => {
      if (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN || !e.target.position) return;
      toggleBreakpoint(pathRef.current, e.target.position.lineNumber);
    });
    applyDebug();
    onEditor?.(editor);
    applyLive();
    applyWhy();
    // The sync effect ran before Monaco mounted, so register the other files now
    syncModels();
    applyMarkers();
    applyTodoHighlights();
  };

  const editorTheme = useEditorTheme(theme === 'light' ? 'light' : 'dark');
  return (
    <MonacoEditor
      height="100%"
      path={uriFor(path)}
      language={language}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      theme={editorTheme}
      beforeMount={configureMonaco}
      onMount={handleMount}
      options={editorOptions(fontSize, extensions)}
    />
  );
}

interface DiffViewProps {
  original: string;
  modified: string;
  language?: string;
  theme?: 'dark' | 'light';
  fontSize?: number;
}

/** Side-by-side, read-only diff (Git changes and version history) */
export function DiffView({ original, modified, language = 'typescript', theme = 'dark', fontSize = 13 }: DiffViewProps) {
  const handleMount: DiffOnMount = (editor) => {
    editor.updateOptions({ renderSideBySide: true });
    // The wrapper disposes the models before the editor on unmount, which Monaco reports as an error;
    // keep them (below) and dispose them here once the editor itself is gone
    const { original: before, modified: after } = editor.getModel() ?? {};
    editor.onDidDispose(() => {
      before?.dispose();
      after?.dispose();
    });
  };
  const editorTheme = useEditorTheme(theme === 'light' ? 'light' : 'dark');
  return (
    <MonacoDiffEditor
      height="100%"
      original={original}
      modified={modified}
      language={language}
      theme={editorTheme}
      beforeMount={configureMonaco}
      onMount={handleMount}
      keepCurrentOriginalModel
      keepCurrentModifiedModel
      options={{ ...editorOptions(fontSize, { wordWrap: false }), readOnly: true, originalEditable: false, renderOverviewRuler: false }}
    />
  );
}

interface OutputViewProps {
  value: string;
  /** monaco language id: llvm, asm, wat, json or plaintext */
  language: string;
  /** Names the model, so each artifact keeps its own scroll position */
  name: string;
  theme?: 'dark' | 'light';
  fontSize?: number;
}

/** Read-only view of a build artifact */
export function OutputView({ value, language, name, theme = 'dark', fontSize = 13 }: OutputViewProps) {
  const editorTheme = useEditorTheme(theme === 'light' ? 'light' : 'dark');
  return (
    <MonacoEditor
      height="100%"
      path={`file:///output/${name}`}
      language={language}
      value={value}
      theme={editorTheme}
      beforeMount={configureMonaco}
      options={{
        ...editorOptions(fontSize, { wordWrap: false }),
        readOnly: true,
        domReadOnly: true,
        minimap: { enabled: true },
        renderLineHighlight: 'none',
        stickyScroll: { enabled: false },
        // Hexdumps are full of stray brackets; don't colour or pair them
        bracketPairColorization: { enabled: false },
        guides: { bracketPairs: false, indentation: false },
        matchBrackets: 'never' as const,
        ariaLabel: 'Build output',
      }}
    />
  );
}

export type { EditorInstance };
