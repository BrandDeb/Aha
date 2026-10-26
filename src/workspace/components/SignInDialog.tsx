'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitHubUserInfo } from '@/types';
import { Dialog } from './Dialog';

type Step =
  | { kind: 'starting' }
  | { kind: 'code'; userCode: string; verificationUri: string; expiresAt: number }
  | { kind: 'failed'; message: string }
  | { kind: 'unconfigured' };

const post = (body: Record<string, string>) =>
  fetch('/api/github/device', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => ({})) }));

/**
 * Sign in (or sign up) with GitHub using a one-time code: no callback URL, so it works on localhost,
 * in the desktop app and on a server without its own domain. You enter the code on github.com; this
 * dialog waits for GitHub to confirm, then you're signed in.
 */
export function SignInDialog({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: (user: GitHubUserInfo) => void }) {
  const [step, setStep] = useState<Step>({ kind: 'starting' });
  const [copied, setCopied] = useState(false);
  const cancelled = useRef(false);

  const start = useCallback(async () => {
    const config = await fetch('/api/github/device').then((r) => r.json()).catch(() => null);
    if (cancelled.current) return;
    if (!config?.configured) {
      setStep({ kind: 'unconfigured' });
      return;
    }
    const { ok, data } = await post({ action: 'start' });
    if (cancelled.current) return;
    if (!ok) {
      setStep({ kind: 'failed', message: data.error ?? 'GitHub sign-in could not start.' });
      return;
    }
    setStep({ kind: 'code', userCode: data.userCode, verificationUri: data.verificationUri, expiresAt: Date.now() + data.expiresIn * 1000 });
    // Wait for GitHub, at the pace it asks for
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
      if (status === 'done' && poll.data.user) {
        onSignedIn(poll.data.user as GitHubUserInfo);
        return;
      }
      setStep({ kind: 'failed', message: poll.data.message ?? poll.data.error ?? 'Sign-in failed.' });
      return;
    }
  }, [onSignedIn]);

  useEffect(() => {
    cancelled.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starts the sign-in with GitHub; state changes as GitHub answers
    void start();
    return () => {
      cancelled.current = true;
    };
  }, [start]);

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the code is on screen to type
    }
  };

  return (
    <Dialog title="Sign in with GitHub" description="New to GitHub? You can create a free account on the same page." onClose={onClose} width="max-w-md">
      <div className="space-y-4 p-5">
        {step.kind === 'starting' && <p className="text-sm text-gray-400">Asking GitHub for a sign-in code…</p>}
        {step.kind === 'code' && (
          <>
            <ol className="space-y-2 text-sm text-gray-300">
              <li>1. Open GitHub’s sign-in page (it opens in your browser).</li>
              <li>2. Enter this code, then choose Authorize.</li>
            </ol>
            <div className="flex items-center justify-center gap-3 rounded-xl border border-border-strong bg-black/30 py-4">
              <span className="font-mono text-3xl tracking-[0.2em] text-gray-100" aria-label={`Code ${step.userCode.split('').join(' ')}`}>{step.userCode}</span>
              <button onClick={() => void copy(step.userCode)} className="btn btn-ghost btn-sm">{copied ? 'Copied' : 'Copy'}</button>
            </div>
            <a
              href={step.verificationUri}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => void copy(step.userCode)}
              className="btn btn-primary w-full"
            >
              Open github.com/login/device
            </a>
            <p className="flex items-center gap-2 text-xs text-gray-500" role="status">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden="true" />
              Waiting for GitHub. This window signs you in by itself once you authorize.
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
            <p>GitHub sign-in isn’t set up on this server yet. It takes one GitHub OAuth app (no domain needed):</p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>GitHub → Settings → Developer settings → OAuth Apps → New OAuth App.</li>
              <li>Any homepage URL; callback URL <code className="font-mono text-gray-200">http://127.0.0.1/api/github/callback</code>.</li>
              <li>After creating it, tick “Enable Device Flow”.</li>
              <li>Start the studio with <code className="font-mono text-gray-200">GITHUB_CLIENT_ID=&lt;its client ID&gt;</code>.</li>
            </ol>
          </div>
        )}
        <p className="text-[11px] leading-relaxed text-gray-500">
          The studio asks for access to your repositories (pull, push, CI files and Actions) and gists. Your token stays on this studio’s server in an httpOnly cookie; the page never sees it. Sign out from your avatar.
        </p>
      </div>
    </Dialog>
  );
}
