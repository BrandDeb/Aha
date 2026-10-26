import { test } from 'node:test';
import assert from 'node:assert/strict';
import { YOU, channelBrief, channelTools, createChannel, historyFiles, inboxNote, readHistory, withInbox, type ChannelMode } from '../src/lib/agent/channel.ts';
import type { Tool } from '../src/lib/agent/types.ts';

let clock = 1_800_000_000_000;
const make = (mode: ChannelMode = 'open') => createChannel({ mode: () => mode, now: () => ++clock });
const run = (tools: Tool[], name: string, args: Record<string, unknown> = {}, signal?: AbortSignal) => tools.find((t) => t.name === name)!.run(args, { signal });

test('post, inbox and open questions', () => {
  const ch = make();
  ch.join({ id: 'a', label: 'Back end', goal: 'rename the API' });
  ch.join({ id: 'b', label: 'Front end', goal: 'update the client' });
  ch.post({ from: 'a', kind: 'decision', text: 'Renamed /api/items to /api/products' });
  ch.post({ from: 'a', kind: 'note', text: 'to me only', to: 'a' });
  const inbox = ch.inbox('b');
  assert.deepEqual(inbox.map((m) => m.text), ['Renamed /api/items to /api/products']);
  assert.equal(inbox[0].fromLabel, 'Back end');
  assert.deepEqual(ch.inbox('b'), [], 'seen once');
  assert.deepEqual(ch.inbox('a'), [], 'not its own messages');
  const q = ch.post({ from: 'b', kind: 'question', to: 'a', text: 'Keep a redirect?' });
  assert.deepEqual(ch.openQuestions('a').map((m) => m.id), [q.id]);
  ch.answer('a', q.id, 'Yes');
  assert.deepEqual(ch.openQuestions('a'), []);
  assert.equal(ch.answer('a', q.id, 'Again'), null, 'one answer per question');
});

test('ask waits for the answer, times out, stops on abort, and a finished agent answers with its summary', async () => {
  const ch = make();
  ch.join({ id: 'a', label: 'Back end', goal: 'g' });
  ch.join({ id: 'b', label: 'Front end', goal: 'g' });
  const pending = ch.ask('b', 'a', 'Which route?', { timeoutMs: 1000 });
  const q = ch.openQuestions('a')[0];
  ch.answer('a', q.id, '/api/products');
  assert.deepEqual(await pending, { answer: '/api/products', by: 'Back end' });
  assert.equal(await ch.ask('b', 'a', 'Anyone?', { timeoutMs: 10 }), null, 'timeout');
  const controller = new AbortController();
  const aborted = ch.ask('b', 'a', 'Still there?', { timeoutMs: 5000, signal: controller.signal });
  controller.abort();
  assert.equal(await aborted, null);
  // You can answer an agent's question too
  const toYou = ch.ask('b', YOU, 'Keep the old route?', { timeoutMs: 1000 });
  ch.answer(YOU, ch.openQuestions(YOU)[0].id, 'Yes, as a redirect');
  assert.deepEqual(await toYou, { answer: 'Yes, as a redirect', by: 'You' });
  // Finished: questions waiting on it are answered with its summary, and new ones right away
  const waiting = ch.ask('b', 'a', 'Done yet?', { timeoutMs: 1000 });
  ch.finish('a', 'Renamed the route and kept a redirect.');
  assert.match((await waiting)!.answer, /has finished.*kept a redirect/);
  assert.match((await ch.ask('b', 'a', 'And now?'))!.answer, /has finished/);
});

