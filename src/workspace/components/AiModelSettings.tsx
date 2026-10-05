'use client';

import { useEffect, useId, useState } from 'react';
import { COST_LABEL, PROVIDERS, getProvider, listModels, resolveProvider, streamChat, type Provider } from '@/lib/ai-providers';
import { forgetAiKeys, updateAiConfig, useAiConfig } from '../ai-config';
import { useToast } from '../toasts';

/** Whether the studio server has its own model configured */
export function useServerAi(): boolean | null {
  const [configured, setConfigured] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    fetch('/api/ai')
      .then((r) => r.json())
      .then((d) => live && setConfigured(!!d.configured))
      .catch(() => live && setConfigured(false));
    return () => {
      live = false;
    };
  }, []);
  return configured;
}

const GROUPS: { title: string; filter: (p: Provider) => boolean }[] = [
  { title: 'Free', filter: (p) => p.cost === 'free' || p.cost === 'free-tier' },
  { title: 'Your paid key', filter: (p) => p.cost === 'paid' },
];

/**
 * Pick a provider and model, add a key, fetch the live model list and test
 * the connection. Used in Settings and as the assistant's first-run screen.
 */
export function AiModelSettings({ compact = false, onSelect }: { compact?: boolean; onSelect?: (id: string) => void }) {
  const config = useAiConfig();
  const { notify } = useToast();
  const serverAi = useServerAi();
  const [fetched, setFetched] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<'models' | 'test' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const listId = useId();

  const provider = getProvider(config.provider);
  const groups = [...GROUPS, ...(serverAi ? [{ title: 'Hosted', filter: (p: Provider) => p.cost === 'host' }] : [])];

  const select = (id: string) => {
    updateAiConfig({ provider: id });
    onSelect?.(id);
    setStatus(null);
    setShowKey(false);
  };

  const fetchModels = async () => {
    if (!provider) return;
    const resolved = resolveProvider({ ...config, models: { ...config.models, [provider.id]: 'x' } });
    if ('error' in resolved) {
      setStatus({ ok: false, text: resolved.error });
      return;
    }
    setBusy('models');
    setStatus(null);
    try {
      const models = await listModels(resolved);
      setFetched((prev) => ({ ...prev, [provider.id]: models }));
      setStatus({ ok: true, text: `${models.length} models available${provider.id === 'openrouter' ? ' — free ones are listed first' : ''}.` });
      if (models.length && !config.models[provider.id] && !provider.models.length) {
        updateAiConfig((prev) => ({ models: { ...prev.models, [provider.id]: models[0] } }));
      }
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    const resolved = resolveProvider(config);
    if ('error' in resolved) {
      setStatus({ ok: false, text: resolved.error });
      return;
    }
    setBusy('test');
    setStatus(null);
    const started = performance.now();
    try {
      if (resolved.provider.kind === 'server') {
        const r = await fetch('/api/ai');
        const d = await r.json();
        setStatus(d.configured ? { ok: true, text: 'The studio server has a model configured.' } : { ok: false, text: 'The studio server has no model configured.' });
        return;
      }
      let reply = '';
      for await (const text of streamChat(resolved, 'Reply with exactly: OK', [{ role: 'user', content: 'Ping' }], AbortSignal.timeout(30_000))) {
        reply += text;
        if (reply.length > 40) break;
      }
      const ms = Math.round(performance.now() - started);
      setStatus({ ok: true, text: `Connected to ${resolved.model} in ${ms} ms${reply.trim() ? ` — “${reply.trim().slice(0, 40)}”` : ''}.` });
    } catch (error) {
      setStatus({ ok: false, text: (error as Error).name === 'TimeoutError' ? 'No answer within 30 s.' : (error as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const models = provider ? [...new Set([...(fetched[provider.id] ?? []), ...provider.models])] : [];
  const model = provider ? config.models[provider.id] ?? provider.models[0] ?? '' : '';

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <fieldset key={group.title}>
          <legend className="eyebrow mb-2">{group.title}</legend>
          <div className={`grid gap-2 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
            {PROVIDERS.filter(group.filter).map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => select(p.id)}
                aria-pressed={config.provider === p.id}
                className={`surface flex flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.07] ${
                  config.provider === p.id ? 'outline outline-1 outline-gray-100' : ''
                }`}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="text-sm font-medium text-gray-100">{p.name}</span>
                  <span className="badge px-1.5 py-0 text-[10px]">{COST_LABEL[p.cost]}</span>
                </span>
                {!compact && <span className="line-clamp-2 text-xs text-gray-500">{p.note}</span>}
              </button>
            ))}
          </div>
        </fieldset>
      ))}

      {provider && (
        <div className="surface space-y-3 p-4">
          <p className="text-xs leading-relaxed text-gray-400">{provider.note}</p>

          {provider.editableUrl && (
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Server URL</span>
              <input
                value={config.baseUrls[provider.id] ?? provider.baseUrl}
                onChange={(e) => updateAiConfig((prev) => ({ baseUrls: { ...prev.baseUrls, [provider.id]: e.target.value.trim() } }))}
                placeholder="http://localhost:8080/v1"
                spellCheck={false}
                className="input h-9 font-mono text-xs"
              />
            </label>
          )}

          {provider.kind !== 'server' && (
            <label className="block">
              <span className="mb-1 flex items-center justify-between text-xs text-gray-400">
                <span>API key{provider.needsKey ? '' : ' (optional)'}</span>
                {provider.keyUrl && (
                  <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-gray-300 underline-offset-2 hover:underline">
                    Get a {provider.cost === 'free-tier' ? 'free ' : ''}key ↗
                  </a>
                )}
              </span>
              <span className="flex gap-2">
                <input
                  type={showKey ? 'text' : 'password'}
                  value={config.keys[provider.id] ?? ''}
                  onChange={(e) => updateAiConfig((prev) => ({ keys: { ...prev.keys, [provider.id]: e.target.value.trim() } }))}
                  placeholder={provider.needsKey ? 'Paste your key' : 'Not needed'}
                  autoComplete="off"
                  spellCheck={false}
                  className="input h-9 font-mono text-xs"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} className="btn btn-ghost btn-sm h-9 shrink-0" aria-pressed={showKey}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </span>
            </label>
          )}

          {provider.kind !== 'server' && (
            <label className="block">
              <span className="mb-1 block text-xs text-gray-400">Model</span>
              <span className="flex gap-2">
                <input
                  list={listId}
                  value={model}
                  onChange={(e) => updateAiConfig((prev) => ({ models: { ...prev.models, [provider.id]: e.target.value.trim() } }))}
                  placeholder="model id"
                  spellCheck={false}
                  className="input h-9 font-mono text-xs"
                />
                <button type="button" onClick={fetchModels} disabled={busy !== null} className="btn btn-secondary btn-sm h-9 shrink-0">
                  {busy === 'models' ? 'Loading…' : 'Fetch models'}
                </button>
              </span>
              <datalist id={listId}>
                {models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={test} disabled={busy !== null} className="btn btn-primary btn-sm">
              {busy === 'test' ? 'Testing…' : 'Test connection'}
            </button>
            {status && (
              <span role="status" className={`text-xs ${status.ok ? 'text-gray-300' : 'text-danger'}`}>
                {status.text}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
        <p className="max-w-md">
          Keys stay in this browser and go straight to the provider — never to the studio server. Anyone with access to this
          browser profile can read them.
        </p>
        <button
          type="button"
          onClick={() => {
            forgetAiKeys();
            notify({ kind: 'info', title: 'API keys removed from this browser' });
          }}
          className="btn btn-ghost btn-sm"
        >
          Forget all keys
        </button>
      </div>
    </div>
  );
}
