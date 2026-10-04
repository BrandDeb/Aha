'use client';

/**
 * NanoCLI Studio - Editor
 * Write TypeScript in the browser, compile it to a native binary with scriptc.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { CodeEditor } from '@/components/CodeEditor';
import { SiteHeader } from '@/components/SiteHeader';
import {
  analyzeCoverageBrowser,
  compileTypeScriptBrowser,
  formatSize,
  type CompileResult,
  type CoverageResult,
} from '@/lib/compiler-browser';
import { DEFAULT_CODE, TEMPLATES, type Template } from '@/lib/templates';
import { WebSocketManager } from '@/lib/websocket';
import type { CollaboratorInfo, CompileTarget, GitHubUserInfo } from '@/types';

const TARGETS: { value: CompileTarget; label: string; hint: string }[] = [
  { value: 'exe', label: 'Native', hint: 'Executable for the build server (Linux x64)' },
  { value: 'wasm', label: 'WASM', hint: 'Portable WASI Preview 1 module' },
  { value: 'llvm', label: 'LLVM IR', hint: 'Textual LLVM IR' },
  { value: 'asm', label: 'Assembly', hint: 'Target assembly' },
];

type PanelTab = 'problems' | 'output' | 'console';

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function hexPreview(base64: string, bytes = 256): string {
  const raw = atob(base64.slice(0, Math.ceil((bytes * 4) / 3)));
  const lines: string[] = [];
  for (let offset = 0; offset < raw.length; offset += 16) {
    const chunk = raw.slice(offset, offset + 16);
    const hex = Array.from(chunk, (c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(chunk, (c) => (c >= ' ' && c <= '~' ? c : '.')).join('');
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  return lines.join('\n');
}

export default function HomePage() {
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [filename, setFilename] = useState<string>('app.ts');
  const [projectName, setProjectName] = useState<string>('my-cli');
  const [target, setTarget] = useState<CompileTarget>('exe');
  const [isCompiling, setIsCompiling] = useState(false);
  const [compileResult, setCompileResult] = useState<CompileResult | null>(null);
  const [coverage, setCoverage] = useState<CoverageResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('problems');
  const [consoleMessages, setConsoleMessages] = useState<string[]>([]);
  const [shareUrl, setShareUrl] = useState<string>('');
  const [showShareModal, setShowShareModal] = useState(false);
  const [copied, setCopied] = useState(false);
  const [githubUser, setGithubUser] = useState<GitHubUserInfo | null>(null);
  const [showCollaboration, setShowCollaboration] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorInfo[]>([]);

  const [clientId] = useState(() => crypto.randomUUID());
  const [projectId] = useState(() => crypto.randomUUID());
  const wsManager = useRef<WebSocketManager | null>(null);

  const addConsoleMessage = useCallback((message: string) => {
    setConsoleMessages(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
  }, []);

  // Initialize WebSocket connection for collaboration
  useEffect(() => {
    if (!showCollaboration) return;
    const manager = new WebSocketManager(projectId, clientId, 'User');
    wsManager.current = manager;
    manager.connect();

    manager.on('collaborator_joined', (message) => {
      setCollaborators(prev => [...prev.filter(c => c.id !== message.clientId), {
        id: message.clientId,
        name: typeof message.name === 'string' ? message.name : 'Anonymous',
        color: `hsl(${Math.floor(Math.random() * 360)} 80% 60%)`,
      }]);
    });
    manager.on('collaborator_left', (message) => {
      setCollaborators(prev => prev.filter(c => c.id !== message.clientId));
    });
    manager.on('content_update', (message) => {
      if (typeof message.content === 'string') setCode(message.content);
    });

    return () => {
      manager.disconnect();
      setCollaborators([]);
    };
  }, [showCollaboration, projectId, clientId]);

  // Check GitHub authentication status
  useEffect(() => {
    fetch('/api/github/user')
      .then(res => res.json())
      .then(data => {
        if (data.authenticated) setGithubUser(data.user);
      })
      .catch(() => {});
  }, []);

  // Load from a ?template= or ?share= link (once, on mount — re-running would clobber edits)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const template = TEMPLATES.find(t => t.id === params.get('template'));
    if (template) {
      /* eslint-disable-next-line react-hooks/set-state-in-effect -- window.location is only readable after hydration */
      setCode(template.code);
      setFilename(template.filename);
      return;
    }
    const shareData = params.get('share');
    if (!shareData) return;
    try {
      const decoded = JSON.parse(decodeURIComponent(atob(shareData)));
      /* eslint-disable react-hooks/set-state-in-effect -- window.location is only readable after hydration */
      if (typeof decoded.code === 'string') setCode(decoded.code);
      if (typeof decoded.filename === 'string') setFilename(decoded.filename);
      if (TARGETS.some(t => t.value === decoded.target)) setTarget(decoded.target);
      if (typeof decoded.projectName === 'string') setProjectName(decoded.projectName);
      /* eslint-enable react-hooks/set-state-in-effect */
      addConsoleMessage('Loaded shared project');
    } catch {
      addConsoleMessage('Could not read the shared project link');
    }
  }, [addConsoleMessage]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
    if (showCollaboration && wsManager.current?.isConnected()) {
      wsManager.current.send({ type: 'edit', content: value, projectId, clientId });
    }
  }, [showCollaboration, projectId, clientId]);

  const handleCompile = useCallback(async () => {
    if (isCompiling) return;
    setIsCompiling(true);
    addConsoleMessage(`Compiling ${filename} → ${target}`);
    try {
      const result = await compileTypeScriptBrowser({ code, filename, target });
      setCompileResult(result);
      if (result.success) {
        addConsoleMessage(`Built ${result.filename} (${formatSize(result.size)}) in ${result.durationMs}ms`);
        if (result.error) addConsoleMessage(result.error);
        setPanelTab('output');
      } else {
        addConsoleMessage(`Build failed: ${result.error}`);
        setPanelTab(result.diagnostics?.length ? 'problems' : 'console');
        if (!result.diagnostics?.length && result.stderr) addConsoleMessage(result.stderr);
      }
    } catch (err) {
      addConsoleMessage(`Error: ${errorMessage(err)}`);
    } finally {
      setIsCompiling(false);
    }
  }, [isCompiling, code, filename, target, addConsoleMessage]);

  const handleCoverage = useCallback(async () => {
    setIsAnalyzing(true);
    const result = await analyzeCoverageBrowser(code, filename);
    setCoverage(result);
    setIsAnalyzing(false);
    addConsoleMessage(result.success
      ? `Coverage: ${result.percent}% of ${result.statements} statements compile statically`
      : `Coverage failed: ${result.error}`);
  }, [code, filename, addConsoleMessage]);

  const handleDownload = useCallback(async () => {
    if (!compileResult?.filename) return;
    try {
      const response = await fetch(`/api/download/${encodeURIComponent(compileResult.filename)}`);
      if (!response.ok) throw new Error('The build artifact has expired — compile again');
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = compileResult.filename.replace(/^[0-9a-f]{32}-?/, '') || compileResult.filename;
      a.click();
      URL.revokeObjectURL(url);
      addConsoleMessage(`Downloaded ${a.download}`);
    } catch (err) {
      addConsoleMessage(`Download error: ${errorMessage(err)}`);
      setPanelTab('console');
    }
  }, [compileResult, addConsoleMessage]);

  const handleGitHubLogin = useCallback(() => {
    // Full-page navigation: the OAuth flow is a server redirect, not a client route
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/api/github/auth');
  }, []);

  const handleGitHubLogout = useCallback(async () => {
    await fetch('/api/github/user', { method: 'DELETE' });
    setGithubUser(null);
    addConsoleMessage('Signed out of GitHub');
  }, [addConsoleMessage]);

  const loadTemplate = useCallback((template: Template) => {
    setCode(template.code);
    setFilename(template.filename);
    setCompileResult(null);
    setCoverage(null);
    addConsoleMessage(`Loaded template: ${template.name}`);
  }, [addConsoleMessage]);

  const generateShareUrl = useCallback(() => {
    const encoded = btoa(encodeURIComponent(JSON.stringify({ code, filename, target, projectName })));
    setShareUrl(`${window.location.origin}/?share=${encoded}`);
    setCopied(false);
    setShowShareModal(true);
  }, [code, filename, target, projectName]);

  const diagnostics = compileResult?.diagnostics ?? [];
  const problems = diagnostics.filter(d => d.severity === 'error');
  const isBinary = compileResult?.success && (target === 'exe' || target === 'wasm') && !compileResult.filename?.endsWith('.ll');

  return (
    <div className="flex h-dvh flex-col bg-black text-gray-100">
      <SiteHeader
        active="/"
        fluid
        center={
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              aria-label="Project name"
              className="w-36 rounded-md bg-transparent px-2 py-1 text-right text-gray-300 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none"
            />
            <span>/</span>
            <input
              value={filename}
              onChange={(e) => setFilename(e.target.value.replace(/[^a-zA-Z0-9._-]/g, ''))}
              aria-label="Filename"
              className="w-36 rounded-md bg-transparent px-2 py-1 font-mono text-gray-100 hover:bg-white/[0.04] focus:bg-white/[0.06] focus:outline-none"
            />
          </div>
        }
      >
        <button onClick={generateShareUrl} className="btn btn-ghost btn-sm">Share</button>
        {githubUser ? (
          <button onClick={handleGitHubLogout} className="btn btn-ghost btn-sm" title="Sign out of GitHub">
            {/* eslint-disable-next-line @next/next/no-img-element -- remote avatar, no optimization needed */}
            <img src={githubUser.avatar_url} alt="" className="h-5 w-5 rounded-full" />
            {githubUser.login}
          </button>
        ) : (
          <button onClick={handleGitHubLogin} className="btn btn-secondary btn-sm">Sign in with GitHub</button>
        )}
      </SiteHeader>

      <div className="flex min-h-0 flex-1">
        {/* Templates */}
        <aside className="hidden w-64 shrink-0 flex-col border-r border-border md:flex">
          <div className="px-4 pt-4 pb-2 eyebrow">Templates</div>
          <ul className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            {TEMPLATES.map((template) => (
              <li key={template.id}>
                <button
                  onClick={() => loadTemplate(template)}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-white/[0.04] ${
                    filename === template.filename ? 'bg-white/[0.06]' : ''
                  }`}
                >
                  <div className="text-sm text-gray-100">{template.name}</div>
                  <div className="mt-0.5 text-xs leading-snug text-gray-500">{template.description}</div>
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-border p-3">
            <button
              onClick={() => setShowCollaboration(on => !on)}
              aria-pressed={showCollaboration}
              className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-sm text-gray-300 hover:bg-white/[0.04]"
            >
              Live collaboration
              <span className={`relative h-5 w-9 rounded-full transition-colors ${showCollaboration ? 'bg-accent' : 'bg-gray-700'}`}>
                <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${showCollaboration ? 'left-[18px]' : 'left-0.5'}`} />
              </span>
            </button>
            {showCollaboration && (
              <div className="mt-2 space-y-1 px-2.5 text-xs text-gray-500">
                {collaborators.length === 0 ? 'Share the link to invite others.' : collaborators.map(c => (
                  <div key={c.id} className="flex items-center gap-2 text-gray-300">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />
                    {c.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>

        {/* Editor + panel */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-3 border-b border-border px-3">
            <div className="segmented" role="group" aria-label="Output target">
              {TARGETS.map((t) => (
                <button key={t.value} aria-pressed={target === t.value} title={t.hint} onClick={() => setTarget(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button onClick={handleCoverage} disabled={isAnalyzing} className="btn btn-ghost btn-sm">
                {isAnalyzing ? 'Analyzing…' : 'Check coverage'}
              </button>
              <button onClick={handleCompile} disabled={isCompiling} className="btn btn-primary btn-sm">
                {isCompiling ? 'Compiling…' : 'Compile'}
                <span className="kbd border-black/15 text-black/60">⌘↵</span>
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 bg-gray-900">
            <CodeEditor value={code} onChange={handleCodeChange} diagnostics={diagnostics} onRun={handleCompile} />
          </div>

          <section className="flex h-60 shrink-0 flex-col border-t border-border bg-black">
            <div className="flex h-10 items-center gap-1 border-b border-border px-2" role="tablist">
              {([
                ['problems', `Problems${problems.length ? ` · ${problems.length}` : ''}`],
                ['output', 'Output'],
                ['console', 'Console'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  role="tab"
                  aria-selected={panelTab === tab}
                  onClick={() => setPanelTab(tab)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    panelTab === tab ? 'bg-white/[0.08] text-gray-100' : 'text-gray-500 hover:text-gray-100'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-[12.5px] leading-relaxed">
              {panelTab === 'problems' && (
                diagnostics.length === 0 ? (
                  <p className="text-gray-500">
                    {compileResult?.success === false ? compileResult.error : 'No problems. Compile to type-check against the scriptc surface.'}
                  </p>
                ) : diagnostics.map((d, i) => (
                  <div key={i} className="mb-2">
                    <span className={d.severity === 'error' ? 'text-danger' : 'text-warning'}>{d.code}</span>
                    <span className="text-gray-500"> {filename}:{d.line}:{d.column} </span>
                    <span className="text-gray-100">{d.message}</span>
                    {d.hint && <div className="pl-4 text-gray-500">hint: {d.hint}</div>}
                  </div>
                ))
              )}
              {panelTab === 'output' && (
                !compileResult?.success ? (
                  <p className="text-gray-500">Compile your program to see the artifact here.</p>
                ) : isBinary ? (
                  <pre className="whitespace-pre text-gray-400">{hexPreview(compileResult.output ?? '')}</pre>
                ) : (
                  <pre className="whitespace-pre text-gray-300">
                    {(compileResult.output ?? '').length > 20000
                      ? `${compileResult.output?.slice(0, 20000)}\n\n… truncated — download for the full file`
                      : compileResult.output}
                  </pre>
                )
              )}
              {panelTab === 'console' && (
                consoleMessages.length === 0
                  ? <p className="text-gray-500">Build logs appear here.</p>
                  : consoleMessages.map((msg, i) => <div key={i} className="whitespace-pre-wrap text-gray-400">{msg}</div>)
              )}
            </div>
          </section>
        </main>

        {/* Build inspector */}
        <aside className="hidden w-72 shrink-0 flex-col gap-6 overflow-y-auto border-l border-border p-4 xl:flex">
          <div>
            <div className="eyebrow mb-3">Build</div>
            {!compileResult ? (
              <p className="text-sm text-gray-500">
                Press <span className="kbd">⌘↵</span> to compile <span className="font-mono text-gray-300">{filename}</span> with scriptc.
              </p>
            ) : compileResult.success ? (
              <div className="space-y-3 animate-fade-in">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-success" />
                  <span className="text-gray-100">Build succeeded</span>
                </div>
                <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border">
                  <div className="bg-black p-3">
                    <dt className="text-xs text-gray-500">Size</dt>
                    <dd className="mt-1 font-mono text-lg text-gray-100">{formatSize(compileResult.size)}</dd>
                  </div>
                  <div className="bg-black p-3">
                    <dt className="text-xs text-gray-500">Build time</dt>
                    <dd className="mt-1 font-mono text-lg text-gray-100">{compileResult.durationMs}ms</dd>
                  </div>
                </dl>
                {compileResult.error && <p className="text-xs text-warning">{compileResult.error}</p>}
                <button onClick={handleDownload} className="btn btn-secondary w-full">
                  Download {compileResult.filename?.replace(/^[0-9a-f]{32}-?/, '')}
                </button>
              </div>
            ) : (
              <div className="space-y-2 animate-fade-in">
                <div className="flex items-center gap-2 text-sm">
                  <span className="h-2 w-2 rounded-full bg-danger" />
                  <span className="text-gray-100">Build failed</span>
                </div>
                <p className="text-sm text-gray-400">{compileResult.error}</p>
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow mb-3">scriptc coverage</div>
            {!coverage ? (
              <p className="text-sm text-gray-500">
                See how much of this program compiles statically, and what blocks the rest.
              </p>
            ) : coverage.success ? (
              <div className="space-y-3 animate-fade-in">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-2xl text-gray-100">{coverage.percent}%</span>
                  <span className="text-xs text-gray-500">{coverage.static}/{coverage.statements} statements</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={`h-full rounded-full ${coverage.percent === 100 ? 'bg-success' : 'bg-warning'}`}
                    style={{ width: `${coverage.percent ?? 0}%` }}
                  />
                </div>
                {coverage.blockers?.map((b) => (
                  <div key={b.code + b.message} className="text-xs">
                    <span className="font-mono text-warning">{b.code}</span>
                    <span className="text-gray-400"> ×{b.count} {b.message}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-danger">{coverage.error}</p>
            )}
          </div>

          <div className="mt-auto rounded-lg border border-border p-3 text-xs leading-relaxed text-gray-500">
            Compiled by <a href="https://scriptc.dev" className="text-gray-300 hover:underline">scriptc</a>: ordinary
            TypeScript to a native executable — no Node, no V8, no runtime in the artifact.
          </div>
        </aside>
      </div>

      {/* Share Modal */}
      {showShareModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
          onClick={() => setShowShareModal(false)}
        >
          <div className="surface w-full max-w-md p-5 mx-4 animate-fade-in" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold">Share project</h3>
            <p className="mt-1 text-sm text-gray-500">Anyone with the link opens a copy of this code.</p>
            <div className="mt-4 flex gap-2">
              <input value={shareUrl} readOnly className="input font-mono text-xs" onFocus={(e) => e.target.select()} />
              <button
                onClick={() => {
                  navigator.clipboard.writeText(shareUrl);
                  setCopied(true);
                }}
                className="btn btn-primary"
              >
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <button onClick={() => setShowShareModal(false)} className="btn btn-ghost mt-3 w-full">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}
