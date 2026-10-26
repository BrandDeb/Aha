/**
 * Agent channels: running agents talk to each other (and to you) instead of you relaying between them.
 *
 * One channel per project. Agents that join can post decisions and handoffs, ask another agent (or you) a question
 * and wait for the answer, and answer questions sent to them. A busy agent sees what was sent to it after its next
 * tool call (its inbox is appended to that tool's result), so questions are answered between its steps.
 *
 * Who may talk is yours to set: open, ask first (messages from one agent to another wait for your OK), or off.
 * History is kept as JSON lines, one file per day, so later agents can search past decisions.
 */

import type { Tool, ToolResult } from './types.ts';

export const CHANNEL_DIR = '.aha/channels';
export const YOU = 'you';

export type MessageKind = 'decision' | 'question' | 'answer' | 'handoff' | 'note';
export type ChannelMode = 'open' | 'ask' | 'off';

export interface ChannelMessage {
  id: string;
  at: number;
  /** An agent's id, or "you" */
  from: string;
  fromLabel: string;
  kind: MessageKind;
  text: string;
  /** An agent's id or "you"; absent means everyone */
  to?: string;
  /** The question this answers */
  replyTo?: string;
  /** Held: waits for your OK (ask-first mode). Declined: you said no, nobody else sees it */
  status?: 'held' | 'declined';
}

export interface Member {
  id: string;
  label: string;
  goal: string;
  status: 'working' | 'done';
  /** What it said when it finished: answers questions sent after it stopped */
  summary?: string;
}

export interface Channel {
  join(member: Omit<Member, 'status'>): void;
  finish(id: string, summary: string): void;
  members(): Member[];
  messages(): ChannelMessage[];
  post(message: Omit<ChannelMessage, 'id' | 'at' | 'status' | 'fromLabel'> & { fromLabel?: string }): ChannelMessage;
  /** Ask and wait for an answer (from the agent asked, or from you); null when none comes in time */
  ask(from: string, to: string, question: string, options?: { timeoutMs?: number; signal?: AbortSignal }): Promise<{ answer: string; by: string } | null>;
  answer(from: string, questionId: string, text: string): ChannelMessage | null;
  /** Release a held message (ask-first mode) or decline it */
  approve(id: string): void;
  decline(id: string): void;
  /** Messages for this member it hasn't seen yet (to it or to everyone, not its own, not held) */
  inbox(memberId: string): ChannelMessage[];
  /** Questions to this member that nobody has answered */
  openQuestions(memberId: string): ChannelMessage[];
  search(query: string, limit?: number): ChannelMessage[];
  subscribe(listener: () => void): () => void;
}

const DEFAULT_TIMEOUT = 120_000;

