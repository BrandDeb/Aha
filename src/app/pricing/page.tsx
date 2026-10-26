import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { checkoutFor, COMPARISON, PLANS, PRICING_FAQ } from '@/lib/pricing';
import { PricingPlans } from './PricingPlans';
import { JsonLd } from '@/components/JsonLd';
import { breadcrumbLd, faqLd, pageMeta, siteUrl, softwareLd } from '@/lib/site';

export const metadata: Metadata = pageMeta({
  title: 'Pricing',
  description: 'Free for the whole studio with your own model. Pro adds the autonomous worker, automatic debugging and the native app. Premium is for forward-deployed, ISV and platform teams.',
  path: '/pricing',
});

function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="text-accent" aria-label="Included">✓</span>;
  if (value === false) return <span className="text-gray-600" aria-label="Not included">–</span>;
  return <span className={value === 'Soon' ? 'badge px-1.5 py-0 text-[10px]' : 'text-gray-300'}>{value}</span>;
}

export default function PricingPage() {
  // NEXT_PUBLIC_ variables are inlined at build time, so each is read by name
  const env = {
    NEXT_PUBLIC_CHECKOUT_PRO_URL: process.env.NEXT_PUBLIC_CHECKOUT_PRO_URL,
    NEXT_PUBLIC_CHECKOUT_PREMIUM_URL: process.env.NEXT_PUBLIC_CHECKOUT_PREMIUM_URL,
    NEXT_PUBLIC_SALES_URL: process.env.NEXT_PUBLIC_SALES_URL,
  };
  const checkouts = Object.fromEntries(PLANS.map((p) => [p.id, checkoutFor(p, env)]));

  return (
    <div className="min-h-screen">
      <JsonLd data={[softwareLd(siteUrl(), PLANS), faqLd(PRICING_FAQ.map((f) => ({ question: f.q, answer: f.a }))), breadcrumbLd(siteUrl(), [{ name: 'Home', path: '/landing' }, { name: 'Pricing', path: '/pricing' }])]} />
      <SiteHeader active="/pricing">
        <Link href="/" className="btn btn-primary btn-sm">Open the studio</Link>
      </SiteHeader>

      <main id="main">
        <section className="mx-auto max-w-6xl px-4 pt-20 pb-16 text-center md:pt-24">
          <div className="eyebrow text-accent">Pricing</div>
          <h1 className="display mx-auto mt-4 max-w-3xl text-[clamp(2.5rem,6vw,4.25rem)] text-gray-100">Free to build. Pay when the AI works for you.</h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-gray-400">
            The whole studio is free with your own model. Pro lets the agent work on its own while you code. Premium is for teams who take it into the field.
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4">
          <PricingPlans plans={PLANS} checkouts={checkouts} />
          <p className="mt-6 text-center text-xs text-gray-500">Prices in US dollars, before tax. Model usage is billed by your provider, not by us.</p>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-24" aria-labelledby="compare">
          <h2 id="compare" className="text-2xl font-semibold tracking-tight text-gray-100 md:text-3xl">Compare plans</h2>
          <div className="mt-8 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="bg-[var(--bar)] text-gray-300">
                <tr>
                  <th scope="col" className="w-1/2 px-4 py-3 font-medium"><span className="sr-only">Feature</span></th>
                  {PLANS.map((p) => <th key={p.id} scope="col" className="px-4 py-3 font-medium">{p.name}</th>)}
                </tr>
              </thead>
              {COMPARISON.map((group) => (
                <tbody key={group.group} className="divide-y divide-border border-t border-border">
                  <tr>
                    <th colSpan={4} scope="colgroup" className="bg-white/[0.02] px-4 pt-5 pb-2 text-xs font-medium uppercase tracking-wider text-gray-500">{group.group}</th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="px-4 py-3 font-normal text-gray-300">{row.label}</th>
                      <td className="px-4 py-3"><Cell value={row.free} /></td>
                      <td className="px-4 py-3"><Cell value={row.pro} /></td>
                      <td className="px-4 py-3"><Cell value={row.premium} /></td>
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24">
          <div className="grid gap-10 lg:grid-cols-[1fr_2fr]">
            <h2 className="text-2xl font-semibold tracking-tight text-gray-100 md:text-3xl">Questions about plans</h2>
            <div className="divide-y divide-border border-y border-border">
              {PRICING_FAQ.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-gray-100">
                    {item.q}
                    <span className="text-gray-500 transition-transform group-open:rotate-45" aria-hidden="true">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-gray-400">{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
