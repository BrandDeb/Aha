'use client';

import { useMemo, useState } from 'react';
import { AUDIENCE_LABEL } from '@/lib/kit-library';
import { checkPassed, describeConnector, draftKit, exportBundle, KIT_FILE, kitConnector, kitError, kitOf, readiness, type Kit, type KitCheck } from '@/lib/kits';
import { useActions } from '../actions';
import { newConnectorId, upsertConnector, useConnectors } from '../connectors-config';
import { downloadText, useStepsDone } from '../kits-client';
import { useProposals } from '../proposals';
import { setPythonEnv, usePythonEnv } from '../python-client';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

type CheckState = { status: 'running' | 'pass' | 'fail'; output: string };

/** The Kit tab: a field kit's readiness, checks, playbook and export */
export function KitPanel({ onFocus }: { onFocus: (focus: string) => void }) {
  const { project, dispatch } = useWorkspace();
  const kit = useMemo(() => kitOf(project.files), [project.files]);
  const error = useMemo(() => kitError(project.files), [project.files]);

  if (!kit) {
    return (
      <div className="space-y-3 p-4">
        <h3 className="eyebrow">Field kit</h3>
        {error ? (
          <>
            <p className="text-sm text-danger">{KIT_FILE} has a problem: {error}</p>
            <button onClick={() => dispatch({ type: 'open', path: KIT_FILE })} className="btn btn-secondary btn-sm">Open {KIT_FILE}</button>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-gray-400">
              A kit packages this project with what usually lives in someone’s head: the playbook for an engagement, the variables and connectors it needs, the checks that prove it works, and house rules for the agent. Share it as one file with your team, a customer, or your developers.
            </p>
            <button
              onClick={() => {
                dispatch({ type: 'put', files: { [KIT_FILE]: JSON.stringify(draftKit(project.name, project.entry || undefined), null, 2) + '\n' } });
                dispatch({ type: 'open', path: KIT_FILE });
              }}
              className="btn btn-primary btn-sm w-full"
            >
              Make this project a kit
            </button>
            <p className="text-[11px] text-gray-500">Or start from a ready-made kit: New project → Field kits.</p>
          </>
        )}
      </div>
    );
  }
  return <KitView key={kit.id} kit={kit} onFocus={onFocus} />;
}

