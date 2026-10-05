'use client';

import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { buildTree, diffStatus, dirname, isRunnable, isValidPath, type TreeNode } from '../project';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

type Editing =
  | { mode: 'new-file' | 'new-folder'; parent: string }
  | { mode: 'rename'; path: string };

const CHANGE_GLYPH = { added: 'A', modified: 'M', deleted: 'D' } as const;

export function FileTree({ errorCounts }: { errorCounts: Record<string, number> }) {
  const { project, active, git, dispatch } = useWorkspace();
  const { notify } = useToast();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState('');
  const [focused, setFocused] = useState<string>('');
  const treeRef = useRef<HTMLUListElement>(null);

  const tree = useMemo(() => buildTree(project), [project]);
  const changes = useMemo(() => (git ? diffStatus(git.base, project.files) : {}), [git, project.files]);

  // Flattened visible rows, for keyboard navigation
  const rows = useMemo(() => {
    const out: { node: TreeNode; depth: number }[] = [];
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth });
        if (node.type === 'folder' && !collapsed.has(node.path)) walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    return out;
  }, [tree, collapsed]);

  const startCreate = (mode: 'new-file' | 'new-folder', parent = focusedFolder()) => {
    setEditing({ mode, parent });
    setDraft('');
    if (parent) setCollapsed((prev) => { const next = new Set(prev); next.delete(parent); return next; });
  };

  function focusedFolder(): string {
    const row = rows.find((r) => r.node.path === focused);
    if (!row) return '';
    return row.node.type === 'folder' ? row.node.path : dirname(row.node.path);
  }

  const commit = () => {
    if (!editing) return;
    const name = draft.trim().replace(/^\/+/, '');
    if (!name) {
      setEditing(null);
      return;
    }
    if (editing.mode === 'rename') {
      const target = name.includes('/') ? name : [dirname(editing.path), name].filter(Boolean).join('/');
      if (!isValidPath(target)) {
        notify({ kind: 'error', title: 'Invalid name', detail: 'Use letters, numbers, dots, dashes and underscores.' });
        return;
      }
      if (target !== editing.path && (target in project.files)) {
        notify({ kind: 'error', title: `${target} already exists` });
        return;
      }
      dispatch({ type: 'move', from: editing.path, to: target });
      notify({ kind: 'success', title: `Renamed to ${target}` });
    } else {
      const target = [editing.parent, name].filter(Boolean).join('/');
      if (!isValidPath(target)) {
        notify({ kind: 'error', title: 'Invalid name', detail: 'Use letters, numbers, dots, dashes and underscores.' });
        return;
      }
      if (target in project.files) {
        notify({ kind: 'error', title: `${target} already exists` });
        return;
      }
      if (editing.mode === 'new-file') dispatch({ type: 'create', path: target, content: '' });
      else dispatch({ type: 'mkdir', path: target });
    }
    setEditing(null);
  };

  const remove = (node: TreeNode) => {
    const what = node.type === 'folder' ? `the folder ${node.path} and everything in it` : node.path;
    if (window.confirm(`Delete ${what}? You can restore it from History.`)) {
      dispatch({ type: 'delete', path: node.path });
      notify({ kind: 'info', title: `Deleted ${node.path}` });
    }
  };

  const toggle = (folder: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(folder)) next.delete(folder);
      else next.add(folder);
      return next;
    });

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (editing) return;
    const index = rows.findIndex((r) => r.node.path === focused);
    const row = rows[index];
    const move = (i: number) => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (next) {
        setFocused(next.node.path);
        treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.node.path)}"]`)?.focus();
      }
    };
    if (e.key === 'ArrowDown') { e.preventDefault(); move(index + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(index - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(rows.length - 1); }
    else if (!row) return;
    else if (e.key === 'ArrowRight' && row.node.type === 'folder') { e.preventDefault(); if (collapsed.has(row.node.path)) toggle(row.node.path); else move(index + 1); }
    else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (row.node.type === 'folder' && !collapsed.has(row.node.path)) toggle(row.node.path);
      else move(rows.findIndex((r) => r.node.path === dirname(row.node.path)));
    }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (row.node.type === 'folder') toggle(row.node.path); else dispatch({ type: 'open', path: row.node.path }); }
    else if (e.key === 'F2') { e.preventDefault(); setEditing({ mode: 'rename', path: row.node.path }); setDraft(row.node.name); }
    else if (e.key === 'Delete') { e.preventDefault(); remove(row.node); }
  };

  const editor = (depth: number) => (
    <li role="none" style={{ paddingLeft: 12 + depth * 14 }} className="py-0.5 pr-2">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setEditing(null);
        }}
        onBlur={commit}
        placeholder={editing?.mode === 'new-folder' ? 'folder name' : 'file.ts'}
        aria-label={editing?.mode === 'rename' ? 'New name' : editing?.mode === 'new-folder' ? 'New folder name' : 'New file name'}
        className="input h-7 rounded-md px-2 font-mono text-xs"
      />
    </li>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
        <span className="eyebrow">Explorer</span>
        <div className="flex gap-0.5">
          <button className="btn btn-ghost btn-icon h-7 w-7 text-xs" title="New file" aria-label="New file" onClick={() => startCreate('new-file')}>＋</button>
          <button className="btn btn-ghost btn-icon h-7 w-7 text-xs" title="New folder" aria-label="New folder" onClick={() => startCreate('new-folder')}>⊞</button>
        </div>
      </div>
      <ul
        ref={treeRef}
        role="tree"
        aria-label="Project files"
        className="min-h-0 flex-1 overflow-y-auto pb-3 font-mono text-[12.5px]"
        onKeyDown={onKeyDown}
      >
        {editing && editing.mode !== 'rename' && editing.parent === '' && editor(0)}
        {rows.map(({ node, depth }) => {
          const isActive = node.path === active;
          const change = changes[node.path];
          const errors = errorCounts[node.path] ?? 0;
          if (editing?.mode === 'rename' && editing.path === node.path) return <div key={node.path}>{editor(depth)}</div>;
          return (
            <li key={node.path} role="none">
              <div
                role="treeitem"
                aria-level={depth + 1}
                aria-expanded={node.type === 'folder' ? !collapsed.has(node.path) : undefined}
                aria-selected={isActive}
                data-path={node.path}
                tabIndex={focused === node.path || (!focused && isActive) ? 0 : -1}
                onFocus={() => setFocused(node.path)}
                onClick={() => (node.type === 'folder' ? toggle(node.path) : dispatch({ type: 'open', path: node.path }))}
                onDoubleClick={() => { setEditing({ mode: 'rename', path: node.path }); setDraft(node.name); }}
                style={{ paddingLeft: 12 + depth * 14 }}
                className={`group flex h-7 cursor-pointer items-center gap-2 pr-2 outline-none transition-colors focus-visible:bg-white/[0.08] ${
                  isActive ? 'bg-white/[0.09] text-gray-100' : 'text-gray-400 hover:bg-white/[0.04] hover:text-gray-100'
                }`}
              >
                <span className="w-3 shrink-0 text-center text-[10px] text-gray-500" aria-hidden="true">
                  {node.type === 'folder' ? (collapsed.has(node.path) ? '▸' : '▾') : ''}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {node.name}
                  {node.path === project.entry && <span className="ml-1.5 text-[10px] text-gray-500" title="Entry file">● entry</span>}
                </span>
                {errors > 0 && <span className="text-[10px] text-danger" title={`${errors} problem${errors > 1 ? 's' : ''}`}>{errors}✕</span>}
                {change && <span className="w-3 text-center text-[10px] text-gray-300" title={change}>{CHANGE_GLYPH[change]}</span>}
                <span className="hidden items-center gap-0.5 group-hover:flex group-focus-within:flex">
                  {node.type === 'file' && isRunnable(node.path) && node.path !== project.entry && (
                    <button
                      className="px-1 text-[10px] text-gray-500 hover:text-gray-100"
                      title="Set as entry"
                      aria-label={`Set ${node.path} as entry`}
                      onClick={(e) => { e.stopPropagation(); dispatch({ type: 'setEntry', path: node.path }); notify({ kind: 'success', title: `Entry set to ${node.path}` }); }}
                    >●</button>
                  )}
                  <button
                    className="px-1 text-[10px] text-gray-500 hover:text-gray-100"
                    title="Rename (F2)"
                    aria-label={`Rename ${node.path}`}
                    onClick={(e) => { e.stopPropagation(); setEditing({ mode: 'rename', path: node.path }); setDraft(node.name); }}
                  >✎</button>
                  <button
                    className="px-1 text-[10px] text-gray-500 hover:text-danger"
                    title="Delete"
                    aria-label={`Delete ${node.path}`}
                    onClick={(e) => { e.stopPropagation(); remove(node); }}
                  >✕</button>
                </span>
              </div>
              {editing && editing.mode !== 'rename' && editing.parent === node.path && node.type === 'folder' && editor(depth + 1)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
