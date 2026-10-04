'use client';

import { useMemo, useState, type KeyboardEvent } from 'react';
import { formatCombo } from '../project';

export interface Command {
  id: string;
  title: string;
  category: string;
  /** Default key combo, e.g. "Mod+Shift+F" */
  keys?: string;
  run: () => void;
  enabled?: boolean;
}

interface PaletteProps {
  commands: Command[];
  files: string[];
  bindings: Record<string, string>;
  isMac: boolean;
  onOpenFile: (path: string) => void;
  onClose: () => void;
}

/** Subsequence match: "gp" matches "Git: Pull". Lower score = better. */
function score(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const direct = t.indexOf(q);
  if (direct !== -1) return direct;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found === -1) return Infinity;
    gaps += found - ti;
    ti = found + 1;
  }
  return 100 + gaps;
}

export function CommandPalette({ commands, files, bindings, isMac, onOpenFile, onClose }: PaletteProps) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);

  const items = useMemo(() => {
    const cmd = commands
      .filter((c) => c.enabled !== false)
      .map((c) => ({ kind: 'command' as const, id: c.id, label: `${c.category}: ${c.title}`, keys: bindings[c.id] ?? c.keys ?? '', run: c.run, s: score(query, `${c.category} ${c.title}`) }));
    const file = files.map((f) => ({ kind: 'file' as const, id: f, label: f, keys: '', run: () => onOpenFile(f), s: score(query, f) + 0.5 }));
    return [...cmd, ...file].filter((i) => i.s !== Infinity).sort((a, b) => a.s - b.s).slice(0, 50);
  }, [commands, files, bindings, query, onOpenFile]);

  const choose = (i: number) => {
    const item = items[i];
    if (!item) return;
    onClose();
    // Let the palette unmount before running (commands may open dialogs)
    setTimeout(item.run, 0);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex((i) => Math.min(items.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(index); }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[14vh] backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="glass animate-fade-in w-full max-w-xl overflow-hidden rounded-3xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setIndex(0); }}
          onKeyDown={onKeyDown}
          placeholder="Run a command or open a file…"
          aria-label="Search commands and files"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[index] ? `palette-${index}` : undefined}
          className="h-14 w-full border-b border-border bg-transparent px-5 text-[15px] text-gray-100 outline-none placeholder:text-gray-500"
        />
        <ul id="palette-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-2">
          {items.length === 0 && <li className="px-3 py-6 text-center text-sm text-gray-500">No commands or files match “{query}”.</li>}
          {items.map((item, i) => (
            <li
              key={`${item.kind}-${item.id}`}
              id={`palette-${i}`}
              role="option"
              aria-selected={i === index}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(i)}
              className={`flex cursor-pointer items-center justify-between gap-4 rounded-xl px-3 py-2 text-sm ${i === index ? 'bg-white/[0.08] text-gray-100' : 'text-gray-300'}`}
            >
              <span className={`truncate ${item.kind === 'file' ? 'font-mono text-[13px]' : ''}`}>
                {item.kind === 'file' && <span className="mr-2 text-gray-500">↳</span>}
                {item.label}
              </span>
              {item.keys && <span className="kbd shrink-0">{formatCombo(item.keys, isMac)}</span>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
