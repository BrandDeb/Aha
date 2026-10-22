'use client';

import { useEffect, useRef, useState } from 'react';
import { detectLanguage } from '@/lib/languages';
import { useActions } from '../actions';
import { splitArgs } from '../connector-forms';
import { fetchToolchains, saveToolchainSettings, toolchainCommand, useLanguages, type ToolchainInfo } from '../run-client';
import { type PythonStream } from '../python-client';
import { useWorkspace } from '../store';

interface LogLine {
  stream: PythonStream;
  text: string;
}

const platformKey = (): 'windows' | 'mac' | 'linux' => (/Win/.test(navigator.platform) ? 'windows' : /Mac/.test(navigator.platform) ? 'mac' : 'linux');

/** Run the project in the entry file's language, and see which languages this machine can run */
export function LanguagePanel() {
  const { project } = useWorkspace();
  const actions = useActions();
  const { status, refresh } = useLanguages();
  const language = project.entry ? detectLanguage(project.entry, Object.keys(project.files)) : null;
  const info = language ? status?.languages.find((l) => l.id === language.id) : undefined;

  const [argsText, setArgsText] = useState('');
  const [stdin, setStdin] = useState('');
  const [log, setLog] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const [toolchains, setToolchains] = useState<ToolchainInfo | null>(null);
  const [toolTick, setToolTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchToolchains().then((t) => live && setToolchains(t));
    return () => {
      live = false;
    };
  }, [toolTick]);
  const partial = useRef<Record<PythonStream, string>>({ stdout: '', stderr: '', info: '' });

  const addLines = (stream: PythonStream, lines: string[]) => setLog((prev) => [...prev.slice(-500), ...lines.map((text) => ({ stream, text }))]);
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

  const run = async () => {
    if (running || !project.entry) return;
    setRunning(true);
    setLog([]);
    controller.current = new AbortController();
    const outcome = await actions.runLanguage({ entry: project.entry, args: splitArgs(argsText), stdin: stdin || undefined }, append, controller.current.signal);
    flush();
    controller.current = null;
    setRunning(false);
    const seconds = outcome.ms >= 1000 ? `${(outcome.ms / 1000).toFixed(1)} s` : `${outcome.ms} ms`;
    if (outcome.error && outcome.error !== 'stopped') addLines('stderr', outcome.error.split('\n'));
    else if (outcome.timedOut) addLines('stderr', [`Timed out after ${seconds}.`]);
    else if (outcome.code === 0) addLines('info', [`Done in ${seconds}.`]);
    else if (!outcome.error) addLines('stderr', [`Exited with code ${outcome.code ?? '?'} after ${seconds}.`]);
    if (outcome.skipped.length) addLines('info', [`Not copied back (binary or large): ${outcome.skipped.slice(0, 5).join(', ')}`]);
  };

  /** Install, update or upgrade toolchains, with the progress in the output area */
  const manage = async (body: Parameters<typeof toolchainCommand>[0], label: string) => {
    if (running) return;
    setRunning(true);
    setLog([]);
    addLines('info', [label]);
    controller.current = new AbortController();
    const outcome = await toolchainCommand(body, append, controller.current.signal);
    flush();
    controller.current = null;
    setRunning(false);
    if (outcome.error && outcome.error !== 'stopped') addLines('stderr', outcome.error.split('\n'));
    else if (outcome.code === 0) addLines('info', ['Done.']);
    refresh();
    setToolTick((n) => n + 1);
  };
  const updates = toolchains?.tools?.filter((t) => t.update) ?? [];
  const majors = toolchains?.tools?.filter((t) => t.major) ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="eyebrow">{language ? language.name : 'Languages'}</h3>
          <button className="text-xs text-gray-500 hover:text-gray-100" onClick={refresh}>Check again</button>
        </div>

        {status && !status.enabled && (
          <p className="text-xs leading-relaxed text-gray-400">Running other languages is off on this server: it only runs programs when it listens on your own machine.</p>
        )}

        {status?.enabled && language && (
          <>
            {info?.available ? (
              <p className="text-xs text-gray-400">
                <span className="mr-1.5 text-accent" aria-hidden="true">✓</span>
                {info.version ?? info.tool} {info.managed ? 'installed by the studio, kept up to date.' : 'found on this machine.'}
              </p>
            ) : info?.installable ? (
              <div className="space-y-2 rounded-lg border border-border p-3 text-xs text-gray-300">
                <p>{language.name} isn’t installed yet. The studio can install it for you (about {info.installable.size}) and keep it updated{toolchains?.autoInstall !== false ? '; pressing Run does that too' : ''}.</p>
                <button className="btn btn-primary btn-sm" disabled={running} onClick={() => void manage({ action: 'install', language: language.id }, `Installing ${language.name}…`)}>Install {language.name}</button>
              </div>
            ) : info ? (
              <div className="space-y-1.5 rounded-lg border border-border p-3 text-xs text-gray-300">
                <p><span className="mr-1.5 text-warn" aria-hidden="true">!</span>{language.name} isn’t installed here.</p>
                <p className="font-mono text-[11px] text-gray-400">{language.install[platformKey()]}</p>
              </div>
            ) : (
              <p className="text-xs text-gray-500">Checking…</p>
            )}
            {language.note && <p className="text-xs leading-relaxed text-gray-500">{language.note}</p>}

            <div className="flex gap-2">
              <input
                className="input h-9 min-w-0 flex-1 font-mono text-xs"
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && void run()}
                placeholder="arguments, e.g. Ada --verbose"
                aria-label="Program arguments"
                disabled={running}
              />
              {running ? (
                <button className="btn btn-secondary btn-sm" onClick={() => controller.current?.abort()}>Stop</button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => void run()} disabled={info ? !info.available && !(info.installable && toolchains?.autoInstall !== false) : false}>Run</button>
              )}
            </div>
            <details>
              <summary className="cursor-pointer text-xs text-gray-500 hover:text-gray-300">Standard input</summary>
              <textarea className="input mt-2 min-h-[4rem] resize-y font-mono text-xs" value={stdin} onChange={(e) => setStdin(e.target.value)} placeholder="Text the program reads from stdin" aria-label="Standard input" />
            </details>
          </>
        )}

        {status?.enabled && !language && (
          <p className="text-xs leading-relaxed text-gray-400">
            The entry file ({project.entry || 'none'}) is run by scriptc or uv. Set the entry to a Go, Rust, Java, C, Ruby, PHP… file, or start a project from <strong>New project → Other languages</strong>.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {log.length > 0 ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed" aria-live="polite">
            {log.map((line, i) => (
              <div key={i} className={line.stream === 'stderr' ? 'text-danger' : line.stream === 'info' ? 'text-gray-500' : 'text-gray-200'}>{line.text || ' '}</div>
            ))}
          </pre>
        ) : (
          status?.enabled && (
            <div className="space-y-2">
              <div className="eyebrow">On this machine</div>
              <ul className="divide-y divide-border rounded-xl border border-border text-xs">
                {status.languages.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 px-3 py-1.5">
                    <span className={l.available ? 'text-accent' : 'text-gray-600'} aria-hidden="true">{l.available ? '✓' : '·'}</span>
                    <span className="min-w-0 flex-1 truncate text-gray-200">{l.name}</span>
                    {l.managed && <span className="badge px-1 py-0 text-[10px]" title="Installed and kept up to date by the studio">studio</span>}
                    <span className="max-w-[45%] truncate font-mono text-[11px] text-gray-500" title={l.available ? l.version : l.install[platformKey()]}>{l.available ? (l.version ?? l.tool) : l.installable ? 'installs on first run' : 'not installed'}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-gray-500">Missing toolchains are installed by the studio (with mise) the first time you run that language, into its own folder; anything you installed yourself is used first.</p>

              {toolchains?.enabled && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">Studio toolchains</span>
                    <button className="text-[11px] text-gray-500 hover:text-gray-100" disabled={running || !toolchains.tools?.length} onClick={() => void manage({ action: 'update' }, 'Checking for toolchain updates…')}>Check for updates</button>
                  </div>
                  {toolchains.tools?.length ? (
                    <ul className="space-y-1 text-xs">
                      {toolchains.tools.map((t) => (
                        <li key={t.tool} className="flex items-center gap-2">
                          <span className="min-w-0 flex-1 truncate font-mono text-gray-300">{t.tool} {t.version}</span>
                          {t.update && <span className="text-[11px] text-warn" title="Applied automatically when auto-update is on">→ {t.update}</span>}
                          {t.major && <button className="rounded px-1 text-[11px] text-accent hover:bg-[var(--accent-soft)]" disabled={running} onClick={() => void manage({ action: 'upgrade', tool: t.tool }, `Upgrading ${t.tool} to ${t.major}…`)} title={`A new major version. Your line (${t.requested}) keeps getting patches until you move.`}>{t.major} available</button>}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-gray-500">None yet.</p>
                  )}
                  {(updates.length > 0 || majors.length > 0) && <p className="text-[11px] text-gray-500">{updates.length ? `${updates.length} update${updates.length > 1 ? 's' : ''} within your versions. ` : ''}{majors.length ? 'New major versions are offered, never installed on their own.' : ''}</p>}
                  {toolchains.lastUpdate && <p className="text-[11px] text-gray-500">Last updated {new Date(toolchains.lastUpdate.at).toLocaleString()}: {toolchains.lastUpdate.updated.join(', ')}</p>}
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <input type="checkbox" checked={toolchains.autoUpdate !== false} onChange={(e) => { const autoUpdate = e.target.checked; setToolchains((t) => t && { ...t, autoUpdate }); void saveToolchainSettings({ autoUpdate }); }} />
                    Apply patch and minor updates automatically (checked every 12 hours)
                  </label>
                  <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
                    <input type="checkbox" checked={toolchains.autoInstall !== false} onChange={(e) => { const autoInstall = e.target.checked; setToolchains((t) => t && { ...t, autoInstall }); void saveToolchainSettings({ autoInstall }); }} />
                    Install a missing toolchain when I press Run
                  </label>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
}
