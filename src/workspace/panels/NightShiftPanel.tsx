'use client';

import { useState } from 'react';
import { parseTasks, startTime, usedTokens, type NightTaskStatus } from '@/lib/nightshift';
import { useProposals } from '../proposals';
import type { NightShiftHandle } from '../nightshift';

const STATUS: Record<NightTaskStatus, { label: string; tone: string }> = {
  queued: { label: 'queued', tone: 'text-gray-500' },
  running: { label: 'running', tone: 'text-accent' },
  done: { label: 'done', tone: 'text-accent' },
  stopped: { label: 'stopped', tone: 'text-warn' },
  skipped: { label: 'skipped', tone: 'text-gray-500' },
  failed: { label: 'failed', tone: 'text-danger' },
};

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** Queue tasks before you leave; they run one by one inside a budget, and the morning report has the results */
export function NightShiftPanel({ handle }: { handle: NightShiftHandle }) {
  const { night, plan, arm, cancel, reset } = handle;
  const { open } = useProposals();
  const [draft, setDraft] = useState('');
  const armed = night.armedAt !== null;
  const starts = startTime(night);
  const running = night.tasks.some((t) => t.status === 'running');
  const b = night.budget;

  const add = () => {
    const texts = parseTasks(draft);
    if (!texts.length) return;
    plan({ tasks: [...night.tasks, ...texts.map((text) => ({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text, status: 'queued' as const }))].slice(0, 20) });
    setDraft('');
  };
  const number = (key: keyof typeof b, value: string, scale = 1) => {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) plan({ budget: { ...b, [key]: Math.round(n * scale) } });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <h3 className="eyebrow">Night shift</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          Queue tasks before you leave. They run one after another as background proposals, each inside its own time and token budget and all inside the night’s. In the morning the report lists what each one did, ready to review. Nothing is accepted without you.
        </p>
        <p className="text-[11px] text-gray-500">Runs while the studio is open (leave the tab or the desktop app running).</p>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <section aria-label="Tasks">
          <h4 className="mb-1.5 text-xs text-gray-300">Tasks</h4>
          {night.tasks.length === 0 && <p className="mb-2 text-xs text-gray-500">None yet.</p>}
          <ol className="mb-2 space-y-1.5">
            {night.tasks.map((t, i) => (
              <li key={t.id} className="rounded-lg border border-border p-2">
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[11px] text-gray-600">{i + 1}.</span>
                  <span className="min-w-0 flex-1 text-sm text-gray-200">{t.text}</span>
                  <span className={`shrink-0 text-[11px] ${STATUS[t.status].tone}`}>{STATUS[t.status].label}</span>
                  {!armed && (
                    <button onClick={() => plan({ tasks: night.tasks.filter((x) => x.id !== t.id) })} className="text-gray-600 hover:text-danger" aria-label={`Remove ${t.text}`}>×</button>
                  )}
                </div>
                {(t.reason || t.tokens || t.proposalId) && (
                  <div className="mt-1 flex items-center gap-2 pl-4 text-[11px] text-gray-500">
                    <span className="min-w-0 flex-1 truncate">{[t.reason, t.tokens ? `${Math.round(t.tokens / 1000)}k tokens` : ''].filter(Boolean).join(' · ')}</span>
                    {t.proposalId && <button onClick={() => open(t.proposalId!)} className="shrink-0 text-accent hover:underline">Open proposal</button>}
                  </div>
                )}
              </li>
            ))}
          </ol>
          {!armed && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
              className="space-y-1.5"
            >
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    add();
                  }
                }}
                rows={3}
                placeholder={'One task per line, e.g.\nAdd tests for src/utils.ts\nUpgrade the dependencies and fix what breaks'}
                aria-label="New tasks"
                className="input w-full resize-y text-sm"
              />
              <button type="submit" disabled={!parseTasks(draft).length} className="btn btn-secondary btn-sm">Add to the queue</button>
            </form>
          )}
        </section>

        {!armed && (
          <section className="space-y-2" aria-label="When and how much">
            <h4 className="text-xs text-gray-300">When and how much</h4>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={night.startAt === 'now'} onChange={() => plan({ startAt: 'now' })} /> Now
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={night.startAt !== 'now'} onChange={() => plan({ startAt: '22:00' })} /> At
              </label>
              <input type="time" value={night.startAt === 'now' ? '22:00' : night.startAt} onChange={(e) => plan({ startAt: e.target.value })} disabled={night.startAt === 'now'} aria-label="Start time" className="input h-7 w-28 text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
              <label className="space-y-0.5">
                <span>Each task, minutes</span>
                <input type="number" min={1} value={b.perTaskMinutes} onChange={(e) => number('perTaskMinutes', e.target.value)} className="input h-7 w-full text-xs" />
              </label>
              <label className="space-y-0.5">
                <span>Each task, thousand tokens</span>
                <input type="number" min={1} value={Math.round(b.perTaskTokens / 1000)} onChange={(e) => number('perTaskTokens', e.target.value, 1000)} className="input h-7 w-full text-xs" />
              </label>
              <label className="space-y-0.5">
                <span>The whole night, hours</span>
                <input type="number" min={1} value={b.totalHours} onChange={(e) => number('totalHours', e.target.value)} className="input h-7 w-full text-xs" />
              </label>
              <label className="space-y-0.5">
                <span>The whole night, thousand tokens</span>
                <input type="number" min={1} value={Math.round(b.totalTokens / 1000)} onChange={(e) => number('totalTokens', e.target.value, 1000)} className="input h-7 w-full text-xs" />
              </label>
            </div>
            <button onClick={arm} disabled={!night.tasks.some((t) => t.status === 'queued')} className="btn btn-primary btn-sm w-full">
              {night.startAt === 'now' ? 'Start the night shift now' : `Start at ${night.startAt}`}
            </button>
          </section>
        )}

        {armed && (
          <section className="space-y-2 rounded-lg border border-border p-3" aria-label="Night status">
            <p className="text-sm text-gray-200" aria-live="polite">
              {night.finishedAt
                ? `Finished at ${clock(night.finishedAt)}${night.ended ? `: ${night.ended}` : ''}.`
                : starts && !night.startedAt
                  ? `Starts at ${clock(starts)}.`
                  : running
                    ? 'Working through the queue…'
                    : 'Starting…'}
            </p>
            <p className="text-[11px] text-gray-500">{Math.round(usedTokens(night) / 1000)}k of {Math.round(b.totalTokens / 1000)}k tokens used · up to {b.totalHours} h</p>
            {night.finishedAt ? (
              <button onClick={reset} className="btn btn-secondary btn-sm">Plan another night</button>
            ) : (
              <button onClick={cancel} className="btn btn-ghost btn-sm text-gray-400 hover:text-danger">Stop the night shift</button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
