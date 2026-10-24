'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

/** Open dialogs, oldest first, so only the topmost reacts to keys that arrive while focus is outside every dialog */
const openDialogs: HTMLElement[] = [];

interface DialogProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class */
  width?: string;
  /** Full-height content area (diffs, graphs) */
  tall?: boolean;
}

/**
 * Modal dialog: focus moves inside on open, Tab stays inside, Esc closes and
 * focus returns to whatever opened it.
 */
export function Dialog({ title, description, onClose, children, width = 'max-w-lg', tall = false }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const focusables = () =>
      Array.from(node?.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? [])
        .filter((el) => !el.hasAttribute('disabled'));
    (focusables()[0] ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        const items = focusables();
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    node?.addEventListener('keydown', onKey);

    // If focus drops to the page (a focused control was removed or disabled), the keys must still work:
    // the topmost dialog handles them from the document until focus is back inside it
    if (node) openDialogs.push(node);
    const onDocumentKey = (e: KeyboardEvent) => {
      if (!node || openDialogs[openDialogs.length - 1] !== node || node.contains(document.activeElement)) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        (focusables()[0] ?? node).focus();
      }
    };
    document.addEventListener('keydown', onDocumentKey);

    return () => {
      node?.removeEventListener('keydown', onKey);
      document.removeEventListener('keydown', onDocumentKey);
      const at = openDialogs.indexOf(node as HTMLDivElement);
      if (at >= 0) openDialogs.splice(at, 1);
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
        className={`glass animate-fade-in flex w-full ${width} flex-col rounded-3xl ${tall ? 'h-[min(86vh,820px)]' : 'max-h-[86vh]'}`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-gray-100">{title}</h2>
            {description && <p id={descriptionId} className="mt-0.5 text-sm text-gray-400">{description}</p>}
          </div>
          <button onClick={onClose} className="btn btn-ghost btn-icon" aria-label="Close dialog">✕</button>
        </div>
        <div className={`min-h-0 flex-1 ${tall ? 'flex flex-col' : 'overflow-y-auto'} p-5`}>{children}</div>
      </div>
    </div>
  );
}
