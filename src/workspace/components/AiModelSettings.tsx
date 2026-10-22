'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import {
  COST_LABEL,
  PROVIDERS,
  getProvider,
  isBuiltInSuggestion,
  keyWarning,
  listModels,
  resolveForListing,
  resolveProvider,
  sanitizeKey,
  streamChat,
  type ModelInfo,
  type Provider,
} from '@/lib/ai-providers';
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
  const [fetched, setFetched] = useState<Record<string, ModelInfo[]>>({});
  const [loading, setLoading] = useState(false);
  const [listNote, setListNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState<'test' | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [filter, setFilter] = useState('');
  const [choosing, setChoosing] = useState(false);

  const provider = getProvider(config.provider);
  const groups = [...GROUPS, ...(serverAi ? [{ title: 'Hosted', filter: (p: Provider) => p.cost === 'host' }] : [])];

  const select = (id: string) => {
    updateAiConfig({ provider: id });
    onSelect?.(id);
    setStatus(null);
    setListNote(null);
    setFilter('');
    setShowKey(false);
    setChoosing(false);
  };

  /** Read the provider's live model list and replace a saved default it no longer offers */
  const loadModels = async (signal?: AbortSignal) => {
    if (!provider) return;
    const target = resolveForListing(config);
    if ('error' in target) {
      setListNote({ ok: false, text: target.error });
      return;
    }
    setLoading(true);
    setListNote(null);
    try {
      const models = await listModels(target, signal);
      setFetched((prev) => ({ ...prev, [provider.id]: models }));
      const saved = config.models[provider.id];
      const effective = saved ?? provider.models[0];
      const offered = new Set(models.map((m) => m.id));
      // Only replace a built-in suggestion, never a model id the user typed themselves
      if (models.length && (!effective || (!offered.has(effective) && (!saved || isBuiltInSuggestion(provider, saved))))) {
        const next = provider.models.find((id) => offered.has(id)) ?? models[0].id;
        updateAiConfig((prev) => ({ models: { ...prev.models, [provider.id]: next } }));
        setListNote({ ok: true, text: effective ? `${effective} isn’t offered any more — switched to ${next}.` : `Selected ${next}.` });
      } else {
        setListNote({ ok: true, text: `${models.length} chat models, newest first${models.some((m) => m.free) ? ' — free ones on top' : ''}.` });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setListNote({ ok: false, text: (error as Error).message });
    } finally {
      setLoading(false);
    }
  };
  // Effects must call it through an Effect Event so they always see the latest config
  const loadInEffect = useEffectEvent((signal: AbortSignal) => loadModels(signal));

  // Load the list as soon as there's enough to ask (provider chosen, key pasted), after a short pause for typing
  const listing = provider ? resolveForListing(config) : null;
  const listKey = listing && !('error' in listing) ? `${listing.provider.id}|${listing.baseUrl}|${listing.apiKey}` : '';
  useEffect(() => {
    if (!listKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => void loadInEffect(controller.signal), 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [listKey]);

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

  const model = provider ? config.models[provider.id] ?? provider.models[0] ?? '' : '';
  const live = provider ? fetched[provider.id] : undefined;
  const options: ModelInfo[] = live ?? (provider?.models ?? []).map((id) => ({ id }));
  const needle = filter.trim().toLowerCase();
  const shown = needle ? options.filter((m) => m.id.toLowerCase().includes(needle)) : options;
  const keyHint = provider ? keyWarning(provider.id, config.keys[provider.id] ?? '') : null;

  // In the narrow side panel, collapse the provider cards once one is chosen so the key and model list fit
  const collapsed = compact && !!provider && !choosing;

  return (
    <div className="space-y-4">
      {collapsed && provider && (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="eyebrow">Provider</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="truncate text-sm font-medium text-gray-100">{provider.name}</span>
              <span className="badge px-1.5 py-0 text-[10px]">{COST_LABEL[provider.cost]}</span>
            </div>
          </div>
          <button type="button" onClick={() => setChoosing(true)} className="btn btn-secondary btn-sm shrink-0">Change</button>
        </div>
      )}

      {!collapsed && groups.map((group) => (
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
                  config.provider === p.id ? 'outline outline-1 outline-accent' : ''
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
                  onChange={(e) => updateAiConfig((prev) => ({ keys: { ...prev.keys, [provider.id]: sanitizeKey(e.target.value) } }))}
                  placeholder={provider.needsKey ? 'Paste your key' : 'Not needed'}
                  autoComplete="off"
                  spellCheck={false}
                  className="input h-9 font-mono text-xs"
                />
                <button type="button" onClick={() => setShowKey((v) => !v)} className="btn btn-ghost btn-sm h-9 shrink-0" aria-pressed={showKey}>
                  {showKey ? 'Hide' : 'Show'}
                </button>
              </span>
              {keyHint && <span className="mt-1.5 block text-xs text-amber-300">{keyHint}</span>}
            </label>
          )}

          {provider.kind !== 'server' && (
            <div>
              <label className="block">
                <span className="mb-1 flex items-center justify-between text-xs text-gray-400">
                  <span>Model</span>
                  <button type="button" onClick={() => void loadModels()} disabled={loading} className="text-gray-300 underline-offset-2 hover:underline disabled:opacity-50">
                    {loading ? 'Loading…' : 'Refresh list'}
                  </button>
                </span>
                <input
                  value={model}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    updateAiConfig((prev) => ({ models: { ...prev.models, [provider.id]: e.target.value.trim() } }));
                  }}
                  placeholder="Pick one below, or type a model id"
                  spellCheck={false}
                  className="input h-9 font-mono text-xs"
                />
              </label>
              {(listNote || !live) && (
                <p
                  role={listNote && !listNote.ok ? 'alert' : 'status'}
                  className={`mt-1.5 text-xs ${listNote && !listNote.ok ? 'text-danger' : 'text-gray-500'}`}
                >
                  {listNote?.text ??
                    (provider.needsKey && !provider.publicModelList ? 'Suggestions only — paste your key to load the full, current list.' : 'Loading the current list…')}
                </p>
              )}
              {shown.length > 0 && (
                <ul role="listbox" aria-label="Models" className="mt-2 max-h-48 divide-y divide-border overflow-y-auto rounded-lg border border-border">
                  {shown.slice(0, 150).map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={m.id === model}
                        onClick={() => {
                          setFilter('');
                          updateAiConfig((prev) => ({ models: { ...prev.models, [provider.id]: m.id } }));
                        }}
                        className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left font-mono text-xs transition-colors hover:bg-white/[0.06] ${
                          m.id === model ? 'bg-[var(--accent-soft)] text-accent' : 'text-gray-200'
                        }`}
                      >
                        <span className="min-w-0 truncate">{m.id}</span>
                        <span className="flex shrink-0 items-center gap-1.5 font-sans text-[10px] text-gray-500">
                          {m.free && <span className="rounded bg-[var(--accent-soft)] px-1 text-accent">Free</span>}
                          {m.context ? <span>{m.context >= 1_000_000 ? `${Math.round(m.context / 100_000) / 10}M` : `${Math.round(m.context / 1000)}K`}</span> : null}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {needle && shown.length === 0 && <p className="mt-2 text-xs text-gray-500">No match in the list — “{model}” will be used as typed.</p>}
            </div>
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
