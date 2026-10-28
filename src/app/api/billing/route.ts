import { NextRequest, NextResponse } from 'next/server';
import { ACCOUNT_COOKIE, readAccount } from '@/lib/account';
import { isSameOrigin } from '@/lib/github-session';
import { addSeat, cancel, daysLeft, effective, hasTeam, readStore, removeSeat, startTrial, TEAM_MAX_SEATS, TRIAL_DAYS, writeStore, accountKey, type Result, type Store } from '@/lib/billing';

export const dynamic = 'force-dynamic';

const view = (request: NextRequest) => {
  const account = readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
  if (!account) return { account: null, subscription: null };
  const sub = effective(readStore()[accountKey(account)]);
  return { account, subscription: sub ? { ...sub, daysLeft: daysLeft(sub), active: hasTeam(sub) } : null };
};

/** The signed-in account's Team subscription, if any */
export async function GET(request: NextRequest) {
  return NextResponse.json({ ...view(request), limits: { trialDays: TRIAL_DAYS, maxSeats: TEAM_MAX_SEATS } }, { headers: { 'Cache-Control': 'no-store' } });
}

/** Start the trial, add or remove a seat, cancel. Needs a signed-in account; only that account's own subscription changes */
export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: 'Cross-origin request rejected' }, { status: 403 });
  const account = readAccount(request.cookies.get(ACCOUNT_COOKIE)?.value);
  if (!account) return NextResponse.json({ error: 'Sign in first.' }, { status: 401 });
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; handle?: unknown; discounted?: unknown };
  const store = readStore();
  let result: Result<Store>;
  switch (body.action) {
    case 'start-trial':
      result = startTrial(store, account, body.discounted === true);
      break;
    case 'add-seat':
      result = addSeat(store, account, body.handle);
      break;
    case 'remove-seat':
      result = removeSeat(store, account, body.handle);
      break;
    case 'cancel':
      result = cancel(store, account);
      break;
    default:
      return NextResponse.json({ error: 'Unknown action.' }, { status: 400 });
  }
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  writeStore(result.value);
  const sub = effective(result.value[accountKey(account)]);
  return NextResponse.json({ account, subscription: sub ? { ...sub, daysLeft: daysLeft(sub), active: hasTeam(sub) } : null }, { headers: { 'Cache-Control': 'no-store' } });
}
