'use client';

import { useRef, useState } from 'react';
import { AUDIENCE_LABEL, KIT_LIBRARY } from '@/lib/kit-library';
import { parseBundle, type Kit } from '@/lib/kits';
import { getLanguage } from '@/lib/languages';
import { TEMPLATES, templateFiles, type Template } from '@/lib/templates';
import { useActions } from '../actions';
import { kitProject } from '../kits-client';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';
import { Dialog } from './Dialog';

export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const { project, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const actions = useActions();
  const [language, setLanguage] = useState<'all' | 'typescript' | 'web' | 'python' | 'other' | 'kits'>('all');
  const importRef = useRef<HTMLInputElement>(null);
  const groupOf = (t: Template) => ((t.language ?? 'typescript') === 'typescript' || t.language === 'python' || t.language === 'web' ? (t.language ?? 'typescript') : 'other');
  const shown = language === 'kits' ? [] : TEMPLATES.filter((t) => language === 'all' || groupOf(t) === language);

  const openKit = (kit: Kit, files: Record<string, string>) => {
    saveSnapshot(`Before opening kit: ${kit.name}`);
    dispatch({ type: 'replace', project: kitProject(kit, files), git: null });
    notify({ kind: 'success', title: `Opened kit: ${kit.name}`, detail: `Your previous project (${project.name}) is in History.` });
    actions.openPanel('kit');
    onClose();
  };
  const importKit = async (file: File) => {
    const parsed = parseBundle(await file.text());
    if ('error' in parsed) return notify({ kind: 'error', title: 'Could not open the kit', detail: parsed.error });
    openKit(parsed.kit, parsed.files);
  };
  /** A short tag for the card: TS, Python, or the language's first word */
  const tagOf = (t: Template) => (t.language === 'web' ? 'Web' : t.language === 'python' ? 'Python' : (t.language ?? 'typescript') === 'typescript' ? 'TS' : (getLanguage(t.language!)?.name.split(' ')[0] ?? t.language));

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
    <Dialog title="New project" description="TypeScript templates compile with scriptc as-is. Web apps run with their framework's dev server and a live preview. Python runs with uv. Other languages run with their own toolchain on this machine." onClose={onClose} width="max-w-3xl">
      <div className="segmented mb-3 self-start" role="group" aria-label="Language">
        {([['all', 'All'], ['typescript', 'TypeScript'], ['web', 'Web apps'], ['python', 'Python · AI'], ['other', 'Other languages'], ['kits', 'Field kits']] as const).map(([value, label]) => (
          <button key={value} aria-pressed={language === value} onClick={() => setLanguage(value)}>{label}</button>
        ))}
      </div>
      {language === 'kits' && (
        <div className="space-y-3">
          <p className="text-sm text-gray-400">A kit is a project plus its playbook, the variables and connectors it needs, checks that prove it works, and house rules for the agent. Each one runs on sample data as soon as it opens.</p>
          <ul className="grid gap-2.5 sm:grid-cols-2">
            {KIT_LIBRARY.map(({ kit, files }) => (
              <li key={kit.id}>
                <button onClick={() => openKit(kit, files)} className="h-full w-full rounded-xl border border-border p-4 text-left transition-colors hover:border-border-strong hover:bg-white/[0.04]">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-gray-100">{kit.name}</span>
                    <span className="badge shrink-0 px-1.5 py-0 text-[10px]">{AUDIENCE_LABEL[kit.audience]}</span>
                  </span>
                  <p className="mt-1 text-sm text-gray-400">{kit.summary}</p>
                  <p className="mt-2 font-mono text-[11px] text-gray-500">{kit.steps.length} steps · {kit.checks.length} check{kit.checks.length === 1 ? '' : 's'} · {Object.keys(files).length} files</p>
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <button onClick={() => importRef.current?.click()} className="btn btn-secondary btn-sm">Open a kit file…</button>
            <span className="text-xs text-gray-500">A .nanokit.json from your team, a customer or a vendor. Nothing in it runs until you run it.</span>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              aria-label="Kit file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importKit(file);
                e.target.value = '';
              }}
            />
          </div>
        </div>
      )}
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
                    <span className="badge shrink-0 px-1.5 py-0 text-[10px]">{tagOf(template)}</span>
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
