'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Diagnostic } from '@/lib/compiler-browser';
import { isValidPath } from '../project';
import { useWorkspace } from '../store';
import { useToast } from '../toasts';

type Action = 'chat' | 'explain' | 'fix' | 'tests';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const LABELS: Record<Exclude<Action, 'chat'>, string> = {
  explain: 'Explain this file',
  fix: 'Fix the build errors',
  tests: 'Write tests for this file',
};

/** Split an answer into prose and fenced code blocks */
function parseBlocks(text: string): ({ type: 'text'; text: string } | { type: 'code'; lang: string; code: string })[] {
  const blocks: ({ type: 'text'; text: string } | { type: 'code'; lang: string; code: string })[] = [];
  const fence = /```(\w*)\n([\s\S]*?)(?:```|$)/g;
  let last = 0;
  for (const match of text.matchAll(fence)) {
    if (match.index! > last) blocks.push({ type: 'text', text: text.slice(last, match.index) });
    blocks.push({ type: 'code', lang: match[1], code: match[2].replace(/\n$/, '') });
    last = match.index! + match[0].length;
  }
  if (last < text.length) blocks.push({ type: 'text', text: text.slice(last) });
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('`') && part.endsWith('`') ? (
      <code key={i} className="rounded bg-white/[0.08] px-1 py-0.5 font-mono text-[0.85em] text-gray-100">{part.slice(1, -1)}</code>
    ) : part.startsWith('**') && part.endsWith('**') ? (
      <strong key={i} className="font-semibold text-gray-100">{part.slice(2, -2)}</strong>
    ) : (
      part
    )
  );
}

/** A block whose first line is `// path/to/file.ts` targets that file */
function targetPath(code: string): string | null {
  const first = code.split('\n')[0].trim();
  const match = /^(?:\/\/|#)\s*([\w./-]+\.\w+)\s*$/.exec(first);
  return match && isValidPath(match[1]) ? match[1] : null;
}

interface AiPanelProps {
  diagnostics: Diagnostic[];
  getSelection: () => string;
}

export function AiPanel({ diagnostics, getSelection }: AiPanelProps) {
  const { project, active, dispatch, saveSnapshot } = useWorkspace();
  const { notify } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const ask = async (action: Action, prompt = '') => {
    if (streaming) return;
    const shown = action === 'chat' ? prompt : `${LABELS[action]}${prompt ? `: ${prompt}` : ''}`;
    const history = messages.slice(-12);
    setMessages((prev) => [...prev, { role: 'user', content: shown }, { role: 'assistant', content: '' }]);
    setInput('');
    setStreaming(true);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          prompt,
          history,
          files: project.files,
          activeFile: active,
          selection: getSelection() || undefined,
          diagnostics: diagnostics.map((d) => ({ ...d, file: d.file ?? project.entry })),
        }),
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        const message = data.error || `The assistant returned ${response.status}`;
        if (response.status === 503) setUnavailable(message);
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: message }]);
        return;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: 'assistant', content: next[next.length - 1].content + chunk };
          return next;
        });
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') {
        setMessages((prev) => [...prev.slice(0, -1), { role: 'assistant', content: 'Could not reach the assistant. Check your connection and try again.' }]);
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  };

  const apply = (code: string) => {
    const target = targetPath(code) ?? active;
    if (!target) return;
    const body = targetPath(code) ? code.split('\n').slice(1).join('\n').replace(/^\n/, '') : code;
    saveSnapshot('Before applying assistant change');
    if (target in project.files) dispatch({ type: 'write', path: target, content: body.endsWith('\n') ? body : `${body}\n` });
    else dispatch({ type: 'create', path: target, content: body.endsWith('\n') ? body : `${body}\n` });
    dispatch({ type: 'open', path: target });
    notify({ kind: 'success', title: `Applied to ${target}`, detail: 'The previous version is in History.' });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-2 border-b border-border p-4">
        <div className="flex items-center justify-between">
          <h3 className="eyebrow">Assistant</h3>
          <span className="font-mono text-[11px] text-gray-500">Claude</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => ask('explain')} disabled={streaming || !active} className="btn btn-secondary btn-sm">Explain</button>
          <button onClick={() => ask('fix')} disabled={streaming || !diagnostics.length} className="btn btn-secondary btn-sm" title={diagnostics.length ? undefined : 'Compile first — there are no errors to fix'}>
            Fix errors{diagnostics.length ? ` · ${diagnostics.length}` : ''}
          </button>
          <button onClick={() => ask('tests')} disabled={streaming || !active} className="btn btn-secondary btn-sm">Generate tests</button>
        </div>
        {unavailable && <p className="text-xs text-gray-400">{unavailable}</p>}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite">
        {messages.length === 0 && (
          <p className="text-sm text-gray-500">
            Ask about your code. The assistant sees every file in the project, your selection and the latest scriptc errors.
          </p>
        )}
        {messages.map((message, i) =>
          message.role === 'user' ? (
            <div key={i} className="ml-6 rounded-2xl bg-white/[0.07] px-3.5 py-2.5 text-sm text-gray-100">{message.content}</div>
          ) : (
            <div key={i} className="space-y-2.5 text-sm leading-relaxed text-gray-300">
              {message.content === '' && streaming && i === messages.length - 1 && (
                <p className="flex items-center gap-2 text-gray-500">
                  <span className="h-3 w-3 animate-spin rounded-full border border-gray-600 border-t-gray-100" aria-hidden="true" />
                  Thinking…
                </p>
              )}
              {parseBlocks(message.content).map((block, j) =>
                block.type === 'text' ? (
                  block.text.split(/\n{2,}/).map((para, k) => para.trim() && <p key={`${j}-${k}`} className="whitespace-pre-wrap">{inline(para.trim())}</p>)
                ) : (
                  <div key={j} className="overflow-hidden rounded-xl border border-border">
                    <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
                      <span className="font-mono text-[11px] text-gray-500">{targetPath(block.code) ?? block.lang ?? 'code'}</span>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-ghost btn-sm h-6 px-2 text-xs"
                          onClick={() => {
                            navigator.clipboard.writeText(block.code);
                            notify({ kind: 'info', title: 'Copied to clipboard' });
                          }}
                        >Copy</button>
                        {(!streaming || i < messages.length - 1) && (
                          <button className="btn btn-ghost btn-sm h-6 px-2 text-xs" onClick={() => apply(block.code)}>
                            Apply{targetPath(block.code) ? '' : ` to ${active.split('/').pop()}`}
                          </button>
                        )}
                      </div>
                    </div>
                    <pre className="max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed text-gray-200">{block.code}</pre>
                  </div>
                )
              )}
            </div>
          )
        )}
      </div>

      <form
        className="border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim()) void ask('chat', input.trim());
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (input.trim()) void ask('chat', input.trim());
              }
            }}
            rows={2}
            placeholder="Ask about your code…"
            aria-label="Message the assistant"
            className="input min-h-[2.75rem] resize-none text-sm"
          />
          {streaming ? (
            <button type="button" onClick={() => abortRef.current?.abort()} className="btn btn-secondary">Stop</button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="btn btn-primary">Send</button>
          )}
        </div>
      </form>
    </div>
  );
}
