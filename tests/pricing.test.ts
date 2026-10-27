import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutFor, COMING_SOON, COMPARISON, PLANS, priceLabel, quote, yearlySaving } from '../src/lib/pricing.ts';

const [free, pro, team, business, enterprise] = PLANS;

test('plans: Free, Pro, Team, Business, Enterprise; yearly is cheaper; one highlighted', () => {
  assert.deepEqual(PLANS.map((p) => p.name), ['Free', 'Pro', 'Team', 'Business', 'Enterprise']);
  for (const p of [pro, team, business]) assert.ok(p.yearly! < p.monthly!, p.name);
  assert.deepEqual([team.monthly, team.yearly, business.monthly, business.yearly], [24, 20, 45, 38]);
  assert.equal(PLANS.filter((p) => p.highlight).length, 1);
  assert.equal(priceLabel(free, 'yearly'), '$0');
  assert.equal(priceLabel(enterprise, 'yearly'), 'Custom', 'Enterprise has no list price, and is not shown as free');
  assert.equal(yearlySaving(pro), (pro.monthly! - pro.yearly!) * 12);
  assert.equal(yearlySaving(enterprise), 0);
});

test('nothing on the page is promised that is not in a plan', () => {
  const listed = new Set(PLANS.flatMap((p) => p.includes));
  for (const item of COMING_SOON) assert.ok(listed.has(item), item);
  for (const group of COMPARISON)
    for (const row of group.rows) {
      assert.equal(row.cells.length, PLANS.length, row.label);
      for (const v of row.cells) assert.ok(typeof v === 'boolean' || v.length > 0, row.label);
    }
});

test('checkout: only https links, otherwise the free studio, said plainly', () => {
  assert.deepEqual(checkoutFor(free, {}), { href: '/onboarding', label: 'Start building', live: true });
  assert.equal(checkoutFor(pro, {}).live, false);
  assert.equal(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'javascript:alert(1)' }).live, false);
  assert.equal(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'http://pay.example.com' }).live, false);
  assert.deepEqual(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'https://pay.example.com/pro' }), { href: 'https://pay.example.com/pro', label: 'Get Pro', live: true });
  assert.equal(checkoutFor(business, { NEXT_PUBLIC_SALES_URL: 'https://example.com/sales' }).href, 'https://example.com/sales');
  assert.equal(checkoutFor(enterprise, { NEXT_PUBLIC_SALES_URL: 'https://example.com/sales' }).href, 'https://example.com/sales');
  assert.equal(checkoutFor(enterprise, {}).live, false);
});

test('Team: a trial starts from the account, and a checkout link replaces it when one is set', () => {
  assert.deepEqual(checkoutFor(team, {}), { href: '/billing', label: 'Start a 14-day trial', live: true });
  assert.equal(checkoutFor(team, { NEXT_PUBLIC_CHECKOUT_TEAM_URL: 'http://insecure.example' }).href, '/billing');
  assert.deepEqual(checkoutFor(team, { NEXT_PUBLIC_CHECKOUT_TEAM_URL: 'https://pay.example.com/team' }), { href: 'https://pay.example.com/team', label: 'Buy Team', live: true });
});

test('quote: seats times the seat price, half off for startups, and the plan that fits better', () => {
  assert.deepEqual(quote(team, 10, 'yearly'), { seats: 10, perMonth: 200, perYear: 2400 });
  assert.equal(quote(team, 10, 'monthly')!.perMonth, 240);
  assert.equal(quote(team, 10, 'yearly', true)!.perMonth, 100);
  assert.equal(quote(business, 100, 'yearly')!.perMonth, 3800);
  assert.equal(quote(team, 80, 'yearly')!.suggest, 'business');
  assert.equal(quote(business, 5, 'yearly')!.suggest, 'team');
  assert.equal(quote(business, 400, 'yearly')!.suggest, 'enterprise');
  assert.equal(quote(team, 10, 'yearly')!.suggest, undefined);
  assert.equal(quote(team, 0.4, 'yearly')!.seats, 1, 'never fewer than one seat');
  assert.equal(quote(free, 5, 'yearly'), null);
  assert.equal(quote(pro, 5, 'yearly'), null, 'Pro is for one developer');
  assert.equal(quote(enterprise, 500, 'yearly'), null, 'no list price to multiply');
});
