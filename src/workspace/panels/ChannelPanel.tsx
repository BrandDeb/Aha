'use client';

import { useMemo, useState } from 'react';
import { YOU, type ChannelMessage, type ChannelMode, type MessageKind } from '@/lib/agent/channel';
import { ago, useProposals } from '../proposals';
import { useChannelUpdates } from '../channel-client';

const MODES: { id: ChannelMode; label: string; hint: string }[] = [
  { id: 'open', label: 'Open', hint: 'Agents tell each other what they changed and ask each other questions.' },
  { id: 'ask', label: 'Ask first', hint: 'Messages from one agent to another wait for your OK. Questions to you never wait.' },
  { id: 'off', label: 'Off', hint: 'Each agent works alone, as before.' },
];

const KIND: Record<MessageKind, { label: string; tone: string }> = {
  decision: { label: 'decision', tone: 'text-accent' },
  question: { label: 'question', tone: 'text-warn' },
  answer: { label: 'answer', tone: 'text-gray-300' },
  handoff: { label: 'handoff', tone: 'text-gray-300' },
  note: { label: 'note', tone: 'text-gray-500' },
};

/** The project channel: what the agents told each other, their questions to you, and your messages to them */
export function ChannelPanel() {
  const { channel, prefs, setPrefs, open } = useProposals();
  useChannelUpdates(channel);
  const [text, setText] = useState('');
  const [to, setTo] = useState('');
  const [query, setQuery] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});

  const members = channel.members();
  const working = members.filter((m) => m.status === 'working');
  const all = channel.messages();
  const answered = useMemo(() => new Set(all.filter((m) => m.kind === 'answer' && !m.status).map((m) => m.replyTo)), [all]);
  const shown = (query.trim() ? channel.search(query, 200) : all.filter((m) => m.status !== 'declined')).slice(-120);
  const nameOf = (id?: string) => (!id ? 'everyone' : id === YOU ? 'you' : members.find((m) => m.id === id)?.label ?? id);

  const send = () => {
    if (!text.trim()) return;
    channel.post({ from: YOU, kind: 'note', text, ...(to ? { to } : {}) });
    setText('');
  };

  const row = (m: ChannelMessage) => {
    const forYou = m.kind === 'question' && m.to === YOU && !m.status && !answered.has(m.id);
    return (
      <li key={m.id} className={`rounded-lg border p-2.5 ${forYou ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]' : m.status === 'held' ? 'border-dashed border-border-strong' : 'border-border'}`}>
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="text-gray-200">{m.from === YOU ? 'You' : m.fromLabel}</span>
          <span className="text-gray-500">→ {nameOf(m.to)}</span>
          <span className={`ml-1 ${KIND[m.kind].tone}`}>{KIND[m.kind].label}</span>
          {m.status === 'held' && <span className="text-warn">waiting for your OK</span>}
          <span className="ml-auto text-gray-500">{ago(m.at)}</span>
        </div>
        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-100">{m.text}</p>
        {m.status === 'held' && (
          <div className="mt-2 flex gap-1.5">
            <button onClick={() => channel.approve(m.id)} className="btn btn-primary btn-sm h-6">Pass it on</button>
            <button onClick={() => channel.decline(m.id)} className="btn btn-ghost btn-sm h-6">Decline</button>
          </div>
        )}
        {forYou && (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const reply = answers[m.id]?.trim();
              if (!reply) return;
              channel.answer(YOU, m.id, reply);
              setAnswers(({ [m.id]: _, ...rest }) => rest);
            }}
          >
            <input value={answers[m.id] ?? ''} onChange={(e) => setAnswers({ ...answers, [m.id]: e.target.value })} placeholder="Your answer" aria-label={`Answer ${m.fromLabel}`} className="input h-7 flex-1 text-xs" autoFocus />
            <button type="submit" className="btn btn-primary btn-sm h-7">Answer</button>
          </form>
        )}
      </li>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="space-y-3 border-b border-border p-4">
        <h3 className="eyebrow">Channel</h3>
        <p className="text-xs leading-relaxed text-gray-400">
          Running agents talk here: they post what they changed that others depend on, ask each other or you, and answer. You can write to all of them or to one. The history is saved in <code className="font-mono">.aha/channels/</code>, and later agents search it.
        </p>
        <div role="radiogroup" aria-label="Who may talk" className="grid grid-cols-3 gap-1 rounded-lg border border-border p-0.5">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={prefs.channel === m.id} title={m.hint} onClick={() => setPrefs({ channel: m.id })} className={`h-7 rounded-md text-xs ${prefs.channel === m.id ? 'bg-white/[0.1] text-gray-100' : 'text-gray-400 hover:text-gray-100'}`}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-gray-500">{MODES.find((m) => m.id === prefs.channel)?.hint}</p>
        {working.length > 0 && (
          <div className="flex flex-wrap gap-1" aria-label="Agents on the channel">
            {working.map((m) => (
              <button key={m.id} onClick={() => open(m.id)} title={m.goal} className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] text-gray-300 hover:text-gray-100">
                <span className="dot animate-pulse text-accent" aria-hidden="true" />
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the history" aria-label="Search the channel" className="input mb-3 h-8 w-full text-xs" />
        {shown.length === 0 ? (
          <p className="text-sm text-gray-500">{query ? 'Nothing matches.' : 'Quiet so far. Start two tasks that touch each other (say, the API and the page that calls it) and they will talk here.'}</p>
        ) : (
          <ol className="space-y-2" aria-label="Channel messages">{shown.map(row)}</ol>
        )}
      </div>

      <form
        className="space-y-1.5 border-t border-border p-3"
        aria-label="Write to the agents"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="flex gap-1.5">
          <select value={to} onChange={(e) => setTo(e.target.value)} aria-label="To" className="input h-8 w-auto text-xs">
            <option value="">Everyone</option>
            {working.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={prefs.channel === 'off' ? 'The channel is off' : 'Tell the agents something'} disabled={prefs.channel === 'off'} aria-label="Message" className="input h-8 flex-1 text-sm" />
          <button type="submit" disabled={!text.trim() || prefs.channel === 'off'} className="btn btn-primary btn-sm h-8">Send</button>
        </div>
      </form>
    </div>
  );
}
