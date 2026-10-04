'use client';

import { useActions } from '../actions';
import { diffStatus } from '../project';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

function relative(time: number): string {
  const seconds = Math.round((Date.now() - time) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return new Date(time).toLocaleDateString();
}

export function HistoryPanel() {
  const { project, active, snapshots, saveSnapshot, restoreSnapshot, deleteSnapshot } = useWorkspace();
  const actions = useActions();
  const { notify } = useToast();

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">Version history</h3>
        <button onClick={() => { saveSnapshot('Saved manually'); notify({ kind: 'success', title: 'Version saved' }); }} className="btn btn-ghost btn-sm">
          Save version
        </button>
      </div>
      <p className="text-xs text-gray-500">
        Versions are saved when you press ⌘S, after each successful build, and before pulls, restores and assistant edits. They stay in this browser.
      </p>
      {snapshots.length === 0 ? (
        <p className="text-sm text-gray-500">No versions yet.</p>
      ) : (
        <ol className="space-y-2">
          {snapshots.map((snapshot) => {
            const changed = Object.keys(diffStatus(snapshot.files, project.files)).length;
            const hasActive = active in snapshot.files;
            return (
              <li key={snapshot.id} className="rounded-2xl border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-gray-100">{snapshot.label}</p>
                    <p className="mt-0.5 font-mono text-[11px] text-gray-500">
                      {relative(snapshot.createdAt)} · {Object.keys(snapshot.files).length} files · {changed ? `${changed} differ from now` : 'same as now'}
                    </p>
                  </div>
                  <button onClick={() => deleteSnapshot(snapshot.id)} className="text-xs text-gray-500 hover:text-gray-100" aria-label={`Delete version ${snapshot.label}`}>✕</button>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button
                    disabled={!hasActive}
                    onClick={() => actions.showDiff({ title: `${active} — ${snapshot.label} vs now`, path: active, original: snapshot.files[active] ?? '', modified: project.files[active] ?? '' })}
                    className="btn btn-secondary btn-sm"
                    title={hasActive ? undefined : `${active} didn't exist in this version`}
                  >
                    Compare {active.split('/').pop()}
                  </button>
                  <button
                    disabled={!changed}
                    onClick={() => {
                      if (window.confirm('Restore this version? Your current files are saved as a new version first.')) {
                        restoreSnapshot(snapshot.id);
                        notify({ kind: 'success', title: 'Version restored' });
                      }
                    }}
                    className="btn btn-ghost btn-sm"
                  >
                    Restore
                  </button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
