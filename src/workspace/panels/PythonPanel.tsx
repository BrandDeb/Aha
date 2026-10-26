'use client';

import { useMemo, useRef, useState } from 'react';
import { getProvider } from '@/lib/ai-providers';
import { useActions } from '../actions';
import { useAiConfig } from '../ai-config';
import { normalizeName, parseLockVersions, parsePyproject, requirementName } from '../pyproject';
import { isPython } from '../project';
import { setPythonEnv, streamPython, usePythonEnv, usePythonStatus, type PythonCommand, type PythonStream } from '../python-client';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

/** Libraries people reach for first in AI and data work; clicking one fills the add box */
const SUGGESTIONS = ['openai', 'anthropic', 'httpx', 'numpy', 'pandas', 'pydantic', 'rich', 'fastapi'];

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD/i;

interface LogLine {
  stream: PythonStream;
  text: string;
}

/** Dependencies, environment and commands for a uv-managed Python project */
export function PythonPanel() {
  const { project } = useWorkspace();
  const actions = useActions();
  const { notify } = useToast();
  const { status, refresh } = usePythonStatus();
  const env = usePythonEnv();
  const aiConfig = useAiConfig();

  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState<string | null>(null);
  const [spec, setSpec] = useState('');
  const [dev, setDev] = useState(false);
  const [envName, setEnvName] = useState('');
  const [envValue, setEnvValue] = useState('');
  const controller = useRef<AbortController | null>(null);

  const pyprojectText = project.files['pyproject.toml'];
  const pyproject = useMemo(() => (pyprojectText === undefined ? null : parsePyproject(pyprojectText)), [pyprojectText]);
  const resolved = useMemo(() => parseLockVersions(project.files['uv.lock'] ?? ''), [project.files]);
  const pinned = project.files['.python-version']?.trim();
  const entry = isPython(project.entry) ? project.entry : Object.keys(project.files).find(isPython);

  // Output arrives in arbitrary chunks, so hold back the unfinished line until its newline shows up
  const partial = useRef<Record<PythonStream, string>>({ stdout: '', stderr: '', info: '' });
  const addLines = (stream: PythonStream, lines: string[]) => setLog((prev) => [...prev.slice(-400), ...lines.map((text) => ({ stream, text }))]);
  const append = (stream: PythonStream, text: string) => {
    const pieces = (partial.current[stream] + text).split('\n');
    partial.current[stream] = pieces.pop() ?? '';
    if (pieces.length) addLines(stream, pieces.map((line) => line.replace(/\r$/, '')));
  };
  const flush = () => {
    for (const stream of ['stdout', 'stderr', 'info'] as const) {
      if (partial.current[stream]) addLines(stream, [partial.current[stream]]);
      partial.current[stream] = '';
    }
  };

  /** Run a uv command and show its output here */
  const run = async (label: string, command: PythonCommand) => {
    if (running) return;
    setRunning(label);
    setLog([]);
    controller.current = new AbortController();
    const outcome = await actions.python(command, append, controller.current.signal);
    flush();
    controller.current = null;
    setRunning(null);
    // Whole lines, added directly: the stream's own partial-line buffer has already been flushed
    if (outcome.error && outcome.error !== 'stopped') addLines('stderr', [outcome.error]);
    else if (outcome.code === 0) addLines('info', [`Done in ${outcome.ms >= 1000 ? `${(outcome.ms / 1000).toFixed(1)} s` : `${outcome.ms} ms`}.`]);
    else if (!outcome.error) addLines('stderr', [`Exited with code ${outcome.code ?? '?'}.`]);
  };

  const installUv = async () => {
    if (running) return;
    setRunning('install');
    setLog([]);
    const done = await streamPython({ action: 'install-uv' }, append);
    flush();
    setRunning(null);
    if (done.error) addLines('stderr', [done.error]);
    else {
      notify({ kind: 'success', title: `uv ${done.uv ?? ''} installed` });
      refresh();
    }
  };

  const add = () => {
    const packages = spec.split(/[\s,]+/).filter(Boolean);
    if (!packages.length) return;
    void run(`add ${dev ? '--dev ' : ''}${packages.join(' ')}`, { action: 'add', packages, dev }).then(() => setSpec(''));
  };

  const setEnv = (name: string, value: string) => setPythonEnv({ ...env, [name]: value });
  const removeEnv = (name: string) => {
    const next = { ...env };
    delete next[name];
    setPythonEnv(next);
  };

  /** Point programs at the assistant provider the user already set up (one OpenAI-compatible trio) */
  const useAssistantProvider = () => {
    const provider = getProvider(aiConfig.provider);
    if (!provider || provider.kind === 'server') {
      notify({ kind: 'info', title: 'Choose a provider first', detail: 'Pick one in the Assistant panel; its key and model are reused here.' });
      return;
    }
    const base = ((provider.editableUrl && aiConfig.baseUrls[provider.id]) || provider.baseUrl).replace(/\/+$/, '');
    setPythonEnv({
      ...env,
      LLM_BASE_URL: provider.kind === 'anthropic' ? `${base}/v1/` : base,
      LLM_MODEL: aiConfig.models[provider.id] ?? provider.models[0] ?? '',
      ...(aiConfig.keys[provider.id] ? { LLM_API_KEY: aiConfig.keys[provider.id] } : {}),
    });
    notify({ kind: 'success', title: `Programs will use ${provider.name}`, detail: 'Set as LLM_BASE_URL, LLM_MODEL and LLM_API_KEY.' });
  };

  const depRow = (requirement: string, group: 'dependencies' | 'dev') => {
    const name = requirementName(requirement);
    const version = resolved[normalizeName(name)];
    return (
      <li key={`${group}:${requirement}`} className="flex items-center gap-2 py-1.5">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-100" title={requirement}>{requirement}</span>
        {version && <span className="shrink-0 font-mono text-[11px] text-gray-500" title="Version in uv.lock">{version}</span>}
        <button
          onClick={() => void run(`remove ${group === 'dev' ? '--dev ' : ''}${name}`, { action: 'remove', packages: [name], dev: group === 'dev' })}
          disabled={!!running}
          className="shrink-0 text-xs text-gray-500 hover:text-danger disabled:opacity-40"
          aria-label={`Remove ${name}`}
        >✕</button>
      </li>
    );
  };

  const header = (
    <div className="flex items-center justify-between">
      <h3 className="eyebrow">Python</h3>
      {status?.uv ? (
        <span className="font-mono text-[11px] text-gray-500" title={`uv from ${status.uv.source}`}>uv {status.uv.version}</span>
      ) : (
        <button onClick={refresh} className="text-xs text-gray-400 hover:text-gray-100">Re-check</button>
      )}
    </div>
  );

  if (status && !status.enabled) {
    return (
      <div className="space-y-3 p-4">
        {header}
        <p className="text-sm text-gray-400">Python is turned off on this server (<code className="font-mono">AHA_PYTHON=0</code>). Remove that setting and restart to use uv here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4">
      {header}

      {status && !status.uv && (
        <section className="surface space-y-3 p-3.5" aria-label="Install uv">
          <p className="text-sm text-gray-100">uv isn’t installed on this machine.</p>
          <p className="text-xs leading-relaxed text-gray-400">
            uv is a fast Python package and project manager. The studio can download the official release into its own folder (checksum verified), or you can install it yourself:
          </p>
          <pre className="overflow-x-auto rounded-lg bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed text-gray-300">{`winget install --id=astral-sh.uv -e\n# macOS / Linux\ncurl -LsSf https://astral.sh/uv/install.sh | sh`}</pre>
          <button onClick={() => void installUv()} disabled={!!running} className="btn btn-primary btn-sm">{running === 'install' ? 'Downloading…' : 'Download uv'}</button>
        </section>
      )}

      {status?.uv && (
        <>
          <section aria-label="Project" className="space-y-2.5">
            {pyproject ? (
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate font-mono text-sm text-gray-100">{pyproject.name ?? 'project'}</span>
                <span className="shrink-0 font-mono text-[11px] text-gray-500">
                  {pyproject.version ? `v${pyproject.version}` : ''}{pyproject.requiresPython ? ` · python ${pyproject.requiresPython}` : ''}
                </span>
              </div>
            ) : (
              <div className="surface space-y-2 p-3">
                <p className="text-sm text-gray-300">No <code className="font-mono">pyproject.toml</code> yet.</p>
                <p className="text-xs text-gray-500">Adding a package creates one. Scripts with inline <code className="font-mono">{'/// script'}</code> dependencies run without it.</p>
                <button onClick={() => void run('init', { action: 'init' })} disabled={!!running} className="btn btn-secondary btn-sm">Create pyproject.toml</button>
              </div>
            )}

            {status.pythons.length > 0 && (
              <label className="flex items-center justify-between gap-2 text-xs text-gray-400">
                <span>Python {pinned ? <span className="font-mono text-gray-300">pinned {pinned}</span> : 'version'}</span>
                <select
                  value={pinned && status.pythons.some((v) => v.startsWith(pinned)) ? status.pythons.find((v) => v.startsWith(pinned)) : ''}
                  onChange={(e) => e.target.value && void run(`python pin ${e.target.value.split('.').slice(0, 2).join('.')}`, { action: 'pin', version: e.target.value.split('.').slice(0, 2).join('.') })}
                  disabled={!!running}
                  className="input h-7 w-32 font-mono text-xs"
                  aria-label="Pin a Python version"
                >
                  <option value="">Choose…</option>
                  {status.pythons.map((version) => <option key={version} value={version}>{version}</option>)}
                </select>
              </label>
            )}
          </section>

          <section aria-label="Dependencies">
            <h4 className="eyebrow mb-1.5">Dependencies</h4>
            {pyproject && pyproject.dependencies.length + pyproject.devDependencies.length > 0 ? (
              <ul className="divide-y divide-border">
                {pyproject.dependencies.map((r) => depRow(r, 'dependencies'))}
                {pyproject.devDependencies.map((r) => depRow(r, 'dev'))}
              </ul>
            ) : (
              <p className="text-xs text-gray-500">None yet.</p>
            )}

            <form
              className="mt-3 space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <div className="flex gap-2">
                <input
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  placeholder="httpx  rich>=13"
                  aria-label="Packages to add"
                  spellCheck={false}
                  className="input h-8 font-mono text-xs"
                />
                <button type="submit" disabled={!spec.trim() || !!running} className="btn btn-primary btn-sm shrink-0">Add</button>
              </div>
              <label className="flex items-center gap-2 text-xs text-gray-400">
                <input type="checkbox" checked={dev} onChange={(e) => setDev(e.target.checked)} className="accent-[var(--color-accent)]" />
                Development dependency
              </label>
              <div className="flex flex-wrap gap-1.5" aria-label="Suggestions">
                {SUGGESTIONS.map((name) => (
                  <button key={name} type="button" onClick={() => setSpec((v) => (v.split(/\s+/).includes(name) ? v : `${v.trim()} ${name}`.trim()))} className="badge hover:text-gray-100">{name}</button>
                ))}
              </div>
            </form>
          </section>

          <section aria-label="Commands" className="flex flex-wrap gap-1.5">
            <button onClick={() => void run('sync', { action: 'sync' })} disabled={!!running || !pyproject} className="btn btn-secondary btn-sm">Sync</button>
            <button onClick={() => void run('lock', { action: 'lock' })} disabled={!!running || !pyproject} className="btn btn-secondary btn-sm">Lock</button>
            <button onClick={() => void run('lock --upgrade', { action: 'lock', upgrade: true })} disabled={!!running || !pyproject} className="btn btn-secondary btn-sm" title="Re-resolve to the newest allowed versions">Upgrade</button>
            <button onClick={() => void run('tree', { action: 'tree' })} disabled={!!running || !pyproject} className="btn btn-secondary btn-sm">Tree</button>
            {entry && (
              <button onClick={() => void run(`run ${entry}`, { action: 'run', entry })} disabled={!!running} className="btn btn-primary btn-sm">Run {entry.split('/').pop()}</button>
            )}
          </section>

          <section aria-label="Environment variables">
            <div className="mb-1.5 flex items-center justify-between">
              <h4 className="eyebrow">Environment</h4>
              <button onClick={useAssistantProvider} className="text-xs text-gray-400 hover:text-gray-100" title="Set LLM_BASE_URL, LLM_MODEL and LLM_API_KEY from the Assistant's provider">Use assistant provider</button>
            </div>
            {Object.entries(env).map(([name, value]) => (
              <div key={name} className="flex items-center gap-2 py-1">
                <span className="w-28 shrink-0 truncate font-mono text-xs text-gray-100" title={name}>{name}</span>
                <input
                  type={SECRET_NAME.test(name) ? 'password' : 'text'}
                  value={value}
                  onChange={(e) => setEnv(name, e.target.value)}
                  aria-label={`Value of ${name}`}
                  autoComplete="off"
                  spellCheck={false}
                  className="input h-7 font-mono text-xs"
                />
                <button onClick={() => removeEnv(name)} className="shrink-0 text-xs text-gray-500 hover:text-danger" aria-label={`Remove ${name}`}>✕</button>
              </div>
            ))}
            <form
              className="mt-1.5 flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const name = envName.trim();
                if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
                  notify({ kind: 'error', title: 'Use letters, digits and underscores for the name' });
                  return;
                }
                setEnv(name, envValue);
                setEnvName('');
                setEnvValue('');
              }}
            >
              <input value={envName} onChange={(e) => setEnvName(e.target.value)} placeholder="NAME" aria-label="New variable name" spellCheck={false} className="input h-7 w-28 shrink-0 font-mono text-xs" />
              <input value={envValue} onChange={(e) => setEnvValue(e.target.value)} placeholder="value" aria-label="New variable value" autoComplete="off" spellCheck={false} className="input h-7 font-mono text-xs" />
              <button type="submit" disabled={!envName.trim()} className="btn btn-secondary btn-sm h-7 shrink-0">Set</button>
            </form>
            <p className="mt-1.5 text-[11px] leading-relaxed text-gray-500">Passed to your programs when they run. Kept in this browser; the server only holds them while a command runs.</p>
          </section>
        </>
      )}

      {(log.length > 0 || running) && (
        <section aria-label="Output">
          <div className="mb-1.5 flex items-center justify-between">
            <h4 className="eyebrow">Output</h4>
            {running ? (
              <button onClick={() => controller.current?.abort()} className="text-xs text-gray-400 hover:text-gray-100">Stop</button>
            ) : (
              <button onClick={() => setLog([])} className="text-xs text-gray-500 hover:text-gray-100">Clear</button>
            )}
          </div>
          <pre role="log" aria-live="polite" className="max-h-64 overflow-auto rounded-lg border border-border bg-black/30 p-2.5 font-mono text-[11px] leading-relaxed">
            {log.map((line, i) => (
              <div key={i} className={`whitespace-pre-wrap break-words ${line.stream === 'info' ? 'text-gray-500' : 'text-gray-200'}`}>{line.text || ' '}</div>
            ))}
            {running && <div className="text-gray-500">…</div>}
          </pre>
        </section>
      )}
    </div>
  );
}
