import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { accountKey, addSeat, cancel, cleanHandle, daysLeft, effective, hasTeam, readStore, removeSeat, startTrial, TEAM_MAX_SEATS, writeStore, type Store } from '../src/lib/billing.ts';
import type { Account } from '../src/lib/account.ts';

const ada: Account = { provider: 'google', id: '1', name: 'Ada', handle: 'ada@example.com', avatar: null };
const bob: Account = { provider: 'github', id: '2', name: 'Bob', handle: 'bob', avatar: null };
const T0 = 1_000_000_000_000;
const DAY = 86_400_000;
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  assert.ok(r.ok, r.ok ? '' : r.error);
  return (r as { ok: true; value: T }).value;
};

test('a trial lasts 14 days, gives Team, then Free again; it cannot be restarted', () => {
  const store = ok(startTrial({}, ada, false, T0));
  const sub = store[accountKey(ada)];
  assert.equal(sub.status, 'trialing');
  assert.equal(daysLeft(sub, T0), 14);
  assert.equal(daysLeft(sub, T0 + 13.5 * DAY), 1);
  assert.ok(hasTeam(sub, T0 + 13 * DAY));
  assert.equal(effective(sub, T0 + 14 * DAY)!.status, 'expired');
  assert.ok(!hasTeam(sub, T0 + 14 * DAY));
  const again = startTrial(store, ada, false, T0 + 20 * DAY);
  assert.ok(!again.ok && /already had/.test(again.error));
  const twice = startTrial(store, ada, false, T0 + DAY);
  assert.ok(!twice.ok && /already started/.test(twice.error));
  assert.ok(startTrial(store, bob, true, T0).ok, 'another account has its own trial');
  assert.ok(!hasTeam(undefined));
});

test('seats: the owner has the first; add, no duplicates, remove, never the owner', () => {
  let store: Store = ok(startTrial({}, ada, false, T0));
  assert.deepEqual(store[accountKey(ada)].seats.map((s) => s.handle), ['ada@example.com']);
  store = ok(addSeat(store, ada, '@Grace', T0 + 1));
  store = ok(addSeat(store, ada, 'linus@example.org', T0 + 2));
  assert.deepEqual(store[accountKey(ada)].seats.map((s) => s.handle), ['ada@example.com', 'grace', 'linus@example.org']);
  const dup = addSeat(store, ada, 'GRACE', T0 + 3);
  assert.ok(!dup.ok && /already has a seat/.test(dup.error));
  const owner = removeSeat(store, ada, 'ada@example.com', T0 + 3);
  assert.ok(!owner.ok && /owner/.test(owner.error));
  store = ok(removeSeat(store, ada, 'grace', T0 + 4));
  assert.equal(store[accountKey(ada)].seats.length, 2);
  const nobody = removeSeat(store, ada, 'nobody', T0 + 4);
  assert.ok(!nobody.ok);
});

test('seat input is a GitHub login or an email, nothing else', () => {
  assert.equal(cleanHandle('  @Octo-Cat '), 'octo-cat');
  assert.equal(cleanHandle('Dev@Example.com'), 'dev@example.com');
  for (const bad of ['', 'a b', '-lead', 'trail-', 'dou--ble', 'x'.repeat(40), '<script>@x.io', 'a@b', 'a@b.c', "o'brien@x.io", 5, null, undefined, {}]) assert.equal(cleanHandle(bad), null, String(bad));
});

test('Team is for up to 50; changes need a live trial or subscription', () => {
  let store: Store = ok(startTrial({}, ada, false, T0));
  for (let i = 1; i < TEAM_MAX_SEATS; i++) store = ok(addSeat(store, ada, `dev${i}@example.com`, T0 + i));
  assert.equal(store[accountKey(ada)].seats.length, TEAM_MAX_SEATS);
  const full = addSeat(store, ada, 'one-more@example.com', T0 + 100);
  assert.ok(!full.ok && /Business/.test(full.error));
  const late = addSeat(store, ada, 'late@example.com', T0 + 15 * DAY);
  assert.ok(!late.ok && /trial has ended/.test(late.error));
  assert.ok(!addSeat({}, ada, 'x@example.com').ok, 'no trial yet');
  const canceled = ok(cancel(store, ada, T0 + DAY));
  assert.equal(canceled[accountKey(ada)].status, 'canceled');
  assert.ok(!hasTeam(canceled[accountKey(ada)], T0 + 2 * DAY));
  assert.ok(!addSeat(canceled, ada, 'x@example.com', T0 + 2 * DAY).ok);
  assert.ok(!cancel(canceled, ada, T0 + 2 * DAY).ok);
});

test('one account never touches another’s subscription', () => {
  const store = ok(startTrial({}, ada, false, T0));
  assert.ok(!addSeat(store, bob, 'x@example.com', T0 + 1).ok);
  assert.ok(!cancel(store, bob, T0 + 1).ok);
  assert.equal(store[accountKey(ada)].status, 'trialing');
});

test('the store is kept private, written whole, and survives junk', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'aha-billing-'));
  assert.deepEqual(readStore(home), {});
  const store = ok(startTrial({}, ada, true, T0));
  writeStore(store, home);
  assert.deepEqual(readStore(home), store);
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(home, 'billing.json')).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(home), ['billing.json'], 'no temp file left behind');
  fs.writeFileSync(path.join(home, 'billing.json'), '[1,2');
  assert.deepEqual(readStore(home), {});
  fs.writeFileSync(path.join(home, 'billing.json'), '[]');
  assert.deepEqual(readStore(home), {});
});
