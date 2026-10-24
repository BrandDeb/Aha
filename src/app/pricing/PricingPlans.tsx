'use client';

import { useState } from 'react';
import Link from 'next/link';
import { COMING_SOON, priceLabel, yearlySaving, type Checkout, type Plan } from '@/lib/pricing';

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
        {plans.map((plan) => {
          const checkout = checkouts[plan.id];
          const external = checkout.href.startsWith('http');
          const button = `btn h-11 w-full text-[15px] ${plan.highlight ? 'btn-primary' : 'btn-secondary'}`;
          return (
            <li
              key={plan.id}
              aria-label={`${plan.name} plan`}
              className={`relative flex flex-col rounded-2xl border p-6 ${plan.highlight ? 'border-accent/60 bg-[var(--raised)] shadow-[0_30px_80px_-40px_var(--accent-soft)]' : 'border-border bg-[var(--panel)]'}`}
            >
              {plan.highlight && <span className="badge absolute -top-3 left-6 border-accent/50 bg-background text-accent">Most popular</span>}
              <h2 className="text-lg font-medium text-gray-100">{plan.name}</h2>
              <p className="mt-1 min-h-[2.5rem] text-sm text-gray-400">{plan.tagline}</p>
              <div className="mt-6 flex items-baseline gap-1.5">
                <span className="font-mono text-5xl tracking-tight text-gray-100" data-price={plan.id}>{priceLabel(plan, billing)}</span>
                <span className="text-sm text-gray-400">{plan.monthly === null ? 'forever' : `/ month${plan.perSeat ? ' per seat' : ''}`}</span>
              </div>
              <p className="mt-1 h-5 text-xs text-gray-500">
                {plan.monthly === null ? 'No card, no time limit' : billing === 'yearly' ? `Billed yearly · save $${yearlySaving(plan)} a year${plan.perSeat ? ' per seat' : ''}` : 'Billed monthly · cancel any time'}
              </p>
              <div className="mt-6">
                {external ? (
                  <a href={checkout.href} className={button} rel="noopener">{checkout.label}</a>
                ) : (
                  <Link href={checkout.href} className={button}>{checkout.label}</Link>
                )}
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
        })}
      </ul>
    </div>
  );
}
