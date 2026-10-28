/**
 * Signing in with Google without a website: Google's device flow (for apps on devices with no browser of their own to
 * redirect). The studio asks Google for a short code, you enter it at google.com/device, and the studio's server picks
 * up your identity. It needs a Google OAuth client of the "TVs and limited-input devices" type: GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET (for this client type Google issues a secret and documents it as not confidential).
 *
 * Only identity is asked for (openid, email, profile). The ID token comes straight from Google's token endpoint over
 * TLS, which the OpenID Connect spec accepts without checking its signature; the issuer, audience and expiry are still
 * checked. Server only.
 */

import type { Account } from './account.ts';

const BASE = 'https://oauth2.googleapis.com';
export const GOOGLE_SCOPE = 'openid email profile';

export const googleConfigured = (env: Record<string, string | undefined> = process.env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export interface GoogleDeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export type GooglePoll =
  | { status: 'done'; account: Account }
  | { status: 'pending'; interval?: number }
  | { status: 'expired' | 'denied' | 'error'; message: string };

const form = async (url: string, body: Record<string, string>) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
};

export async function startGoogleDevice(clientId: string): Promise<GoogleDeviceStart | { error: string }> {
  try {
    const { ok, data } = await form(`${BASE}/device/code`, { client_id: clientId, scope: GOOGLE_SCOPE });
    if (!ok || typeof data.device_code !== 'string') return { error: `Google refused to start sign-in: ${String(data.error_description ?? data.error ?? 'unknown error')}` };
    return {
      deviceCode: data.device_code,
      userCode: String(data.user_code),
      verificationUri: String(data.verification_url ?? data.verification_uri ?? 'https://www.google.com/device'),
      expiresIn: Number(data.expires_in) || 1800,
      interval: Number(data.interval) || 5,
    };
  } catch (error) {
    return { error: `Could not reach Google: ${(error as Error).message}` };
  }
}

const decode = (part: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** The account in a Google ID token, if it is for this client, from Google, current and has a verified email */
export function readIdToken(idToken: unknown, clientId: string, now = Date.now()): Account | null {
  if (typeof idToken !== 'string') return null;
  const parts = idToken.split('.');
  if (parts.length !== 3) return null;
  const claims = decode(parts[1]);
  if (!claims) return null;
  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return null;
  if (claims.aud !== clientId) return null;
  if (typeof claims.exp !== 'number' || claims.exp * 1000 < now) return null;
  if (typeof claims.sub !== 'string' || typeof claims.email !== 'string' || claims.email_verified === false) return null;
  return {
    provider: 'google',
    id: claims.sub.slice(0, 64),
    name: typeof claims.name === 'string' && claims.name ? claims.name.slice(0, 120) : claims.email,
    handle: claims.email.slice(0, 254),
    avatar: typeof claims.picture === 'string' && /^https:\/\//.test(claims.picture) ? claims.picture.slice(0, 500) : null,
  };
}

/** Pure: Google's answer to a poll, as a status */
export function readGooglePoll(data: Record<string, unknown>, clientId: string, now = Date.now()): GooglePoll {
  if (typeof data.id_token === 'string') {
    const account = readIdToken(data.id_token, clientId, now);
    return account ? { status: 'done', account } : { status: 'error', message: 'Google’s answer didn’t check out. Try again.' };
  }
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'pending', interval: Number(data.interval) || 10 };
    case 'expired_token':
      return { status: 'expired', message: 'The code expired. Start again for a new one.' };
    case 'access_denied':
      return { status: 'denied', message: 'Sign-in was cancelled on Google.' };
    default:
      return { status: 'error', message: String(data.error_description ?? data.error ?? 'Google did not answer') };
  }
}

export async function pollGoogleDevice(clientId: string, clientSecret: string, deviceCode: string): Promise<GooglePoll> {
  try {
    const { data } = await form(`${BASE}/token`, { client_id: clientId, client_secret: clientSecret, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    return readGooglePoll(data, clientId);
  } catch (error) {
    return { status: 'error', message: `Could not reach Google: ${(error as Error).message}` };
  }
}
