'use client';

/**
 * AI autocomplete in the editor: asks the model chosen for the Autocomplete job (or the main one) for the
 * text at the cursor, with the code around it and the files it imports. Off when there is no model, when
 * the extension is switched off, or for the keystrokes where a suggestion wouldn't help (mid-word, empty
 * files). Answers are cached, and a request is cancelled the moment you type on.
 */

import { useEffect, useRef } from 'react';
import { resolveFor, streamChat } from '@/lib/ai-providers';
import { cleanCompletion, CompletionCache, COMPLETION_SYSTEM, completionPrompt, relatedFiles, shouldComplete } from '@/lib/complete';
import { setInlineCompleter } from '@/components/CodeEditor';
import { useAiConfig } from './ai-config';

/** Stop reading once the answer is clearly longer than what will be shown */
const MAX_CHARS = 900;

export function useAutocomplete(files: Record<string, string>, enabled: boolean): void {
  const config = useAiConfig();
  const filesRef = useRef(files);
  const cache = useRef(new CompletionCache());
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    const target = resolveFor(config, 'complete');
    if (!enabled || 'error' in target || target.provider.kind === 'server') {
      setInlineCompleter(null);
      return;
    }
    setInlineCompleter(async ({ path, language, prefix, suffix }, signal) => {
      if (!shouldComplete(prefix, suffix)) return '';
      const req = { path, language, prefix, suffix, related: relatedFiles(path, { ...filesRef.current, [path]: prefix + suffix }) };
      const key = CompletionCache.key(req);
      const hit = cache.current.get(key);
      if (hit !== undefined) return hit;
      let raw = '';
      for await (const chunk of streamChat(target, COMPLETION_SYSTEM, [{ role: 'user', content: completionPrompt(req) }], signal)) {
        raw += chunk;
        if (raw.length > MAX_CHARS) break;
      }
      const text = cleanCompletion(raw, prefix, suffix);
      cache.current.set(key, text);
      return text;
    });
    return () => setInlineCompleter(null);
  }, [config, enabled]);
}
