import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutFor, COMING_SOON, COMPARISON, PLANS, priceLabel, yearlySaving } from '../src/lib/pricing.ts';

const [free, pro, premium] = PLANS;

test('plans: Free, Pro, Premium; yearly is cheaper; one highlighted', () => {
  assert.deepEqual(PLANS.map((p) => p.name), ['Free', 'Pro', 'Premium']);
  for (const p of [pro, premium]) assert.ok(p.yearly! < p.monthly!, p.name);
  assert.equal(PLANS.filter((p) => p.highlight).length, 1);
  assert.equal(priceLabel(free, 'yearly'), '$0');
  assert.equal(yearlySaving(pro), (pro.monthly! - pro.yearly!) * 12);
});

test('nothing on the page is promised that is not in a plan', () => {
  const listed = new Set(PLANS.flatMap((p) => p.includes));
  for (const item of COMING_SOON) assert.ok(listed.has(item), item);
  for (const group of COMPARISON) for (const row of group.rows) for (const v of [row.free, row.pro, row.premium]) assert.ok(typeof v === 'boolean' || v.length > 0, row.label);
});

test('checkout: only https links, otherwise the free studio, said plainly', () => {
  assert.deepEqual(checkoutFor(free, {}), { href: '/onboarding', label: 'Start building', live: true });
  assert.equal(checkoutFor(pro, {}).live, false);
  assert.equal(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'javascript:alert(1)' }).live, false);
  assert.equal(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'http://pay.example.com' }).live, false);
  assert.deepEqual(checkoutFor(pro, { NEXT_PUBLIC_CHECKOUT_PRO_URL: 'https://pay.example.com/pro' }), { href: 'https://pay.example.com/pro', label: 'Get Pro', live: true });
  assert.equal(checkoutFor(premium, { NEXT_PUBLIC_SALES_URL: 'https://example.com/sales' }).href, 'https://example.com/sales');
});
