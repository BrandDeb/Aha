'use client';

import { useState } from 'react';
import { WATCHER_PRESETS, describeTrigger, validate, type Watcher, type WatcherTrigger } from '@/lib/watchers';
import { ago, useProposals } from '../proposals';
import type { WatchersHandle } from '../watchers';

type Draft = Omit<Watcher, 'id' | 'enabled'> & { id?: string };

const EMPTY: Draft = { name: '', task: '', trigger: { kind: 'schedule', cron: '0 8 * * 1-5' }, mode: 'suggest', perDay: 4 };

const TRIGGERS: { kind: WatcherTrigger['kind']; label: string; make: () => WatcherTrigger }[] = [
  { kind: 'schedule', label: 'On a schedule', make: () => ({ kind: 'schedule', cron: '0 8 * * 1-5' }) },
  { kind: 'interval', label: 'Every…', make: () => ({ kind: 'interval', minutes: 60 }) },
  { kind: 'change', label: 'When files change', make: () => ({ kind: 'change', glob: 'src/**' }) },
  { kind: 'failure', label: 'When it fails', make: () => ({ kind: 'failure' }) },
];

const ACTION_TONE = { started: 'text-accent', suggested: 'text-gray-300', skipped: 'text-gray-500' } as const;
const ACTION_LABEL = { started: 'started', suggested: 'suggested', skipped: 'held back' } as const;

