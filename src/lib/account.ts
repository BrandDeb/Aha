/**
 * The studio's account: who is signed in, whichever provider they used (GitHub or Google). A signed cookie carries
 * the public profile, so the page can show it and the server can trust it; provider tokens (GitHub's) stay in their
 * own httpOnly cookies. Server only.
 *
 * The cookie is `base64url(json).hmac`. The key is AHA_SESSION_SECRET when set (several servers behind one address
 * need the same one); otherwise a random key made once and kept in ~/.aha/session-secret (this user only), so a
 * studio on its own machine keeps you signed in across restarts without any setup.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type Provider = 'github' | 'google';

export interface Account {
  provider: Provider;
  /** The provider's stable id for the person (GitHub's numeric id, Google's `sub`) */
  id: string;
  name: string;
  /** What to call them in short: a GitHub login, or an email address */
  handle: string;
  /** An https image, or null */
  avatar: string | null;
}

export const ACCOUNT_COOKIE = 'aha_account';
export const SESSION_DAYS = 30;

const clip = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : '');

/** Only what the profile needs, bounded, with an https avatar or none: whatever a provider sent, nothing odd gets stored */
export function cleanAccount(input: Partial<Account> & { provider?: unknown }): Account | null {
  if (input.provider !== 'github' && input.provider !== 'google') return null;
  const id = clip(input.id, 64);
  const handle = clip(input.handle, 254);
  if (!id || !handle) return null;
  const avatar = typeof input.avatar === 'string' && /^https:\/\//.test(input.avatar) && input.avatar.length <= 500 ? input.avatar : null;
  return { provider: input.provider, id, name: clip(input.name, 120) || handle, handle, avatar };
}

let cachedSecret: Buffer | null = null;

/** The signing key (see the file comment). `home` and `env` are for tests */
export function sessionSecret(env: Record<string, string | undefined> = process.env, home = env.AHA_HOME || path.join(os.homedir(), '.aha')): Buffer {
  if (env.AHA_SESSION_SECRET && env.AHA_SESSION_SECRET.length >= 32) return Buffer.from(env.AHA_SESSION_SECRET);
  const file = path.join(home, 'session-secret');
  if (env === process.env && cachedSecret) return cachedSecret;
  let secret: Buffer | null = null;
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    if (text.length >= 32) secret = Buffer.from(text);
  } catch {
    // none yet
  }
  if (!secret) {
    secret = Buffer.from(crypto.randomBytes(32).toString('base64url'));
    try {
      fs.mkdirSync(home, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file, secret.toString(), { mode: 0o600, flag: 'wx' });
    } catch {
      // Another start wrote it first (read theirs), or the folder is read-only (this run's key lasts until restart)
      try {
        const text = fs.readFileSync(file, 'utf8').trim();
        if (text.length >= 32) secret = Buffer.from(text);
      } catch {
        // keep the in-memory key
      }
    }
  }
  if (env === process.env) cachedSecret = secret;
  return secret;
}

const mac = (payload: string, secret: Buffer) => crypto.createHmac('sha256', secret).update(payload).digest('base64url');

export function signAccount(account: Account, secret = sessionSecret(), now = Date.now(), days = SESSION_DAYS): string {
  const payload = Buffer.from(JSON.stringify({ a: account, exp: now + days * 86_400_000 })).toString('base64url');
  return `${payload}.${mac(payload, secret)}`;
}

/** The account in a cookie, if it is ours, unaltered and not expired */
export function readAccount(cookie: string | undefined, secret = sessionSecret(), now = Date.now()): Account | null {
  if (!cookie) return null;
  const dot = cookie.indexOf('.');
  if (dot < 1) return null;
  const payload = cookie.slice(0, dot);
  const given = Buffer.from(cookie.slice(dot + 1));
  const expected = Buffer.from(mac(payload, secret));
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { a?: Partial<Account>; exp?: number };
    if (typeof data.exp !== 'number' || data.exp < now || !data.a) return null;
    return cleanAccount(data.a);
  } catch {
    return null;
  }
}

/** Which providers this server can sign people in with */
export function providersFor(env: Record<string, string | undefined> = process.env): { github: boolean; google: boolean } {
  return { github: !!(env.GITHUB_CLIENT_ID || env.NEXT_PUBLIC_GITHUB_CLIENT_ID), google: !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) };
}
