'use client';

/**
 * The last failure, under the editor: what broke, where (each location opens
 * the file at that line), and one button to have the agent debug it: reproduce,
 * find the root cause, fix, and prove the fix. With auto-debug on, that starts
 * by itself and the bar links to the proposal.
 */

import type { Failure, SourceLocation } from '@/lib/debug';

const SOURCE: Record<Failure['source'], string> = {
  build: 'Build failed',
  run: 'Run failed',
  python: 'Python failed',
  preview: 'Error in the app',
  devserver: 'Dev server failed',
};

interface Props {
  failure: Failure;
  /** The proposal debugging this failure, if one was started */
  proposal?: { id: string; working: boolean; waiting: boolean } | null;
  onDebug: () => void;
  onOpenProposal: (id: string) => void;
  onOpenLocation: (location: SourceLocation) => void;
  onDismiss: () => void;
}

export function DebugBar({ failure, proposal, onDebug, onOpenProposal, onOpenLocation, onDismiss }: Props) {
  return (
    <div role="status" aria-label="Last failure" className="flex shrink-0 items-center gap-2 border-t border-danger/30 bg-danger/[0.07] px-3 py-1.5 text-xs" data-zen-hide>
      <span className="shrink-0 font-medium text-danger">{SOURCE[failure.source]}</span>
      <span className="min-w-0 flex-1 truncate font-mono text-gray-300" title={failure.title}>{failure.title}</span>
      {failure.locations.slice(0, 3).map((l) => (
        <button
          key={`${l.file}:${l.line}`}
          onClick={() => onOpenLocation(l)}
          className="hidden shrink-0 rounded px-1.5 font-mono text-[11px] text-gray-300 underline decoration-dotted underline-offset-2 hover:bg-white/[0.07] hover:text-gray-100 md:inline"
          title={`Open ${l.file} at line ${l.line}`}
        >
          {l.file.split('/').pop()}:{l.line}
        </button>
      ))}
      {proposal ? (
        <button
          onClick={() => onOpenProposal(proposal.id)}
          className={`btn btn-sm h-7 shrink-0 ${proposal.waiting ? 'btn-primary' : 'btn-secondary'}`}
          title={proposal.waiting ? 'The agent wants to run something to reproduce or verify: it needs your OK' : undefined}
        >
          {proposal.waiting ? 'Approve to continue' : proposal.working ? 'Debugging…' : 'See the fix'}
        </button>
      ) : (
        <button onClick={onDebug} className="btn btn-primary btn-sm h-7 shrink-0" title="The agent reproduces it, finds the root cause, fixes it and proves the fix. Nothing changes until you accept.">
          ✦ Debug this
        </button>
      )}
      <button onClick={onDismiss} className="shrink-0 text-gray-500 hover:text-gray-100" aria-label="Dismiss">✕</button>
    </div>
  );
}
