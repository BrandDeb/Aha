'use client';

/**
 * Fork the future, compared: every version of a forked proposal side by side. A web app that can run in the
 * browser runs live in each column (and what you have now in the first), rebuilt as each fork works; anything
 * else shows what each version changed and how it went. Pick one to review, ship or keep going from it.
 */

import { useMemo, useState } from 'react';
import { verdict } from '@/lib/agent/evidence';
import { Stage } from '@/lib/agent/stage';
import { browserPreviewSupport } from '@/lib/browser-preview';
import type { Proposal } from '../proposals';
import { BrowserPreview, type BrowserState } from './PreviewPane';

interface Props {
  proposal: Proposal;
  files: Record<string, string>;
  onPick: (laneId: string) => void;
}

const noop = () => {};

function Column({ title, detail, files, live, picked, onPick, children }: { title: string; detail: string; files: Record<string, string>; live: boolean; picked?: boolean; onPick?: () => void; children?: React.ReactNode }) {
  const [state, setState] = useState<BrowserState>({ status: 'loading' });
  return (
    <section className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border ${picked ? 'border-[var(--accent-line)]' : 'border-border'}`} aria-label={`Version: ${title}`}>
      <header className="flex shrink-0 items-center gap-2 border-b border-border bg-[var(--bar)] px-3 py-2">
        {live && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.status === 'ready' ? 'bg-accent' : state.status === 'failed' ? 'bg-danger' : 'animate-pulse bg-warn'}`} title={state.status === 'ready' ? `Built in ${state.ms} ms` : state.status === 'failed' ? 'Build failed' : 'Building'} aria-hidden="true" />}
        <span className="shrink-0 text-sm font-medium text-gray-100">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-gray-500" title={detail}>{detail}</span>
        {onPick && (
          <button onClick={onPick} className={`btn btn-sm h-6 ${picked ? 'btn-primary' : 'btn-secondary'}`}>{picked ? 'Picked' : 'Pick'}</button>
        )}
      </header>
      {live ? (
        <div className="flex min-h-[18rem] flex-1 flex-col bg-white">
          <BrowserPreview files={files} reloads={0} width={null} picking={false} snapshots={0} onState={setState} onConsole={noop} onPicked={noop} onSnapshot={noop} />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-gray-300">{children}</div>
      )}
    </section>
  );
}

export function ForkCompare({ proposal, files, onPick }: Props) {
  const live = browserPreviewSupport(files).ok;
  // Each version's files: the project with that fork's changes; rebuilt only when the fork's work changes
  const versions = useMemo(
    () => proposal.lanes.map((lane) => ({ lane, files: lane.files.length ? Stage.restore(files, lane.saved).files() : files })),
    [proposal.lanes, files]
  );
  return (
    <div className="grid min-h-0 flex-1 auto-cols-[minmax(20rem,1fr)] grid-flow-col gap-3 overflow-auto p-3" aria-label="Compare versions">
      {live && <Column title="Now" detail="Your project as it is" files={files} live />}
      {versions.map(({ lane, files: f }) => {
        const judged = lane.evidence ? verdict(lane.evidence) : null;
        const detail = lane.status === 'running' ? `step ${lane.steps}…` : [judged?.headline, lane.scoreNotes?.[0]].filter(Boolean).join(' · ');
        return (
          <Column key={lane.id} title={lane.label} detail={detail} files={f} live={live} picked={proposal.laneId === lane.id} onPick={lane.status === 'done' && lane.files.length ? () => onPick(lane.id) : undefined}>
            <p className="mb-2 text-gray-400">{lane.scoreNotes?.[0] || (lane.status === 'running' ? 'Working…' : 'No summary')}</p>
            <ul className="space-y-0.5 font-mono text-[11px]">
              {lane.files.map((c) => (
                <li key={c.path} className="flex gap-2">
                  <span className={c.kind === 'added' ? 'text-accent' : c.kind === 'deleted' ? 'text-danger' : 'text-gray-500'}>{c.kind === 'added' ? '+' : c.kind === 'deleted' ? '−' : '~'}</span>
                  <span className="min-w-0 flex-1 truncate">{c.path}</span>
                  <span className="text-gray-500">+{c.added} −{c.removed}</span>
                </li>
              ))}
            </ul>
          </Column>
        );
      })}
    </div>
  );
}
