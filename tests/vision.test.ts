import { test } from 'node:test';
import assert from 'node:assert/strict';
import { imageFromDataUrl, pictureBrief, pictureRequest } from '../src/lib/vision.ts';
import { toAnthropicMessages, toOpenAiMessages } from '../src/lib/agent/model.ts';
import { runAgent } from '../src/lib/agent/loop.ts';
import type { Message } from '../src/lib/agent/types.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('data URLs become images; other types and huge files are refused', () => {
  assert.deepEqual(imageFromDataUrl(`data:image/png;base64,${PNG}`), { mediaType: 'image/png', data: PNG });
  assert.match((imageFromDataUrl(`data:image/svg+xml;base64,${PNG}`) as { error: string }).error, /PNG, JPEG/);
  assert.match((imageFromDataUrl('hello') as { error: string }).error, /not an image/);
  assert.match((imageFromDataUrl(`data:image/png;base64,${'A'.repeat(8_000_000)}`) as { error: string }).error, /limit is 5 MB/);
});

test('images go on the wire for both API shapes', () => {
  const messages: Message[] = [{ role: 'user', content: 'Build this', images: [{ mediaType: 'image/png', data: PNG }] }];
  const openai = toOpenAiMessages('S', messages) as { content: unknown }[];
  assert.deepEqual(openai[1].content, [{ type: 'text', text: 'Build this' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG}` } }]);
  const anthropic = toAnthropicMessages(messages) as { content: unknown }[];
  assert.deepEqual(anthropic[0].content, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: PNG } }, { type: 'text', text: 'Build this' }]);
  // Plain text stays a string
  assert.equal((toOpenAiMessages('S', [{ role: 'user', content: 'hi' }]) as { content: unknown }[])[1].content, 'hi');
});

test('the agent sends the picture with its first message', async () => {
  let seen: Message[] = [];
  await runAgent({ goal: 'Build this', images: [{ mediaType: 'image/png', data: PNG }], system: 's', tools: [], callModel: async ({ messages }) => { seen = messages; return { text: 'done', toolCalls: [], stop: 'end' }; } });
  assert.deepEqual(seen[0], { role: 'user', content: 'Build this', images: [{ mediaType: 'image/png', data: PNG }] });
});

test('briefs: a screenshot is matched, a sketch interpreted; a bare picture still plans a web app', () => {
  assert.match(pictureBrief('screenshot', '', 'PLAN'), /Match it closely[\s\S]*PLAN$/);
  assert.match(pictureBrief('sketch', 'dark mode please', 'PLAN'), /hand-drawn sketch[\s\S]*Also: dark mode please/);
  assert.match(pictureRequest('screenshot', ''), /web app/);
  assert.equal(pictureRequest('sketch', 'A recipe box with tags'), 'A recipe box with tags');
});
