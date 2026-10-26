'use client';

import { useEffect, useId, useRef, useState } from 'react';
import type { CompileTarget } from '@/types';
import { TARGET_GROUPS, targetInfo, type BuildOptions } from '../targets';

interface OutputMenuProps {
  target: CompileTarget;
  options: BuildOptions;
  onTarget: (target: CompileTarget) => void;
  onOptions: (patch: Partial<BuildOptions>) => void;
}

/** Which compiler options apply to which outputs (others are ignored by scriptc) */
const APPLIES: Record<keyof BuildOptions, CompileTarget[]> = {
  optimization: ['exe', 'wasm', 'wat'],
  strip: ['exe'],
  sanitize: ['exe'],
  dynamic: ['exe', 'wasm', 'wat'],
  windowsSubsystem: ['exe'],
};

/**
 * The output picker in the toolbar: what to build (executable, WebAssembly,
 * compiler output, libraries) and the options that apply to it.
 */
export function OutputMenu({ target, options, onTarget, onOptions }: OutputMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const current = targetInfo(target);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const applies = (key: keyof BuildOptions) => APPLIES[key].includes(target);
  const option = (key: 'strip' | 'sanitize' | 'dynamic', label: string, hint: string) => (
    <label key={key} className={`flex cursor-pointer items-start gap-2.5 py-1.5 ${applies(key) ? '' : 'opacity-40'}`}>
      <input
        type="checkbox"
        checked={options[key]}
        disabled={!applies(key)}
        onChange={(e) => onOptions({ [key]: e.target.checked })}
        className="mt-0.5 accent-[var(--color-accent)]"
      />
      <span>
        <span className="block text-sm text-gray-100">{label}</span>
        <span className="block text-xs text-gray-500">{hint}</span>
      </span>
    </label>
  );

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        title={`Output: ${current.label} — ${current.hint}`}
        className="btn btn-secondary btn-sm gap-1.5 border-[var(--accent-line)] text-accent"
      >
        {current.short}
        <span aria-hidden="true" className="text-[10px] text-gray-400">▾</span>
      </button>

      {open && (
        <div id={menuId} role="dialog" aria-label="Output and build options" className="glass absolute right-0 top-full z-50 mt-2 w-80 rounded-xl p-2 animate-fade-in">
          {TARGET_GROUPS.map((group) => (
            <div key={group.label} role="group" aria-label={group.label} className="mb-1">
              <div className="eyebrow px-2 pt-1.5 pb-1">{group.label}</div>
              {group.items.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={target === item.value}
                  onClick={() => onTarget(item.value)}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] ${target === item.value ? 'bg-[var(--accent-soft)]' : ''}`}
                >
                  <span aria-hidden="true" className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${target === item.value ? 'bg-accent' : 'bg-transparent'}`} />
                  <span className="min-w-0">
                    <span className={`block text-sm ${target === item.value ? 'text-accent' : 'text-gray-100'}`}>{item.label}</span>
                    <span className="block truncate text-xs text-gray-500">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}

          <div className="mt-1 border-t border-border px-2 pt-2">
            <div className="eyebrow pb-1">Build options</div>
            <div className={`flex items-center justify-between py-1.5 ${applies('optimization') ? '' : 'opacity-40'}`}>
              <span className="text-sm text-gray-100">Optimization</span>
              <div className="segmented" role="group" aria-label="Optimization">
                {(['release', 'dev'] as const).map((level) => (
                  <button key={level} disabled={!applies('optimization')} aria-pressed={options.optimization === level} onClick={() => onOptions({ optimization: level })}>
                    {level === 'release' ? 'Release' : 'Dev'}
                  </button>
                ))}
              </div>
            </div>
            {option('strip', 'Strip symbols', 'Smaller executables; off keeps debug symbols')}
            {option('dynamic', 'Dynamic engine', 'Embed scriptc’s runtime engine (+~620 KB) for code that can’t compile statically')}
            {option('sanitize', 'Sanitizers', 'AddressSanitizer and a runtime reference-count audit (needs clang’s ASan runtime)')}
            <div className={`flex items-center justify-between py-1.5 ${applies('windowsSubsystem') ? '' : 'opacity-40'}`}>
              <span className="text-sm text-gray-100">Windows window</span>
              <div className="segmented" role="group" aria-label="Windows subsystem">
                {(['console', 'gui'] as const).map((kind) => (
                  <button key={kind} disabled={!applies('windowsSubsystem')} aria-pressed={options.windowsSubsystem === kind} onClick={() => onOptions({ windowsSubsystem: kind })}>
                    {kind === 'console' ? 'Console' : 'GUI'}
                  </button>
                ))}
              </div>
            </div>
            <p className="pb-1.5 pt-1 text-[11px] text-gray-500">Options that don’t apply to this output are dimmed. Library builds are configured in scriptc.profile.json.</p>
          </div>
        </div>
      )}
    </div>
  );
}
