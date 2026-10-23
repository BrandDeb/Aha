'use client';

/** Talking to /api/doctor and /api/update from the browser. Both only exist when the studio runs on this machine. */

import { useCallback, useEffect, useState } from 'react';
import type { DoctorReport, FixId } from '@/lib/doctor';
import type { UpdateResult, UpdateStatus } from '@/lib/updater';

export type { DoctorReport, UpdateResult, UpdateStatus };

const JSON_POST = { method: 'POST', headers: { 'Content-Type': 'application/json' } } as const;

/** The studio can't maintain itself when it's hosted (the server answers 403), so the answer is just "not available" */
export async function fetchDoctor(): Promise<DoctorReport | null> {
  try {
    const response = await fetch('/api/doctor', { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

export async function applyDoctorFix(fix: FixId): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch('/api/doctor', { ...JSON_POST, body: JSON.stringify({ fix }) });
    const data = await response.json().catch(() => ({}));
    return response.ok ? data : { ok: false, message: data.error ?? `The server answered ${response.status}` };
  } catch {
    return { ok: false, message: 'Could not reach the studio server.' };
  }
}

export async function fetchUpdateStatus(refresh = false): Promise<UpdateStatus | null> {
  try {
    const response = await fetch(`/api/update${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

/** Run the update, reporting progress text as it arrives */
export async function runUpdate(onOutput: (text: string) => void): Promise<UpdateResult> {
  const fail = (error: string): UpdateResult => ({ ok: false, steps: [], restartRequired: false, error });
  let response: Response;
  try {
    response = await fetch('/api/update', { ...JSON_POST, body: JSON.stringify({ action: 'apply' }) });
  } catch {
    return fail('Could not reach the studio server.');
  }
  if (!response.ok || !response.body) return fail(((await response.json().catch(() => ({}))) as { error?: string }).error ?? `The server answered ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: UpdateResult | null = null;
  const handle = (line: string) => {
    if (!line.trim()) return;
    try {
      const event = JSON.parse(line);
      if (event.t === 'out') onOutput(event.d);
      else if (event.t === 'done') result = event;
    } catch {
      // a partial line
    }
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handle);
    }
    handle(buffer);
  } catch {
    return fail('The connection was interrupted. The update may still have finished; check again in a moment.');
  }
  return result ?? fail('The connection closed before the update finished.');
}

export async function restartStudio(): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch('/api/update', { ...JSON_POST, body: JSON.stringify({ action: 'restart' }) });
    return await response.json().catch(() => ({ ok: response.ok }));
  } catch {
    // the server going away mid-reply is what a restart looks like
    return { ok: true };
  }
}

/** What an update would bring, checked once when the studio opens (the server caches the answer for hours) */
export function useUpdateStatus(): { status: UpdateStatus | null; refresh: (force?: boolean) => Promise<void> } {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const refresh = useCallback(async (force = false) => setStatus(await fetchUpdateStatus(force)), []);
  useEffect(() => {
    let live = true;
    fetchUpdateStatus().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return { status, refresh };
}

// ---------------------------------------------------------------------------
// Autopilot: self-healing and opt-in self-updating (/api/autopilot)
// ---------------------------------------------------------------------------

export type { AutopilotState } from '@/lib/autopilot';
import type { AutopilotState } from '@/lib/autopilot';

export async function fetchAutopilot(): Promise<AutopilotState | null> {
  try {
    const response = await fetch('/api/autopilot', { cache: 'no-store' });
    return response.ok ? ((await response.json()) as AutopilotState) : null;
  } catch {
    return null;
  }
}

export async function saveAutopilot(body: { autoRepair?: boolean; autoUpdate?: boolean } | { action: 'run' }): Promise<AutopilotState | null> {
  try {
    const response = await fetch('/api/autopilot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return response.ok ? ((await response.json()) as AutopilotState) : null;
  } catch {
    return null;
  }
}
