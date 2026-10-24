import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReview, reviewFollowUp, reviewInput, unifiedDiff } from '../src/lib/agent/review.ts';

test('the diff the reviewer reads: hunks with new-file line numbers', () => {
  const before = 'a\nb\nc\nd\ne\nf\ng\nh\ni\nj\n';
  const after = 'a\nb\nc\nD\ne\nf\ng\nh\ni\nj\nk\n';
  const diff = unifiedDiff('x.ts', before, after, 1);
  assert.equal(diff, ['--- x.ts', '+++ x.ts', '@@', '    3 c', '-     d', '+   4 D', '    5 e', '@@', '   10 j', '+  11 k', '   12 '].join('\n'));
  assert.equal(unifiedDiff('x.ts', 'same', 'same'), '');
  assert.match(unifiedDiff('new.ts', '', 'one\ntwo'), /^--- \/dev\/null\n\+\+\+ new\.ts\n@@\n\+   1 one\n\+   2 two$/);
});

test('the input: goal, evidence, contracts and the diff', () => {
  const text = reviewInput({ goal: 'Add a total', summary: 'Added total()', changes: [{ path: 'a.ts', before: '', after: 'export const t = 1;\n' }], evidence: ['built ✓'], contracts: ['No console.log'] });
  assert.match(text, /^Goal: Add a total/);
  assert.match(text, /Evidence: built ✓/);
  assert.match(text, /- No console\.log/);
  assert.match(text, /\+   1 export const t = 1;/);
});

test('reading the answer: tolerant, and a blocker always blocks', () => {
  const r = parseReview('Here you go:\n```json\n{"verdict":"concerns","summary":"Empty input breaks it","findings":[{"severity":"blocker","file":"cart.ts","line":3,"issue":"total([]) returns -1","fix":"return 0"},{"severity":"weird","issue":"naming"},{"nope":1}]}\n```');
  assert.equal(r.verdict, 'block', 'a blocker finding makes it a block');
  assert.deepEqual(r.findings[0], { severity: 'blocker', file: 'cart.ts', line: 3, issue: 'total([]) returns -1', fix: 'return 0' });
  assert.equal(r.findings[1].severity, 'minor');
  assert.equal(r.findings.length, 2, 'a finding without an issue is dropped');
  assert.deepEqual(parseReview('{"verdict":"approve","summary":"Looks right","findings":[]}'), { verdict: 'approve', summary: 'Looks right', findings: [] });
  const prose = parseReview('I think this is fine overall.');
  assert.equal(prose.verdict, 'concerns');
  assert.equal(prose.summary, 'I think this is fine overall.');
  assert.match(reviewFollowUp(r), /1\. \[blocker\] cart\.ts:3: total\(\[\]\) returns -1\n {3}Suggested fix: return 0/);
});
