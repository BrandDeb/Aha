/**
 * Team billing, against a stand-in provider. A signed-in account can start one 14-day Team trial (no card), add and
 * remove seats, and cancel. State is a file in ~/.aha (billing.json, this user only), keyed by the account, so the
 * whole flow runs and is tested without a payment provider. A real provider replaces `readStore` / `writeStore` and
 * `startTrial` (checkout, webhooks); the rules below stay. Server only.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Account } from './account.ts';

export const TRIAL_DAYS = 14;
export const TEAM_MAX_SEATS = 50;

export type SubscriptionStatus = 'trialing' | 'active' | 'canceled' | 'expired';

export interface Seat {
  /** A GitHub login or an email address, as typed */
  handle: string;
  addedAt: number;
}

export interface Subscription {
  plan: 'team';
  status: SubscriptionStatus;
  startedAt: number;
  trialEndsAt: number;
  /** Half off for a startup or non-profit */
  discounted: boolean;
  /** The first seat is the owner's and cannot be removed */
  seats: Seat[];
}

/** Subscriptions by account key (`provider:id`) */
export type Store = Record<string, Subscription>;

export const accountKey = (account: Pick<Account, 'provider' | 'id'>) => `${account.provider}:${account.id}`;

const DAY = 86_400_000;

/** Whether the subscription still gives the paid plan: a trial that has run out gives Free again */
export function effective(sub: Subscription | undefined, now = Date.now()): Subscription | undefined {
  if (!sub) return undefined;
  if (sub.status === 'trialing' && now >= sub.trialEndsAt) return { ...sub, status: 'expired' };
  return sub;
}

export const hasTeam = (sub: Subscription | undefined, now = Date.now()) => {
  const s = effective(sub, now);
  return !!s && (s.status === 'trialing' || s.status === 'active');
};

export const daysLeft = (sub: Subscription, now = Date.now()) => (sub.status === 'trialing' ? Math.max(0, Math.ceil((sub.trialEndsAt - now) / DAY)) : 0);

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });

/** The 14-day Team trial: once per account, whether or not the last one ran out */
export function startTrial(store: Store, account: Account, discounted = false, now = Date.now()): Result<Store> {
  const key = accountKey(account);
  if (store[key]) return fail(effective(store[key], now)!.status === 'trialing' ? 'The trial has already started.' : 'This account has already had its Team trial.');
  const sub: Subscription = {
    plan: 'team',
    status: 'trialing',
    startedAt: now,
    trialEndsAt: now + TRIAL_DAYS * DAY,
    discounted,
    seats: [{ handle: account.handle, addedAt: now }],
  };
  return { ok: true, value: { ...store, [key]: sub } };
}

/** A seat handle: a GitHub login or an email address, nothing else */
export function cleanHandle(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const handle = input.trim().replace(/^@/, '');
  if (handle.length > 254) return null;
  const email = /^[^\s@<>"'`,;]+@[^\s@<>"'`,;]+\.[^\s@<>"'`,;]{2,}$/.test(handle);
  const login = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(handle) && !handle.endsWith('-') && !handle.includes('--');
  return email || login ? handle.toLowerCase() : null;
}

const mutable = (store: Store, account: Account, now: number): Result<Subscription> => {
  const sub = effective(store[accountKey(account)], now);
  if (!sub) return fail('Start the Team trial first.');
  if (sub.status === 'expired') return fail('The trial has ended. Seats can be changed again once the team is on a paid plan.');
  if (sub.status === 'canceled') return fail('The subscription is canceled.');
  return { ok: true, value: sub };
};

export function addSeat(store: Store, account: Account, handleInput: unknown, now = Date.now()): Result<Store> {
  const found = mutable(store, account, now);
  if (!found.ok) return found;
  const handle = cleanHandle(handleInput);
  if (!handle) return fail('Enter a GitHub username or an email address.');
  const sub = found.value;
  if (sub.seats.some((s) => s.handle.toLowerCase() === handle)) return fail(`${handle} already has a seat.`);
  if (sub.seats.length >= TEAM_MAX_SEATS) return fail(`Team is for up to ${TEAM_MAX_SEATS} developers. Business covers 25 to 250.`);
  return { ok: true, value: { ...store, [accountKey(account)]: { ...sub, seats: [...sub.seats, { handle, addedAt: now }] } } };
}

export function removeSeat(store: Store, account: Account, handleInput: unknown, now = Date.now()): Result<Store> {
  const found = mutable(store, account, now);
  if (!found.ok) return found;
  const handle = cleanHandle(handleInput);
  const sub = found.value;
  if (!handle || !sub.seats.some((s) => s.handle.toLowerCase() === handle)) return fail('That person has no seat.');
  if (sub.seats[0].handle.toLowerCase() === handle) return fail('The owner’s seat can’t be removed.');
  return { ok: true, value: { ...store, [accountKey(account)]: { ...sub, seats: sub.seats.filter((s) => s.handle.toLowerCase() !== handle) } } };
}

/** Stop the trial or subscription; the seats stay on record, the team goes back to Free */
export function cancel(store: Store, account: Account, now = Date.now()): Result<Store> {
  const found = mutable(store, account, now);
  if (!found.ok) return found;
  return { ok: true, value: { ...store, [accountKey(account)]: { ...found.value, status: 'canceled' } } };
}

/** Where the records live */
const file = (home = process.env.AHA_HOME || path.join(os.homedir(), '.aha')) => path.join(home, 'billing.json');

export function readStore(home?: string): Store {
  try {
    const data = JSON.parse(fs.readFileSync(file(home), 'utf8')) as unknown;
    return data && typeof data === 'object' && !Array.isArray(data) ? (data as Store) : {};
  } catch {
    return {};
  }
}

/** Written whole, then moved into place, so a crash never leaves half a file */
export function writeStore(store: Store, home = process.env.AHA_HOME || path.join(os.homedir(), '.aha')): void {
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const target = file(home);
  const temp = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, target);
}
