'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { BeforeMount, DiffOnMount, Monaco, OnMount } from '@monaco-editor/react';
import type { Diagnostic } from '@/lib/compiler-browser';
import { NODE_TYPES } from '@/lib/monaco-node-types';

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

export const configureMonaco: BeforeMount = (monaco) => {
  // scriptc programs target Node, not the browser: no DOM lib, Node globals,
  // and every file is its own module so top-level names don't collide.
  if (!languageConfigured) {
    languageConfigured = true;
    const ts = monaco.languages.typescript;
    const options = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      lib: ['es2023'],
      strict: true,
      noEmit: true,
      allowNonTsExtensions: true,
      allowJs: true,
      moduleDetection: 3, // force: treat every file as a module
    };
    ts.typescriptDefaults.setCompilerOptions(options);
    ts.javascriptDefaults.setCompilerOptions(options);
    ts.typescriptDefaults.addExtraLib(NODE_TYPES, 'file:///node_modules/@types/node-lite/index.d.ts');
  }

  const colors = (dark: boolean) => dark
    ? {
        'editor.background': '#00000000',
        'editor.foreground': '#f5f5f4',
        'editorLineNumber.foreground': '#3a3a3a',
        'editorLineNumber.activeForeground': '#bdbdbc',
        'editor.lineHighlightBackground': '#ffffff08',
        'editor.lineHighlightBorder': '#00000000',
        'editor.selectionBackground': '#ffffff2e',
        'editor.inactiveSelectionBackground': '#ffffff14',
        'editorCursor.foreground': '#ffffff',
        'editorIndentGuide.background1': '#ffffff10',
        'editorIndentGuide.activeBackground1': '#ffffff30',
        'editorWidget.background': '#0b0b0c',
        'editorWidget.border': '#ffffff24',
        'editorHoverWidget.background': '#0b0b0c',
        'editorHoverWidget.border': '#ffffff24',
        'editorSuggestWidget.background': '#0b0b0c',
        'editorSuggestWidget.selectedBackground': '#ffffff1a',
        'editorBracketMatch.background': '#ffffff14',
        'editorBracketMatch.border': '#ffffff40',
        'editorStickyScroll.background': '#0b0b0c',
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
        'editorCursor.foreground': '#000000',
        'editorWidget.background': '#fafaf9',
        'editorWidget.border': '#00000024',
        'editorHoverWidget.background': '#fafaf9',
        'editorSuggestWidget.background': '#fafaf9',
        'editorStickyScroll.background': '#f4f4f3',
        'diffEditor.insertedTextBackground': '#0000001a',
        'diffEditor.removedTextBackground': '#c6282826',
      };

  // Monochrome syntax: hierarchy through weight, italics and grey levels
  monaco.editor.defineTheme('nanocli-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: '', foreground: 'f5f5f4' },
      { token: 'comment', foreground: '6e6e6e', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ffffff', fontStyle: 'bold' },
      { token: 'string', foreground: 'bdbdbc' },
      { token: 'number', foreground: 'dcdcdb' },
      { token: 'type', foreground: 'f5f5f4', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '8a8a8a' },
      { token: 'regexp', foreground: 'bdbdbc', fontStyle: 'underline' },
    ],
    colors: colors(true),
  });
  monaco.editor.defineTheme('nanocli-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: '', foreground: '0b0b0c' },
      { token: 'comment', foreground: '8a8a8a', fontStyle: 'italic' },
      { token: 'keyword', foreground: '000000', fontStyle: 'bold' },
      { token: 'string', foreground: '444445' },
      { token: 'number', foreground: '262627' },
      { token: 'type', foreground: '0b0b0c', fontStyle: 'italic' },
      { token: 'delimiter', foreground: '737373' },
    ],
    colors: colors(false),
  });
};

function editorOptions(fontSize: number, extensions: EditorExtensions) {
  return {
    minimap: { enabled: !!extensions.minimap },
    fontSize,
    fontFamily: 'var(--font-plex-mono), ui-monospace, Menlo, monospace',
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
  useEffect(() => {
    const monaco = monacoRef.current;
    if (!monaco || !files) return;
    const wanted = new Set(Object.keys(files).map(uriFor));
    for (const [filePath, content] of Object.entries(files)) {
      if (filePath === path) continue;
      const uri = monaco.Uri.parse(uriFor(filePath));
      const model = monaco.editor.getModel(uri);
      if (!model) monaco.editor.createModel(content, undefined, uri);
      else if (model.getValue() !== content) model.setValue(content);
    }
    for (const model of monaco.editor.getModels()) {
      const uri = model.uri.toString();
      if (uri.startsWith('file:///') && !uri.includes('node_modules') && !wanted.has(uri)) model.dispose();
    }
  });

  useEffect(() => () => onEditor?.(null), [onEditor]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
    editor.onDidFocusEditorText(() => onFocus?.());
    onEditor?.(editor);
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
      options={{ ...editorOptions(fontSize, { wordWrap: false }), readOnly: true, originalEditable: false, renderOverviewRuler: false }}
    />
  );
}

export type { EditorInstance };
