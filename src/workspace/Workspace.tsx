'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { CodeEditor, DiffView, setEditorProjectKind, type EditorInstance } from '@/components/CodeEditor';
import { analyzeCoverageBrowser, compileTypeScriptBrowser, type CompileResult, type CoverageResult, type Diagnostic } from '@/lib/compiler-browser';
import { WebSocketManager } from '@/lib/websocket';
import type { CompileTarget, GitHubUserInfo } from '@/types';
import { ActionsContext, type PanelId, type RunOutcome, type WorkspaceActions } from './actions';
import { CommandBar } from './components/CommandBar';
import { DebugBar } from './components/DebugBar';
import { CommandPalette, type Command } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { FileTree } from './components/FileTree';
import type { SettingsTab } from './components/SettingsDialog';
import { useUpdateStatus } from './maintenance-client';
import { Terminal } from './components/Terminal';
import { canFormat, formatSource } from './format';
import { BuildPanel } from './panels/BuildPanel';
import { browserPreviewSupport } from '@/lib/browser-preview';
import { debugBrief, type SourceLocation } from '@/lib/debug';
import { detectFramework } from '@/lib/frameworks';
import { detectLanguage } from '@/lib/languages';
import { basename, comboFromEvent, diffStatus, formatCombo, isPython, isValidPath, languageFor } from './project';
import { getPythonEnv, pythonProjectId, streamPython } from './python-client';
import { runProject } from './run-client';
import { base64ToArrayBuffer, runWasm } from './runner';
import { OutputMenu } from './components/OutputMenu';
import { TARGET_GROUPS, targetInfo } from './targets';
import { outputRecorder, useFailureTracker } from './debugging';
import { useDevServer } from './devserver-client';
import { useProposals } from './proposals';
import { useWorkspace } from './store';
import { useToast } from './toasts';

// Everything beyond the editor, terminal and Build panel loads the first time it is opened, so the studio starts with
// only what it needs. The chunks are small and local, so opening one feels instant.
const PanelLoading = () => <div className="p-4 font-mono text-xs text-gray-500">Loading…</div>;
const AgentPanel = dynamic(() => import('./panels/AgentPanel').then((m) => m.AgentPanel), { ssr: false, loading: PanelLoading });
const AiPanel = dynamic(() => import('./panels/AiPanel').then((m) => m.AiPanel), { ssr: false, loading: PanelLoading });
const GitPanel = dynamic(() => import('./panels/GitPanel').then((m) => m.GitPanel), { ssr: false, loading: PanelLoading });
const GraphPanel = dynamic(() => import('./panels/GraphPanel').then((m) => m.GraphPanel), { ssr: false, loading: PanelLoading });
const HistoryPanel = dynamic(() => import('./panels/HistoryPanel').then((m) => m.HistoryPanel), { ssr: false, loading: PanelLoading });
const PackagePanel = dynamic(() => import('./panels/PackagePanel').then((m) => m.PackagePanel), { ssr: false, loading: PanelLoading });
const LanguagePanel = dynamic(() => import('./panels/LanguagePanel').then((m) => m.LanguagePanel), { ssr: false, loading: PanelLoading });
const PythonPanel = dynamic(() => import('./panels/PythonPanel').then((m) => m.PythonPanel), { ssr: false, loading: PanelLoading });
const SettingsDialog = dynamic(() => import('./components/SettingsDialog').then((m) => m.SettingsDialog), { ssr: false });
const TemplatesDialog = dynamic(() => import('./components/TemplatesDialog').then((m) => m.TemplatesDialog), { ssr: false });
const ProjectDialog = dynamic(() => import('./components/ProjectDialog').then((m) => m.ProjectDialog), { ssr: false });
const ArtifactDialog = dynamic(() => import('./components/ArtifactDialog').then((m) => m.ArtifactDialog), { ssr: false });
const PreviewPane = dynamic(() => import('./components/PreviewPane').then((m) => m.PreviewPane), { ssr: false, loading: PanelLoading });
const ProposalView = dynamic(() => import('./components/ProposalView').then((m) => m.ProposalView), { ssr: false, loading: PanelLoading });

const PANELS: { id: PanelId; label: string; glyph: string }[] = [
  { id: 'build', label: 'Build', glyph: '▶' },
  { id: 'git', label: 'Git', glyph: '⑂' },
  { id: 'ai', label: 'Assistant', glyph: '✦' },
  { id: 'agent', label: 'Agent', glyph: '⚙' },
  { id: 'python', label: 'Python', glyph: 'Py' },
  { id: 'languages', label: 'Run', glyph: '▷' },
  { id: 'history', label: 'History', glyph: '↺' },
  { id: 'graph', label: 'Graph', glyph: '⌬' },
  { id: 'package', label: 'Package', glyph: '▤' },
];

const DEFAULT_KEYS: Record<string, string> = {
  'build.compile': 'Mod+Enter',
  'build.run': 'Mod+Shift+Enter',
  'file.save': 'Mod+S',
  'file.format': 'Mod+Shift+F',
  'file.new-project': 'Mod+Alt+N',
  'file.import-export': 'Mod+Alt+E',
  'view.palette': 'Mod+K',
  'view.explorer': 'Mod+B',
  'view.panel': 'Mod+Alt+B',
  'view.terminal': 'Mod+J',
  'view.split': 'Mod+\\',
  'view.zen': 'Mod+Alt+Z',
  'view.preview': 'Mod+Alt+P',
  'view.theme': 'Mod+Alt+T',
  'panel.git': 'Mod+Alt+G',
  'panel.ai': 'Mod+I',
  'panel.history': 'Mod+Alt+H',
  'prefs.settings': 'Mod+,',
  'agent.ask': 'Mod+L',
};

