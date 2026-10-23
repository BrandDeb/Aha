import { test } from 'node:test';
import assert from 'node:assert/strict';
import { advise, JOBS, keysToGet, PRIORITIES } from '../src/lib/model-advisor.ts';
import { getProvider, resolveFor, EMPTY_AI_CONFIG } from '../src/lib/ai-providers.ts';

test('no keys yet: the first choice for each job, why, and the keys to get', () => {
  const advice = advise('best', {});
  assert.deepEqual(advice.map((a) => [a.job.id, a.provider, a.model]), [
    ['agent', 'anthropic', 'claude-opus-5-5'],
    ['reviewer', 'gemini', 'gemini-pro-latest'],
    ['ask', 'anthropic', 'claude-haiku-5-5'],
    ['complete', 'anthropic', 'claude-haiku-5-5'],
    ['worker', 'anthropic', 'claude-sonnet-5-5'],
  ]);
  assert.ok(advice.every((a) => !a.ready && a.why.length > 40 && a.cost));
  const keys = keysToGet(advice);
  assert.deepEqual(keys.map((k) => [k.provider, k.jobs]), [['anthropic', ['Agent', 'Ask', 'Autocomplete', 'Worker']], ['gemini', ['Second reviewer']]], 'each key once, with the jobs it unlocks');
  assert.match(keys[0].keyUrl, /console\.anthropic\.com/);
});

test('a key you have is used now, and the stronger choice is named as the upgrade', () => {
  const advice = advise('best', { gemini: 'AIza-x' });
  const agent = advice.find((a) => a.job.id === 'agent')!;
  assert.equal(agent.provider, 'gemini');
  assert.equal(agent.ready, true);
  assert.equal(agent.better?.model, 'claude-opus-5-5');
  assert.equal(advice.find((a) => a.job.id === 'reviewer')!.better, undefined, 'already the first choice');
});

test('free and private: no paid provider, and local needs no key', () => {
  for (const a of advise('free', {})) assert.notEqual(getProvider(a.provider)!.cost, 'paid', a.job.id);
  const local = advise('private', {});
  assert.ok(local.every((a) => a.ready && getProvider(a.provider)!.local), 'local models are ready without a key');
  assert.equal(keysToGet(local).length, 0);
  // The free reviewer is a different family from the free agent: a real second opinion
  const free = advise('free', {});
  assert.notEqual(free.find((a) => a.job.id === 'agent')!.provider, free.find((a) => a.job.id === 'reviewer')!.provider);
  assert.equal(JOBS.length, 5);
  assert.equal(PRIORITIES.length, 3);
});

test('each job resolves to its own model when it has a ready one, else the main one', () => {
  const config = { ...EMPTY_AI_CONFIG, provider: 'gemini', keys: { gemini: 'AIza-x', groq: 'gsk_x' }, models: {}, jobs: { reviewer: { provider: 'groq', model: 'openai/gpt-oss-120b' }, worker: { provider: 'anthropic', model: 'claude-sonnet-5-5' } } };
  const reviewer = resolveFor(config, 'reviewer');
  assert.ok(!('error' in reviewer) && reviewer.provider.id === 'groq' && reviewer.model === 'openai/gpt-oss-120b');
  const worker = resolveFor(config, 'worker');
  assert.ok(!('error' in worker) && worker.provider.id === 'gemini', 'no Anthropic key: the worker falls back to the main model');
  const agent = resolveFor(config, 'agent');
  assert.ok(!('error' in agent) && agent.provider.id === 'gemini');
});

test('the reviewer differs from the agent when it can, and says so honestly when it cannot', () => {
  const both = advise('best', { gemini: 'AIza-x', groq: 'gsk_x' });
  const onlyGemini = advise('best', { gemini: 'AIza-x' });
  assert.equal(onlyGemini.find((a) => a.job.id === 'agent')!.provider, 'gemini');
  const reviewer = onlyGemini.find((a) => a.job.id === 'reviewer')!;
  assert.equal(reviewer.provider, 'gemini');
  assert.match(reviewer.why, /same model as the agent/);
  assert.equal(both.find((a) => a.job.id === 'reviewer')!.provider, 'gemini', 'reviewer choices for best are gemini then anthropic');
  const withClaude = advise('best', { anthropic: 'sk-ant-x', gemini: 'AIza-x' });
  assert.equal(withClaude.find((a) => a.job.id === 'agent')!.provider, 'anthropic');
  assert.equal(withClaude.find((a) => a.job.id === 'reviewer')!.provider, 'gemini', 'a different family from the agent');
});
