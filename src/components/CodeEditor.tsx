'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import loader from '@monaco-editor/loader';
import type { BeforeMount, DiffOnMount, Monaco, OnMount } from '@monaco-editor/react';
import type { Diagnostic } from '@/lib/compiler-browser';
import { NODE_TYPES } from '@/lib/monaco-node-types';
import { DEFAULT_APPEARANCE, accentTokens, syntaxColors } from '@/workspace/appearance';

// Serve the editor from this server instead of a public CDN: it works offline, loads from the same
// origin as the app, and never sends a request to a third party. (See src/app/monaco/.)
loader.config({ paths: { vs: `/monaco/${process.env.NEXT_PUBLIC_MONACO_VERSION}/vs` } });

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
  monaco.editor.defineTheme('nanocli-dark', {
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
  monaco.editor.defineTheme('nanocli-light', {
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
  monacoInstance.editor.setTheme(document.documentElement.classList.contains('light') ? 'nanocli-light' : 'nanocli-dark');
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
  }

  monacoInstance = monaco;
  defineThemes(monaco);
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
}

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

  // Keep the other project files registered as models for cross-file IntelliSense
  const syncModels = () => {
    const monaco = monacoRef.current;
    if (!monaco || !files) return;
    // Compared in Monaco's own form: it percent-encodes characters such as + and @ (SvelteKit's +page.svelte)
    const wanted = new Set(Object.keys(files).map((p) => monaco.Uri.parse(uriFor(p)).toString()));
    let added = false;
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === path) continue;
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

  useEffect(() => () => onEditor?.(null), [onEditor]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
    editor.onDidFocusEditorText(() => onFocus?.());
    onEditor?.(editor);
    // The sync effect ran before Monaco mounted, so register the other files now
    syncModels();
    applyMarkers();
    applyTodoHighlights();
  };

  return (
    <MonacoEditor
      height="100%"
      path={uriFor(path)}
      language={language}
      value={value}
      onChange={(next) => onChange(next ?? '')}
      theme={theme === 'light' ? 'nanocli-light' : 'nanocli-dark'}
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
  return (
    <MonacoDiffEditor
      height="100%"
      original={original}
      modified={modified}
      language={language}
      theme={theme === 'light' ? 'nanocli-light' : 'nanocli-dark'}
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
  return (
    <MonacoEditor
      height="100%"
      path={`file:///output/${name}`}
      language={language}
      value={value}
      theme={theme === 'light' ? 'nanocli-light' : 'nanocli-dark'}
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
