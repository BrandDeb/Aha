'use client';

import { useEffect, useState } from 'react';
import { Dialog } from './Dialog';
import type { SignInProvider } from './SignInDialog';

interface Providers {
  github: boolean;
  google: boolean;
}

const BUTTONS: { id: SignInProvider; label: string; detail: string }[] = [
  { id: 'github', label: 'Continue with GitHub', detail: 'Also lets the studio work with your repositories, pull requests and CI' },
  { id: 'google', label: 'Continue with Google', detail: 'Any Google account, including a work Google Workspace account' },
];

/**
 * Sign in, or sign up, with GitHub or Google. On a first launch it comes before the welcome and offers to carry on
 * without an account: the studio works fully offline with your own or a local model, and an account is what syncs
 * your settings and carries a plan. When the server can't sign anyone in, or someone already is, a first launch skips
 * straight past it.
 */
export function AccountDialog({ first, onPick, onSkip, onClose }: { first: boolean; onPick: (provider: SignInProvider) => void; onSkip: () => void; onClose: () => void }) {
  const [providers, setProviders] = useState<Providers | null>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/account', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data: { account: unknown; providers: Providers }) => {
        if (!live) return;
        // Nothing to sign in with, or already signed in: a first launch has nothing to ask
        if (first && (data.account || (!data.providers.github && !data.providers.google))) onSkip();
        else setProviders(data.providers);
      })
      .catch(() => live && (first ? onSkip() : setProviders({ github: false, google: false })));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- asked once, when the dialog opens
  }, []);

  if (!providers) return null;
  const offered = BUTTONS.filter((b) => providers[b.id]);

  return (
    <Dialog
      title="Sign in to Aha!"
      description={first ? 'Sign in to carry your settings and plan from one machine to the next.' : 'Sign in or sign up with an account you already have.'}
      onClose={first ? onSkip : onClose}
      width="max-w-md"
    >
      <div className="space-y-3 p-5">
        {offered.length === 0 && <p className="text-sm text-gray-400">This server can’t sign anyone in yet: it has no GitHub or Google client set up. See Configuration in the guide.</p>}
        {offered.map((b) => (
          <button key={b.id} onClick={() => onPick(b.id)} className="flex w-full flex-col items-start gap-0.5 rounded-xl border border-border-strong bg-white/[0.03] px-4 py-3 text-left transition-colors hover:bg-white/[0.07]">
            <span className="text-sm text-gray-100">{b.label}</span>
            <span className="text-xs text-gray-500">{b.detail}</span>
          </button>
        ))}
        {first ? (
          <button onClick={onSkip} className="btn btn-ghost w-full">Continue without an account</button>
        ) : (
          <button onClick={onClose} className="btn btn-ghost w-full">Not now</button>
        )}
        {first && <p className="text-[11px] leading-relaxed text-gray-500">The studio works fully without one, on your own machine, with your own model or a local one. You can sign in later from the top bar.</p>}
      </div>
    </Dialog>
  );
}
