'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  notify: (toast: Omit<Toast, 'id'>) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const GLYPH: Record<ToastKind, string> = { info: '●', success: '✓', error: '✕' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const notify = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { ...toast, id }]);
    setTimeout(() => dismiss(id), toast.kind === 'error' ? 8000 : 4500);
  }, [dismiss]);

  const api = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
        role="region"
        aria-label="Notifications"
        aria-live="polite"
      >
        {toasts.map((toast) => (
          <div key={toast.id} role={toast.kind === 'error' ? 'alert' : 'status'} className="glass animate-toast pointer-events-auto rounded-2xl p-3.5">
            <div className="flex items-start gap-3">
              <span className={`mt-0.5 font-mono text-xs ${toast.kind === 'error' ? 'text-danger' : 'text-gray-100'}`} aria-hidden="true">
                {GLYPH[toast.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-100">{toast.title}</p>
                {toast.detail && <p className="mt-0.5 break-words text-xs text-gray-400">{toast.detail}</p>}
                {toast.action && (
                  <button
                    onClick={() => {
                      toast.action?.run();
                      dismiss(toast.id);
                    }}
                    className="mt-2 text-xs font-medium text-gray-100 underline underline-offset-4"
                  >
                    {toast.action.label}
                  </button>
                )}
              </div>
              <button onClick={() => dismiss(toast.id)} className="text-xs text-gray-500 hover:text-gray-100" aria-label="Dismiss notification">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
