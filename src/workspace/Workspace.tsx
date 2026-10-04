'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ByteField } from '@/components/ByteField';
import { CodeEditor, DiffView, type EditorInstance } from '@/components/CodeEditor';
import { analyzeCoverageBrowser, compileTypeScriptBrowser, type CompileResult, type CoverageResult, type Diagnostic } from '@/lib/compiler-browser';
import { TEMPLATES, templateFiles } from '@/lib/templates';
import { WebSocketManager } from '@/lib/websocket';
import type { CompileTarget, GitHubUserInfo } from '@/types';
import { ActionsContext, type PanelId, type RunOutcome, type WorkspaceActions } from './actions';
import { CommandPalette, type Command } from './components/CommandPalette';
import { Dialog } from './components/Dialog';
import { FileTree } from './components/FileTree';
import { ProjectDialog } from './components/ProjectDialog';
import { SettingsDialog } from './components/SettingsDialog';
import { TemplatesDialog } from './components/TemplatesDialog';
import { Terminal } from './components/Terminal';
import { canFormat, formatSource } from './format';
import { AiPanel } from './panels/AiPanel';
import { BuildPanel } from './panels/BuildPanel';
import { GitPanel } from './panels/GitPanel';
import { GraphPanel } from './panels/GraphPanel';
import { HistoryPanel } from './panels/HistoryPanel';
import { PackagePanel } from './panels/PackagePanel';
import { basename, comboFromEvent, diffStatus, formatCombo, languageFor } from './project';
import { base64ToArrayBuffer, runWasm } from './runner';
import { useWorkspace } from './store';
import { useToast } from './toasts';

const TARGETS: { value: CompileTarget; label: string; hint: string }[] = [
  { value: 'exe', label: 'Native', hint: 'Executable for the build server (Linux x64)' },
  { value: 'wasm', label: 'WASM', hint: 'Portable WASI Preview 1 module' },
  { value: 'llvm', label: 'IR', hint: 'Textual LLVM IR' },
  { value: 'asm', label: 'ASM', hint: 'Target assembly' },
];