test('ask-first mode holds agent-to-agent messages until you approve or decline', async () => {
  const ch = make('ask');
  ch.join({ id: 'a', label: 'A', goal: 'g' });
  ch.join({ id: 'b', label: 'B', goal: 'g' });
  const m = ch.post({ from: 'a', kind: 'decision', text: 'held' });
  assert.equal(m.status, 'held');
  assert.deepEqual(ch.inbox('b'), [], 'not delivered yet');
  ch.approve(m.id);
  assert.deepEqual(ch.inbox('b').map((x) => x.text), ['held']);
  assert.equal(ch.post({ from: YOU, kind: 'note', text: 'you are always heard' }).status, undefined);
  assert.equal(ch.post({ from: 'a', kind: 'question', to: YOU, text: 'to you' }).status, undefined, 'questions to you are not held');
  const pending = ch.ask('b', 'a', 'May I?', { timeoutMs: 1000 });
  const q = ch.messages().find((x) => x.text === 'May I?')!;
  assert.equal(q.status, 'held');
  ch.decline(q.id);
  assert.match((await pending)!.answer, /declined/);
  assert.equal(ch.messages().find((x) => x.id === q.id)!.status, 'declined');
});

test('tools: list, post, ask, answer and search; inbox rides along with every tool result', async () => {
  const ch = make();
  ch.join({ id: 'a', label: 'Back end', goal: 'rename the items API' });
  ch.join({ id: 'b', label: 'Front end', goal: 'update the client' });
  const a = channelTools(ch, 'a', { timeoutMs: 1000 });
  const b = withInbox(channelTools(ch, 'b', { timeoutMs: 1000 }), ch, 'b');
  assert.match((await run(b, 'list_agents')).content, /a · Back end · working\n  goal: rename the items API/);
  assert.equal((await run(a, 'post_message', { kind: 'decision', text: 'Renamed /api/items to /api/products' })).ok, true);
  assert.equal((await run(a, 'post_message', { kind: 'note', text: 'x', to: 'nobody' })).ok, false);
  // b's next tool call shows the decision
  const listed = await run(b, 'list_agents');
  assert.match(listed.content, /Channel: 1 new message[\s\S]*Decision .* from Back end\] Renamed \/api\/items/);
  // b asks a by label; a sees it in its inbox note and answers
  const asking = run(b, 'ask_agent', { to: 'Back end', question: 'Did you keep a redirect?' });
  const note = inboxNote(ch.inbox('a'), 'a');
  assert.match(note, /Question (\S+) from Front end → a\] Did you keep a redirect\?[\s\S]*answer_question/);
  const id = /Question (\S+) from/.exec(note)![1];
  assert.equal((await run(a, 'answer_question', { id, answer: 'Yes, 301 to the new route' })).ok, true);
  assert.match((await asking).content, /^Back end: Yes, 301 to the new route/);
  assert.match((await run(b, 'search_channel', { query: 'graphql schema' })).content, /Nothing/);
  assert.match((await run(b, 'search_channel', { query: 'renamed products' })).content, /Renamed \/api\/items to \/api\/products/);
  assert.match((await run(b, 'ask_agent', { to: 'ghost', question: 'q' })).content, /No agent called "ghost"/);
  assert.match(channelBrief(ch, 'b'), /Working now: Back end \(a\): rename the items API/);
});

test('history: day files round-trip, skip held messages, merge with what is there', () => {
  const ch = make('ask');
  ch.join({ id: 'a', label: 'A', goal: 'g' });
  ch.post({ from: YOU, kind: 'note', text: 'one' });
  ch.post({ from: 'a', kind: 'decision', text: 'held, not saved' });
  const files = historyFiles({}, ch.messages());
  const [path] = Object.keys(files);
  assert.match(path, /^\.aha\/channels\/\d{4}-\d{2}-\d{2}\.jsonl$/);
  assert.deepEqual(readHistory(files).map((m) => m.text), ['one']);
  const next = make();
  next.post({ from: YOU, kind: 'note', text: 'two' });
  const merged = { ...files, ...historyFiles(files, [...readHistory(files), ...next.messages()]) };
  assert.deepEqual(readHistory(merged).map((m) => m.text), ['one', 'two']);
  assert.deepEqual(historyFiles(merged, readHistory(merged)), {}, 'nothing new to write');
  assert.deepEqual(readHistory({ [path]: 'not json\n{"id":1}\n' }), []);
});
