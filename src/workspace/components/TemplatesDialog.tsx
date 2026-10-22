'use client';

import { useState } from 'react';
import { TEMPLATES, templateFiles, type Template } from '@/lib/templates';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';
import { Dialog } from './Dialog';

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const [language, setLanguage] = useState<'all' | 'typescript' | 'python'>('all');
  const shown = TEMPLATES.filter((t) => language === 'all' || (t.language ?? 'typescript') === language);

  const create = (template: Template) => {
    const { files, entry } = templateFiles(template);
    saveSnapshot(`Before new project: ${template.name}`);
    dispatch({
      type: 'replace',
      project: { name: template.id, files, folders: [], entry },
      git: null,
    });
    notify({ kind: 'success', title: `New project from ${template.name}`, detail: `Your previous project (${project.name}) is in History.` });
    onClose();
  };

  return (
    <Dialog title="New project" description="TypeScript templates compile with scriptc as-is. Python templates run with uv." onClose={onClose} width="max-w-3xl">
      <div className="segmented mb-3 self-start" role="group" aria-label="Language">
        {([['all', 'All'], ['typescript', 'TypeScript'], ['python', 'Python · AI']] as const).map(([value, label]) => (
          <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{label}</button>
        ))}
      </div>
      <ul className="grid gap-2.5 sm:grid-cols-2">
        {shown.map((template) => {
          const { files } = templateFiles(template);
          const count = Object.keys(files).length;
          return (
            <li key={template.id}>
              <button
                onClick={() => create(template)}
                className="group h-full w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-white/[0.04]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-100">{template.name}</span>
                    <span className="badge shrink-0 px-1.5 py-0 text-[10px]">{template.language === 'python' ? 'Python' : 'TS'}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] text-gray-500">{count > 1 ? `${count} files` : template.filename}</span>
                </div>
                <p className="mt-1 text-sm text-gray-400">{template.description}</p>
                <pre className="mt-3 max-h-20 overflow-hidden font-mono text-[11px] leading-relaxed text-gray-500 [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
                  {template.code.split('\n').slice(0, 5).join('\n')}
                </pre>
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
