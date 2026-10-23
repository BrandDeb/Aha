'use client';

import { useState } from 'react';
import { applyEdit, editableAt, type ElementLocation, type PickedElement } from '@/lib/visual-edit';

interface Props {
  element: PickedElement;
  location: ElementLocation | null;
  source: string | undefined;
  onOpen: (location: ElementLocation) => void;
  onWrite: (path: string, content: string) => void;
  onAsk: (request: string) => void;
  onPickAgain: () => void;
  onClose: () => void;
}

/**
 * The card for an element picked in the preview: where its code is, its text and classes to edit in place
 * (written to the source, so the preview and the code never disagree), and a box to ask the agent for anything else.
 */
export function ElementEditor({ element, location, source, onOpen, onWrite, onAsk, onPickAgain, onClose }: Props) {
  const editable = location && source !== undefined ? editableAt(source, location) : null;
  const [text, setText] = useState(editable?.text ?? '');
  const [classes, setClasses] = useState(editable?.classes ?? '');
  const [request, setRequest] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const changed = (editable?.text !== null && editable?.text !== undefined && text !== editable.text) || (editable?.classes !== null && editable?.classes !== undefined && classes !== editable.classes);

  const apply = () => {
    if (!location || source === undefined || !editable) return;
    const edit: { text?: string; classes?: string } = {};
    if (editable.text !== null && text !== editable.text) edit.text = text;
    if (editable.classes !== null && classes !== editable.classes) edit.classes = classes;
    const next = applyEdit(source, location, edit);
    if (next === null) setNote('That part of the element is not plain text in the code; ask the agent instead.');
    else {
      onWrite(location.file, next);
      setNote(`Saved to ${location.file}`);
    }
  };

  return (
    <section className="absolute inset-x-3 bottom-3 z-10 rounded-xl border border-border-strong bg-[var(--panel)] p-3 shadow-2xl" aria-label="Edit the picked element">
      <div className="flex items-center gap-2">
        <span className="rounded-md border border-[var(--accent-line)] bg-[var(--accent-soft)] px-1.5 font-mono text-[11px] text-accent">&lt;{element.tag}&gt;</span>
        {location ? (
          <button onClick={() => onOpen(location)} className="min-w-0 truncate font-mono text-[11px] text-gray-300 underline decoration-dotted underline-offset-2 hover:text-gray-100" title={location.exact ? 'Open the code that draws it' : 'Found by its text: open the likely code'}>
            {location.file}:{location.line}
            {location.exact ? '' : ' (likely)'}
          </button>
        ) : (
          <span className="text-[11px] text-gray-500">Its code wasn&apos;t found; the agent can look for it.</span>
        )}
        <span className="flex-1" />
        <button onClick={onPickAgain} className="btn btn-ghost btn-sm h-6 px-1.5 text-[11px]" title="Pick another element">Pick another</button>
        <button onClick={onClose} className="btn btn-ghost btn-icon btn-sm h-6" aria-label="Close" title="Close">✕</button>
      </div>

      {editable && (editable.text !== null || editable.classes !== null) && (
        <form
          className="mt-2 grid gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          {editable.text !== null && (
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <span className="w-12 shrink-0">Text</span>
              <input value={text} onChange={(e) => setText(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs text-gray-100 outline-none focus:border-[var(--accent-line)]" />
            </label>
          )}
          {editable.classes !== null && (
            <label className="flex items-center gap-2 text-[11px] text-gray-400">
              <span className="w-12 shrink-0">Classes</span>
              <input value={classes} onChange={(e) => setClasses(e.target.value)} spellCheck={false} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 font-mono text-[11px] text-gray-100 outline-none focus:border-[var(--accent-line)]" />
            </label>
          )}
          <div className="flex items-center gap-2">
            <button type="submit" disabled={!changed} className="btn btn-secondary btn-sm h-7">Apply to the code</button>
            {note && <span className="truncate text-[11px] text-gray-500" role="status">{note}</span>}
          </div>
        </form>
      )}

      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (request.trim()) onAsk(request);
        }}
      >
        <input
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          placeholder="Describe a change: “make it a pill”, “add an icon”, “only show when logged in”…"
          aria-label="Describe a change to this element"
          className="h-8 min-w-0 flex-1 rounded-md border border-border bg-transparent px-2 text-xs text-gray-100 outline-none placeholder:text-gray-600 focus:border-[var(--accent-line)]"
        />
        <button type="submit" disabled={!request.trim()} className="btn btn-primary btn-sm h-8">Ask the agent</button>
      </form>
    </section>
  );
}
