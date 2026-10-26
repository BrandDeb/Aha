'use client';

/**
 * The project's agent channel, in the studio: one channel per project, its history read from (and written back to)
 * `.aha/channels/<day>.jsonl` so it travels with the project and later agents can search it.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import { createChannel, historyFiles, readHistory, type Channel, type ChannelMode } from '@/lib/agent/channel';
import type { Project } from './project';
import type { Action } from './store';

const SAVE_DELAY = 1500;

/** A short name for an agent on the channel: the part before a colon, or the first words of its task */
export function agentLabel(goal: string): string {
  const line = goal.trim().split('\n')[0];
  const head = /^([^:]{2,40}):/.exec(line)?.[1];
  if (head) return head.trim();
  const words = line.split(/\s+/).slice(0, 5).join(' ');
  return words.length < line.length ? `${words}…` : words;
}

export function useProjectChannel(project: Project, dispatch: (action: Action) => void, mode: ChannelMode) {
  const modeRef = useRef(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  const projectRef = useRef(project);
  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const save = useCallback(
    (channel: Channel) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const files = historyFiles(projectRef.current.files, channel.messages());
        if (Object.keys(files).length) dispatch({ type: 'put', files });
      }, SAVE_DELAY);
    },
    [dispatch]
  );

  // One channel per project; running agents keep the same one while the project stays open
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the history is read once, when the project opens
  const channel = useMemo(() => {
    // The channel reads the mode and saves only when an agent posts, never while rendering
    // eslint-disable-next-line react-hooks/refs
    const created: Channel = createChannel({ mode: () => modeRef.current, history: readHistory(project.files), onMessage: () => save(created) });
    return created;
  }, [project.name, save]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  return channel;
}

/** Re-render when the channel changes (a message, an answer, an approval, someone joining or finishing) */
export function useChannelUpdates(channel: Channel): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    return channel.subscribe(bump);
  }, [channel]);
}
