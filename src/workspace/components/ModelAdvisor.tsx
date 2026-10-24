'use client';

import { useState } from 'react';
import { getProvider, keyWarning, listModels, sanitizeKey } from '@/lib/ai-providers';
import { advise, keysToGet, PRIORITIES, type Advice, type Priority } from '@/lib/model-advisor';
import { updateAiConfig, useAiConfig } from '../ai-config';
import { useToast } from '../toasts';
import { Check, External, Key } from './Icons';

/** Which model for which job, and why: a recommendation per job, the keys it needs, and one click to use it */
export function ModelAdvisor() {
  const config = useAiConfig();
  const { notify } = useToast();
  const [priority, setPriority] = useState<Priority>('best');
  const advice = advise(priority, config.keys);
  const missing = keysToGet(advice);

  const current = (a: Advice) => {
    const own = a.job.id === 'agent' ? null : config.jobs?.[a.job.id];
    const providerId = own?.provider || config.provider;
    const provider = getProvider(providerId);
    if (!provider) return 'Not set';
    const model = own?.model || config.models[providerId] || provider.models[0] || '';
    return `${provider.name}${model ? ` · ${model}` : ''}${own ? '' : a.job.id === 'agent' ? '' : ' (same as the agent)'}`;
  };

  const apply = () => {
    const ready = advice.filter((a) => a.ready);
    if (!ready.length) {
      notify({ kind: 'info', title: 'Add a key first', detail: 'Each recommendation needs its key: get one with the links above and paste it in.' });
      return;
    }
    updateAiConfig((prev) => {
      const next = { models: { ...prev.models }, jobs: { ...prev.jobs }, provider: prev.provider };
      for (const a of ready) {
        if (a.job.id === 'agent') {
          next.provider = a.provider;
          if (a.model) next.models[a.provider] = a.model;
        } else next.jobs[a.job.id] = { provider: a.provider, model: a.model };
      }
      return next;
    });
    const waiting = advice.filter((a) => !a.ready).map((a) => a.job.name);
    notify({ kind: 'success', title: `Set up ${ready.map((a) => a.job.name).join(', ')}`, detail: waiting.length ? `${waiting.join(', ')} keep their current model until you add the key they need.` : 'Every job now uses its recommended model.' });
  };

  return (
    <section className="space-y-4" aria-label="Recommended models">
      <div>
        <h3 className="eyebrow mb-1">Which model for which job</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          The studio does four different jobs, and the best model for each is not the same. Pick what matters to you; each recommendation says why.
        </p>
      </div>

      <div role="radiogroup" aria-label="What matters most" className="grid grid-cols-3 gap-1.5">
        {PRIORITIES.map((p) => (
          <button
            key={p.id}
            role="radio"
            aria-checked={priority === p.id}
            onClick={() => setPriority(p.id)}
            className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${priority === p.id ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : 'border-border hover:border-border-strong'}`}
          >
            <span className="block text-xs font-medium text-gray-100">{p.label}</span>
            <span className="mt-0.5 block text-[11px] leading-snug text-gray-500">{p.detail}</span>
          </button>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="space-y-2 rounded-lg border border-border p-3" aria-label="Keys to get">
          <div className="flex items-center gap-1.5 text-xs font-medium text-gray-100">
            <Key size={14} /> {missing.length === 1 ? 'One key to get' : `${missing.length} keys to get`}
          </div>
          {missing.map((k) => (
            <KeyRow key={k.provider} provider={k.provider} name={k.providerName} url={k.keyUrl} jobs={k.jobs} />
          ))}
          <p className="text-[11px] text-gray-500">Keys stay in this browser and go only to their provider.</p>
        </div>
      )}

      <ul className="space-y-2">
        {advice.map((a) => (
          <li key={a.job.id} className="rounded-lg border border-border p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-100">{a.job.name}</div>
                <div className="text-[11px] text-gray-500">{a.job.does}</div>
              </div>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${a.ready ? 'bg-[var(--accent-soft)] text-accent' : 'bg-white/[0.06] text-gray-400'}`}>
                {a.ready ? 'ready' : 'needs a key'}
              </span>
            </div>
            <div className="mt-2 font-mono text-xs text-gray-200">
              {a.providerName}
              {a.model ? ` · ${a.model}` : ''}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">{a.why}</p>
            <p className="mt-1 text-[11px] text-gray-500">
              {a.cost} · Now: {current(a)}
            </p>
            {a.better && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                Better with {/^[AEIOU]/.test(a.better.providerName) ? 'an' : 'a'} {a.better.providerName} key ({a.better.model}).{' '}
                {a.better.keyUrl && (
                  <a href={a.better.keyUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                    Get one
                  </a>
                )}
              </p>
            )}
          </li>
        ))}
      </ul>

      <button onClick={apply} className="btn btn-primary btn-sm w-full">
        Use this setup
      </button>
    </section>
  );
}

/** Get a key from the provider's page, paste it, and check it works */
function KeyRow({ provider, name, url, jobs }: { provider: string; name: string; url: string; jobs: string[] }) {
  const [value, setValue] = useState('');
  const [state, setState] = useState<{ ok: boolean; text: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const p = getProvider(provider)!;
  const hint = value ? keyWarning(provider, sanitizeKey(value)) : null;

  const save = async () => {
    const key = sanitizeKey(value);
    if (!key) return;
    setChecking(true);
    setState(null);
    try {
      // Listing the models is a free call that fails exactly when the key is wrong
      const models = await listModels({ provider: p, baseUrl: p.baseUrl, apiKey: key });
      updateAiConfig((prev) => ({ keys: { ...prev.keys, [provider]: key } }));
      setState({ ok: true, text: `Works: ${models.length} models available.` });
      setValue('');
    } catch (error) {
      setState({ ok: false, text: (error as Error).message });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-gray-200">
          {name} <span className="text-gray-500">· for {jobs.join(', ')}</span>
        </span>
        <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-accent hover:underline">
          Get a key <External size={12} />
        </a>
      </div>
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={`Paste your ${name} key`}
          aria-label={`${name} API key`}
          autoComplete="off"
          spellCheck={false}
          className="input h-8 flex-1 font-mono text-xs"
        />
        <button type="submit" disabled={!value.trim() || checking} className="btn btn-secondary btn-sm h-8">
          {checking ? 'Checking…' : 'Save'}
        </button>
      </form>
      {hint && <p className="text-[11px] text-warn">{hint}</p>}
      {state && (
        <p className={`flex items-center gap-1 text-[11px] ${state.ok ? 'text-accent' : 'text-danger'}`} role="status">
          {state.ok && <Check size={12} />} {state.text}
        </p>
      )}
    </div>
  );
}
