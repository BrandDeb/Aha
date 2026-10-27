'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubUserInfo } from '@/types';
import { Dialog } from './Dialog';

export type SignInProvider = 'github' | 'google';

/** What a finished sign-in gives back: GitHub also gives the profile the GitHub features use */
export interface SignedIn {
  provider: SignInProvider;
  user?: GitHubUserInfo;
  account?: { provider: SignInProvider; id: string; name: string; handle: string; avatar: string | null };
}

type Step =
  | { kind: 'starting' }
  | { kind: 'code'; userCode: string; verificationUri: string; expiresAt: number }
  | { kind: 'failed'; message: string }
  | { kind: 'unconfigured' };

const COPY = {
  github: {
    name: 'GitHub',
    endpoint: '/api/github/device',
    title: 'Sign in with GitHub',
    description: 'New to GitHub? You can create a free account on the same page.',
    open: 'Open github.com/login/device',
    page: 'GitHub’s sign-in page',
    action: 'Authorize',
    note: 'The studio asks for access to your repositories (pull, push, CI files and Actions) and gists. Your token stays on this studio’s server in an httpOnly cookie; the page never sees it. Sign out from your avatar.',
  },
  google: {
    name: 'Google',
    endpoint: '/api/google/device',
    title: 'Sign in with Google',
    description: 'Use any Google account, including a Google Workspace account from work.',
    open: 'Open google.com/device',
    page: 'Google’s sign-in page',
    action: 'Continue',
    note: 'The studio only asks who you are: your name, email address and picture. It gets no access to your mail, files or anything else in your Google account. Sign out from your avatar.',
  },
} as const;

const UNCONFIGURED = {
  github: (
    <ol className="list-decimal space-y-1 pl-5">
      <li>GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.</li>
      <li>Any homepage URL; callback URL <code className="font-mono text-gray-200">http://127.0.0.1/api/github/callback</code>.</li>
      <li>After creating it, tick “Enable Device Flow”.</li>
      <li>Start the studio with <code className="font-mono text-gray-200">GITHUB_CLIENT_ID=&lt;its client ID&gt;</code>.</li>
    </ol>
  ),
  google: (
    <ol className="list-decimal space-y-1 pl-5">
      <li>Google Cloud Console → APIs &amp; Services → Credentials → Create credentials → OAuth client ID.</li>
      <li>Application type: “TVs and Limited Input devices”. No domain or redirect address is needed.</li>
      <li>Start the studio with <code className="font-mono text-gray-200">GOOGLE_CLIENT_ID</code> and <code className="font-mono text-gray-200">GOOGLE_CLIENT_SECRET</code> set to its values.</li>
    </ol>
  ),
} as const;

/**
 * Sign in (or sign up) with a one-time code: no callback URL, so it works on localhost, in the desktop app and on a
 * server without its own domain. You enter the code on the provider's page; this dialog waits for the provider to
 * confirm, then you're signed in.
 */
export function SignInDialog({ provider, onClose, onSignedIn }: { provider: SignInProvider; onClose: () => void; onSignedIn: (result: SignedIn) => void }) {
  const copy = COPY[provider];
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  const post = useCallback(
    (body: Record<string, string>) => fetch(copy.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) })),
    [copy.endpoint]
  );

  const start = useCallback(async () => {
    const config = await fetch(copy.endpoint).then((r) => r.json()).catch(() => null);
    if (cancelled.current) return;
    if (!config?.configured) {
      setStep({ kind: 'unconfigured' });
      return;
    }
    const { ok, data } = await post({ action: 'start' });
    if (cancelled.current) return;
    if (!ok) {
      setStep({ kind: 'failed', message: data.error ?? `${copy.name} sign-in could not start.` });
      return;
    }
    setStep({ kind: 'code', userCode: data.userCode, verificationUri: data.verificationUri, expiresAt: Date.now() + data.expiresIn * 1000 });
    // Wait for the provider, at the pace it asks for
    let interval = Math.max(5, Number(data.interval) || 5) * 1000;
    for (;;) {
      await new Promise((resolve) => setTimeout(resolve, interval));
      if (cancelled.current) return;
      const poll = await post({ action: 'poll' }).catch(() => ({ ok: false, data: { status: 'pending' } }));
      if (cancelled.current) return;
      const status = poll.data.status;
      if (status === 'pending') {
        if (poll.data.interval) interval = Math.max(interval, poll.data.interval * 1000);
        continue;
      }
      if (status === 'done' && (poll.data.user || poll.data.account)) {
        onSignedIn({ provider, user: poll.data.user, account: poll.data.account });
        return;
      }
      setStep({ kind: 'failed', message: poll.data.message ?? poll.data.error ?? 'Sign-in failed.' });
      return;
    }
  }, [copy.endpoint, copy.name, onSignedIn, post, provider]);

  useEffect(() => {
    cancelled.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the sign-in with the provider; state changes as it answers
    void start();
    return () => {
      cancelled.current = true;
    };
  }, [start]);

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is on screen to type
    }
  };

  return (
    <Dialog title={copy.title} description={copy.description} onClose={onClose} width="max-w-md">
      <div className="space-y-4 p-5">
        {step.kind === 'starting' && <p className="text-sm text-gray-400">Asking {copy.name} for a sign-in code…</p>}
        {step.kind === 'code' && (
          <>
            <ol className="space-y-2 text-sm text-gray-300">
              <li>1. Open {copy.page} (it opens in your browser).</li>
              <li>2. Enter this code, then choose {copy.action}.</li>
            </ol>
            <div className="flex items-center justify-center gap-3 rounded-xl border border-border-strong bg-black/30 py-4">
              <span className="font-mono text-3xl tracking-[0.2em] text-gray-100" aria-label={`Code ${step.userCode.split('').join(' ')}`}>{step.userCode}</span>
              <button onClick={() => void copyCode(step.userCode)} className="btn btn-ghost btn-sm">{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <a href={step.verificationUri} target="_blank" rel="noopener noreferrer" onClick={() => void copyCode(step.userCode)} className="btn btn-primary w-full">
              {copy.open}
            </a>
            <p className="flex items-center gap-2 text-xs text-gray-500" role="status">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              Waiting for {copy.name}. This window signs you in by itself once you finish there.
            </p>
          </>
        )}
        {step.kind === 'failed' && (
          <>
            <p className="text-sm text-danger" role="alert">{step.message}</p>
            <button
              onClick={() => {
                setStep({ kind: 'starting' });
                void start();
              }}
              className="btn btn-secondary w-full"
            >
              Try again
            </button>
          </>
        )}
        {step.kind === 'unconfigured' && (
          <div className="space-y-2 text-sm text-gray-400">
            <p>{copy.name} sign-in isn’t set up on this server yet. It takes one OAuth client:</p>
            {UNCONFIGURED[provider]}
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-gray-500">{copy.note}</p>
      </div>
    </Dialog>
  );
}
