'use client';

import { useEffect, useRef, useState } from 'react';
import { comboFromEvent, formatCombo } from '../project';
import { DEFAULT_SETTINGS, useWorkspace, type Settings } from '../store';
import { useToast } from '../toasts';
import { AiModelSettings } from './AiModelSettings';
import type { Command } from './CommandPalette';
import { Dialog } from './Dialog';

export const EXTENSIONS: { id: keyof Settings['extensions'] | string; name: string; description: string }[] = [
  { id: 'byteField', name: 'Byte field', description: 'The compiled binary drifting behind the glass.' },
  { id: 'wordWrap', name: 'Word wrap', description: 'Wrap long lines in the editor.' },
  { id: 'minimap', name: 'Minimap', description: 'Code overview along the editor’s right edge.' },
  { id: 'bracketPairs', name: 'Bracket pairs', description: 'Colourise matching brackets and draw pair guides.' },
  { id: 'stickyScroll', name: 'Sticky scroll', description: 'Keep the enclosing function visible while scrolling.' },
  { id: 'todoHighlights', name: 'TODO highlights', description: 'Underline TODO, FIXME, HACK and NOTE comments.' },
];

type Tab = 'general' | 'ai' | 'keys' | 'extensions';

export function SettingsDialog({ commands, isMac, onClose }: { commands: Command[]; isMac: boolean; onClose: () => void }) {
  const { settings, updateSettings } = useWorkspace();
  const { notify } = useToast();
  const [tab, setTab] = useState<Tab>('general');
  const [recording, setRecording] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecording(null);
        return;
      }
      const combo = comboFromEvent(e, isMac);
      if (!combo) return;
      const clash = commands.find((c) => c.id !== recording && (settings.keybindings[c.id] ?? c.keys) === combo);
      updateSettings({ keybindings: { ...settings.keybindings, [recording]: combo } });
      if (clash) notify({ kind: 'info', title: `${formatCombo(combo, isMac)} was also bound to “${clash.title}”`, detail: 'Both commands share it now; the first match runs.' });
      setRecording(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, isMac, commands, settings.keybindings, updateSettings, notify]);

  const toggle = (label: string, value: boolean, onChange: (v: boolean) => void, hint?: string) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2.5">
      <span>
        <span className="block text-sm text-gray-100">{label}</span>
        {hint && <span className="block text-xs text-gray-500">{hint}</span>}
      </span>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden="true" className="relative h-5 w-9 shrink-0 rounded-full border border-border-strong bg-white/[0.06] transition-colors peer-checked:bg-gray-100 peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-gray-100 after:absolute after:top-0.5 after:left-0.5 after:h-3.5 after:w-3.5 after:rounded-full after:bg-gray-400 after:transition-all peer-checked:after:left-[18px] peer-checked:after:bg-black" />
    </label>
  );

  const exportBindings = () => {
    const blob = new Blob([JSON.stringify(settings.keybindings, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'nanocli-keybindings.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const importBindings = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected an object of command → keys');
      const known = new Set(commands.map((c) => c.id));
      const bindings: Record<string, string> = {};
      for (const [id, keys] of Object.entries(data)) if (known.has(id) && typeof keys === 'string') bindings[id] = keys;
      updateSettings({ keybindings: bindings });
      notify({ kind: 'success', title: `Imported ${Object.keys(bindings).length} keybindings` });
    } catch (error) {
      notify({ kind: 'error', title: 'Could not import keybindings', detail: (error as Error).message });
    }
  };

  return (
    <Dialog title="Settings" onClose={onClose} width="max-w-2xl" tall>
      <div className="segmented mb-4 self-start" role="tablist" aria-label="Settings sections">
        {(['general', 'ai', 'keys', 'extensions'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
            {t === 'general' ? 'General' : t === 'ai' ? 'AI models' : t === 'keys' ? 'Keyboard shortcuts' : 'Extensions'}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === 'general' && (
          <div className="divide-y divide-border">
            <div className="flex items-center justify-between py-2.5">
              <span className="text-sm text-gray-100">Theme</span>
              <div className="segmented" role="group" aria-label="Theme">
                <button aria-pressed={settings.theme === 'dark'} onClick={() => updateSettings({ theme: 'dark' })}>Dark</button>
                <button aria-pressed={settings.theme === 'light'} onClick={() => updateSettings({ theme: 'light' })}>Light</button>
              </div>
            </div>
            {toggle('High contrast', settings.highContrast, (v) => updateSettings({ highContrast: v }), 'Solid surfaces, stronger borders and focus rings.')}
            <label className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-gray-100">Editor font size</span>
              <span className="flex items-center gap-3">
                <input type="range" min={11} max={22} value={settings.fontSize} onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })} className="accent-current" aria-label="Editor font size" />
                <span className="w-10 text-right font-mono text-xs text-gray-400">{settings.fontSize}px</span>
              </span>
            </label>
            {toggle('Format on save', settings.formatOnSave, (v) => updateSettings({ formatOnSave: v }), 'Run Prettier when you press ⌘S.')}
            {toggle('Semicolons', settings.semi, (v) => updateSettings({ semi: v }))}
            {toggle('Single quotes', settings.singleQuote, (v) => updateSettings({ singleQuote: v }))}
            <label className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-gray-100">Print width</span>
              <input type="number" min={40} max={200} value={settings.printWidth} onChange={(e) => updateSettings({ printWidth: Math.min(200, Math.max(40, Number(e.target.value) || 100)) })} className="input h-8 w-20 text-right font-mono text-xs" aria-label="Print width" />
            </label>
            <label className="flex items-center justify-between gap-4 py-2.5">
              <span className="text-sm text-gray-100">Tab width</span>
              <select value={settings.tabWidth} onChange={(e) => updateSettings({ tabWidth: Number(e.target.value) })} className="input h-8 w-20 font-mono text-xs" aria-label="Tab width">
                <option value={2}>2</option>
                <option value={4}>4</option>
              </select>
            </label>
            <div className="py-3">
              <button onClick={() => updateSettings({ ...DEFAULT_SETTINGS, keybindings: settings.keybindings })} className="btn btn-ghost btn-sm -ml-3">Reset general settings</button>
            </div>
          </div>
        )}

        {tab === 'ai' && <AiModelSettings />}

        {tab === 'keys' && (
          <div>
            <div className="mb-3 flex flex-wrap gap-2">
              <button onClick={exportBindings} className="btn btn-secondary btn-sm">Export</button>
              <button onClick={() => fileRef.current?.click()} className="btn btn-secondary btn-sm">Import</button>
              <button onClick={() => updateSettings({ keybindings: {} })} className="btn btn-ghost btn-sm">Reset all</button>
              <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && importBindings(e.target.files[0])} />
            </div>
            <table className="w-full text-sm">
              <thead className="sr-only">
                <tr><th>Command</th><th>Shortcut</th><th>Actions</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {commands.map((c) => {
                  const current = settings.keybindings[c.id] ?? c.keys ?? '';
                  const custom = c.id in settings.keybindings;
                  return (
                    <tr key={c.id}>
                      <td className="py-2 pr-3">
                        <span className="text-gray-500">{c.category}: </span>
                        <span className="text-gray-100">{c.title}</span>
                      </td>
                      <td className="py-2 text-right">
                        <button
                          onClick={() => setRecording(c.id)}
                          className={`kbd h-7 min-w-[5rem] justify-center px-2 ${recording === c.id ? 'border-gray-100 text-gray-100' : ''}`}
                          aria-label={`Change shortcut for ${c.title}${current ? `, currently ${formatCombo(current, isMac)}` : ''}`}
                        >
                          {recording === c.id ? 'Press keys…' : current ? formatCombo(current, isMac) : '—'}
                        </button>
                      </td>
                      <td className="w-16 py-2 pl-2 text-right">
                        {custom && (
                          <button
                            onClick={() => {
                              const next = { ...settings.keybindings };
                              delete next[c.id];
                              updateSettings({ keybindings: next });
                            }}
                            className="text-xs text-gray-500 hover:text-gray-100"
                          >Reset</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-gray-500">Click a shortcut and press the new keys. Esc cancels.</p>
          </div>
        )}

        {tab === 'extensions' && (
          <div className="divide-y divide-border">
            {EXTENSIONS.map((ext) => (
              <div key={ext.id}>
                {toggle(ext.name, !!settings.extensions[ext.id], (v) => updateSettings({ extensions: { ...settings.extensions, [ext.id]: v } }), ext.description)}
              </div>
            ))}
            <p className="pt-3 text-xs text-gray-500">Built-in extensions. Each one contributes editor behaviour and can be switched off without affecting the others.</p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