export function createChannel(options: { mode: () => ChannelMode; history?: ChannelMessage[]; now?: () => number; onMessage?: (m: ChannelMessage) => void }): Channel {
  const now = options.now ?? Date.now;
  const members = new Map<string, Member>();
  let messages: ChannelMessage[] = [...(options.history ?? [])];
  /** Where each member started reading, and what it has been shown since (held messages are shown once released) */
  const joinedAt = new Map<string, number>();
  const shown = new Map<string, Set<string>>();
  const waiters = new Map<string, (m: ChannelMessage) => void>();
  const listeners = new Set<() => void>();
  let counter = 0;

  const changed = () => {
    for (const l of [...listeners]) l();
  };
  const labelOf = (id: string) => (id === YOU ? 'You' : members.get(id)?.label ?? id);
  const visible = (m: ChannelMessage) => !m.status;

  const deliver = (m: ChannelMessage) => {
    if (m.kind === 'answer' && m.replyTo && visible(m)) {
      waiters.get(m.replyTo)?.(m);
      waiters.delete(m.replyTo);
    }
  };

  const replace = (id: string, patch: Partial<ChannelMessage>) => {
    messages = messages.map((m) => {
      if (m.id !== id) return m;
      const next = { ...m, ...patch };
      if (!('status' in patch) || patch.status === undefined) delete next.status;
      return next;
    });
  };

  const channel: Channel = {
    join(member) {
      members.set(member.id, { ...member, status: 'working' });
      // A new member reads from now on; history is searchable, not pushed
      joinedAt.set(member.id, messages.length);
      shown.set(member.id, new Set());
      changed();
    },
    finish(id, summary) {
      const m = members.get(id);
      if (!m) return;
      members.set(id, { ...m, status: 'done', summary });
      // Questions still waiting on it are answered with what it reported
      for (const q of channel.openQuestions(id)) channel.answer(id, q.id, `(${m.label} has finished.) ${summary}`.slice(0, 2000));
      changed();
    },
    members: () => [...members.values()],
    messages: () => messages,
    post(input) {
      const message: ChannelMessage = { ...input, id: `m${now().toString(36)}${(++counter).toString(36)}`, at: now(), fromLabel: input.fromLabel ?? labelOf(input.from), text: input.text.trim().slice(0, 4000) };
      // Ask first: what one agent sends another (or everyone) waits for you; you are always heard
      if (options.mode() === 'ask' && message.from !== YOU && message.to !== YOU) message.status = 'held';
      messages = [...messages, message];
      options.onMessage?.(message);
      deliver(message);
      changed();
      return message;
    },
    ask(from, to, question, { timeoutMs = DEFAULT_TIMEOUT, signal } = {}) {
      const target = to === YOU ? null : members.get(to);
      if (target?.status === 'done') {
        const q = channel.post({ from, kind: 'question', to, text: question });
        channel.answer(to, q.id, `(${target.label} has finished.) ${target.summary ?? ''}`.trim());
        return Promise.resolve({ answer: `(${target.label} has finished.) ${target.summary ?? 'It left no summary.'}`, by: target.label });
      }
      const q = channel.post({ from, kind: 'question', to, text: question });
      return new Promise((resolve) => {
        const done = (value: { answer: string; by: string } | null) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          waiters.delete(q.id);
          resolve(value);
        };
        const onAbort = () => done(null);
        const timer = setTimeout(() => done(null), timeoutMs);
        signal?.addEventListener('abort', onAbort);
        waiters.set(q.id, (m) => done({ answer: m.text, by: m.fromLabel }));
      });
    },
    answer(from, questionId, text) {
      const q = messages.find((m) => m.id === questionId && m.kind === 'question');
      if (!q) return null;
      if (messages.some((m) => m.kind === 'answer' && m.replyTo === questionId && visible(m))) return null;
      // An answer goes back to whoever asked, so you need not approve it in ask-first mode
      const message: ChannelMessage = { id: `m${now().toString(36)}${(++counter).toString(36)}`, at: now(), from, fromLabel: labelOf(from), kind: 'answer', text: text.trim().slice(0, 4000), to: q.from, replyTo: questionId };
      messages = [...messages, message];
      options.onMessage?.(message);
      deliver(message);
      changed();
      return message;
    },
    approve(id) {
      const m = messages.find((x) => x.id === id);
      if (!m || m.status !== 'held') return;
      replace(id, { status: undefined });
      deliver({ ...m, status: undefined });
      options.onMessage?.({ ...m, status: undefined });
      changed();
    },
    decline(id) {
      const m = messages.find((x) => x.id === id);
      if (!m || m.status !== 'held') return;
      replace(id, { status: 'declined' });
      // A declined question gets an answer saying so, so the asker doesn't wait for nothing
      if (m.kind === 'question') {
        waiters.get(m.id)?.({ ...m, kind: 'answer', fromLabel: 'You', text: 'You declined to pass this question on. Decide for yourself, and say what you assumed.' });
        waiters.delete(m.id);
      }
      changed();
    },
    inbox(memberId) {
      const from = joinedAt.get(memberId) ?? messages.length;
      const done = shown.get(memberId) ?? new Set<string>();
      const fresh = messages.slice(from).filter((m) => visible(m) && !done.has(m.id) && m.from !== memberId && (!m.to || m.to === memberId));
      for (const m of fresh) done.add(m.id);
      shown.set(memberId, done);
      return fresh;
    },
    openQuestions(memberId) {
      return messages.filter((q) => q.kind === 'question' && visible(q) && q.to === memberId && !messages.some((a) => a.kind === 'answer' && a.replyTo === q.id && visible(a)));
    },
    search(query, limit = 20) {
      const words = query.toLowerCase().split(/\s+/).filter(Boolean);
      if (!words.length) return messages.filter(visible).slice(-limit);
      return messages
        .filter((m) => visible(m) && words.every((w) => `${m.fromLabel} ${m.kind} ${m.text}`.toLowerCase().includes(w)))
        .slice(-limit);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return channel;
}

/* ------------------------------------------------------------------ for the agent */

const KIND_LABEL: Record<MessageKind, string> = { decision: 'Decision', question: 'Question', answer: 'Answer', handoff: 'Handoff', note: 'Note' };

export function formatMessage(m: ChannelMessage): string {
  const to = m.to ? ` → ${m.to === YOU ? 'you' : m.to}` : '';
  return `[${KIND_LABEL[m.kind]} ${m.id} from ${m.fromLabel}${to}] ${m.text}`;
}

/** What an agent is told after a tool call when something arrived for it */
export function inboxNote(messages: ChannelMessage[], memberId: string): string {
  if (!messages.length) return '';
  const lines = messages.map(formatMessage);
  const asked = messages.some((m) => m.kind === 'question' && m.to === memberId);
  return `\n\n--- Channel: ${messages.length} new message${messages.length > 1 ? 's' : ''} ---\n${lines.join('\n')}${asked ? '\nAnswer questions addressed to you with answer_question (use its id), then carry on.' : ''}`;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const ok = (content: string): ToolResult => ({ ok: true, content });
const fail = (content: string): ToolResult => ({ ok: false, content });

/** The channel tools one agent gets */
export function channelTools(channel: Channel, me: string, options: { timeoutMs?: number } = {}): Tool[] {
  const others = () => channel.members().filter((m) => m.id !== me);
  const resolve = (target: string) => {
    if (!target || target === YOU || /^(you|user|human)$/i.test(target)) return YOU;
    const all = others();
    return all.find((m) => m.id === target)?.id ?? all.find((m) => m.label.toLowerCase() === target.toLowerCase())?.id ?? null;
  };
  return [
    {
      name: 'list_agents',
      description: 'List the other agents working on this project right now (and recently finished ones): their id, label, goal and status. Use it before asking someone.',
      risk: 'read',
      parameters: { type: 'object', properties: {} },
      run: async () => {
        const list = others();
        if (!list.length) return ok('No other agents are on the channel. You can still ask the user with ask_agent to "you".');
        return ok(list.map((m) => `${m.id} · ${m.label} · ${m.status}${m.status === 'done' && m.summary ? ` · finished: ${m.summary.slice(0, 200)}` : ''}\n  goal: ${m.goal.slice(0, 240)}`).join('\n'));
      },
    },
    {
      name: 'post_message',
      description: 'Tell the other agents (and the user) something they need to know: a decision that affects them (a renamed API, a changed type, a new file they should use), a handoff of work you are not doing, or a short note. Keep it to one fact.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['decision', 'handoff', 'note'], description: 'decision: something you changed or chose that others must follow; handoff: work for another agent; note: anything else' },
          text: { type: 'string', description: 'The message, specific (names, paths, signatures)' },
          to: { type: 'string', description: 'An agent id or label for one agent; leave out for everyone' },
        },
        required: ['kind', 'text'],
      },
      run: async (args) => {
        const text = str(args.text).trim();
        if (!text) return fail('Say what the message is.');
        const kind = (['decision', 'handoff', 'note'] as const).find((k) => k === args.kind) ?? 'note';
        const to = args.to ? resolve(str(args.to)) : undefined;
        if (args.to && !to) return fail(`No agent called "${str(args.to)}". Use list_agents.`);
        const m = channel.post({ from: me, kind, text, ...(to ? { to } : {}) });
        return ok(m.status === 'held' ? `Posted (${m.id}). The user approves messages between agents first, so it is delivered once they OK it.` : `Posted (${m.id}).`);
      },
    },
    {
      name: 'ask_agent',
      description: 'Ask another agent, or the user ("you"), a question and wait for the answer. Use it when you need something only they know (what they changed, what they want), not for things you can read in the files. You wait up to two minutes; if no answer comes, decide yourself and say what you assumed.',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'An agent id or label from list_agents, or "you" for the user' },
          question: { type: 'string', description: 'One clear question' },
        },
        required: ['to', 'question'],
      },
      run: async (args, { signal }) => {
        const question = str(args.question).trim();
        if (!question) return fail('Ask a question.');
        const to = resolve(str(args.to));
        if (!to) return fail(`No agent called "${str(args.to)}". Use list_agents, or ask "you" (the user).`);
        const reply = await channel.ask(me, to, question, { timeoutMs: options.timeoutMs, signal });
        return reply ? ok(`${reply.by}: ${reply.answer}`) : ok('No answer in time. Decide yourself, and say in your summary what you assumed.');
      },
    },
    {
      name: 'answer_question',
      description: 'Answer a question another agent asked you (its id is in the channel note that showed it to you).',
      risk: 'read',
      parameters: {
        type: 'object',
        properties: { id: { type: 'string', description: 'The question id' }, answer: { type: 'string', description: 'Your answer, specific' } },
        required: ['id', 'answer'],
      },
      run: async (args) => {
        const answer = str(args.answer).trim();
        if (!answer) return fail('Give an answer.');
        return channel.answer(me, str(args.id), answer) ? ok('Answered.') : fail('No open question with that id (it may be answered already).');
      },
    },
    {
      name: 'search_channel',
      description: 'Search the channel history of this project (decisions, questions and answers from earlier work) by words, e.g. "api route rename". Use it before deciding something a past agent may already have decided.',
      risk: 'read',
      parameters: { type: 'object', properties: { query: { type: 'string', description: 'Words to look for; empty for the latest messages' } } },
      run: async (args) => {
        const found = channel.search(str(args.query));
        return ok(found.length ? found.map((m) => `${new Date(m.at).toISOString().slice(0, 16)} ${formatMessage(m)}`).join('\n') : 'Nothing in the channel matches.');
      },
    },
  ];
}

