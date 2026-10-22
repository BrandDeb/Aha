'use client';

/**
 * Skills in the browser: the list the studio's server knows (built in and
 * installed), merged with the project's own skills, as the library the agent
 * uses; and the calls the Skills settings make.
 */

import { useCallback, useEffect, useState } from 'react';
import { projectSkills, type SkillDoc, type SkillLibrary, type SkillMeta } from '@/lib/skills/format';

export interface SkillIndex {
  writable: boolean;
  skills: SkillMeta[];
}

export async function fetchSkillIndex(): Promise<SkillIndex | null> {
  try {
    const response = await fetch('/api/skills', { cache: 'no-store' });
    return response.ok ? ((await response.json()) as SkillIndex) : null;
  } catch {
    return null;
  }
}

export async function fetchSkill(name: string): Promise<SkillDoc | null> {
  const response = await fetch(`/api/skills?name=${encodeURIComponent(name)}`, { cache: 'no-store' }).catch(() => null);
  return response?.ok ? ((await response.json()) as SkillDoc) : null;
}

export async function fetchSkillFile(name: string, file: string): Promise<string | null> {
  const response = await fetch(`/api/skills?name=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`, { cache: 'no-store' }).catch(() => null);
  return response?.ok ? ((await response.json()) as { text: string }).text : null;
}

/** POST an action to /api/skills; throws with the server's message */
export async function skillAction<T = { skills: SkillMeta[] }>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/skills', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `The studio answered ${response.status}`);
  return data as T;
}

/** What the agent can use: the project's skills (read live from its working copy) first, then the studio's */
export function skillLibrary(index: SkillMeta[], files: () => Record<string, string>): SkillLibrary {
  const project = () => projectSkills(files());
  return {
    list: () => [...project().map((s) => s.meta), ...index],
    load: async (name) => project().find((s) => s.meta.name === name) ?? fetchSkill(name),
    file: async (name, path) => {
      const own = project().find((s) => s.meta.name === name);
      if (own) {
        const dir = own.meta.source?.replace(/SKILL\.md$/i, '');
        return dir && own.files.includes(path) ? (files()[`${dir}${path}`] ?? null) : null;
      }
      return fetchSkillFile(name, path);
    },
  };
}

export function useSkillIndex(): { index: SkillIndex | null; refresh: () => void; set: (skills: SkillMeta[]) => void } {
  const [index, setIndex] = useState<SkillIndex | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetchSkillIndex().then((i) => live && setIndex(i));
    return () => {
      live = false;
    };
  }, [tick]);
  return {
    index,
    refresh: useCallback(() => setTick((n) => n + 1), []),
    set: useCallback((skills: SkillMeta[]) => setIndex((prev) => (prev ? { ...prev, skills } : prev)), []),
  };
}