/** Watchers: agents that wake on a schedule, on changes or on failures, and know when not to act */
export function WatchersPanel({ watchers: handle }: { watchers: WatchersHandle }) {
  const { open } = useProposals();
  const { watchers, runs } = handle;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');

  const edit = (d: Draft) => {
    setDraft(d);
    setError('');
  };
  const save = () => {
    if (!draft) return;
    const w: Watcher = { ...draft, id: draft.id ?? `w${Date.now().toString(36)}`, enabled: watchers.find((x) => x.id === draft.id)?.enabled ?? true };
    const problem = validate(w);
    if (problem) return setError(problem);
    handle.upsert(w);
    setDraft(null);
  };
  const t = draft?.trigger;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <h3 className="eyebrow">Watchers</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          Agents that wake on their own: on a schedule, when files change, or when something fails. Each one either suggests its task or starts it as a background proposal you review. One event runs once, a fixed failure is skipped, and every time one holds back it says why below.
        </p>
        <p className="text-[11px] text-gray-500">Saved in <code className="font-mono">.nanocli/watchers.json</code>, so they travel with the project. They run while the studio is open.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!draft && (
          <section className="border-b border-border p-4">
            {watchers.length === 0 ? (
              <p className="mb-3 text-sm text-gray-400">No watchers yet. Start from one of these:</p>
            ) : (
              <ul className="mb-3 space-y-2" aria-label="Your watchers">
                {watchers.map((w) => {
                  const last = runs.find((r) => r.watcherId === w.id);
                  return (
                    <li key={w.id} className="rounded-lg border border-border p-2.5">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm ${w.enabled ? 'text-gray-100' : 'text-gray-500'}`}>{w.name}</span>
                        <span className="rounded bg-white/[0.06] px-1 text-[10px] text-gray-400" title={w.mode === 'act' ? 'Starts a background proposal' : 'Tells you; you start it'}>{w.mode === 'act' ? 'acts' : 'suggests'}</span>
                        <label className="ml-auto flex items-center gap-1 text-[11px] text-gray-400">
                          <input type="checkbox" checked={w.enabled} onChange={(e) => handle.toggle(w.id, { enabled: e.target.checked })} aria-label={`${w.name} on`} />
                          on
                        </label>
                      </div>
                      <div className="mt-0.5 text-[11px] text-gray-500">{describeTrigger(w.trigger)} · up to {w.perDay} a day</div>
                      {last && <div className="mt-0.5 truncate text-[11px] text-gray-500" title={last.reason}>Last: {ACTION_LABEL[last.action]} {ago(last.at)}{last.action === 'skipped' ? `: ${last.reason}` : ''}</div>}
                      <div className="mt-1.5 flex gap-1">
                        <button onClick={() => handle.runNow(w)} className="btn btn-secondary btn-sm h-6">Run now</button>
                        <button onClick={() => edit({ ...w })} className="btn btn-ghost btn-sm h-6">Edit</button>
                        <button onClick={() => handle.remove(w.id)} className="btn btn-ghost btn-sm h-6 text-gray-500 hover:text-danger" aria-label={`Delete ${w.name}`}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="grid gap-1.5">
              {WATCHER_PRESETS.filter((p) => !watchers.some((w) => w.name === p.name)).map((p) => (
                <button key={p.name} onClick={() => edit({ name: p.name, task: p.task, trigger: p.trigger, mode: p.mode, perDay: p.perDay })} className="rounded-lg border border-dashed border-border px-2.5 py-2 text-left hover:border-border-strong hover:bg-white/[0.03]">
                  <div className="text-sm text-gray-200">＋ {p.name}</div>
                  <div className="text-[11px] text-gray-500">{p.blurb}</div>
                </button>
              ))}
              <button onClick={() => edit({ ...EMPTY })} className="btn btn-ghost btn-sm justify-start">＋ Your own</button>
            </div>
          </section>
        )}

        {draft && t && (
          <form
            className="space-y-3 border-b border-border p-4"
            aria-label="Watcher"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <label className="block space-y-1">
              <span className="text-xs text-gray-300">Name</span>
              <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className="input h-8 w-full text-sm" />
            </label>
            <label className="block space-y-1">
              <span className="text-xs text-gray-300">What it does</span>
              <textarea value={draft.task} onChange={(e) => setDraft({ ...draft, task: e.target.value })} rows={3} className="input w-full resize-none text-sm" placeholder="e.g. Check for outdated dependencies and update the safe ones" />
            </label>
            <div className="space-y-1.5">
              <span className="text-xs text-gray-300">When</span>
              <div className="grid grid-cols-2 gap-1" role="radiogroup" aria-label="Trigger">
                {TRIGGERS.map((k) => (
                  <button type="button" key={k.kind} role="radio" aria-checked={t.kind === k.kind} onClick={() => t.kind !== k.kind && setDraft({ ...draft, trigger: k.make() })} className={`h-7 rounded-md border text-xs ${t.kind === k.kind ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-accent' : 'border-border text-gray-400 hover:text-gray-100'}`}>
                    {k.label}
                  </button>
                ))}
              </div>
              {t.kind === 'schedule' && (
                <label className="block space-y-1">
                  <input value={t.cron} onChange={(e) => setDraft({ ...draft, trigger: { kind: 'schedule', cron: e.target.value } })} className="input h-8 w-full font-mono text-xs" aria-label="Schedule (cron)" />
                  <span className="block text-[11px] text-gray-500">minute hour day month weekday, your local time. {!validate({ ...draft, id: 'x', enabled: true }) && `= ${describeTrigger(t)}`}</span>
                </label>
              )}
              {t.kind === 'interval' && (
                <select value={t.minutes} onChange={(e) => setDraft({ ...draft, trigger: { kind: 'interval', minutes: Number(e.target.value) } })} className="input h-8 w-full text-xs" aria-label="How often">
                  {[15, 30, 60, 120, 240, 480].map((m) => <option key={m} value={m}>{describeTrigger({ kind: 'interval', minutes: m })}</option>)}
                </select>
              )}
              {t.kind === 'change' && (
                <label className="block space-y-1">
                  <input value={t.glob} onChange={(e) => setDraft({ ...draft, trigger: { kind: 'change', glob: e.target.value } })} className="input h-8 w-full font-mono text-xs" aria-label="Files" />
                  <span className="block text-[11px] text-gray-500">* within a folder, ** across folders, {'{ts,tsx}'} for either. Checked every 30 seconds.</span>
                </label>
              )}
              {t.kind === 'failure' && <p className="text-[11px] text-gray-500">When a run or test fails. Skipped if the failure is already fixed by the time it checks.</p>}
            </div>
            <div className="flex gap-2">
              <label className="flex flex-1 items-center justify-between gap-2 text-xs text-gray-400">
                Then
                <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as Watcher['mode'] })} className="input h-7 w-auto text-xs">
                  <option value="suggest">Suggest it</option>
                  <option value="act">Start it</option>
                </select>
              </label>
              <label className="flex flex-1 items-center justify-between gap-2 text-xs text-gray-400" title="Runs it may start in a day">
                A day, at most
                <select value={draft.perDay} onChange={(e) => setDraft({ ...draft, perDay: Number(e.target.value) })} className="input h-7 w-auto text-xs">
                  {[1, 2, 4, 6, 12, 24].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
            {error && <p role="alert" className="text-xs text-danger">{error}</p>}
            <div className="flex gap-2">
              <button type="submit" className="btn btn-primary btn-sm">Save watcher</button>
              <button type="button" onClick={() => setDraft(null)} className="btn btn-ghost btn-sm">Cancel</button>
            </div>
          </form>
        )}

        <section className="p-4">
          <h3 className="eyebrow mb-2">What they did</h3>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500">Nothing yet. Every run, suggestion and decision to hold back shows here.</p>
          ) : (
            <ol className="space-y-1" aria-label="Watcher log">
              {runs.slice(0, 40).map((r) => {
                const w = watchers.find((x) => x.id === r.watcherId);
                return (
                  <li key={`${r.key}:${r.at}`} className="flex items-start gap-2 text-xs">
                    <span className={`w-16 shrink-0 ${ACTION_TONE[r.action]}`}>{ACTION_LABEL[r.action]}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-gray-200">{w?.name ?? 'Removed watcher'} · {r.event}</div>
                      {r.action === 'skipped' && <div className="text-[11px] text-gray-500">{r.reason}{r.count && r.count > 1 ? ` (×${r.count})` : ''}</div>}
                    </div>
                    <span className="shrink-0 text-[11px] text-gray-500">{ago(r.at)}</span>
                    {r.proposalId && <button onClick={() => open(r.proposalId!)} className="shrink-0 text-[11px] text-accent hover:underline">open</button>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}