/** Every tool result also carries what arrived on the channel for this agent since its last step */
export function withInbox(tools: Tool[], channel: Channel, me: string): Tool[] {
  return tools.map((tool) => ({
    ...tool,
    run: async (args, context) => {
      const result = await tool.run(args, context);
      const note = inboxNote(channel.inbox(me), me);
      return note ? { ...result, content: result.content + note } : result;
    },
  }));
}

/** What the agent is told about the channel in its instructions */
export function channelBrief(channel: Channel, me: string): string {
  const others = channel.members().filter((m) => m.id !== me && m.status === 'working');
  const team = others.length ? `Working now: ${others.map((m) => `${m.label} (${m.id}): ${m.goal.slice(0, 120)}`).join('; ')}.` : 'No other agent is working right now.';
  return [
    '',
    '<channel>',
    'You share a channel with the other agents working on this project, and with the user.',
    team,
    '- When you change something others depend on (an API route, a function signature, a file they use), post_message a decision right away.',
    '- When you need something only another agent or the user knows, ask_agent. Do not ask what you can read in the files.',
    '- Questions addressed to you show up after your tool calls: answer them with answer_question before carrying on.',
    '- search_channel finds decisions from earlier work on this project.',
    '</channel>',
  ].join('\n');
}

/* ------------------------------------------------------------------ history files */