/** 128 random bits, URL-safe: a live session's room can't be guessed */
function newRoomId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Workspace() {
  const ws = useWorkspace();
  const { project, tabs, active, split, git, settings, dispatch, hydrated, updateSettings, saveSnapshot } = ws;
  const { notify } = useToast();
  const proposals = useProposals();
  const { open: openProposal, close: closeProposal } = proposals;
  const askRef = useRef<HTMLInputElement | null>(null);

  // Opening a file (from the tree, a tab, the palette) brings the editor back in front of a proposal
  const shownFile = useRef(active);
  useEffect(() => {
    if (shownFile.current === active) return;
    shownFile.current = active;
    openProposal(null);
  }, [active, openProposal]);

  const target = settings.target;
  const setTarget = useCallback((next: CompileTarget) => updateSettings({ target: next }), [updateSettings]);
  const [viewer, setViewer] = useState<CompileResult | null>(null);
  // Tabs follow the project: Python's only for Python projects, and package.json's only when there is one to manage
  // Which engine runs the entry file: uv (Python), scriptc (TypeScript), or one of the other languages
  const entryLanguage = useMemo(() => (project.entry ? detectLanguage(project.entry, Object.keys(project.files)) : null), [project.entry, project.files]);
  // Web apps (Vite, Next.js, Nuxt…) run with their own dev server in the Preview pane
  const web = useMemo(() => detectFramework(project.files), [project.files]);
  const usesScriptc = !isPython(project.entry) && !entryLanguage && !web;
  const [showPreview, setShowPreview] = useState(false);
  // Failures from every run path, and the last version that worked: what "Debug this" starts from
  const tracker = useFailureTracker(project.name, project.files);
  const { report: reportFailure, markGood } = tracker;
  const devServer = useDevServer(project.name, project.files, !!web);
  // Vite-style apps can also run entirely in the browser (esbuild-wasm): the only way where dev servers are off
  const inBrowser = useMemo(() => (web ? browserPreviewSupport(project.files) : null), [web, project.files]);
  const [previewChoice, setPreviewChoice] = useState<'server' | 'browser' | null>(null);
  // The editor's TypeScript follows the project: Node for scriptc, DOM and JSX for web apps
  const jsxSource = web ? (/"preact"/.test(project.files['package.json'] ?? '') ? 'preact' : 'react') : null;
  useEffect(() => setEditorProjectKind(jsxSource ? { jsxImportSource: jsxSource } : null), [jsxSource]);
  const previewMode: 'server' | 'browser' = previewChoice ?? (devServer.enabled === false && inBrowser?.ok ? 'browser' : 'server');
  const hasPython = useMemo(() => Object.keys(project.files).some((f) => isPython(f) || f === 'pyproject.toml'), [project.files]);
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<CompileResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastRun, setLastRun] = useState<(RunOutcome & { entry: string }) | null>(null);
  const [panel, setPanel] = useState<PanelId>('build');
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [zen, setZen] = useState(false);
  const [dialog, setDialog] = useState<null | 'palette' | 'settings' | 'templates' | 'project'>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general');
  const { status: update, refresh: refreshUpdate } = useUpdateStatus();
  const [diff, setDiff] = useState<{ title: string; path: string; original: string; modified: string } | null>(null);
  const [user, setUser] = useState<GitHubUserInfo | null>(null);
  const [collab, setCollab] = useState(false);
  const [collaborators, setCollaborators] = useState<{ id: string; name: string }[]>([]);
  const [isMac, setIsMac] = useState(true);

  const editorRef = useRef<EditorInstance | null>(null);
  const projectRef = useRef(project);
  const wsRef = useRef<WebSocketManager | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  // Platform + signed-in user
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- navigator is only readable on the client
    setIsMac(/Mac|iPhone|iPad/.test(navigator.platform));
    fetch('/api/github/user')
      .then((res) => res.json())
      .then((data) => data.authenticated && setUser(data.user))
      .catch(() => {});
  }, []);

  // ?project= / ?template= / ?share= links (once, after storage hydration)
  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    const load = (files: Record<string, string>, entry: string, name: string, label: string) => {
      saveSnapshot('Before opening a link');
      dispatch({ type: 'replace', project: { name, files, folders: [], entry }, git: null });
      notify({ kind: 'success', title: label });
      window.history.replaceState(null, '', window.location.pathname);
    };
    const fail = () => notify({ kind: 'error', title: 'Could not read the link', detail: 'It may be truncated or from an older version.' });
    if (params.get('template')) {
      // The template catalogue is large; load it only when a link asks for it
      import('@/lib/templates')
        .then(({ TEMPLATES, templateFiles }) => {
          const template = TEMPLATES.find((t) => t.id === params.get('template'));
          if (!template) return;
          const { files, entry } = templateFiles(template);
          load(files, entry, template.id, `Opened template: ${template.name}`);
        })
        .catch(fail);
      return;
    }
    try {
      if (params.get('project')) {
        const data = JSON.parse(decodeURIComponent(atob(params.get('project')!)));
        if (data && typeof data.files === 'object') {
          load(data.files, data.entry, typeof data.name === 'string' ? data.name : 'shared', 'Opened shared project');
        }
      } else if (params.get('share')) {
        const data = JSON.parse(decodeURIComponent(atob(params.get('share')!)));
        if (typeof data.code === 'string') {
          const file = `src/${typeof data.filename === 'string' && /^[\w.-]+$/.test(data.filename) ? data.filename : 'main.ts'}`;
          load({ [file]: data.code }, file, typeof data.projectName === 'string' ? data.projectName : 'shared', 'Opened shared code');
        }
      }
    } catch {
      fail();
    }
  }, [hydrated, dispatch, notify, saveSnapshot]);

  // Zen mode: hide chrome, go full screen
  useEffect(() => {
    document.documentElement.classList.toggle('zen', zen);
    if (zen && !document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    if (!zen && document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  }, [zen]);

  useEffect(() => {
    const onFullscreen = () => !document.fullscreenElement && setZen(false);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => document.removeEventListener('fullscreenchange', onFullscreen);
  }, []);

  // Live collaboration: relay edits of the active file
  useEffect(() => {
    if (!collab) return;
    // Rooms are unguessable and shared by link: joining one means trusting its edits
    const requested = new URLSearchParams(window.location.search).get('room');
    const room = requested && /^[A-Za-z0-9_-]{16,64}$/.test(requested) ? requested : newRoomId();
    if (room !== requested) {
      const url = new URL(window.location.href);
      url.searchParams.set('room', room);
      window.history.replaceState(null, '', url);
    }
    const manager = new WebSocketManager(room, clientId, user?.login ?? 'Guest');
    wsRef.current = manager;
    manager.connect();
    manager.on('collaborator_joined', (m) => {
      const id = String(m.clientId);
      setCollaborators((prev) => [...prev.filter((c) => c.id !== id), { id, name: typeof m.name === 'string' ? m.name : 'Guest' }]);
      notify({ kind: 'info', title: `${typeof m.name === 'string' ? m.name : 'Someone'} joined the session` });
    });
    manager.on('collaborator_left', (m) => setCollaborators((prev) => prev.filter((c) => c.id !== m.clientId)));
    manager.on('content_update', (m) => {
      const path = typeof m.path === 'string' ? m.path : null;
      // Edits from others go through the same rules as your own: a valid path, a sane size
      if (!path || !isValidPath(path) || typeof m.content !== 'string' || m.content.length > 1024 * 1024) return;
      if (path in projectRef.current.files) dispatch({ type: 'write', path, content: m.content });
      else if (Object.keys(projectRef.current.files).length < 500) {
        dispatch({ type: 'create', path, content: m.content });
        notify({ kind: 'info', title: `A collaborator added ${path}` });
      }
    });
    return () => {
      manager.disconnect();
      wsRef.current = null;
      setCollaborators([]);
    };
  }, [collab, clientId, user, dispatch, notify, project.name]);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const terminalRun = useRef<((cmd: string) => void) | null>(null);

  const python = useCallback<WorkspaceActions['python']>(async (command, onOutput = () => {}, signal) => {
    const p = projectRef.current;
    const recorded = outputRecorder();
    const done = await streamPython(
      { ...command, name: command.name ?? p.name, projectId: pythonProjectId(p.name), files: p.files, env: getPythonEnv() },
      (stream, text) => {
        recorded.push(text);
        onOutput(stream, text);
      },
      signal
    );
    if (command.action === 'run') {
      if (done.code === 0) markGood('python');
      else if (done.error !== 'stopped') reportFailure('python', `${recorded.text()}${done.error ? `\n${done.error}` : ''}`, 'python');
    }
    // pyproject.toml, uv.lock and files the program wrote come back into the explorer
    if (Object.keys(done.changed).length || done.removed.length) dispatch({ type: 'put', files: done.changed, removed: done.removed });
    return { ...done, ok: done.code === 0 };
  }, [dispatch, markGood, reportFailure]);

  const runLanguage = useCallback<WorkspaceActions['runLanguage']>(async (options, onOutput = () => {}, signal) => {
    const p = projectRef.current;
    const recorded = outputRecorder();
    const outcome = await runProject(p.name, p.files, options, (stream, text) => {
      if (stream !== 'info') recorded.push(text);
      onOutput(stream, text);
    }, signal);
    const language = outcome.language ?? (options.entry ? detectLanguage(options.entry, Object.keys(p.files))?.id : undefined);
    if (outcome.ok) markGood('run');
    else if (outcome.error !== 'stopped') reportFailure('run', `${recorded.text()}${outcome.error ? `\n${outcome.error}` : ''}`, language);
    // Cargo.lock, go.sum and files the program wrote come back into the explorer
    if (Object.keys(outcome.changed).length || outcome.removed.length) dispatch({ type: 'put', files: outcome.changed, removed: outcome.removed });
    return outcome;
  }, [dispatch, markGood, reportFailure]);

  const compile = useCallback<WorkspaceActions['compile']>(async (options = {}) => {
    const p = projectRef.current;
    const entry = options.entry ?? p.entry;
    if (!entry || !(entry in p.files)) {
      notify({ kind: 'error', title: 'Nothing to build', detail: 'Create a .ts file or set an entry file.' });
      return null;
    }
    const buildTarget = options.target ?? target;
    setBuilding(true);
    try {
      const result = await compileTypeScriptBrowser({ files: p.files, entry, target: buildTarget, ...settings.build });
      setLastBuild(result);
      if (result.success) {
        markGood('build');
        saveSnapshot(`Build succeeded (${buildTarget})`);
        if (!options.quiet) notify({ kind: 'success', title: 'Build succeeded', detail: `${result.filename?.replace(/^[0-9a-f]{32}-/, '')} · ${result.durationMs}ms` });
        // IR, assembly and similar outputs are only useful when you can read them
        if (!options.quiet && targetInfo(buildTarget).inspect) setViewer(result);
      } else {
        reportFailure('build', result.diagnostics?.length ? result.diagnostics.map((d) => `${d.file ?? entry}:${d.line}:${d.column} - error ${d.code}: ${d.message}`).join('\n') : (result.error ?? 'The build failed'), 'typescript');
        if (!options.quiet) notify({ kind: 'error', title: 'Build failed', detail: result.error });
        setPanel('build');
        setShowPanel(true);
      }
      return result;
    } catch (err) {
      notify({ kind: 'error', title: 'Build failed', detail: errorMessage(err) });
      return null;
    } finally {
      setBuilding(false);
    }
  }, [target, settings.build, notify, saveSnapshot, markGood, reportFailure]);

  /** The toolbar's Compile: Python has no compile step, so it runs the program in the terminal instead */
  const compileOrRun = useCallback(() => {
    const entry = projectRef.current.entry;
    if (entry && (isPython(entry) || detectLanguage(entry, Object.keys(projectRef.current.files)))) {
      notify({ kind: 'info', title: 'This language runs directly', detail: 'Running it in the terminal; scriptc compiles TypeScript only.' });
      setShowTerminal(true);
      setTimeout(() => terminalRun.current?.('run'), 0);
      return;
    }
    void compile();
  }, [compile, notify]);

  const run = useCallback<WorkspaceActions['run']>(async (args, onOutput, options = {}) => {
    const entry = options.entry ?? projectRef.current.entry;
    const result = await compile({ target: 'wasm', entry, quiet: true });
    if (!result) return { ok: false, message: 'Build failed' };
    if (!result.success) {
      // SC3002: the wasm32-wasi target has no socket API, so http and fetch can't run in the tab
      if (result.diagnostics?.some((d) => d.code === 'SC3002')) {
        return {
          ok: false,
          message: 'This program uses network sockets (http or fetch), which WebAssembly can’t do in the browser. Set the target to Native and press Compile to build it for your machine.',
        };
      }
      return {
        ok: false,
        message: result.diagnostics?.length
          ? result.diagnostics.map((d) => `${d.file ?? entry}:${d.line}:${d.column} ${d.code} ${d.message}`).join('\n')
          : result.error,
      };
    }
    if (!result.filename?.endsWith('.wasm') || !result.output) {
      return { ok: false, message: result.error ?? 'The server could not produce a WASM module' };
    }
    const recorded = outputRecorder();
    const handle = runWasm(
      { wasm: base64ToArrayBuffer(result.output), args, env: ['TERM=xterm-256color'], files: projectRef.current.files },
      (stream, line) => {
        recorded.push(`${line}\n`);
        onOutput(stream, line);
      }
    );
    options.signal?.addEventListener('abort', handle.stop);
    const message = await handle.done;
    if (message.type === 'error') {
      const outcome = { ok: false, message: message.message === 'Stopped' ? 'stopped' : `runtime error: ${message.message}` };
      setLastRun({ ...outcome, entry });
      if (outcome.message !== 'stopped') reportFailure('run', `${recorded.text()}\n${outcome.message}`, 'typescript');
      return outcome;
    }
    for (const [path, content] of Object.entries(message.changed)) {
      if (path in projectRef.current.files) dispatch({ type: 'write', path, content });
      else dispatch({ type: 'create', path, content });
      onOutput('stdout', `→ wrote ${path}`);
    }
    const outcome = { ok: true, code: message.code, ms: message.ms, memoryBytes: message.memoryBytes };
    setLastRun({ ...outcome, entry });
    if (message.code === 0) markGood('run');
    else reportFailure('run', `${recorded.text()}\nExited with code ${message.code}`, 'typescript');
    return outcome;
  }, [compile, dispatch, markGood, reportFailure]);

  const format = useCallback<WorkspaceActions['format']>(async (path) => {
    const file = path ?? active;
    const p = projectRef.current;
    if (!file || !(file in p.files) || !canFormat(file)) return false;
    try {
      const formatted = await formatSource(file, p.files[file], settings);
      dispatch({ type: 'write', path: file, content: formatted });
      return true;
    } catch (err) {
      notify({ kind: 'error', title: `Could not format ${basename(file)}`, detail: errorMessage(err).split('\n')[0] });
      return false;
    }
  }, [active, settings, dispatch, notify]);

  const save = useCallback(async () => {
    if (settings.formatOnSave) await format();
    saveSnapshot(`Saved ${active ? basename(active) : ''}`.trim());
    notify({ kind: 'success', title: 'Saved', detail: 'Version stored in History. Files autosave as you type.' });
  }, [settings.formatOnSave, format, saveSnapshot, active, notify]);

  const downloadArtifact = useCallback(async (result?: CompileResult | null) => {
    const build = result ?? lastBuild;
    if (!build?.filename) return;
    try {
      const response = await fetch(`/api/download/${encodeURIComponent(build.filename)}`);
      if (!response.ok) throw new Error('The artifact expired — compile again');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(await response.blob());
      a.download = build.filename.replace(/^[0-9a-f]{32}-?/, '') || build.filename;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      notify({ kind: 'error', title: 'Download failed', detail: errorMessage(err) });
    }
  }, [lastBuild, notify]);

  const analyze = useCallback(async () => {
    const p = projectRef.current;
    if (!p.entry) return;
    setAnalyzing(true);
    setCoverage(await analyzeCoverageBrowser({ files: p.files, entry: p.entry }));
    setAnalyzing(false);
    setPanel('build');
  }, []);

  const openPanel = useCallback((id: PanelId) => {
    setPanel(id);
    setShowPanel(true);
  }, []);

  const actions = useMemo<WorkspaceActions>(() => ({
    compile,
    run,
    format,
    save,
    showDiff: setDiff,
    openPanel,
    downloadArtifact,
    python,
    runLanguage,
    inspect: (result) => setViewer(result ?? lastBuild),
  }), [compile, run, format, save, openPanel, downloadArtifact, python, runLanguage, lastBuild]);

  // Terminal "run" from the toolbar / shortcut
  const runInTerminal = useCallback(() => {
    setShowTerminal(true);
    setTimeout(() => terminalRun.current?.('run'), 0);
  }, []);

  const { start: startDevServer, state: devState } = devServer;
  const runPreview = useCallback(() => {
    setShowPreview(true);
    if (previewMode === 'server' && devState.status !== 'ready' && devState.status !== 'installing' && devState.status !== 'starting') startDevServer();
  }, [devState.status, startDevServer, previewMode]);
  const runApp = web ? runPreview : runInTerminal;

  // ---------------------------------------------------------------------------
  // Debugging: a failure becomes a proposal that reproduces, fixes and proves it
  // ---------------------------------------------------------------------------

  const { failure, lastGood, dismiss: dismissFailure } = tracker;
  const [debugProposals, setDebugProposals] = useState<Record<string, string>>({});
  const startDebug = useCallback(
    (auto = false) => {
      if (!failure) return;
      const brief = debugBrief(failure, projectRef.current.files, lastGood());
      const id = proposals.ask(brief, { approaches: 0, label: `Fix: ${failure.title.slice(0, 90)}`, quiet: auto });
      if (id) setDebugProposals((prev) => ({ ...prev, [failure.signature]: id }));
      else if (!auto) openPanel('agent');
    },
    [failure, lastGood, proposals, openPanel]
  );
  // Auto-debug: once per distinct failure, one at a time, never applied without you
  const autoDebugged = useRef(new Set<string>());
  const anyWorking = proposals.proposals.some((p) => p.status === 'working');
  useEffect(() => {
    if (!failure || !proposals.prefs.autoDebug || anyWorking || autoDebugged.current.has(failure.signature)) return;
    autoDebugged.current.add(failure.signature);
    startDebug(true);
  }, [failure, proposals.prefs.autoDebug, anyWorking, startDebug]);
  const debugging = failure && debugProposals[failure.signature] ? proposals.proposals.find((p) => p.id === debugProposals[failure.signature]) : undefined;

  const openLocation = useCallback(
    (location: SourceLocation) => {
      if (!(location.file in projectRef.current.files)) return;
      dispatch({ type: 'open', path: location.file });
      openProposal(null);
      // The editor swaps to the file's model on the next render; then go to the line
      setTimeout(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.revealLineInCenter(location.line);
        editor.setPosition({ lineNumber: location.line, column: location.column ?? 1 });
        editor.focus();
      }, 60);
    },
    [dispatch, openProposal]
  );

  // ---------------------------------------------------------------------------
  // Commands & shortcuts
  // ---------------------------------------------------------------------------

  const commands = useMemo<Command[]>(() => [
    { id: 'build.compile', category: 'Build', title: 'Compile', keys: DEFAULT_KEYS['build.compile'], run: compileOrRun },
    { id: 'build.run', category: 'Build', title: web ? `Run ${web.label} with its dev server` : 'Run in terminal', keys: DEFAULT_KEYS['build.run'], run: runApp },
    { id: 'view.preview', category: 'View', title: 'Toggle preview', keys: DEFAULT_KEYS['view.preview'], run: () => setShowPreview((v) => !v), enabled: !!web },
    { id: 'build.coverage', category: 'Build', title: 'Analyze scriptc coverage', run: () => void analyze() },
    { id: 'build.inspect', category: 'Build', title: 'Inspect last build output', run: () => lastBuild && setViewer(lastBuild), enabled: !!lastBuild?.success && lastBuild.output !== undefined },
    ...TARGET_GROUPS.flatMap((group) =>
      group.items.map((item) => ({ id: `output.${item.value}`, category: 'Build', title: `Output: ${item.label}`, run: () => setTarget(item.value) }))
    ),
    { id: 'build.download', category: 'Build', title: 'Download last artifact', run: () => void downloadArtifact(), enabled: !!lastBuild?.success },
    { id: 'file.save', category: 'File', title: 'Save version', keys: DEFAULT_KEYS['file.save'], run: () => void save() },
    { id: 'file.format', category: 'Editor', title: 'Format document', keys: DEFAULT_KEYS['file.format'], run: () => void format() },
    { id: 'file.new-project', category: 'File', title: 'New project from template…', keys: DEFAULT_KEYS['file.new-project'], run: () => setDialog('templates') },
    { id: 'file.import-export', category: 'File', title: 'Import & export…', keys: DEFAULT_KEYS['file.import-export'], run: () => setDialog('project') },
    { id: 'view.palette', category: 'View', title: 'Command palette', keys: DEFAULT_KEYS['view.palette'], run: () => setDialog('palette') },
    { id: 'view.explorer', category: 'View', title: 'Toggle explorer', keys: DEFAULT_KEYS['view.explorer'], run: () => setShowExplorer((v) => !v) },
    { id: 'view.panel', category: 'View', title: 'Toggle side panel', keys: DEFAULT_KEYS['view.panel'], run: () => setShowPanel((v) => !v) },
    { id: 'view.terminal', category: 'View', title: 'Toggle terminal', keys: DEFAULT_KEYS['view.terminal'], run: () => setShowTerminal((v) => !v) },
    { id: 'view.split', category: 'View', title: 'Toggle split editor', keys: DEFAULT_KEYS['view.split'], run: () => dispatch({ type: 'split', path: split ? null : tabs.find((t) => t !== active) ?? active }) },
    { id: 'view.zen', category: 'View', title: 'Zen mode', keys: DEFAULT_KEYS['view.zen'], run: () => setZen((v) => !v) },
    { id: 'view.theme', category: 'View', title: 'Toggle light / dark', keys: DEFAULT_KEYS['view.theme'], run: () => updateSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'view.contrast', category: 'View', title: 'Toggle high contrast', run: () => updateSettings({ highContrast: !settings.highContrast }) },
    { id: 'panel.git', category: 'Git', title: 'Open Git panel', keys: DEFAULT_KEYS['panel.git'], run: () => openPanel('git') },
    { id: 'panel.ai', category: 'Assistant', title: 'Open assistant', keys: DEFAULT_KEYS['panel.ai'], run: () => openPanel('ai') },
    { id: 'panel.history', category: 'History', title: 'Open version history', keys: DEFAULT_KEYS['panel.history'], run: () => openPanel('history') },
    { id: 'panel.graph', category: 'Graph', title: 'Open dependency graph', run: () => openPanel('graph') },
    { id: 'agent.ask', category: 'Assistant', title: 'Ask the agent…', keys: DEFAULT_KEYS['agent.ask'], run: () => askRef.current?.focus() },
    { id: 'panel.agent', category: 'Assistant', title: 'Open agent (proposals, model, preferences)', run: () => openPanel('agent') },
    { id: 'panel.languages', category: 'Run', title: 'Open languages panel (Go, Rust, Java, C…)', run: () => openPanel('languages') },
    { id: 'panel.python', category: 'Python', title: 'Open Python (uv) panel', run: () => openPanel('python') },
    { id: 'panel.package', category: 'Package', title: 'Edit package.json', run: () => openPanel('package') },
    { id: 'collab.toggle', category: 'Collaboration', title: collab ? 'Leave live session' : 'Start live session', run: () => setCollab((v) => !v) },
    { id: 'prefs.settings', category: 'Preferences', title: 'Settings', keys: DEFAULT_KEYS['prefs.settings'], run: () => { setSettingsTab('general'); setDialog('settings'); } },
    { id: 'prefs.maintenance', category: 'Preferences', title: 'Updates and health checks', run: () => { setSettingsTab('maintenance'); setDialog('settings'); } },
  ], [compileOrRun, runApp, web, analyze, downloadArtifact, lastBuild, save, format, dispatch, split, tabs, active, updateSettings, setTarget, settings.theme, settings.highContrast, openPanel, collab]);

  const bindings = useMemo(() => {
    const map: Record<string, string> = { ...DEFAULT_KEYS, ...settings.keybindings };
    for (const [id, keys] of Object.entries(map)) if (!keys) delete map[id];
    return map;
  }, [settings.keybindings]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (dialog === 'settings') return; // the shortcut recorder owns the keyboard
      if (e.key === 'Escape' && zen && !dialog) {
        setZen(false);
        return;
      }
      const combo = comboFromEvent(e, isMac);
      if (!combo) return;
      const command = commands.find((c) => bindings[c.id] === combo && c.enabled !== false);
      if (!command) return;
      e.preventDefault();
      e.stopPropagation();
      command.run();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [commands, bindings, isMac, dialog, zen]);

  // ---------------------------------------------------------------------------
  // Derived
  // ---------------------------------------------------------------------------

  const diagnostics = useMemo<Diagnostic[]>(() => (lastBuild?.success === false ? lastBuild.diagnostics ?? [] : []), [lastBuild]);
  const diagnosticsFor = (path: string) => diagnostics.filter((d) => (d.file ?? project.entry) === path);
  const errorCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of diagnostics) {
      const file = d.file ?? project.entry;
      counts[file] = (counts[file] ?? 0) + 1;
    }
    return counts;
  }, [diagnostics, project.entry]);
  const changes = git ? diffStatus(git.base, project.files) : {};
  const fileList = Object.keys(project.files).sort();
  const extensions = settings.extensions;

  const startResize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const startHeight = terminalHeight;
    const onMove = (ev: PointerEvent) => setTerminalHeight(Math.min(window.innerHeight * 0.7, Math.max(120, startHeight - (ev.clientY - startY))));
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const editorPane = (path: string, secondary = false) => (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {secondary && (
        <div className="flex h-9 items-center gap-2 border-b border-border px-3">
          <select
            value={path}
            onChange={(e) => dispatch({ type: 'split', path: e.target.value })}
            aria-label="File in split pane"
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-gray-300 outline-none"
          >
            {fileList.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button onClick={() => dispatch({ type: 'split', path: null })} className="text-xs text-gray-500 hover:text-gray-100" aria-label="Close split pane">✕</button>
        </div>
      )}
      <div className="min-h-0 flex-1">
        {path && path in project.files ? (
          <CodeEditor
            path={path}
            language={languageFor(path)}
            value={project.files[path]}
            onChange={(value) => {
              dispatch({ type: 'write', path, content: value });
              if (collab && wsRef.current?.isConnected()) wsRef.current.send({ type: 'edit', path, content: value });
            }}
            files={secondary ? undefined : project.files}
            diagnostics={diagnosticsFor(path)}
            onRun={compileOrRun}
            onEditor={secondary ? undefined : (editor) => { editorRef.current = editor; }}
            fontSize={settings.fontSize}
            theme={settings.theme}
            extensions={extensions}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-gray-400">No file open.</p>
            <button onClick={() => setDialog('templates')} className="btn btn-secondary btn-sm">Start from a template</button>
          </div>
        )}
      </div>
    </div>
  );

  // Web apps have no scriptc build: their side panel opens on the agent instead
  const shownPanel: PanelId = web && panel === 'build' ? 'agent' : panel;
  const panelVisible = (id: PanelId) =>
    id === 'build' ? !web : id === 'python' ? hasPython || panel === 'python' : id === 'languages' ? !!entryLanguage || panel === 'languages' : id === 'package' ? !hasPython || 'package.json' in project.files || panel === 'package' : true;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="flex h-dvh flex-col bg-background text-gray-100">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-[var(--bar)] px-3" data-zen-hide>
          <Link href="/landing" className="flex items-center gap-2 pl-1" aria-label="NanoCLI overview">
            <span className="wordmark text-[20px] text-gray-100">NANOCLI</span>
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <input
            value={project.name}
            onChange={(e) => dispatch({ type: 'rename-project', name: e.target.value })}
            aria-label="Project name"
            className="w-36 min-w-0 rounded-md bg-transparent px-2 py-1 font-mono text-sm text-gray-300 outline-none hover:bg-white/[0.05] focus:bg-white/[0.07]"
          />
          {git && (
            <button onClick={() => openPanel('git')} className="badge hidden font-mono md:inline-flex" title={`${git.owner}/${git.repo}`}>
              ⑂ {git.branch}{Object.keys(changes).length ? ` · ${Object.keys(changes).length}` : ''}
            </button>
          )}
          {collab && (
            <button
              className="badge hidden md:inline-flex"
              title={`${collaborators.map((c) => c.name).join(', ') || 'Waiting for others'}. Click to copy the invite link.`}
              onClick={() => {
                void navigator.clipboard?.writeText(window.location.href).then(() => notify({ kind: 'success', title: 'Invite link copied', detail: 'Anyone with the link can edit this project with you.' }));
              }}
            >
              <span className="dot animate-pulse" aria-hidden="true" /> Live · {collaborators.length + 1}
            </button>
          )}

          <div className="hidden min-w-0 flex-1 px-2 md:block">
            <CommandBar inputRef={askRef} shortcut={formatCombo(bindings['agent.ask'] ?? '', isMac)} onNeedModel={() => openPanel('agent')} />
          </div>

          <div className="ml-auto flex items-center gap-2">
            {usesScriptc && <OutputMenu target={target} options={settings.build} onTarget={setTarget} onOptions={(patch) => updateSettings({ build: { ...settings.build, ...patch } })} />}
            {web && !showPreview && devState.status === 'ready' ? (
              <button onClick={() => setShowPreview(true)} className="btn btn-primary btn-sm" title={`Show the running app (${formatCombo(bindings['view.preview'] ?? '', isMac)})`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> Preview
              </button>
            ) : (
              <button
                onClick={runApp}
                className={`btn btn-sm ${usesScriptc ? 'btn-secondary' : 'btn-primary'}`}
                title={`${web ? `Start ${web.label} and preview it` : isPython(project.entry) ? 'Run with uv in the terminal' : entryLanguage ? `Run with ${entryLanguage.name} in the terminal` : 'Run as WASM in the terminal'} (${formatCombo(bindings['build.run'] ?? '', isMac)})`}
              >
                Run
              </button>
            )}
            {usesScriptc && <button onClick={compileOrRun} disabled={building} className="btn btn-primary btn-sm" title={formatCombo(bindings['build.compile'] ?? '', isMac)}>
              {building ? 'Compiling…' : 'Compile'}
              <span className="kbd border-black/25 text-[10px] text-[var(--color-accent-fg)]/70">{formatCombo(bindings['build.compile'] ?? '', isMac)}</span>
            </button>}
            <button onClick={() => setDialog('palette')} className="btn btn-ghost btn-icon" aria-label="Command palette" title={formatCombo(bindings['view.palette'] ?? '', isMac)}>⌘</button>
            <button onClick={() => { setSettingsTab('general'); setDialog('settings'); }} className="btn btn-ghost btn-icon" aria-label="Settings">⚙</button>
            {user ? (
              // eslint-disable-next-line @next/next/no-img-element -- remote avatar, no optimisation needed
              <img src={user.avatar_url} alt={`Signed in as ${user.login}`} className="h-7 w-7 rounded-full border border-border-strong" />
            ) : (
              <button
                // Full-page navigation: the OAuth flow is a server redirect, not a client route
                // eslint-disable-next-line @next/next/no-location-assign-relative-destination
                onClick={() => window.location.assign('/api/github/auth')}
                className="btn btn-ghost btn-sm hidden lg:inline-flex"
              >
                Sign in
              </button>
            )}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Explorer */}
          {showExplorer && (
            <aside className="pane hidden w-60 shrink-0 flex-col border-r border-border md:flex" aria-label="Explorer" data-zen-hide>
              <FileTree errorCounts={errorCounts} />
              <div className="flex items-center gap-1 border-t border-border p-2">
                <button onClick={() => setDialog('templates')} className="btn btn-ghost btn-sm flex-1">New project</button>
                <button onClick={() => setDialog('project')} className="btn btn-ghost btn-sm flex-1">Import / export</button>
              </div>
            </aside>
          )}

          {/* Editor + terminal */}
          <main id="main" className="flex min-w-0 flex-1 flex-col">
            <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--color-background)]" aria-label="Editor">
              <div className="flex h-10 shrink-0 items-center border-b border-border bg-[var(--bar)]" data-zen-hide>
                <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 overflow-x-auto">
                  {tabs.map((tab) => (
                    <div
                      key={tab}
                      className={`group flex h-10 shrink-0 items-center gap-2 border-r border-border pl-3.5 pr-2 font-mono text-xs ${
                        tab === active && !proposals.active ? 'bg-[var(--color-background)] text-gray-100 shadow-[inset_0_-2px_0_var(--color-accent)]' : 'bg-[var(--bar)] text-gray-400 hover:text-gray-100'
                      }`}
                    >
                      <button role="tab" aria-selected={tab === active && !proposals.active} onClick={() => { dispatch({ type: 'open', path: tab }); openProposal(null); }} title={tab}>
                        {basename(tab)}
                        {changes[tab] && <span className="ml-1 text-gray-400" aria-label={changes[tab]}>•</span>}
                        {errorCounts[tab] ? <span className="ml-1 text-danger">✕</span> : null}
                      </button>
                      <button
                        onClick={() => dispatch({ type: 'close', path: tab })}
                        className="text-gray-600 opacity-0 hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
                        aria-label={`Close ${tab}`}
                      >✕</button>
                    </div>
                  ))}
                  {proposals.proposals.filter((p) => !p.closed).map((p) => {
                    const selected = proposals.activeId === p.id;
                    return (
                      <div
                        key={p.id}
                        className={`group flex h-10 max-w-[16rem] shrink-0 items-center gap-2 border-r border-border pl-3 pr-2 text-xs ${
                          selected ? 'bg-[var(--color-background)] text-gray-100 shadow-[inset_0_-2px_0_var(--color-accent)]' : 'bg-[var(--bar)] text-gray-400 hover:text-gray-100'
                        }`}
                      >
                        <button role="tab" aria-selected={selected} onClick={() => openProposal(p.id)} title={`Proposal: ${p.goal}`} className="flex min-w-0 items-center gap-1.5">
                          {p.status === 'working' ? (
                            p.pending ? <span className="h-2 w-2 shrink-0 rounded-full bg-warn" aria-label="waiting for you" /> : <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-gray-600 border-t-gray-100" aria-label="working" />
                          ) : (
                            <span aria-hidden="true" className="text-accent">✦</span>
                          )}
                          <span className="truncate">{p.goal}</span>
                        </button>
                        <button
                          onClick={() => closeProposal(p.id)}
                          className="text-gray-600 opacity-0 hover:text-gray-100 group-hover:opacity-100 focus:opacity-100"
                          aria-label={`Close proposal ${p.goal}`}
                        >✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="flex shrink-0 items-center gap-1 px-2">
                  <button onClick={() => void format()} disabled={!active || !canFormat(active)} className="btn btn-ghost btn-sm" title={formatCombo(bindings['file.format'] ?? '', isMac)}>Format</button>
                  <button
                    onClick={() => dispatch({ type: 'split', path: split ? null : tabs.find((t) => t !== active) ?? active })}
                    className="btn btn-ghost btn-sm"
                    aria-pressed={!!split}
                    title={formatCombo(bindings['view.split'] ?? '', isMac)}
                  >Split</button>
                  <button onClick={() => setZen((v) => !v)} className="btn btn-ghost btn-sm" aria-pressed={zen} title={formatCombo(bindings['view.zen'] ?? '', isMac)}>Zen</button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1">
                {proposals.active ? (
                  <div className="min-h-0 min-w-0 flex-1">
                    <ProposalView key={proposals.active.id} proposal={proposals.active} />
                  </div>
                ) : (
                  <div className="flex min-h-0 min-w-0 flex-1 divide-x divide-border">
                    {editorPane(active)}
                    {split && !showPreview && editorPane(split, true)}
                  </div>
                )}
                {web && showPreview && (
                  <PreviewPane
                    detected={web}
                    server={devServer}
                    files={project.files}
                    mode={previewMode}
                    browserSupport={inBrowser}
                    onMode={setPreviewChoice}
                    onFailure={(source, text) => reportFailure(source, text, web.framework.name)}
                    onWorking={() => markGood('preview')}
                    onClose={() => setShowPreview(false)}
                  />
                )}
              </div>
              {failure && (
                <DebugBar
                  failure={failure}
                  proposal={debugging ? { id: debugging.id, working: debugging.status === 'working', waiting: !!debugging.pending } : null}
                  onDebug={() => startDebug(false)}
                  onOpenProposal={openProposal}
                  onOpenLocation={openLocation}
                  onDismiss={dismissFailure}
                />
              )}
            </section>

            {showTerminal && (
              <section className="pane relative flex shrink-0 flex-col overflow-hidden border-t border-border" style={{ height: terminalHeight }} aria-label="Terminal" data-zen-hide>
                <div
                  role="separator"
                  aria-orientation="horizontal"
                  aria-label="Resize terminal"
                  tabIndex={0}
                  onPointerDown={startResize}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowUp') setTerminalHeight((h) => Math.min(window.innerHeight * 0.7, h + 24));
                    if (e.key === 'ArrowDown') setTerminalHeight((h) => Math.max(120, h - 24));
                  }}
                  className="absolute inset-x-0 top-0 z-10 h-1.5 cursor-row-resize hover:bg-white/10 focus-visible:bg-white/20"
                />
                <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-4">
                  <span className="eyebrow">Terminal</span>
                  <button onClick={() => setShowTerminal(false)} className="text-xs text-gray-500 hover:text-gray-100" aria-label="Hide terminal">✕</button>
                </div>
                <div className="min-h-0 flex-1">
                  <Terminal user={user?.login} registerRunner={(fn) => { terminalRun.current = fn; }} />
                </div>
              </section>
            )}
          </main>

          {/* Side panel */}
          {showPanel && (
            <aside className="pane hidden w-[24rem] shrink-0 flex-col overflow-hidden border-l border-border lg:flex" aria-label="Tools" data-zen-hide>
              <div role="tablist" aria-label="Tool panels" className="flex shrink-0 overflow-x-auto border-b border-border bg-[var(--bar)] px-1">
                {PANELS.filter((p) => panelVisible(p.id)).map((p) => (
                  <button
                    key={p.id}
                    role="tab"
                    aria-selected={shownPanel === p.id}
                    onClick={() => setPanel(p.id)}
                    className={`flex h-10 shrink-0 items-center gap-1.5 px-2.5 text-[13px] transition-colors ${
                      shownPanel === p.id ? 'text-gray-100 shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-gray-400 hover:text-gray-100'
                    }`}
                  >
                    {p.label}
                    {p.id === 'git' && Object.keys(changes).length > 0 && <span className="rounded bg-[var(--accent-soft)] px-1 font-mono text-[11px] text-accent">{Object.keys(changes).length}</span>}
                    {p.id === 'build' && diagnostics.length > 0 && <span className="rounded bg-danger/15 px-1 font-mono text-[11px] text-danger">{diagnostics.length}</span>}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                {shownPanel === 'build' && (
                  <BuildPanel result={lastBuild} building={building} coverage={coverage} analyzing={analyzing} onCoverage={() => void analyze()} lastRun={lastRun} />
                )}
                {shownPanel === 'git' && <GitPanel user={user} />}
                {shownPanel === 'ai' && <AiPanel diagnostics={diagnostics} getSelection={() => {
                  const editor = editorRef.current;
                  const selection = editor?.getSelection();
                  return selection && !selection.isEmpty() ? editor?.getModel()?.getValueInRange(selection) ?? '' : '';
                }} />}
                {shownPanel === 'agent' && <AgentPanel />}
                {shownPanel === 'history' && <HistoryPanel />}
                {shownPanel === 'graph' && <GraphPanel />}
                {shownPanel === 'package' && <PackagePanel />}
                {shownPanel === 'python' && <PythonPanel />}
                {shownPanel === 'languages' && <LanguagePanel key={`${project.name}:${project.entry}`} />}
              </div>
            </aside>
          )}
        </div>

        {/* Status bar */}
        <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-border bg-[var(--bar)] px-3 font-mono text-[11px] text-gray-400" data-zen-hide>
          <span className="flex items-center gap-1.5"><span className="dot text-accent" aria-hidden="true" />{project.entry ? project.entry : 'no entry file'}</span>
          <span className="hidden sm:inline">{Object.keys(project.files).length} files</span>
          {web && devState.status !== 'none' && (
            <button onClick={() => setShowPreview((v) => !v)} className={`rounded px-1.5 hover:bg-white/[0.06] ${devState.status === 'ready' ? 'text-accent' : devState.status === 'failed' ? 'text-danger' : ''}`} title={devState.url ?? devState.error ?? ''}>
              {devState.status === 'ready' ? `● ${web.label} · ${devState.url?.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : `${web.label} · ${devState.status}`}
            </button>
          )}
          {lastBuild && <span className={lastBuild.success ? 'text-accent' : 'text-danger'}>{lastBuild.success ? `✓ built ${lastBuild.durationMs}ms` : `✕ ${diagnostics.length || 1} problem${diagnostics.length > 1 ? 's' : ''}`}</span>}
          {update?.canApply && (
            <button onClick={() => { setSettingsTab('maintenance'); setDialog('settings'); }} className="rounded px-1.5 text-accent hover:bg-[var(--accent-soft)]" title="A newer version of the studio is available">
              ↑ {update.behind} update{update.behind > 1 ? 's' : ''}
            </button>
          )}
          <span className="ml-auto hidden sm:inline">scriptc 0.2 · {formatCombo(bindings['view.palette'] ?? '', isMac)} for commands</span>
          <span className="hidden md:inline">© 2026 BrandDeb</span>
        </footer>
      </div>

      {dialog === 'palette' && (
        <CommandPalette
          commands={commands}
          files={fileList}
          bindings={bindings}
          isMac={isMac}
          onOpenFile={(path) => dispatch({ type: 'open', path })}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'settings' && <SettingsDialog commands={commands} isMac={isMac} onClose={() => setDialog(null)} initialTab={settingsTab} update={update} refreshUpdate={refreshUpdate} />}
      {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
      {viewer && <ArtifactDialog result={viewer} theme={settings.theme} onClose={() => setViewer(null)} />}
      {dialog === 'project' && <ProjectDialog user={user} onClose={() => setDialog(null)} />}
      {diff && (
        <Dialog title={diff.title} description="Left: before · Right: now" onClose={() => setDiff(null)} width="max-w-6xl" tall>
          <div className="min-h-0 flex-1 overflow-hidden rounded-2xl border border-border">
            <DiffView original={diff.original} modified={diff.modified} language={languageFor(diff.path)} theme={settings.theme} />
          </div>
        </Dialog>
      )}
    </ActionsContext.Provider>
  );
}
