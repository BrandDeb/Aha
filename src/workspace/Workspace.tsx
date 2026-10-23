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
import { debugBrief, isUsageExit, type SourceLocation } from '@/lib/debug';
import { detectFramework } from '@/lib/frameworks';
import { KIT_FILE } from '@/lib/kits';
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
import { useWorker } from './worker';
import { useWorkspace } from './store';
import { useToast } from './toasts';
import { useLiveValues } from './live-client';
import { useContracts } from './contracts-client';
import { useCiOnSave } from './ci-on-save';
import { describeContracts } from '@/lib/contracts';
import { liveSummary } from '@/lib/live/display';

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
const ContractsPanel = dynamic(() => import('./panels/ContractsPanel').then((m) => m.ContractsPanel), { ssr: false, loading: PanelLoading });
const KitPanel = dynamic(() => import('./panels/KitPanel').then((m) => m.KitPanel), { ssr: false, loading: PanelLoading });
const PipelinesPanel = dynamic(() => import('./panels/PipelinesPanel').then((m) => m.PipelinesPanel), { ssr: false, loading: PanelLoading });
const WorkerPanel = dynamic(() => import('./panels/WorkerPanel').then((m) => m.WorkerPanel), { ssr: false, loading: PanelLoading });
const SettingsDialog = dynamic(() => import('./components/SettingsDialog').then((m) => m.SettingsDialog), { ssr: false });
const TemplatesDialog = dynamic(() => import('./components/TemplatesDialog').then((m) => m.TemplatesDialog), { ssr: false });
const WelcomeDialog = dynamic(() => import('./components/WelcomeDialog').then((m) => m.WelcomeDialog), { ssr: false });
const SignInDialog = dynamic(() => import('./components/SignInDialog').then((m) => m.SignInDialog), { ssr: false });
const ProjectDialog = dynamic(() => import('./components/ProjectDialog').then((m) => m.ProjectDialog), { ssr: false });
const ArtifactDialog = dynamic(() => import('./components/ArtifactDialog').then((m) => m.ArtifactDialog), { ssr: false });
const PreviewPane = dynamic(() => import('./components/PreviewPane').then((m) => m.PreviewPane), { ssr: false, loading: PanelLoading });
const ProposalView = dynamic(() => import('./components/ProposalView').then((m) => m.ProposalView), { ssr: false, loading: PanelLoading });

/**
 * The side panel, in four groups: what you run, the agent, your source and CI, and the project's shape.
 * The agent is one place with three ways to use it: Ask (answers, nothing changes), Do (a task done on a
 * copy, back as a proposal with proof) and Keep going (it picks up the next useful task by itself).
 */