export const dayFile = (at: number) => `${CHANNEL_DIR}/${new Date(at).toISOString().slice(0, 10)}.jsonl`;

/** Messages as JSON lines (held and declined ones are not kept) */
export function toJsonl(messages: ChannelMessage[]): string {
  return messages.filter((m) => !m.status).map((m) => JSON.stringify(m)).join('\n') + (messages.length ? '\n' : '');
}

/** The channel history in a project's files, oldest first; malformed lines are skipped */
export function readHistory(files: Record<string, string>): ChannelMessage[] {
  const out: ChannelMessage[] = [];
  for (const [path, content] of Object.entries(files)) {
    if (!path.startsWith(`${CHANNEL_DIR}/`) || !path.endsWith('.jsonl')) continue;
    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line) as ChannelMessage;
        if (typeof m.id === 'string' && typeof m.text === 'string' && typeof m.at === 'number' && typeof m.from === 'string' && m.kind in KIND_LABEL) out.push(m);
      } catch {
        // skip
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

/** The day files to write for these messages, merged with what the project already has */
export function historyFiles(files: Record<string, string>, messages: ChannelMessage[]): Record<string, string> {
  const byDay = new Map<string, ChannelMessage[]>();
  for (const m of readHistory(files)) byDay.set(dayFile(m.at), [...(byDay.get(dayFile(m.at)) ?? []), m]);
  const known = new Set([...byDay.values()].flat().map((m) => m.id));
  const out: Record<string, string> = {};
  for (const m of messages) {
    if (m.status || known.has(m.id)) continue;
    const day = dayFile(m.at);
    byDay.set(day, [...(byDay.get(day) ?? []), m]);
    out[day] = '';
  }
  for (const day of Object.keys(out)) out[day] = toJsonl(byDay.get(day)!);
  return out;
}
