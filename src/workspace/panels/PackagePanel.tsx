'use client';

import { useMemo, useState } from 'react';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

interface PackageJson {
  name?: string;
  version?: string;
  description?: string;
  bin?: string | Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  [key: string]: unknown;
}

function KeyValueList({
  title,
  entries,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  title: string;
  entries: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  return (
    <section className="space-y-2" aria-label={title}>
      <h4 className="eyebrow">{title}</h4>
      {Object.entries(entries).map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-28 shrink-0 truncate font-mono text-xs text-gray-100" title={k}>{k}</span>
          <input
            value={v}
            onChange={(e) => onChange({ ...entries, [k]: e.target.value })}
            aria-label={`${title}: ${k}`}
            className="input h-8 font-mono text-xs"
          />
          <button
            onClick={() => {
              const next = { ...entries };
              delete next[k];
              onChange(next);
            }}
            className="text-xs text-gray-500 hover:text-gray-100"
            aria-label={`Remove ${k}`}
          >✕</button>
        </div>
      ))}
      <div className="flex gap-2">
        <input value={key} onChange={(e) => setKey(e.target.value)} placeholder={keyPlaceholder} aria-label={`New ${title} name`} className="input h-8 w-28 shrink-0 font-mono text-xs" />
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={valuePlaceholder} aria-label={`New ${title} value`} className="input h-8 font-mono text-xs" />
        <button
          disabled={!key.trim()}
          onClick={() => {
            onChange({ ...entries, [key.trim()]: value.trim() || valuePlaceholder });
            setKey('');
            setValue('');
          }}
          className="btn btn-ghost btn-sm shrink-0"
        >Add</button>
      </div>
    </section>
  );
}

export function PackagePanel() {
  const { project, dispatch } = useWorkspace();
  const { notify } = useToast();
  const raw = project.files['package.json'];

  const parsed = useMemo((): PackageJson | null => {
    if (raw === undefined) return null;
    try {
      const value = JSON.parse(raw);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
    } catch {
      return null;
    }
  }, [raw]);

  const write = (next: PackageJson) => {
    const content = `${JSON.stringify(next, null, 2)}\n`;
    if (raw === undefined) dispatch({ type: 'create', path: 'package.json', content });
    else dispatch({ type: 'write', path: 'package.json', content });
  };

  if (raw === undefined) {
    return (
      <div className="space-y-3 p-4">
        <h3 className="eyebrow">package.json</h3>
        <p className="text-sm text-gray-400">Describe your CLI — its name, version, command name and scripts — for when you publish or export it.</p>
        <button
          onClick={() => {
            const binName = project.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase() || 'my-cli';
            write({
              name: binName,
              version: '0.1.0',
              description: '',
              bin: { [binName]: project.entry },
              scripts: { build: `scriptc build ${project.entry} -o ${binName} --strip` },
              dependencies: {},
            });
            notify({ kind: 'success', title: 'Created package.json' });
          }}
          className="btn btn-primary w-full"
        >
          Create package.json
        </button>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="space-y-3 p-4">
        <h3 className="eyebrow">package.json</h3>
        <p className="text-sm text-danger">package.json isn&apos;t valid JSON. Fix it in the editor to use this panel.</p>
        <button onClick={() => dispatch({ type: 'open', path: 'package.json' })} className="btn btn-secondary w-full">Open package.json</button>
      </div>
    );
  }

  const field = (key: 'name' | 'version' | 'description', label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input value={(parsed[key] as string) ?? ''} onChange={(e) => write({ ...parsed, [key]: e.target.value })} className="input" />
    </label>
  );
  const bin = typeof parsed.bin === 'string' ? { [parsed.name ?? 'cli']: parsed.bin } : parsed.bin ?? {};

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <h3 className="eyebrow">package.json</h3>
        <button onClick={() => dispatch({ type: 'open', path: 'package.json' })} className="btn btn-ghost btn-sm">Open file</button>
      </div>
      <div className="space-y-3">
        {field('name', 'Name')}
        {field('version', 'Version')}
        {field('description', 'Description')}
      </div>
      <KeyValueList title="Commands (bin)" entries={bin} onChange={(next) => write({ ...parsed, bin: next })} keyPlaceholder="command" valuePlaceholder={project.entry || 'src/main.ts'} />
      <KeyValueList title="Scripts" entries={parsed.scripts ?? {}} onChange={(next) => write({ ...parsed, scripts: next })} keyPlaceholder="name" valuePlaceholder="scriptc build …" />
      <KeyValueList title="Dependencies" entries={parsed.dependencies ?? {}} onChange={(next) => write({ ...parsed, dependencies: next })} keyPlaceholder="package" valuePlaceholder="^1.0.0" />
      <p className="text-xs text-gray-500">
        Dependencies are recorded for export and publishing. The build server compiles your sources as they are and doesn&apos;t install npm packages; locally, scriptc can compile some packages statically with <span className="font-mono">--npm-static</span>.
      </p>
    </div>
  );
}
