'use client';

/**
 * The assistant's provider, model and API keys. Kept in this browser only
 * (localStorage, separate from the rest of the settings so resets and exports
 * never touch keys) and shared between components through a tiny store.
 */

import { useSyncExternalStore } from 'react';
import { EMPTY_AI_CONFIG, type AiConfig } from '@/lib/ai-providers';

const KEY = 'nanocli:ai';
const listeners = new Set<() => void>();
let cached: AiConfig | null = null;

function read(): AiConfig {
  if (cached) return cached;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AiConfig> | null;
    cached = { ...EMPTY_AI_CONFIG, ...stored, models: { ...stored?.models }, keys: { ...stored?.keys }, baseUrls: { ...stored?.baseUrls } };
  } catch {
    cached = EMPTY_AI_CONFIG;
  }
  return cached;
}

export function updateAiConfig(patch: Partial<AiConfig> | ((prev: AiConfig) => Partial<AiConfig>)) {
  const prev = read();
  cached = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // storage blocked: keep it for this tab only
  }
  listeners.forEach((l) => l());
}

export function forgetAiKeys() {
  updateAiConfig({ keys: {} });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cached = null;
    listener();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

export function useAiConfig(): AiConfig {
  return useSyncExternalStore(subscribe, read, () => EMPTY_AI_CONFIG);
}