const GROUPS: { id: string; label: string; panels: { id: PanelId; label: string; hint: string }[] }[] = [
  {
    id: 'run',
    label: 'Run',
    panels: [
      { id: 'build', label: 'Build', hint: 'Build output, timings, coverage and the last run' },
      { id: 'languages', label: 'Language', hint: 'The toolchain that runs this project, and its options' },
      { id: 'python', label: 'Python', hint: 'uv: run, packages, environment variables' },
      { id: 'package', label: 'Packages', hint: 'Dependencies and scripts' },
    ],
  },
  {
    id: 'agent',
    label: 'Agent',
    panels: [
      { id: 'agent', label: 'Do', hint: 'Give it a task: it works on a copy and comes back with a proposal and the proof that it works' },
      { id: 'ai', label: 'Ask', hint: 'Questions and explanations about your code; nothing changes' },
      { id: 'worker', label: 'Keep going', hint: 'It picks up the next useful task by itself while you work' },
    ],
  },
  {
    id: 'source',
    label: 'Source',
    panels: [
      { id: 'git', label: 'Git', hint: 'Changes, branches, commit and push' },
      { id: 'ci', label: 'Pipelines', hint: 'CI/CD: set it up, run it here, see GitHub runs' },
      { id: 'history', label: 'History', hint: 'Saved versions of the project' },
    ],
  },
  {
    id: 'project',
    label: 'Project',
    panels: [
      { id: 'contracts', label: 'Contracts', hint: 'Rules that stay true: the agent keeps them, every proposal is checked against them' },
      { id: 'graph', label: 'Graph', hint: 'How the files import each other' },
      { id: 'kit', label: 'Kit', hint: 'The field kit: playbook, checks and setup' },
    ],
  },
];
const groupOf = (panel: PanelId) => GROUPS.find((g) => g.panels.some((p) => p.id === panel)) ?? GROUPS[0];

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
  const argsRef = useRef<HTMLInputElement>(null);
  const { report: reportFailure, markGood } = tracker;
  // Works here = works in CI: the project's CI file runs on every save when that is on
  const ciHooks = useMemo(() => ({ onFailure: (report: string) => reportFailure('pipeline', report), onPassed: () => markGood('pipeline') }), [reportFailure, markGood]);
  const ci = useCiOnSave(project.name, project.files, ciHooks);
  const { onSave: ciOnSave, available: ciAvailable, on: ciOn, setOn: setCiOn } = ci;
  // A program that answered with its usage wants arguments: say so, and offer the field next to Run
  const hintArguments = useCallback(
    (output: string) => {
      const usage = output.split('\n').find((l) => /^\s*usage:?\s/i.test(l))?.trim();
      notify({ kind: 'info', title: 'This program expects arguments', detail: usage, action: { label: 'Add arguments', run: () => argsRef.current?.focus() } });
    },
    [notify]
  );
  const devServer = useDevServer(project.name, project.files, !!web);
  // Vite-style apps can also run entirely in the browser (esbuild-wasm): the only way where dev servers are off
  const inBrowser = useMemo(() => (web ? browserPreviewSupport(project.files) : null), [web, project.files]);
  const [previewChoice, setPreviewChoice] = useState<'server' | 'browser' | null>(null);
  // The editor's TypeScript follows the project: Node for scriptc, DOM and JSX for web apps
  const jsxSource = web ? (/"preact"/.test(project.files['package.json'] ?? '') ? 'preact' : 'react') : null;
  useEffect(() => {
    setEditorProjectKind(jsxSource ? { jsxImportSource: jsxSource } : null);
  }, [jsxSource]);
  const previewMode: 'server' | 'browser' = previewChoice ?? (devServer.enabled === false && inBrowser?.ok ? 'browser' : 'server');
  const hasPython = useMemo(() => Object.keys(project.files).some((f) => isPython(f) || f === 'pyproject.toml'), [project.files]);
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<CompileResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastRun, setLastRun] = useState<(RunOutcome & { entry: string }) | null>(null);
  const [panel, setPanelState] = useState<PanelId>('build');
  // Each group reopens on the tool you last used in it
  const [lastInGroup, setLastInGroup] = useState<Record<string, PanelId>>({});
  const setPanel = useCallback((id: PanelId) => {
    setPanelState(id);
    setLastInGroup((prev) => ({ ...prev, [groupOf(id).id]: id }));
  }, []);
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(220);
  const [zen, setZen] = useState(false);
  const [dialog, setDialog] = useState<null | 'palette' | 'settings' | 'templates' | 'project' | 'signin' | 'welcome'>(null);
  const [templatesFilter, setTemplatesFilter] = useState<'all' | 'typescript' | 'web' | 'python' | 'other' | 'kits'>('all');
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

  // A genuinely first visit (nothing stored, no link to open): the one-minute welcome
  useEffect(() => {
    if (!hydrated) return;
    try {
      const firstVisit = !localStorage.getItem('nanocli:welcomed') && !localStorage.getItem('nanocli:ai') && !localStorage.getItem('nanocli:workspace') && !window.location.search;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable after hydration
      if (firstVisit) setDialog('welcome');
    } catch {
      // storage blocked: no welcome
    }
  }, [hydrated]);

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
    if (params.get('kit')) {
      // A link to a built-in kit (from the site, docs or onboarding)
      Promise.all([import('@/lib/kit-library'), import('./kits-client')])
        .then(([{ KIT_LIBRARY }, { kitProject }]) => {
          const found = KIT_LIBRARY.find((k) => k.kit.id === params.get('kit'));
          if (!found) return;
          const p = kitProject(found.kit, found.files);
          load(p.files, p.entry, p.name, `Opened kit: ${found.kit.name}`);
          setPanel('kit');
        })
        .catch(fail);
      return;
    }
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
  }, [hydrated, dispatch, notify, saveSnapshot, setPanel]);

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
      else if (isUsageExit(recorded.text(), command.args)) hintArguments(recorded.text());
      else if (done.error !== 'stopped') reportFailure('python', `${recorded.text()}${done.error ? `\n${done.error}` : ''}`, 'python');
    }
    // pyproject.toml, uv.lock and files the program wrote come back into the explorer
    if (Object.keys(done.changed).length || done.removed.length) dispatch({ type: 'put', files: done.changed, removed: done.removed });
    return { ...done, ok: done.code === 0 };
  }, [dispatch, markGood, reportFailure, hintArguments]);

  const runLanguage = useCallback<WorkspaceActions['runLanguage']>(async (options, onOutput = () => {}, signal) => {
    const p = projectRef.current;
    const recorded = outputRecorder();
    const outcome = await runProject(p.name, p.files, options, (stream, text) => {
      if (stream !== 'info') recorded.push(text);
      onOutput(stream, text);
    }, signal);
    const language = outcome.language ?? (options.entry ? detectLanguage(options.entry, Object.keys(p.files))?.id : undefined);
    if (outcome.error !== 'stopped') setLastRun({ ok: !outcome.error, code: outcome.code ?? undefined, ms: outcome.ms, entry: options.entry, message: outcome.error });
    if (outcome.ok) markGood('run');
    else if (isUsageExit(recorded.text(), options.args)) hintArguments(recorded.text());
    else if (outcome.error !== 'stopped') reportFailure('run', `${recorded.text()}${outcome.error ? `\n${outcome.error}` : ''}`, language);
    // Cargo.lock, go.sum and files the program wrote come back into the explorer
    if (Object.keys(outcome.changed).length || outcome.removed.length) dispatch({ type: 'put', files: outcome.changed, removed: outcome.removed });
    return outcome;
  }, [dispatch, markGood, reportFailure, hintArguments]);

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
  }, [target, settings.build, notify, saveSnapshot, markGood, reportFailure, setPanel]);

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
    // A usage message is the program explaining its arguments, not a failure to debug
    // args[0] is the program's name (argv[0]); its own arguments follow
    else if (isUsageExit(recorded.text(), args.slice(1))) hintArguments(recorded.text());
    else reportFailure('run', `${recorded.text()}\nExited with code ${message.code}`, 'typescript');
    return outcome;
  }, [compile, dispatch, markGood, reportFailure, hintArguments]);

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
    ciOnSave();
  }, [settings.formatOnSave, format, saveSnapshot, active, notify, ciOnSave]);

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
  }, [setPanel]);

  const openPanel = useCallback((id: PanelId) => {
    setPanel(id);
    setShowPanel(true);
  }, [setPanel]);

  // Sign in: the redirect flow where this server is set up for it (a client secret and a callback on this host), else a one-time code
  const signIn = useCallback(() => {
    fetch('/api/github/device')
      .then((r) => r.json())
      .then((config: { flow?: string }) => {
        // Full-page navigation: the OAuth redirect flow is a server redirect, not a client route
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        if (config.flow === 'web') window.location.assign('/api/github/auth');
        else setDialog('signin');
      })
      .catch(() => setDialog('signin'));
  }, []);
  const signOut = useCallback(async () => {
    await fetch('/api/github/user', { method: 'DELETE' }).catch(() => {});
    setUser(null);
    notify({ kind: 'info', title: 'Signed out of GitHub' });
  }, [notify]);

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
    signIn,
    openSettings: (tab = 'general') => {
      setSettingsTab(tab);
      setDialog('settings');
    },
  }), [compile, run, format, save, openPanel, downloadArtifact, python, runLanguage, lastBuild, signIn]);

  // Terminal "run" from the toolbar / shortcut
  // Program arguments, per project, next to Run (a CLI that needs them shouldn't look broken)
  const [runArgs, setRunArgs] = useState('');
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- storage is only readable in the browser
      setRunArgs(localStorage.getItem(`nanocli:run-args:${project.name}`) ?? '');
    } catch {
      setRunArgs('');
    }
  }, [project.name]);
  const updateRunArgs = useCallback((value: string) => {
    setRunArgs(value);
    try {
      localStorage.setItem(`nanocli:run-args:${projectRef.current.name}`, value);
    } catch {
      // storage blocked: kept for this session
    }
  }, []);
  const runArgsRef = useRef(runArgs);
  useEffect(() => {
    runArgsRef.current = runArgs;
  }, [runArgs]);
  const runInTerminal = useCallback(() => {
    setShowTerminal(true);
    const args = runArgsRef.current.trim();
    // `run --` keeps the arguments from being read as a file to run
    setTimeout(() => terminalRun.current?.(args ? `run -- ${args}` : 'run'), 0);
  }, []);

  // Live values: the entry runs after each pause in typing and every line shows what it did
  const live = useLiveValues({ projectName: project.name, files: project.files, entry: project.entry, args: runArgs });
  const { available: liveAvailable, on: liveOn, setOn: setLiveOn } = live;
  const liveFor = (path: string) => {
    if (!live.on || !live.available) return null;
    const file = live.forFile(path, project.files[path]);
    return { file, stale: !file && !!live.result };
  };

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
      const id = proposals.ask(brief, { approaches: 0, label: `Fix: ${failure.title.slice(0, 90)}`, quiet: auto, origin: 'debug' });
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

  // The worker: an AI teammate that takes the next useful task while you code
  const workerFailure = useMemo(
    () => (failure && !debugProposals[failure.signature] && !proposals.prefs.autoDebug ? { signature: failure.signature, title: failure.title, brief: debugBrief(failure, project.files, lastGood()) } : null),
    [failure, debugProposals, proposals.prefs.autoDebug, lastGood, project.files]
  );
  // Contracts: how they stand, for the status bar and the worker (a stale command result is not a task)
  const contractStatus = useContracts(project.name, project.files);
  const brokenContracts = useMemo(
    () => contractStatus.views.filter((v) => v.status === 'fail' && !v.stale).map((v) => ({ id: v.id, rule: v.rule, report: describeContracts([v]), signature: v.where ? [...new Set(v.where.map((w) => w.path))].join('|') : v.detail.split('\n')[0] })),
    [contractStatus.views]
  );
  const worker = useWorker({
    projectName: project.name,
    files: project.files,
    entry: project.entry,
    failure: workerFailure,
    brokenContracts,
    onStart: useCallback((task: { kind: string; key: string }, id: string) => {
      // A failure the worker took on shows in the debug bar like any other
      if (task.kind === 'failure') setDebugProposals((prev) => ({ ...prev, [task.key.slice('failure:'.length)]: id }));
    }, []),
  });

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
    ...(ciAvailable ? [{ id: 'ci.on-save', category: 'Pipelines', title: ciOn ? 'Stop running CI on save' : 'Run CI on every save (works here = works in CI)', run: () => setCiOn(!ciOn) }] : []),
    ...(liveAvailable ? [{ id: 'view.live', category: 'Editor', title: liveOn ? 'Turn off live values' : 'Turn on live values (show what each line did)', run: () => setLiveOn(!liveOn) }] : []),
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
  ], [compileOrRun, runApp, web, analyze, downloadArtifact, lastBuild, save, format, dispatch, split, tabs, active, updateSettings, setTarget, settings.theme, settings.highContrast, openPanel, collab, liveAvailable, liveOn, setLiveOn, ciAvailable, ciOn, setCiOn]);

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
            live={liveFor(path)}
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
  const shownGroup = groupOf(shownPanel);
  const panelVisible = (id: PanelId) =>
    id === 'build' ? !web : id === 'python' ? hasPython || panel === 'python' : id === 'languages' ? !!entryLanguage || panel === 'languages' : id === 'package' ? !hasPython || 'package.json' in project.files || panel === 'package' : id === 'kit' ? KIT_FILE in project.files || panel === 'kit' : true;

  return (
    <ActionsContext.Provider value={actions}>
      <div className="flex h-dvh flex-col bg-background text-gray-100">
        {/* Top bar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-[var(--bar)] px-3" data-zen-hide>
          <Link href="/landing" prefetch={false} className="flex items-center gap-2 pl-1" aria-label="NanoCLI overview">
            <span className="wordmark text-[20px] text-gray-100">NANOCLI</span>
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <input
            value={project.name}
            onChange={(e) => dispatch({ type: 'rename-project', name: e.target.value })}
            aria-label="Project name"
            className="w-36 min-w-0 rounded-md bg-transparent px-2 py-1 font-mono text-sm text-gray-300 outline-none hover:bg-white/[0.05] focus:bg-white/[0.07]"
          />
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
            {!web && (
              <input
                ref={argsRef}
                value={runArgs}
                onChange={(e) => updateRunArgs(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') runApp();
                }}
                placeholder="arguments"
                aria-label="Program arguments"
                title="Arguments for Run, as you would type them after the program name"
                className="hidden h-8 w-40 rounded-lg border border-border bg-transparent px-2.5 font-mono text-xs text-gray-200 outline-none placeholder:text-gray-600 focus:border-border-strong lg:block"
              />
            )}
            {web && !showPreview && devState.status === 'ready' ? (
              <button onClick={() => setShowPreview(true)} className="btn btn-primary btn-sm" title={`Show the running app (${formatCombo(bindings['view.preview'] ?? '', isMac)})`}>
                <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> Preview
              </button>
            ) : (
              <button
                onClick={runApp}
                className="btn btn-primary btn-sm"
                title={`${web ? `Start ${web.label} and preview it` : isPython(project.entry) ? 'Run with uv in the terminal' : entryLanguage ? `Run with ${entryLanguage.name} in the terminal` : 'Run as WASM in the terminal'} (${formatCombo(bindings['build.run'] ?? '', isMac)})`}
              >
                Run
              </button>
            )}
            {usesScriptc && (
              <button onClick={compileOrRun} disabled={building} className="btn btn-secondary btn-sm" title={`Build the ${target} output (${formatCombo(bindings['build.compile'] ?? '', isMac)})`}>
                {building ? 'Building…' : 'Build'}
              </button>
            )}
            {usesScriptc && <OutputMenu target={target} options={settings.build} onTarget={setTarget} onOptions={(patch) => updateSettings({ build: { ...settings.build, ...patch } })} />}
            <button onClick={() => setDialog('palette')} className="btn btn-ghost btn-icon" aria-label="Command palette" title={formatCombo(bindings['view.palette'] ?? '', isMac)}>⌘</button>
            <button onClick={() => { setSettingsTab('general'); setDialog('settings'); }} className="btn btn-ghost btn-icon" aria-label="Settings">⚙</button>
            {user ? (
              <details className="relative">
                <summary className="flex cursor-pointer list-none rounded-full" aria-label={`Signed in as ${user.login}`} title={`Signed in as ${user.login}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- remote avatar, no optimisation needed */}
                  <img src={user.avatar_url} alt="" className="h-7 w-7 rounded-full border border-border-strong" />
                </summary>
                <div className="glass absolute right-0 top-full z-50 mt-2 w-56 rounded-xl p-2 animate-fade-in">
                  <p className="px-2 py-1.5 text-xs text-gray-400">Signed in as <span className="font-medium text-gray-100">{user.login}</span></p>
                  <button onClick={() => void signOut()} className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-gray-300 hover:bg-white/[0.06] hover:text-gray-100">Sign out</button>
                </div>
              </details>
            ) : (
              <button onClick={signIn} className="btn btn-ghost btn-sm hidden lg:inline-flex">
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
                  {live.available && (
                    <span className="flex items-center">
                      <button
                        onClick={() => live.setOn(!live.on)}
                        className="btn btn-ghost btn-sm gap-1.5"
                        aria-pressed={live.on}
                        title={live.on ? liveSummary(live.result) : 'Run as you type and show, on every line, what it did: values, how often it ran, what it printed. Lines that never ran fade.'}
                      >
                        <span
                          aria-hidden="true"
                          className={`h-1.5 w-1.5 rounded-full ${!live.on ? 'bg-gray-600' : live.running ? 'animate-pulse bg-accent' : live.result && !live.result.ok ? 'bg-danger' : 'bg-accent'}`}
                        />
                        Live
                      </button>
                      {live.on && live.result && (
                        <span className={`hidden max-w-[16rem] truncate text-[11px] lg:inline ${live.result.ok ? 'text-gray-500' : 'text-danger'}`} role="status" aria-live="polite">
                          {liveSummary(live.result)}
                        </span>
                      )}
                    </span>
                  )}
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
              <div role="tablist" aria-label="Tool groups" className="flex shrink-0 border-b border-border bg-[var(--bar)] px-1">
                {GROUPS.filter((g) => g.panels.some((p) => panelVisible(p.id))).map((g) => {
                  const selected = g.id === shownGroup.id;
                  const target = g.panels.find((p) => p.id === lastInGroup[g.id] && panelVisible(p.id)) ?? g.panels.find((p) => panelVisible(p.id))!;
                  return (
                    <button
                      key={g.id}
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setPanel(target.id)}
                      className={`flex h-10 flex-1 items-center justify-center gap-1.5 px-2 text-[13px] transition-colors ${
                        selected ? 'text-gray-100 shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-gray-400 hover:text-gray-100'
                      }`}
                    >
                      {g.label}
                      {g.id === 'source' && Object.keys(changes).length > 0 && <span className="rounded bg-[var(--accent-soft)] px-1 font-mono text-[11px] text-accent">{Object.keys(changes).length}</span>}
                      {g.id === 'run' && diagnostics.length > 0 && <span className="rounded bg-danger/15 px-1 font-mono text-[11px] text-danger">{diagnostics.length}</span>}
                      {g.id === 'agent' && (worker.status.kind === 'working' || proposals.proposals.some((p) => p.status === 'working')) && <span className="dot animate-pulse text-accent" aria-label="working" />}
                    </button>
                  );
                })}
              </div>
              {shownGroup.panels.filter((p) => panelVisible(p.id)).length > 1 && (
                <div role="tablist" aria-label={`${shownGroup.label} tools`} className="flex shrink-0 gap-1 border-b border-border px-3 py-2">
                  {shownGroup.panels.filter((p) => panelVisible(p.id)).map((p) => (
                    <button
                      key={p.id}
                      role="tab"
                      aria-selected={shownPanel === p.id}
                      onClick={() => setPanel(p.id)}
                      title={p.hint}
                      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${shownPanel === p.id ? 'bg-white/[0.08] text-gray-100' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                {shownPanel === 'build' && (
                  <BuildPanel result={lastBuild} building={building} coverage={coverage} analyzing={analyzing} onCoverage={() => void analyze()} lastRun={lastRun} />
                )}
                {shownPanel === 'git' && <GitPanel user={user} onOpenPipelines={() => setPanel('ci')} />}
                {shownPanel === 'ci' && <PipelinesPanel onFailure={(report) => reportFailure('pipeline', report)} onPassed={() => markGood('pipeline')} />}
                {shownPanel === 'ai' && <AiPanel diagnostics={diagnostics} getSelection={() => {
                  const editor = editorRef.current;
                  const selection = editor?.getSelection();
                  return selection && !selection.isEmpty() ? editor?.getModel()?.getValueInRange(selection) ?? '' : '';
                }} />}
                {shownPanel === 'agent' && <AgentPanel />}
                {shownPanel === 'worker' && <WorkerPanel worker={worker} />}
                {shownPanel === 'contracts' && <ContractsPanel onOpen={(file, line) => openLocation({ file, line: line ?? 1 })} />}
                {shownPanel === 'kit' && <KitPanel onFocus={(focus) => worker.setSettings({ focus })} />}
                {shownPanel === 'history' && <HistoryPanel />}
                {shownPanel === 'graph' && <GraphPanel />}
                {shownPanel === 'package' && <PackagePanel />}
                {shownPanel === 'python' && <PythonPanel />}
                {shownPanel === 'languages' && <LanguagePanel key={`${project.name}:${project.entry}`} />}
              </div>
            </aside>
          )}
        </div>

        {/* Status bar: what is happening now, each item one click from its panel */}
        <footer className="flex h-7 shrink-0 items-center gap-1 overflow-hidden border-t border-border bg-[var(--bar)] px-2 font-mono text-[11px] text-gray-400" data-zen-hide>
          {git && (
            <button onClick={() => openPanel('git')} className="rounded px-1.5 hover:bg-white/[0.06] hover:text-gray-100" title={`${git.owner}/${git.repo}`}>
              ⑂ {git.branch}{Object.keys(changes).length ? ` · ${Object.keys(changes).length} changed` : ''}
            </button>
          )}
          <span className="hidden px-1.5 sm:inline" title="Entry file">{project.entry || 'no entry file'}</span>
          {web && devState.status !== 'none' && (
            <button onClick={() => setShowPreview((v) => !v)} className={`rounded px-1.5 hover:bg-white/[0.06] ${devState.status === 'ready' ? 'text-accent' : devState.status === 'failed' ? 'text-danger' : ''}`} title={devState.url ?? devState.error ?? ''}>
              {devState.status === 'ready' ? `● ${web.label} · ${devState.url?.replace(/^https?:\/\//, '').replace(/\/$/, '')}` : `${web.label} · ${devState.status}`}
            </button>
          )}
          {lastBuild && (
            <button onClick={() => openPanel('build')} className={`rounded px-1.5 hover:bg-white/[0.06] ${lastBuild.success ? 'text-accent' : 'text-danger'}`}>
              {lastBuild.success ? `✓ built ${lastBuild.durationMs}ms` : `✕ ${diagnostics.length || 1} problem${diagnostics.length > 1 ? 's' : ''}`}
            </button>
          )}
          {lastRun && lastRun.message !== 'stopped' && (
            <span className={`px-1.5 ${lastRun.ok && !lastRun.code ? 'text-accent' : 'text-amber-300'}`}>{lastRun.ok ? `ran · exit ${lastRun.code ?? 0}${lastRun.ms !== undefined ? ` · ${lastRun.ms}ms` : ''}` : 'run failed'}</span>
          )}
          {failure && (
            <span className="max-w-[18rem] truncate px-1.5 text-danger" title={failure.title}>● {failure.title}</span>
          )}
          <span className="ml-auto" />
          {(() => {
            const working = proposals.proposals.find((p) => p.status === 'working');
            const review = proposals.proposals.filter((p) => p.status === 'review').length;
            if (working) return <button onClick={() => openProposal(working.id)} className="flex max-w-[22rem] items-center gap-1.5 rounded px-1.5 text-gray-200 hover:bg-white/[0.06]"><span className="dot animate-pulse text-accent" aria-hidden="true" /><span className="truncate">Agent · {working.goal.replace(/^Worker · /, '')}</span></button>;
            if (review) return <button onClick={() => openPanel('agent')} className="rounded px-1.5 text-accent hover:bg-white/[0.06]">{review} to review</button>;
            return null;
          })()}
          {ci.on && ci.available && (
            <button
              onClick={() => openPanel('ci')}
              className={`rounded px-1.5 hover:bg-white/[0.06] ${ci.stale ? '' : ci.state.status === 'passed' ? 'text-accent' : ci.state.status === 'failed' ? 'text-danger' : ''}`}
              title={`${ci.ciFile}: the same steps CI runs, on this machine, on every save${ci.stale ? ' (files changed since: save to run again)' : ''}`}
            >
              {ci.state.status === 'running' ? (
                <span className="flex items-center gap-1.5"><span className="dot animate-pulse text-accent" aria-hidden="true" />CI here · {ci.state.step ?? 'starting'}</span>
              ) : ci.state.status === 'passed' ? (
                `CI here ✓ ${Math.round(ci.state.ms / 1000)} s`
              ) : ci.state.status === 'failed' ? (
                `CI here ✕ ${ci.state.step ?? ''}`.trim()
              ) : (
                'CI on save'
              )}
            </button>
          )}
          {contractStatus.contracts.length > 0 && (
            <button
              onClick={() => openPanel('contracts')}
              className={`rounded px-1.5 hover:bg-white/[0.06] ${contractStatus.counts.fail ? 'text-danger' : 'text-accent'}`}
              title={contractStatus.counts.fail ? contractStatus.views.filter((v) => v.status === 'fail').map((v) => `✕ ${v.rule}`).join('\n') : 'Every contract checked here holds'}
            >
              {contractStatus.counts.fail ? `${contractStatus.counts.fail} contract${contractStatus.counts.fail > 1 ? 's' : ''} broken` : `contracts ${contractStatus.counts.pass}/${contractStatus.views.length}`}
            </button>
          )}
          {worker.settings.mode !== 'off' && (
            <button onClick={() => openPanel('worker')} className={`rounded px-1.5 hover:bg-white/[0.06] ${worker.status.kind === 'waiting-for-you' ? 'text-amber-300' : ''}`} title="Keep going: the worker">
              {worker.status.kind === 'working' ? 'worker on it' : worker.status.kind === 'waiting-for-you' ? 'worker needs you' : worker.status.kind === 'paused' ? 'worker paused' : `worker · ${worker.queue.length} queued`}
            </button>
          )}
          {update?.canApply && (
            <button onClick={() => { setSettingsTab('maintenance'); setDialog('settings'); }} className="rounded px-1.5 text-accent hover:bg-[var(--accent-soft)]" title="A newer version of the studio is available">
              ↑ {update.behind} update{update.behind > 1 ? 's' : ''}
            </button>
          )}
          <button onClick={() => setDialog('palette')} className="hidden rounded px-1.5 hover:bg-white/[0.06] hover:text-gray-100 sm:inline">{formatCombo(bindings['view.palette'] ?? '', isMac)} commands</button>
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
      {dialog === 'templates' && <TemplatesDialog initial={templatesFilter} onClose={() => { setDialog(null); setTemplatesFilter('all'); }} />}
      {dialog === 'welcome' && (
        <WelcomeDialog
          onClose={() => {
            setDialog(null);
            try {
              localStorage.setItem('nanocli:welcomed', '1');
            } catch {
              // storage blocked: shown again next time
            }
          }}
          onStart={(startWith) => {
            if (!startWith) return;
            setTemplatesFilter(startWith);
            setDialog('templates');
          }}
        />
      )}
      {viewer && <ArtifactDialog result={viewer} theme={settings.theme} onClose={() => setViewer(null)} />}
      {dialog === 'project' && <ProjectDialog user={user} onClose={() => setDialog(null)} />}
      {dialog === 'signin' && (
        <SignInDialog
          onClose={() => setDialog(null)}
          onSignedIn={(signedIn) => {
            setUser(signedIn);
            setDialog(null);
            notify({ kind: 'success', title: `Signed in as ${signedIn.login}` });
          }}
        />
      )}
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