function KitView({ kit, onFocus }: { kit: Kit; onFocus: (focus: string) => void }) {
  const { project, dispatch } = useWorkspace();
  const { notify } = useToast();
  const actions = useActions();
  const proposals = useProposals();
  const env = usePythonEnv();
  const connectors = useConnectors();
  const [done, toggle] = useStepsDone(kit.id);
  const [checks, setChecks] = useState<Record<number, CheckState>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const items = readiness(kit, project.files, env, connectors.map((c) => c.name));
  const missing = items.filter((i) => !i.ok).length;

  const runCheck = async (check: KitCheck, index: number) => {
    const entry = check.entry ?? kit.entry!;
    let output = '';
    const onOutput = (_: unknown, text: string) => {
      output += text;
    };
    setChecks((prev) => ({ ...prev, [index]: { status: 'running', output: '' } }));
    const outcome = entry.endsWith('.py') ? await actions.python({ action: 'run', entry, args: check.args }, onOutput) : await actions.runLanguage({ entry, args: check.args }, onOutput);
    if (outcome.error) output += `\n${outcome.error}`;
    setChecks((prev) => ({ ...prev, [index]: { status: checkPassed(check, outcome.ok, output) ? 'pass' : 'fail', output } }));
  };
  const runAll = async () => {
    for (let i = 0; i < kit.checks.length; i++) await runCheck(kit.checks[i], i);
  };

  const saveEnv = (name: string) => {
    const value = editing[name];
    if (value === undefined) return;
    const next = { ...env };
    if (value.trim()) next[name] = value.trim();
    else delete next[name];
    setPythonEnv(next);
    setEditing(({ [name]: _, ...rest }) => rest);
  };

  const addConnector = (index: number) => {
    const c = kit.connectors[index];
    const connector = kitConnector(c, env, newConnectorId());
    if ('error' in connector) return notify({ kind: 'error', title: `Can’t add ${c.name} yet`, detail: connector.error });
    upsertConnector(connector);
    notify({ kind: 'success', title: `Added ${c.name}`, detail: 'The agent asks you before each call it makes through it.' });
  };

  const exportKit = () => {
    const { bundle, left } = exportBundle(kit, project.files);
    downloadText(`${kit.id}-${kit.version}.nanokit.json`, JSON.stringify(bundle, null, 2));
    notify(
      left.length
        ? { kind: 'info', title: `Exported ${kit.name}, without ${left.length} file${left.length > 1 ? 's' : ''}`, detail: left.map((l) => `${l.path} (${l.reason})`).join(', ') }
        : { kind: 'success', title: `Exported ${kit.name}`, detail: 'No secrets were found; environment values are never included.' }
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="eyebrow">Field kit</h3>
          <span className="badge px-1.5 py-0 text-[10px]">{AUDIENCE_LABEL[kit.audience]}</span>
        </div>
        <div>
          <div className="text-sm font-medium text-gray-100">{kit.name}</div>
          <div className="font-mono text-[11px] text-gray-500">v{kit.version} · {kit.publisher}</div>
        </div>
        <p className="text-xs leading-relaxed text-gray-400">{kit.summary}</p>
        <p role="status" className={`text-xs ${missing ? 'text-warn' : 'text-accent'}`}>{missing ? `${missing} thing${missing > 1 ? 's' : ''} to set up` : 'Ready'}</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length > 0 && (
          <section className="space-y-2 border-b border-border p-4" aria-label="Setup">
            <h3 className="eyebrow">Setup</h3>
            <ul className="space-y-2">
              {kit.env.map((e) => {
                const value = editing[e.name] ?? env[e.name] ?? '';
                return (
                  <li key={e.name} className="space-y-1">
                    <label className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono text-gray-200">{env[e.name] ? '✓' : e.required ? '○' : '·'} {e.name}</span>
                      <span className="truncate text-[11px] text-gray-500">{e.required ? 'required' : 'optional'}{e.secret ? ' · secret' : ''}</span>
                    </label>
                    <input
                      type={e.secret ? 'password' : 'text'}
                      value={value}
                      placeholder={e.example ?? ''}
                      onChange={(ev) => setEditing((prev) => ({ ...prev, [e.name]: ev.target.value }))}
                      onBlur={() => saveEnv(e.name)}
                      onKeyDown={(ev) => ev.key === 'Enter' && saveEnv(e.name)}
                      aria-label={e.name}
                      autoComplete="off"
                      spellCheck={false}
                      className="input h-8 font-mono text-xs"
                    />
                    <p className="text-[11px] text-gray-500">{e.description}</p>
                  </li>
                );
              })}
              {kit.connectors.map((c, i) => {
                const have = connectors.some((x) => x.name.toLowerCase() === c.name.toLowerCase());
                return (
                  <li key={c.name} className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-gray-200">{have ? '✓' : '○'} Connector: {c.name}</div>
                      <div className="text-[11px] text-gray-500">{c.description}</div>
                      <div className="truncate font-mono text-[10px] text-gray-500" title={describeConnector(c)}>{describeConnector(c)}</div>
                    </div>
                    {!have && <button onClick={() => addConnector(i)} className="btn btn-secondary btn-sm h-6 shrink-0">Add</button>}
                  </li>
                );
              })}
            </ul>
            <p className="text-[11px] text-gray-500">Values stay in this browser and reach only the programs you run here. They are never part of an exported kit.</p>
          </section>
        )}

        {kit.checks.length > 0 && (
          <section className="space-y-2 border-b border-border p-4" aria-label="Checks">
            <div className="flex items-center justify-between">
              <h3 className="eyebrow">Checks</h3>
              <button onClick={() => void runAll()} disabled={Object.values(checks).some((c) => c.status === 'running')} className="btn btn-primary btn-sm h-6">Run checks</button>
            </div>
            <ul className="space-y-1.5">
              {kit.checks.map((c, i) => {
                const state = checks[i];
                return (
                  <li key={c.label}>
                    <div className="flex items-center gap-2 text-xs">
                      <span className={state?.status === 'pass' ? 'text-accent' : state?.status === 'fail' ? 'text-danger' : 'text-gray-500'} aria-hidden="true">
                        {state?.status === 'pass' ? '✓' : state?.status === 'fail' ? '✕' : state?.status === 'running' ? '…' : '○'}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-gray-200">{c.label}</span>
                      <span className="sr-only">{state?.status ?? 'not run'}</span>
                    </div>
                    {state?.status === 'fail' && <pre className="mt-1 max-h-28 overflow-auto rounded bg-black/30 p-2 font-mono text-[10px] text-gray-400">{state.output.trim().slice(-1200) || 'No output'}</pre>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        <section className="space-y-2 border-b border-border p-4" aria-label="Playbook">
          <div className="flex items-center justify-between">
            <h3 className="eyebrow">Playbook</h3>
            <span className="font-mono text-[11px] text-gray-500">{done.size}/{kit.steps.length}</span>
          </div>
          <ol className="space-y-2">
            {kit.steps.map((s, i) => (
              <li key={s.title} className="flex gap-2">
                <input type="checkbox" checked={done.has(i)} onChange={() => toggle(i)} aria-label={`Done: ${s.title}`} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <div className={`text-sm ${done.has(i) ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{i + 1}. {s.title}</div>
                  <p className="text-xs leading-relaxed text-gray-400">{s.detail}</p>
                  {s.agent && (
                    <button
                      onClick={() => {
                        if (proposals.ask(s.agent!, { label: `Kit · ${s.title}` }) === null) actions.openPanel('agent');
                      }}
                      className="mt-1 text-xs text-accent underline decoration-dotted underline-offset-2 hover:text-gray-100"
                      title={s.agent}
                    >
                      ✦ Hand to the agent
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ol>
          {kit.focus && (
            <button onClick={() => { onFocus(kit.focus!); actions.openPanel('worker'); }} className="btn btn-ghost btn-sm w-full" title={kit.focus}>
              Point the worker at this kit’s goal
            </button>
          )}
        </section>

        <section className="space-y-2 p-4">
          <button onClick={exportKit} className="btn btn-secondary btn-sm w-full">Export kit (.nanokit.json)</button>
          <button onClick={() => dispatch({ type: 'open', path: KIT_FILE })} className="btn btn-ghost btn-sm w-full">Edit the kit</button>
        </section>
      </div>
    </div>
  );
}
