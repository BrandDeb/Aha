import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forkDirections, forkGoal, forkLaneId, isDesignRequest, isForkLane } from '../src/lib/forks.ts';

test('design requests get design directions, code requests code directions', () => {
  assert.equal(isDesignRequest('Make the landing page hero stand out'), true);
  assert.equal(isDesignRequest('Cache the API responses for 5 minutes'), false);
  assert.deepEqual(forkDirections('Redesign the pricing page').map((d) => d.label), ['Minimal', 'Bold', 'Playful']);
  assert.deepEqual(forkDirections('Parse the CSV upload', 2).map((d) => d.label), ['Simplest', 'Robust']);
  assert.equal(forkDirections('Parse the CSV upload', 9).length, 4);
  assert.equal(forkDirections('Parse the CSV upload', 1).length, 2);
});

test('each fork commits to its direction and knows the others exist', () => {
  const dirs = forkDirections('Redesign the pricing page');
  const goal = forkGoal('Redesign the pricing page', dirs[1], dirs);
  assert.match(goal, /^Redesign the pricing page/);
  assert.match(goal, /Bold and vivid/);
  assert.match(goal, /\(minimal, playful\)/);
  assert.match(goal, /clearly "Bold"/);
  assert.equal(forkLaneId(0), 'fork-1');
  assert.ok(isForkLane('fork-3') && !isForkLane('main') && !isForkLane('recommended'));
});
