import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_VIBE, isVibe, reviewerPromptFor, vibeBrief, VIBES } from '../src/lib/agent/vibe.ts';
import { REVIEWER_PROMPT } from '../src/lib/agent/review.ts';

test('the dial runs from "just make it work" to "explain every line", balanced by default', () => {
  assert.deepEqual(VIBES.map((v) => v.id), ['ship', 'balanced', 'explain', 'every-line']);
  assert.equal(VIBES[0].label, 'Just make it work');
  assert.equal(VIBES.at(-1)!.label, 'Explain every line');
  assert.equal(DEFAULT_VIBE, 'balanced');
  assert.ok(isVibe('explain'));
  assert.ok(!isVibe('loud'));
  assert.ok(!isVibe(undefined));
});

test('the middle stop changes nothing', () => {
  assert.equal(vibeBrief('balanced'), '');
  assert.equal(vibeBrief(), '');
  assert.equal(reviewerPromptFor(REVIEWER_PROMPT, 'balanced'), REVIEWER_PROMPT);
});

test('each end shapes what it explains and when it asks', () => {
  const ship = vibeBrief('ship');
  assert.match(ship, /ask only when you cannot continue/);
  assert.match(ship, /at most two lines/);
  assert.match(ship, /Verify as always/, 'turning the dial never skips verification');
  const explain = vibeBrief('explain');
  assert.match(explain, /for each file you changed/);
  assert.match(explain, /stop and ask with a short list of options/);
  const every = vibeBrief('every-line');
  assert.match(every, /walk through every changed line/);
  assert.match(every, /code comment wherever a line is not obvious/);
  assert.match(every, /Before each design choice/);
});

test('the reviewer goes lighter or deeper with the dial', () => {
  assert.match(reviewerPromptFor(REVIEWER_PROMPT, 'ship'), /report only blockers and major problems/);
  assert.match(reviewerPromptFor(REVIEWER_PROMPT, 'explain'), /hard to follow/);
  assert.match(reviewerPromptFor(REVIEWER_PROMPT, 'every-line'), /every unclear name/);
  // The JSON shape the reviewer answers in stays the same
  for (const v of VIBES) assert.ok(reviewerPromptFor(REVIEWER_PROMPT, v.id).startsWith(REVIEWER_PROMPT));
});
