'use client';

/**
 * The merge-conflict editor: where both sides changed the same lines, each conflict is shown with your version and
 * theirs, to keep one, the other or both; the result underneath can be edited by hand. Used by Git pull and by
 * proposals that changed files you edited since. Opened from anywhere with openConflicts().
 */

import { useState, useSyncExternalStore } from 'react';
import { conflictCount, hasMarkers, joinMerge, type FileMerge, type MergeChunk, type Resolution } from '@/lib/merge3';
import { Dialog } from './components/Dialog';

export interface ConflictRequest {
  title: string;
  /** What "theirs" is: the branch, the agent… */
  theirs: string;
  conflicts: FileMerge[];
  /** Resolved contents of each conflicted file */
  onApply: (resolved: Record<string, string>) => void;
  onCancel?: () => void;
}

let current: ConflictRequest | null = null;
const listeners = new Set<() => void>();
const set = (next: ConflictRequest | null) => {
  current = next;
  listeners.forEach((l) => l());
};
export const openConflicts = (request: ConflictRequest) => set(request);
const subscribe = (l: () => void) => (listeners.add(l), () => listeners.delete(l));

/** Rendered once by the workspace */
export function ConflictHost() {
  const request = useSyncExternalStore(subscribe, () => current, () => null);
  if (!request) return null;
  return <ConflictEditor key={request.title + request.conflicts.map((c) => c.path).join()} request={request} onDone={() => set(null)} />;
}

interface FileState {
  choices: (Resolution | undefined)[];
  /** Set once the result is edited by hand: it then wins over the choices */
  text: string | null;
}

const resultOf = (f: FileMerge, s: FileState) => s.text ?? joinMerge(f.chunks, s.choices, { ours: 'yours', theirs: 'theirs' });

function ConflictEditor({ request, onDone }: { request: ConflictRequest; onDone: () => void }) {
  const [state, setState] = useState<Record<string, FileState>>(() => Object.fromEntries(request.conflicts.map((c) => [c.path, { choices: [], text: null }])));
  const [selected, setSelected] = useState(request.conflicts[0]?.path ?? '');
  const file = request.conflicts.find((c) => c.path === selected) ?? request.conflicts[0];
  const fs = state[file.path];
  const unresolved = (f: FileMerge) => hasMarkers(resultOf(f, state[f.path]));
  const left = request.conflicts.filter(unresolved).length;

  const choose = (index: number, choice: Resolution) =>
    setState((s) => ({ ...s, [file.path]: { choices: Object.assign([...s[file.path].choices], { [index]: choice }), text: null } }));
  const chooseAll = (choice: Resolution) =>
    setState((s) => ({ ...s, [file.path]: { choices: Array.from({ length: conflictCount(file.chunks) }, () => choice), text: null } }));

  const apply = () => {
    request.onApply(Object.fromEntries(request.conflicts.map((f) => [f.path, resultOf(f, state[f.path])])));
    onDone();
  };
  const cancel = () => {
    request.onCancel?.();
    onDone();
  };

  let conflictIndex = -1;
  return (
    <Dialog title={request.title} description={`${request.conflicts.length} file${request.conflicts.length > 1 ? 's' : ''} changed on both sides. Choose for each conflict, or edit the result.`} onClose={cancel} width="max-w-6xl" tall>
      <div className="flex min-h-0 flex-1 gap-3">
        <ul className="w-52 shrink-0 space-y-0.5 overflow-y-auto" aria-label="Conflicted files">
          {request.conflicts.map((f) => (
            <li key={f.path}>
              <button
                onClick={() => setSelected(f.path)}
                aria-current={f.path === file.path}
                className={`flex w-full items-center gap-1.5 rounded px-2 py-1 text-left font-mono text-xs ${f.path === file.path ? 'bg-white/[0.08] text-gray-100' : 'text-gray-400 hover:bg-white/[0.04]'}`}
              >
                <span className={unresolved(f) ? 'text-warn' : 'text-accent'} aria-label={unresolved(f) ? 'unresolved' : 'resolved'}>{unresolved(f) ? '●' : '✓'}</span>
                <span className="truncate">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-auto font-mono text-xs text-gray-300">{file.path}</span>
            <button onClick={() => chooseAll('ours')} className="btn btn-ghost btn-sm h-7">All yours</button>
            <button onClick={() => chooseAll('theirs')} className="btn btn-ghost btn-sm h-7">All {request.theirs}</button>
          </div>
          {file.chunks.map((chunk: MergeChunk, i) => {
            if (chunk.kind === 'same') return null;
            const index = ++conflictIndex;
            const choice = fs.text === null ? fs.choices[index] : undefined;
            return (
              <section key={i} className="rounded-lg border border-border" aria-label={`Conflict ${index + 1}`}>
                <div className="grid grid-cols-2 divide-x divide-border">
                  {(['ours', 'theirs'] as const).map((side) => (
                    <div key={side} className={`min-w-0 ${choice === side || choice === 'both' ? 'bg-accent/[0.06]' : ''}`}>
                      <div className="border-b border-border px-2 py-1 text-[11px] text-gray-500">{side === 'ours' ? 'Yours' : `${request.theirs[0].toUpperCase()}${request.theirs.slice(1)}`}</div>
                      <pre className="max-h-56 overflow-auto p-2 font-mono text-[11px] leading-relaxed text-gray-200">{(side === 'ours' ? chunk.ours : chunk.theirs).join('\n') || <span className="text-gray-600">(nothing: removed)</span>}</pre>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-1 border-t border-border p-1.5">
                  <span className="mr-auto px-1 text-[11px] text-gray-500">Conflict {index + 1}</span>
                  {(
                    [
                      ['ours', 'Keep yours'],
                      ['theirs', `Keep ${request.theirs}`],
                      ['both', 'Keep both'],
                    ] as const
                  ).map(([value, label]) => (
                    <button key={value} onClick={() => choose(index, value)} aria-pressed={choice === value} className={`btn btn-sm h-7 ${choice === value ? 'btn-primary' : 'btn-secondary'}`}>
                      {label}
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
          <label className="block">
            <span className="mb-1 flex items-center justify-between text-[11px] text-gray-500">
              <span>Result{fs.text !== null ? ' (edited by hand)' : ''}</span>
              {fs.text !== null && <button onClick={() => setState((s) => ({ ...s, [file.path]: { ...s[file.path], text: null } }))} className="text-gray-400 hover:text-gray-100">Undo hand edits</button>}
            </span>
            <textarea
              value={resultOf(file, fs)}
              onChange={(e) => {
                const text = e.target.value;
                setState((s) => ({ ...s, [file.path]: { ...s[file.path], text } }));
              }}
              spellCheck={false}
              aria-label={`Result for ${file.path}`}
              className="input h-64 w-full resize-y whitespace-pre font-mono text-[12px] leading-relaxed"
            />
          </label>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <span className="mr-auto text-xs text-gray-400" aria-live="polite">{left ? `${left} file${left > 1 ? 's' : ''} still ha${left > 1 ? 've' : 's'} conflicts` : 'All conflicts resolved'}</span>
        <button onClick={cancel} className="btn btn-ghost btn-sm">Cancel</button>
        <button onClick={apply} disabled={left > 0} className="btn btn-primary btn-sm">Apply merge</button>
      </div>
    </Dialog>
  );
}