const PANELS: { id: PanelId; label: string; glyph: string }[] = [
  { id: 'build', label: 'Build', glyph: '▶' },
  { id: 'git', label: 'Git', glyph: '⑂' },
  { id: 'ai', label: 'Assistant', glyph: '✦' },
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
  'view.theme': 'Mod+Alt+T',
  'panel.git': 'Mod+Alt+G',
  'panel.ai': 'Mod+I',
  'panel.history': 'Mod+Alt+H',
  'prefs.settings': 'Mod+,',
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function Workspace() {
  const ws = useWorkspace();
  const { project, tabs, active, split, git, settings, dispatch, hydrated, updateSettings, saveSnapshot } = ws;
  const { notify } = useToast();

  const [target, setTarget] = useState<CompileTarget>('exe');
  const [building, setBuilding] = useState(false);
  const [lastBuild, setLastBuild] = useState<CompileResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastRun, setLastRun] = useState<(RunOutcome & { entry: string }) | null>(null);
  const [panel, setPanel] = useState<PanelId>('build');
  const [showExplorer, setShowExplorer] = useState(true);
  const [showPanel, setShowPanel] = useState(true);
  const [showTerminal, setShowTerminal] = useState(true);
  const [terminalHeight, setTerminalHeight] = useState(260);
  const [zen, setZen] = useState(false);
  const [dialog, setDialog] = useState<null | 'palette' | 'settings' | 'templates' | 'project'>(null);
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
    try {
      const template = TEMPLATES.find((t) => t.id === params.get('template'));
      if (template) {
        const { files, entry } = templateFiles(template);
        load(files, entry, template.id, `Opened template: ${template.name}`);
      } else if (params.get('project')) {
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
      notify({ kind: 'error', title: 'Could not read the link', detail: 'It may be truncated or from an older version.' });
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
    const room = new URLSearchParams(window.location.search).get('room') ?? project.name.replace(/[^\w-]/g, '') ?? 'room';
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
      if (path && typeof m.content === 'string') {
        if (path in projectRef.current.files) dispatch({ type: 'write', path, content: m.content });
        else dispatch({ type: 'create', path, content: m.content });
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
      const result = await compileTypeScriptBrowser({ files: p.files, entry, target: buildTarget });
      setLastBuild(result);
      if (result.success) {
        saveSnapshot(`Build succeeded (${buildTarget})`);
        if (!options.quiet) notify({ kind: 'success', title: 'Build succeeded', detail: `${result.filename?.replace(/^[0-9a-f]{32}-/, '')} · ${result.durationMs}ms` });
      } else {
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
  }, [target, notify, saveSnapshot]);

  const run = useCallback<WorkspaceActions['run']>(async (args, onOutput, options = {}) => {
    const entry = options.entry ?? projectRef.current.entry;
    const result = await compile({ target: 'wasm', entry, quiet: true });
    if (!result) return { ok: false, message: 'Build failed' };
    if (!result.success) {
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
    const handle = runWasm(
      { wasm: base64ToArrayBuffer(result.output), args, env: ['TERM=xterm-256color'], files: projectRef.current.files },
      onOutput
    );
    options.signal?.addEventListener('abort', handle.stop);
    const message = await handle.done;
    if (message.type === 'error') {
      const outcome = { ok: false, message: message.message === 'Stopped' ? 'stopped' : `runtime error: ${message.message}` };
      setLastRun({ ...outcome, entry });
      return outcome;
    }
    for (const [path, content] of Object.entries(message.changed)) {
      if (path in projectRef.current.files) dispatch({ type: 'write', path, content });
      else dispatch({ type: 'create', path, content });
      onOutput('stdout', `→ wrote ${path}`);
    }
    const outcome = { ok: true, code: message.code, ms: message.ms, memoryBytes: message.memoryBytes };
    setLastRun({ ...outcome, entry });
    return outcome;
  }, [compile, dispatch]);

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
  }), [compile, run, format, save, openPanel, downloadArtifact]);

  // Terminal "run" from the toolbar / shortcut
  const terminalRun = useRef<((cmd: string) => void) | null>(null);
  const runInTerminal = useCallback(() => {
    setShowTerminal(true);
    setTimeout(() => terminalRun.current?.('run'), 0);
  }, []);

  // ---------------------------------------------------------------------------
  // Commands & shortcuts
  // ---------------------------------------------------------------------------

  const commands = useMemo<Command[]>(() => [
    { id: 'build.compile', category: 'Build', title: 'Compile', keys: DEFAULT_KEYS['build.compile'], run: () => void compile() },
    { id: 'build.run', category: 'Build', title: 'Run in terminal (WASM)', keys: DEFAULT_KEYS['build.run'], run: runInTerminal },
    { id: 'build.coverage', category: 'Build', title: 'Analyze scriptc coverage', run: () => void analyze() },
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
    { id: 'panel.package', category: 'Package', title: 'Edit package.json', run: () => openPanel('package') },
    { id: 'collab.toggle', category: 'Collaboration', title: collab ? 'Leave live session' : 'Start live session', run: () => setCollab((v) => !v) },
    { id: 'prefs.settings', category: 'Preferences', title: 'Settings', keys: DEFAULT_KEYS['prefs.settings'], run: () => setDialog('settings') },
  ], [compile, runInTerminal, analyze, downloadArtifact, lastBuild, save, format, dispatch, split, tabs, active, updateSettings, settings.theme, settings.highContrast, openPanel, collab]);

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
            onRun={() => void compile()}
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

  return (
    <ActionsContext.Provider value={actions}>
      {extensions.byteField !== false && <ByteField />}
      <div className="flex h-dvh flex-col gap-2.5 p-2.5 text-gray-100">
        {/* Top bar */}
        <header className="glass flex h-14 shrink-0 items-center gap-3 rounded-2xl px-3" data-zen-hide>
          <Link href="/landing" className="flex items-center gap-2 pl-1" aria-label="NanoCLI overview">
            <span className="display text-[22px] leading-none text-gray-100">NANOCLI</span>
          </Link>
          <span className="h-5 w-px bg-border" aria-hidden="true" />
          <input
            value={project.name}
            onChange={(e) => dispatch({ type: 'rename-project', name: e.target.value })}
            aria-label="Project name"
            className="w-36 min-w-0 rounded-lg bg-transparent px-2 py-1 font-mono text-sm text-gray-300 outline-none hover:bg-white/[0.05] focus:bg-white/[0.07]"
          />
          {git && (
            <button onClick={() => openPanel('git')} className="badge hidden font-mono md:inline-flex" title={`${git.owner}/${git.repo}`}>
              ⑂ {git.branch}{Object.keys(changes).length ? ` · ${Object.keys(changes).length}` : ''}
            </button>
          )}
          {collab && (
            <span className="badge hidden md:inline-flex" title={collaborators.map((c) => c.name).join(', ') || 'Waiting for others'}>
              <span className="dot animate-pulse" aria-hidden="true" /> Live · {collaborators.length + 1}
            </span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <div className="segmented hidden sm:inline-flex" role="group" aria-label="Output target">
              {TARGETS.map((t) => (
                <button key={t.value} aria-pressed={target === t.value} title={t.hint} onClick={() => setTarget(t.value)}>{t.label}</button>
              ))}
            </div>
            <button onClick={runInTerminal} className="btn btn-secondary btn-sm" title={`Run as WASM in the terminal (${formatCombo(bindings['build.run'] ?? '', isMac)})`}>
              Run
            </button>
            <button onClick={() => void compile()} disabled={building} className="btn btn-primary btn-sm" title={formatCombo(bindings['build.compile'] ?? '', isMac)}>
              {building ? 'Compiling…' : 'Compile'}
              <span className="kbd border-black/20 text-[10px] text-black/60">{formatCombo(bindings['build.compile'] ?? '', isMac)}</span>
            </button>
            <button onClick={() => setDialog('palette')} className="btn btn-ghost btn-icon" aria-label="Command palette" title={formatCombo(bindings['view.palette'] ?? '', isMac)}>⌘</button>
            <button onClick={() => setDialog('settings')} className="btn btn-ghost btn-icon" aria-label="Settings">⚙</button>
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

        <div className="flex min-h-0 flex-1 gap-2.5">
          {/* Explorer */}
          {showExplorer && (
            <aside className="pane hidden w-60 shrink-0 flex-col md:flex" aria-label="Explorer" data-zen-hide>
              <FileTree errorCounts={errorCounts} />
              <div className="flex items-center gap-1 border-t border-border p-2">
                <button onClick={() => setDialog('templates')} className="btn btn-ghost btn-sm flex-1">New project</button>
                <button onClick={() => setDialog('project')} className="btn btn-ghost btn-sm flex-1">Import / export</button>
              </div>
            </aside>
          )}

          {/* Editor + terminal */}
          <main id="main" className="flex min-w-0 flex-1 flex-col gap-2.5">
            <section className="pane flex min-h-0 flex-1 flex-col overflow-hidden" aria-label="Editor">
              <div className="flex h-10 shrink-0 items-center border-b border-border" data-zen-hide>
                <div role="tablist" aria-label="Open files" className="flex min-w-0 flex-1 overflow-x-auto">
                  {tabs.map((tab) => (
                    <div
                      key={tab}
                      className={`group flex h-10 shrink-0 items-center gap-2 border-r border-border pl-3.5 pr-2 font-mono text-xs ${
                        tab === active ? 'bg-white/[0.06] text-gray-100' : 'text-gray-500 hover:text-gray-200'
                      }`}
                    >
                      <button role="tab" aria-selected={tab === active} onClick={() => dispatch({ type: 'open', path: tab })} title={tab}>
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
              <div className="flex min-h-0 flex-1 divide-x divide-border">
                {editorPane(active)}
                {split && editorPane(split, true)}
              </div>
            </section>

            {showTerminal && (
              <section className="pane relative flex shrink-0 flex-col overflow-hidden" style={{ height: terminalHeight }} aria-label="Terminal" data-zen-hide>
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
            <aside className="pane hidden w-[22rem] shrink-0 flex-col overflow-hidden lg:flex" aria-label="Tools" data-zen-hide>
              <div role="tablist" aria-label="Tool panels" className="flex shrink-0 gap-0.5 overflow-x-auto border-b border-border p-1.5">
                {PANELS.map((p) => (
                  <button
                    key={p.id}
                    role="tab"
                    aria-selected={panel === p.id}
                    onClick={() => setPanel(p.id)}
                    title={p.label}
                    aria-label={p.label}
                    className={`flex h-8 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-xs transition-colors ${
                      panel === p.id ? 'bg-gray-100 text-black' : 'text-gray-400 hover:bg-white/[0.06] hover:text-gray-100'
                    }`}
                  >
                    <span aria-hidden="true">{p.glyph}</span>
                    {panel === p.id && p.label}
                    {p.id === 'git' && Object.keys(changes).length > 0 && <span className="font-mono">{Object.keys(changes).length}</span>}
                    {p.id === 'build' && diagnostics.length > 0 && <span className="font-mono">{diagnostics.length}✕</span>}
                  </button>
                ))}
              </div>
              <div role="tabpanel" className="min-h-0 flex-1 overflow-y-auto">
                {panel === 'build' && (
                  <BuildPanel result={lastBuild} building={building} coverage={coverage} analyzing={analyzing} onCoverage={() => void analyze()} lastRun={lastRun} />
                )}
                {panel === 'git' && <GitPanel user={user} />}
                {panel === 'ai' && <AiPanel diagnostics={diagnostics} getSelection={() => {
                  const editor = editorRef.current;
                  const selection = editor?.getSelection();
                  return selection && !selection.isEmpty() ? editor?.getModel()?.getValueInRange(selection) ?? '' : '';
                }} />}
                {panel === 'history' && <HistoryPanel />}
                {panel === 'graph' && <GraphPanel />}
                {panel === 'package' && <PackagePanel />}
              </div>
            </aside>
          )}
        </div>

        {/* Status bar */}
        <footer className="glass flex h-7 shrink-0 items-center gap-4 rounded-xl px-3 font-mono text-[11px] text-gray-500" data-zen-hide>
          <span>{project.entry ? `entry ${project.entry}` : 'no entry file'}</span>
          <span className="hidden sm:inline">{Object.keys(project.files).length} files</span>
          {lastBuild && <span>{lastBuild.success ? `✓ built ${lastBuild.durationMs}ms` : `✕ ${diagnostics.length || 1} problem${diagnostics.length > 1 ? 's' : ''}`}</span>}
          <span className="ml-auto hidden sm:inline">scriptc 0.2 · {formatCombo(bindings['view.palette'] ?? '', isMac)} for commands</span>
          <span className="hidden md:inline">© 2026 BrandDeb · Proprietary</span>
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
      {dialog === 'settings' && <SettingsDialog commands={commands} isMac={isMac} onClose={() => setDialog(null)} />}
      {dialog === 'templates' && <TemplatesDialog onClose={() => setDialog(null)} />}
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
