'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import type { BeforeMount, Monaco, OnMount } from '@monaco-editor/react';
import type { Diagnostic } from '@/lib/compiler-browser';
import { NODE_TYPES } from '@/lib/monaco-node-types';

const MonacoEditor = dynamic(
  () => import('@monaco-editor/react').then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center text-sm text-gray-500 font-mono">
        Loading editor…
      </div>
    ),
  }
);

type EditorInstance = Parameters<OnMount>[0];

const THEME = 'nanocli-dark';

let languageConfigured = false;

const beforeMount: BeforeMount = (monaco) => {
  // scriptc programs target Node, not the browser: no DOM lib, Node globals,
  // and every file is its own module so top-level names don't collide.
  if (!languageConfigured) {
    languageConfigured = true;
    const ts = monaco.languages.typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      lib: ['es2023'],
      strict: true,
      noEmit: true,
      allowNonTsExtensions: true,
      moduleDetection: 3, // force: treat every file as a module
    });
    ts.typescriptDefaults.addExtraLib(NODE_TYPES, 'file:///node_modules/@types/node-lite/index.d.ts');
  }

  monaco.editor.defineTheme(THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b6b6b', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'ff7ab2' },
      { token: 'string', foreground: '7ee787' },
      { token: 'number', foreground: '79c0ff' },
      { token: 'type', foreground: '5ee7f5' },
      { token: 'identifier', foreground: 'ededed' },
    ],
    colors: {
      'editor.background': '#0a0a0a',
      'editor.foreground': '#ededed',
      'editorLineNumber.foreground': '#3d3d3d',
      'editorLineNumber.activeForeground': '#a1a1a1',
      'editor.lineHighlightBackground': '#ffffff08',
      'editor.lineHighlightBorder': '#00000000',
      'editor.selectionBackground': '#3b8cff40',
      'editorCursor.foreground': '#ededed',
      'editorIndentGuide.background1': '#1f1f1f',
      'editorWidget.background': '#111111',
      'editorWidget.border': '#262626',
      'editorHoverWidget.background': '#111111',
      'editorHoverWidget.border': '#262626',
      'scrollbarSlider.background': '#ffffff14',
      'scrollbarSlider.hoverBackground': '#ffffff24',
    },
  });
};

interface CodeEditorProps {
  value: string;
  onChange: (value: string) => void;
  /** scriptc diagnostics to show as squiggles */
  diagnostics?: Diagnostic[];
  /** Called with Cmd/Ctrl+Enter */
  onRun?: () => void;
  fontSize?: number;
}

export function CodeEditor({ value, onChange, diagnostics = [], onRun, fontSize = 14 }: CodeEditorProps) {
  const editorRef = useRef<EditorInstance | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const onRunRef = useRef(onRun);

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

  // Re-apply whenever the diagnostics change
  useEffect(applyMarkers);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => onRunRef.current?.());
    applyMarkers();
  };

  return (
    <MonacoEditor
      height="100%"
      defaultLanguage="typescript"
      value={value}
      onChange={(next) => onChange(next ?? '')}
      theme={THEME}
      beforeMount={beforeMount}
      onMount={handleMount}
      options={{
        minimap: { enabled: false },
        fontSize,
        fontFamily: 'var(--font-geist-mono), ui-monospace, Menlo, monospace',
        fontLigatures: true,
        lineHeight: 1.65,
        padding: { top: 16, bottom: 16 },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        renderLineHighlight: 'line',
        smoothScrolling: true,
        cursorBlinking: 'smooth',
        tabSize: 2,
        overviewRulerBorder: false,
        scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
      }}
    />
  );
}
