'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { AccountDialog } from '@/workspace/components/AccountDialog';
import { SignInDialog, type SignInProvider } from '@/workspace/components/SignInDialog';

interface Seat {
  handle: string;
  addedAt: number;
}
interface Subscription {
  status: 'trialing' | 'active' | 'canceled' | 'expired';
  trialEndsAt: number;
  discounted: boolean;
  seats: Seat[];
  daysLeft: number;
  active: boolean;
}
interface State {
  account: { name: string; handle: string; provider: string } | null;
  subscription: Subscription | null;
  limits?: { trialDays: number; maxSeats: number };
}

/**
 * Team and billing. Sign in, start the 14-day Team trial (no card), add and remove seats, cancel. It runs against the
 * stand-in provider in lib/billing.ts; a payment provider replaces it without changing this page.
 */
export default function BillingPage() {
  const [state, setState] = useState<State | null>(null);
  const [error, setError] = useState('');
  const [handle, setHandle] = useState('');
  const [discounted, setDiscounted] = useState(false);
  const [signIn, setSignIn] = useState<'choose' | SignInProvider | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => fetch('/api/billing', { cache: 'no-store' }).then((r) => r.json()).then(setState).catch(() => setError('Could not load your team.')), []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    const response = await fetch('/api/billing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    setBusy(false);
    if (!response?.ok) {
      setError(data?.error ?? 'That did not work. Try again.');
      return;
    }
    setState((s) => ({ ...s, ...data }));
    if (body.action === 'add-seat') setHandle('');
  };

  const sub = state?.subscription ?? null;
  const live = !!sub?.active;

  return (
    <div className="app-bg min-h-screen">
      <SiteHeader active="/pricing">
        <Link href="/pricing" className="btn btn-ghost btn-sm">Pricing</Link>
      </SiteHeader>

      <main id="main" className="mx-auto max-w-2xl px-4 pt-16 pb-24">
        <div className="eyebrow text-accent">Team</div>
        <h1 className="display mt-3 text-4xl text-gray-100">Your team</h1>

        {!state && !error && <p className="mt-6 text-sm text-gray-400">Loading…</p>}
        {error && <p className="mt-6 text-sm text-danger" role="alert">{error}</p>}

        {state && !state.account && (
          <section className="mt-6 rounded-2xl border border-border bg-[var(--panel)] p-6">
            <p className="text-gray-300">Sign in with GitHub or Google to start a 14-day Team trial. No card needed.</p>
            <button onClick={() => setSignIn('choose')} className="btn btn-primary mt-5">Sign in</button>
          </section>
        )}

        {state?.account && !sub && (
          <section className="mt-6 rounded-2xl border border-border bg-[var(--panel)] p-6">
            <p className="text-gray-300">
              Signed in as <span className="text-gray-100">{state.account.handle}</span>. The Team trial lasts {state.limits?.trialDays ?? 14} days, has no card and goes back to Free if you do nothing.
            </p>
            <label className="mt-4 flex items-center gap-2 text-sm text-gray-300">
              <input type="checkbox" checked={discounted} onChange={(e) => setDiscounted(e.target.checked)} />
              We’re a startup under two years old, or a non-profit (50% off when you subscribe)
            </label>
            <button disabled={busy} onClick={() => void act({ action: 'start-trial', discounted })} className="btn btn-primary mt-5">Start the 14-day trial</button>
          </section>
        )}

        {sub && (
          <section className="mt-6 space-y-6">
            <div className="rounded-2xl border border-border bg-[var(--panel)] p-6" data-status={sub.status}>
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="text-lg font-medium text-gray-100">Team</h2>
                <span className="badge" data-testid="status">
                  {sub.status === 'trialing' ? `Trial · ${sub.daysLeft} day${sub.daysLeft === 1 ? '' : 's'} left` : sub.status === 'expired' ? 'Trial ended' : sub.status === 'canceled' ? 'Canceled' : 'Active'}
                </span>
              </div>
              {!live && <p className="mt-3 text-sm text-gray-400">This team is on Free. Everything you built is still yours.</p>}
              {sub.discounted && <p className="mt-3 text-xs text-gray-500">Startup and non-profit discount noted: 50% off when you subscribe.</p>}
            </div>

            <div className="rounded-2xl border border-border bg-[var(--panel)] p-6">
              <h2 className="text-lg font-medium text-gray-100">Seats <span className="font-mono text-sm text-gray-500" data-testid="seat-count">{sub.seats.length}</span></h2>
              <ul className="mt-4 divide-y divide-border">
                {sub.seats.map((seat, i) => (
                  <li key={seat.handle} className="flex items-center justify-between gap-3 py-2.5 text-sm text-gray-300">
                    <span>
                      {seat.handle}
                      {i === 0 && <span className="badge ml-2 px-1.5 py-0 text-[10px]">Owner</span>}
                    </span>
                    {i > 0 && live && (
                      <button disabled={busy} onClick={() => void act({ action: 'remove-seat', handle: seat.handle })} className="btn btn-ghost btn-sm" aria-label={`Remove ${seat.handle}`}>Remove</button>
                    )}
                  </li>
                ))}
              </ul>
              {live && (
                <form
                  className="mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act({ action: 'add-seat', handle });
                  }}
                >
                  <label className="sr-only" htmlFor="seat-handle">GitHub username or email</label>
                  <input
                    id="seat-handle"
                    value={handle}
                    onChange={(e) => setHandle(e.target.value)}
                    placeholder="GitHub username or email"
                    className="min-w-0 flex-1 rounded-lg border border-border-strong bg-black/30 px-3 py-2 text-sm text-gray-100"
                  />
                  <button disabled={busy || !handle.trim()} className="btn btn-secondary">Add seat</button>
                </form>
              )}
              <p className="mt-3 text-xs text-gray-500">Up to {state?.limits?.maxSeats ?? 50} seats on Team. Reviewers who only approve proposals don’t need one.</p>
            </div>

            {live && <button disabled={busy} onClick={() => void act({ action: 'cancel' })} className="btn btn-ghost">Cancel the trial</button>}
          </section>
        )}
      </main>

      {signIn === 'choose' && <AccountDialog first={false} onPick={setSignIn} onSkip={() => setSignIn(null)} onClose={() => setSignIn(null)} />}
      {signIn && signIn !== 'choose' && (
        <SignInDialog
          provider={signIn}
          onClose={() => setSignIn(null)}
          onSignedIn={() => {
            setSignIn(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
