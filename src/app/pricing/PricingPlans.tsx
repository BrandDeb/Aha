'use client';

import { useState } from 'react';
import Link from 'next/link';
import { COMING_SOON, priceLabel, quote, yearlySaving, type Checkout, type Plan } from '@/lib/pricing';

/** The three plan cards, with the monthly / yearly switch */
export function PricingPlans({ plans, checkouts }: { plans: Plan[]; checkouts: Record<string, Checkout> }) {
  const [billing, setBilling] = useState<'monthly' | 'yearly'>('yearly');

  return (
    <div>
      <div className="flex justify-center">
        <div className="segmented" role="group" aria-label="Billing period">
          <button aria-pressed={billing === 'monthly'} onClick={() => setBilling('monthly')}>Monthly</button>
          <button aria-pressed={billing === 'yearly'} onClick={() => setBilling('yearly')}>
            Yearly <span className="ml-1 text-accent">save up to 25%</span>
          </button>
        </div>
      </div>

      <ul className="mt-10 grid gap-4 lg:grid-cols-3">
        {plans.slice(0, 3).map((plan) => (
          <Card key={plan.id} plan={plan} checkout={checkouts[plan.id]} billing={billing} />
        ))}
      </ul>

      <h2 className="mt-14 text-xl font-medium text-gray-100">For companies</h2>
      <p className="mt-1 text-sm text-gray-400">One bill, your own sign-in, and control over what agents can see and do.</p>
      <ul className="mt-6 grid gap-4 md:grid-cols-2">
        {plans.slice(3).map((plan) => (
          <Card key={plan.id} plan={plan} checkout={checkouts[plan.id]} billing={billing} />
        ))}
      </ul>

      <SeatCalculator plans={plans} billing={billing} />
    </div>
  );
}

function Card({ plan, checkout, billing }: { plan: Plan; checkout: Checkout; billing: 'monthly' | 'yearly' }) {
  const external = checkout.href.startsWith('http');
  const button = `btn h-11 w-full text-[15px] ${plan.highlight ? 'btn-primary' : 'btn-secondary'}`;
  const unit = plan.contact ? '' : plan.monthly === null ? 'forever' : `/ month${plan.perSeat ? ' per seat' : ''}`;
  return (
    <li
      aria-label={`${plan.name} plan`}
      className={`relative flex flex-col rounded-2xl border p-6 ${plan.highlight ? 'border-accent/60 bg-[var(--raised)] shadow-[0_30px_80px_-40px_var(--accent-soft)]' : 'border-border bg-[var(--panel)]'}`}
    >
      {plan.highlight && <span className="badge absolute -top-3 left-6 border-accent/50 bg-background text-accent">For teams</span>}
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-lg font-medium text-gray-100">{plan.name}</h3>
        <span className="text-xs text-gray-500">{plan.audience}</span>
      </div>
      <p className="mt-1 min-h-[2.5rem] text-sm text-gray-400">{plan.tagline}</p>
      <div className="mt-6 flex items-baseline gap-1.5">
        <span className="font-mono text-5xl tracking-tight text-gray-100" data-price={plan.id}>{priceLabel(plan, billing)}</span>
        <span className="text-sm text-gray-400">{unit}</span>
      </div>
      <p className="mt-1 h-5 text-xs text-gray-500">
        {plan.contact
          ? 'Priced for your size and terms'
          : plan.monthly === null
            ? 'No card, no time limit'
            : billing === 'yearly'
              ? `Billed yearly · save $${yearlySaving(plan)} a year${plan.perSeat ? ' per seat' : ''}`
              : 'Billed monthly · cancel any time'}
      </p>
      <div className="mt-6">
        {external ? (
          <a href={checkout.href} className={button} rel="noopener">{checkout.label}</a>
        ) : (
          <Link href={checkout.href} className={button}>{checkout.label}</Link>
        )}
        {plan.id === 'team' && <p className="mt-2 text-center text-[11px] text-gray-500">14 days, no card. Signs in with GitHub or Google.</p>}
        {!checkout.live && <p className="mt-2 text-center text-[11px] text-gray-500">Paid plans open soon. Everything you build on Free carries over.</p>}
      </div>
      <ul className="mt-6 space-y-2.5 border-t border-border pt-6 text-sm">
        {plan.includes.map((item) => (
          <li key={item} className="flex gap-2.5 text-gray-300">
            <span className="mt-0.5 text-accent" aria-hidden="true">✓</span>
            <span>
              {item}
              {COMING_SOON.has(item) && <span className="badge ml-2 px-1.5 py-0 text-[10px]">Soon</span>}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

/** What a team of a given size pays, so nobody has to do the arithmetic */
function SeatCalculator({ plans, billing }: { plans: Plan[]; billing: 'monthly' | 'yearly' }) {
  const [seats, setSeats] = useState(10);
  const [discounted, setDiscounted] = useState(false);
  const rows = plans.filter((p) => p.id === 'team' || p.id === 'business');
  const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
  return (
    <section className="mt-14 rounded-2xl border border-border bg-[var(--panel)] p-6" aria-labelledby="seat-calc">
      <h2 id="seat-calc" className="text-xl font-medium text-gray-100">What would your team pay?</h2>
      <div className="mt-5 flex flex-wrap items-end gap-6">
        <label className="text-sm text-gray-300">
          Developers
          <input
            type="number"
            min={1}
            max={5000}
            value={seats}
            onChange={(e) => setSeats(Math.min(5000, Math.max(1, Number(e.target.value) || 1)))}
            className="mt-1 block w-28 rounded-lg border border-border-strong bg-black/30 px-3 py-2 font-mono text-gray-100"
          />
        </label>
        <label className="flex items-center gap-2 pb-2 text-sm text-gray-300">
          <input type="checkbox" checked={discounted} onChange={(e) => setDiscounted(e.target.checked)} />
          Startup under two years old, or non-profit (50% off)
        </label>
      </div>
      <dl className="mt-6 grid gap-4 md:grid-cols-2">
        {rows.map((plan) => {
          const q = quote(plan, seats, billing, discounted);
          if (!q) return null;
          const fit = plans.find((p) => p.id === q.suggest);
          return (
            <div key={plan.id} className="rounded-xl border border-border p-4">
              <dt className="text-sm font-medium text-gray-100">{plan.name}</dt>
              <dd className="mt-1 font-mono text-2xl text-gray-100" data-quote={plan.id}>
                {money(q.perMonth)}<span className="text-xs text-gray-500"> / month</span>
              </dd>
              <dd className="mt-1 text-xs text-gray-500">
                {billing === 'yearly' ? `${money(q.perYear)} billed yearly` : 'Billed monthly'}
                {fit && ` · ${seats} developers fits ${fit.name} better`}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className="mt-4 text-xs text-gray-500">Seats pay for the studio, not for tokens: your own or a local model costs nothing extra. Reviewers who only approve proposals are free.</p>
    </section>
  );
}
