'use client';

/**
 * The user's connectors, kept in this browser only (like their model keys) and
 * shared between components through a tiny store. Tokens and API keys in a
 * connector's configuration are sent to the studio server only with the call
 * that needs them, and the server never stores them.
 */

import { useSyncExternalStore } from 'react';
import { parseConnector, type Connector } from '@/lib/connectors/types';

const KEY = 'nanocli:connectors';
const listeners = new Set<() => void>();
const EMPTY: Connector[] = [];
let cached: Connector[] | null = null;

function read(): Connector[] {
  if (cached) return cached;
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    // Anything that no longer validates is dropped rather than trusted
    cached = (Array.isArray(stored) ? stored : []).map(parseConnector).filter((c): c is Connector => !('error' in c));
  } catch {
    cached = EMPTY;
  }
  return cached;
}

export function saveConnectors(next: Connector[]): void {
  cached = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked: keep it for this tab only
  }
  listeners.forEach((l) => l());
}

export const upsertConnector = (connector: Connector) => {
  const list = read();
  saveConnectors(list.some((c) => c.id === connector.id) ? list.map((c) => (c.id === connector.id ? connector : c)) : [...list, connector]);
};

export const removeConnector = (id: string) => saveConnectors(read().filter((c) => c.id !== id));

export const newConnectorId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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

export function useConnectors(): Connector[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}

export function getConnectors(): Connector[] {
  return read();
}
