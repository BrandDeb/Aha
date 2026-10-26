/**
 * Signing in with GitHub without a callback URL: GitHub's device flow. The
 * studio asks GitHub for a short code, you enter it at github.com/login/device
 * (signing up there if you have no account), and the studio's server picks up
 * the token. It needs only the OAuth app's client ID (public, no secret), so it
 * works on localhost, in the desktop app on any port, and on a server without
 * its own domain. The web flow (redirect + callback) is used instead when a
 * client secret is configured for the host the studio is served from.
 */

const GITHUB = 'https://github.com';
export const DEVICE_SCOPE = 'repo workflow read:user gist';

/** The OAuth app's client ID: from the environment, else the one this build ships with */
export const githubClientId = (env: Record<string, string | undefined> = process.env) => env.GITHUB_CLIENT_ID || env.NEXT_PUBLIC_GITHUB_CLIENT_ID || '';

/** The redirect sign-in needs a client secret and a callback on the host the studio is served from */
export function webFlowFor(host: string | null, env: Record<string, string | undefined> = process.env): boolean {
  if (!env.GITHUB_CLIENT_ID || !env.GITHUB_CLIENT_SECRET || !host) return false;
  try {
    return new URL(env.GITHUB_REDIRECT_URI || `${env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/github/callback`).host === host;
  } catch {
    return false;
  }
}

/** Secure cookies only over HTTPS: over plain HTTP (localhost, the desktop app) some browsers would drop them */
export const secureCookies = (forwardedProto: string | null, protocol: string) => (forwardedProto?.split(',')[0]?.trim() || protocol.replace(':', '')) === 'https';

export interface DeviceStart {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Seconds the code stays valid */
  expiresIn: number;
  /** Seconds to wait between polls */
  interval: number;
}

export type DevicePoll =
  | { status: 'done'; token: string; scope: string }
  | { status: 'pending'; interval?: number }
  | { status: 'expired' | 'denied' | 'disabled' | 'error'; message: string };

const post = async (url: string, body: Record<string, string>) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: response.ok, data };
};

export async function startDeviceFlow(clientId: string, scope = DEVICE_SCOPE): Promise<DeviceStart | { error: string }> {
  const { ok, data } = await post(`${GITHUB}/login/device/code`, { client_id: clientId, scope });
  if (!ok || typeof data.device_code !== 'string') {
    return { error: data.error === 'device_flow_disabled' ? DISABLED : `GitHub refused to start sign-in: ${String(data.error_description ?? data.error ?? 'unknown error')}` };
  }
  return {
    deviceCode: data.device_code,
    userCode: String(data.user_code),
    verificationUri: String(data.verification_uri ?? `${GITHUB}/login/device`),
    expiresIn: Number(data.expires_in) || 900,
    interval: Number(data.interval) || 5,
  };
}

const DISABLED = 'Device sign-in is turned off for this GitHub OAuth app. In its settings on GitHub, tick “Enable Device Flow”.';

/** Pure: GitHub's answer to a poll, as a status */
export function readPoll(data: Record<string, unknown>): DevicePoll {
  if (typeof data.access_token === 'string' && data.access_token) return { status: 'done', token: data.access_token, scope: String(data.scope ?? '') };
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'pending', interval: Number(data.interval) || undefined };
    case 'expired_token':
      return { status: 'expired', message: 'The code expired. Start again for a new one.' };
    case 'access_denied':
      return { status: 'denied', message: 'Sign-in was cancelled on GitHub.' };
    case 'device_flow_disabled':
      return { status: 'disabled', message: DISABLED };
    default:
      return { status: 'error', message: String(data.error_description ?? data.error ?? 'GitHub did not answer') };
  }
}

export async function pollDeviceFlow(clientId: string, deviceCode: string): Promise<DevicePoll> {
  try {
    const { data } = await post(`${GITHUB}/login/oauth/access_token`, { client_id: clientId, device_code: deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    return readPoll(data);
  } catch (error) {
    return { status: 'error', message: `Could not reach GitHub: ${(error as Error).message}` };
  }
}
