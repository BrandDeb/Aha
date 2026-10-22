'use client';

import { useMemo } from 'react';
import { OutputView } from '@/components/CodeEditor';
import { formatSize, type CompileResult } from '@/lib/compiler-browser';
import { base64ToBytes, describeBinary, hexdump } from '../artifact';
import { useActions } from '../actions';
import { targetInfo } from '../targets';
import { useToast } from '../toasts';
import { Dialog } from './Dialog';

interface ArtifactDialogProps {
  result: CompileResult;
  theme: 'dark' | 'light';
  onClose: () => void;
}

/** What a build produced: highlighted text for IR, assembly and WAT; bytes for binaries */
export function ArtifactDialog({ result, theme, onClose }: ArtifactDialogProps) {
  const actions = useActions();
  const { notify } = useToast();
  const info = targetInfo(result.target ?? 'exe');
  const name = result.filename?.replace(/^[0-9a-f]{32}-?/, '') || 'output';

  const view = useMemo(() => {
    if (result.output === undefined) return null;
    if (result.format === 'text') return { text: result.output, language: info.language === 'hex' ? 'plaintext' : info.language, summary: null as string | null };
    const bytes = base64ToBytes(result.output);
    return { text: hexdump(bytes), language: 'plaintext', summary: describeBinary(bytes) };
  }, [result, info.language]);

  const copy = async () => {
    if (!view) return;
    try {
      await navigator.clipboard.writeText(result.format === 'text' ? result.output ?? '' : view.text);
      notify({ kind: 'info', title: 'Copied to clipboard' });
    } catch {
      notify({ kind: 'error', title: 'Could not copy', detail: 'The browser blocked clipboard access.' });
    }
  };

  return (
    <Dialog title={name} description={`${info.label} · ${formatSize(result.size)}${view?.summary ? ` · ${view.summary}` : ''}`} onClose={onClose} width="max-w-6xl" tall>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={() => void actions.downloadArtifact(result)} className="btn btn-primary btn-sm">Download</button>
        {view && <button onClick={() => void copy()} className="btn btn-secondary btn-sm">{result.format === 'text' ? 'Copy' : 'Copy hexdump'}</button>}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-[var(--color-background)]">
        {view ? (
          <OutputView value={view.text} language={view.language} name={name} theme={theme} />
        ) : (
          <p className="p-6 text-sm text-gray-400">This artifact is too large to show here ({formatSize(result.size)}). Use Download to get the file.</p>
        )}
      </div>
    </Dialog>
  );
}
